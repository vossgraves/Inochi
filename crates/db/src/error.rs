use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sql(#[from] Box<sqlx::Error>),
    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error("invalid settings document: {0}")]
    Settings(#[from] inochi_core::SettingsError),
    #[error("guild {0} is not registered")]
    UnknownGuild(i64),
}

// sqlx::Error is not Clone/Send-friendly through `Box` in all positions we
// need; a manual From keeps call sites tidy.
impl From<sqlx::Error> for DbError {
    fn from(err: sqlx::Error) -> Self {
        Self::Sql(Box::new(err))
    }
}

pub type DbResult<T> = Result<T, DbError>;
