//! Guild configuration repository.

use serde_json::Value;
use sqlx::{PgExecutor, PgPool};

use crate::DbError;
use inochi_core::GuildSettings;

/// Ensure a guild row exists (idempotent).
///
/// Accepts any executor so it works both with a pool and inside a
/// transaction (`&mut *tx`).
pub async fn ensure_guild(pool: impl PgExecutor<'_>, guild_id: i64) -> Result<(), DbError> {
    sqlx::query("INSERT INTO guilds (id) VALUES ($1) ON CONFLICT (id) DO NOTHING")
        .bind(guild_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Load and validate settings for a guild.
///
/// # Errors
/// [`DbError::UnknownGuild`] if the guild was never registered,
/// [`DbError::Settings`] if the JSONB document fails validation.
pub async fn get_settings(pool: &PgPool, guild_id: i64) -> Result<GuildSettings, DbError> {
    let row: Option<(Value,)> =
        sqlx::query_as("SELECT settings FROM guilds WHERE id = $1")
            .bind(guild_id)
            .fetch_optional(pool)
            .await?;
    let raw = row.ok_or(DbError::UnknownGuild(guild_id))?.0;
    Ok(GuildSettings::from_json(&raw)?)
}

/// Validate then persist a full settings document.
///
/// # Errors
/// [`DbError::Settings`] when validation fails.
pub async fn put_settings(
    pool: &PgPool,
    guild_id: i64,
    settings: &GuildSettings,
    actor_id: Option<i64>,
) -> Result<(), DbError> {
    settings.validate()?;
    // Serializing our own validated struct cannot fail; map defensively.
    let payload = serde_json::to_value(settings)
        .map_err(|_| DbError::Settings(inochi_core::SettingsError::Serialize))?;

    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO guilds (id, settings, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()
        "#,
    )
    .bind(guild_id)
    .bind(&payload)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO audit_events (guild_id, kind, actor_id, payload) VALUES ($1, 'settings.update', $2, $3)",
    )
    .bind(guild_id)
    .bind(actor_id)
    .bind(&payload)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}
