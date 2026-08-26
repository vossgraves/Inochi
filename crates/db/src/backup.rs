//! Guild data export/import ("backups").
//!
//! Export produces a single self-describing JSON document; import restores it
//! with non-destructive semantics: member XP is merged by taking the maximum,
//! so importing an old backup never wipes newer progress.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;

use crate::{repos, DbResult};

/// The portable backup document.
#[derive(Debug, Serialize, Deserialize)]
pub struct BackupDoc {
    /// Backup format version, currently always 1.
    pub version: u32,
    pub guild_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<Value>,
    pub members: Vec<BackupMember>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupMember {
    pub user_id: i64,
    pub xp: i64,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportSummary {
    pub settings_applied: bool,
    pub members_merged: u64,
}

/// Dump a guild's settings and leaderboard into a [`BackupDoc`].
///
/// Returns `None` when the guild was never registered.
pub async fn export_guild(pool: &PgPool, guild_id: i64) -> DbResult<Option<BackupDoc>> {
    let settings_row: Option<(Value,)> =
        sqlx::query_as("SELECT settings FROM guilds WHERE id = $1")
            .bind(guild_id)
            .fetch_optional(pool)
            .await?;
    let Some(settings) = settings_row else {
        return Ok(None);
    };

    let rows: Vec<(i64, i64)> =
        sqlx::query_as("SELECT user_id, xp FROM members WHERE guild_id = $1 AND xp > 0")
            .bind(guild_id)
            .fetch_all(pool)
            .await?;

    Ok(Some(BackupDoc {
        version: 1,
        guild_id,
        settings: Some(settings.0),
        members: rows
            .into_iter()
            .map(|(user_id, xp)| BackupMember { user_id, xp })
            .collect(),
    }))
}

/// Restore a [`BackupDoc`]. Settings are replaced wholesale (validated);
/// member XP is merged as `max(current, imported)`.
///
/// # Errors
/// Fails when the settings document does not validate, leaving nothing
/// written (single transaction).
pub async fn import_guild(
    pool: &PgPool,
    guild_id: i64,
    doc: &BackupDoc,
) -> DbResult<ImportSummary> {
    let mut summary = ImportSummary::default();
    let mut tx = pool.begin().await?;

    repos::ensure_guild(&mut *tx, guild_id).await?;

    if let Some(settings_raw) = &doc.settings {
        // Validate before touching the database.
        let parsed = inochi_core::GuildSettings::from_json(settings_raw)?;
        let payload =
            serde_json::to_value(parsed).map_err(|_| crate::DbError::Settings(
                inochi_core::SettingsError::Serialize,
            ))?;
        sqlx::query("UPDATE guilds SET settings = $2, updated_at = now() WHERE id = $1")
            .bind(guild_id)
            .bind(&payload)
            .execute(&mut *tx)
            .await?;
        summary.settings_applied = true;
    }

    let mut merged: u64 = 0;
    for member in &doc.members {
        if member.xp <= 0 {
            continue;
        }
        let res = sqlx::query(
            r#"
            INSERT INTO members (guild_id, user_id, xp, weekly_xp, week_start)
            VALUES ($1, $2, $3, 0, date_trunc('week', now())::date)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET
                xp = GREATEST(members.xp, EXCLUDED.xp),
                updated_at = now()
            "#,
        )
        .bind(guild_id)
        .bind(member.user_id)
        .bind(member.xp)
        .execute(&mut *tx)
        .await?;
        merged += res.rows_affected();
    }
    summary.members_merged = merged;

    tx.commit().await?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_doc_roundtrips() {
        let doc = BackupDoc {
            version: 1,
            guild_id: 42,
            settings: Some(serde_json::json!({ "xp_per_message": 15 })),
            members: vec![BackupMember { user_id: 7, xp: 120 }],
        };
        let json = serde_json::to_string(&doc).unwrap();
        let back: BackupDoc = serde_json::from_str(&json).unwrap();
        assert_eq!(back.members.len(), 1);
        assert_eq!(back.version, 1);
    }
}
