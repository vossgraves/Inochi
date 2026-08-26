//! Level role rewards: roles granted automatically when members reach a
//! level threshold.

use sqlx::PgPool;

use crate::DbResult;

/// Attach (or replace) a role reward at `level`.
pub async fn set_level_role(
    pool: &PgPool,
    guild_id: i64,
    level: i32,
    role_id: i64,
) -> DbResult<()> {
    sqlx::query(
        r#"
        INSERT INTO level_roles (guild_id, level, role_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (guild_id, level) DO UPDATE SET role_id = EXCLUDED.role_id
        "#,
    )
    .bind(guild_id)
    .bind(level)
    .bind(role_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Remove the reward configured at `level`. Returns whether one existed.
pub async fn remove_level_role(
    pool: &PgPool,
    guild_id: i64,
    level: i32,
) -> DbResult<bool> {
    let res =
        sqlx::query("DELETE FROM level_roles WHERE guild_id = $1 AND level = $2")
            .bind(guild_id)
            .bind(level)
            .execute(pool)
            .await?;
    Ok(res.rows_affected() > 0)
}

/// All configured `(level, role_id)` pairs, highest level first.
pub async fn list_level_roles(
    pool: &PgPool,
    guild_id: i64,
) -> DbResult<Vec<(i32, i64)>> {
    let rows: Vec<(i32, i64)> =
        sqlx::query_as("SELECT level, role_id FROM level_roles WHERE guild_id = $1 ORDER BY level DESC")
            .bind(guild_id)
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

/// The most demanding reward the member qualifies for.
///
/// `None` when no threshold is at or below `level`.
pub async fn role_for_level(
    pool: &PgPool,
    guild_id: i64,
    level: u32,
) -> DbResult<Option<i64>> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT role_id FROM level_roles WHERE guild_id = $1 AND level <= $2 ORDER BY level DESC LIMIT 1",
    )
    .bind(guild_id)
    .bind(i32::try_from(level).unwrap_or(i32::MAX))
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(role_id,)| role_id))
}
