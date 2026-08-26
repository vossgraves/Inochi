//! Inochi database layer: PostgreSQL (Neon-compatible) via sqlx.

pub mod backup;
pub mod error;
pub mod members;
pub mod repos;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub use error::{DbError, DbResult};

/// Connection pool with Neon-friendly defaults.
///
/// Neon runs serverless Postgres behind a pooler; we keep the pool small,
/// set generous idle timeouts and always connect over TLS (rustls).
pub async fn connect(database_url: &str) -> Result<PgPool, DbError> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .idle_timeout(std::time::Duration::from_secs(300))
        .connect(database_url)
        .await?;
    Ok(pool)
}

/// Apply embedded migrations. Safe to call on every boot.
pub async fn migrate(pool: &PgPool) -> Result<(), DbError> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}
