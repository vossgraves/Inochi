//! Developer API keys (hashed at rest) and top.gg vote records.

use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::DbResult;

#[derive(Debug, sqlx::FromRow)]
pub struct ApiKeyRow {
    pub id: i64,
    #[allow(dead_code)]
    pub label: String,
    pub guild_id: Option<i64>,
    #[allow(dead_code)]
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

/// Insert a key from its pre-hashed value; returns the row id.
pub async fn create_key(
    pool: &PgPool,
    key_hash: &str,
    label: &str,
    guild_id: Option<i64>,
    created_by: Option<i64>,
) -> DbResult<i64> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO api_keys (key_hash, label, guild_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(key_hash)
    .bind(label)
    .bind(guild_id)
    .bind(created_by)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

/// Resolve a pre-hashed key to its row, if active.
pub async fn verify_key(pool: &PgPool, key_hash: &str) -> DbResult<Option<ApiKeyRow>> {
    let row = sqlx::query_as::<_, ApiKeyRow>(
        "SELECT id, label, guild_id, created_at, revoked_at FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    )
    .bind(key_hash)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// List all keys (newest first), including revoked ones for auditability.
pub async fn list_keys(pool: &PgPool) -> DbResult<Vec<ApiKeyRow>> {
    let rows = sqlx::query_as::<_, ApiKeyRow>(
        "SELECT id, label, guild_id, created_at, revoked_at FROM api_keys ORDER BY id DESC LIMIT 100",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Revoke a key. Returns whether it existed and was active.
pub async fn revoke_key(pool: &PgPool, id: i64) -> DbResult<bool> {
    let res = sqlx::query(
        "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

/// Record a vote boost: active until `hours` after voting.
pub async fn record_vote(
    pool: &PgPool,
    provider: &str,
    user_id: i64,
    hours: i64,
) -> DbResult<()> {
    sqlx::query(
        r#"
        INSERT INTO external_votes (provider, user_id, voted_at, expires_at)
        VALUES ($1, $2, now(), now() + make_interval(hours => $3))
        ON CONFLICT (provider, user_id) DO UPDATE SET
            voted_at = now(), expires_at = now() + make_interval(hours => $3)
        "#,
    )
    .bind(provider)
    .bind(user_id)
    .bind(hours)
    .execute(pool)
    .await?;
    Ok(())
}

/// Whether the user's vote boost is currently active.
pub async fn active_vote(pool: &PgPool, provider: &str, user_id: i64) -> DbResult<bool> {
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM external_votes WHERE provider = $1 AND user_id = $2 AND expires_at > now())",
    )
    .bind(provider)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(active)
}

/// Hours remaining on the boost, if active.
pub async fn vote_hours_left(pool: &PgPool, provider: &str, user_id: i64) -> DbResult<Option<i64>> {
    let row: Option<(Option<f64>,)> = sqlx::query_as(
        "SELECT EXTRACT(EPOCH FROM (expires_at - now())) / 3600 FROM external_votes WHERE provider = $1 AND user_id = $2 AND expires_at > now()",
    )
    .bind(provider)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(h,)| h.map(|v| v.ceil() as i64)))
}

/// Guilds the vote should credit (all registered guilds).
pub async fn registered_guilds(pool: &PgPool) -> DbResult<Vec<i64>> {
    let rows: Vec<(i64,)> = sqlx::query_as("SELECT id FROM guilds ORDER BY id")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}
