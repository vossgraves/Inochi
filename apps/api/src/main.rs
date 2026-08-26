//! Inochi dashboard API.
//!
//! Phase 1 auth model: a single `ADMIN_TOKEN` bearer token. Discord OAuth
//! session auth replaces this in phase 2, matching the upstream Next.js flow.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use sqlx::PgPool;

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    admin_token: Arc<String>,
}

type SharedState = State<Arc<AppState>>;

fn main() {
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    runtime.block_on(async_main());
}

async fn async_main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL (Neon) must be set");
    let admin_token =
        std::env::var("ADMIN_TOKEN").expect("ADMIN_TOKEN must be set");
    let port: u16 = std::env::var("API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let origins: Vec<String> = std::env::var("DASHBOARD_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:5173".into())
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();

    let pool = inochi_db::connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL");
    inochi_db::migrate(&pool).await.expect("migrations failed");

    let state = Arc::new(AppState {
        pool,
        admin_token: Arc::new(admin_token),
    });

    let cors = {
        let mut middleware = tower_http::cors::CorsLayer::new()
            .allow_methods(tower_http::cors::Any)
            .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);
        for origin in origins {
            if let Ok(parsed) = axum::http::HeaderValue::from_str(&origin) {
                middleware = middleware.allow_origin(parsed);
            }
        }
        middleware
    };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/guilds/:guild_id/leaderboard", get(leaderboard))
        .route("/api/guilds/:guild_id/settings", get(get_settings).put(put_settings))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("failed to bind API port");
    tracing::info!(port, "api listening");
    axum::serve(listener, app).await.expect("server error");
}

// ---------- handlers ----------

/// Liveness + database probe, mirrors upstream `/api/health`.
async fn health(State(state): SharedState) -> impl IntoResponse {
    let (status, body) =
        match sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&state.pool).await {
            Ok(_) => (
                StatusCode::OK,
                serde_json::json!({ "status": "ok", "database": "ok" }),
            ),
            Err(err) => {
                tracing::error!(%err, "health check failed");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    serde_json::json!({ "status": "degraded", "database": "error" }),
                )
            }
        };
    (status, Json(body))
}

#[derive(Deserialize)]
struct LeaderboardQuery {
    #[serde(default)]
    weekly: Option<bool>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    offset: Option<i64>,
}

async fn leaderboard(
    State(state): SharedState,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
    Query(q): Query<LeaderboardQuery>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &headers)?;
    ensure_guild(&state, guild_id).await?;

    let rows = if q.weekly.unwrap_or(false) {
        inochi_db::members::weekly_leaderboard(
            &state.pool,
            guild_id,
            q.limit.unwrap_or(25),
            q.offset.unwrap_or(0),
        )
        .await?
    } else {
        inochi_db::members::leaderboard(
            &state.pool,
            guild_id,
            q.limit.unwrap_or(25),
            q.offset.unwrap_or(0),
        )
        .await?
    };

    let entries: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let level = inochi_core::level_for_xp(row.xp.max(0) as u64);
            serde_json::json!({
                "userId": row.user_id.to_string(),
                "position": row.position,
                "xp": row.xp,
                "weeklyXp": row.weekly_xp,
                "level": level,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({ "entries": entries })))
}

async fn get_settings(
    State(state): SharedState,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &headers)?;
    ensure_guild(&state, guild_id).await?;
    let settings = inochi_db::repos::get_settings(&state.pool, guild_id).await?;
    Ok(Json(serde_json::to_value(settings).map_err(|_| ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "serialize failed".into(),
    ))?))
}

#[derive(Deserialize)]
struct PutSettingsBody {
    /// Discord user id of the acting manager (audit trail).
    actor_id: Option<String>,
    settings: serde_json::Value,
}

async fn put_settings(
    State(state): SharedState,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
    Json(body): Json<PutSettingsBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &headers)?;

    // Parse through the validated engine; unknown fields are rejected here so
    // the dashboard cannot persist garbage.
    let parsed = inochi_core::GuildSettings::from_json(&body.settings).map_err(|err| {
        ApiError(StatusCode::UNPROCESSABLE_ENTITY, err.to_string())
    })?;

    inochi_db::repos::ensure_guild(&state.pool, guild_id).await?;
    let actor_id = body
        .actor_id
        .as_deref()
        .and_then(|s| s.parse::<i64>().ok());
    inochi_db::repos::put_settings(&state.pool, guild_id, &parsed, actor_id).await?;

    Ok(Json(serde_json::json!({ "status": "saved" })))
}

// ---------- helpers ----------

fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    let provided = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match provided {
        Some(token) if constant_time_eq(token, &state.admin_token) => Ok(()),
        _ => Err(ApiError(StatusCode::UNAUTHORIZED, "unauthorized".into())),
    }
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn ensure_guild(state: &AppState, guild_id: i64) -> Result<(), ApiError> {
    inochi_db::repos::ensure_guild(&state.pool, guild_id)
        .await
        .map_err(|err| {
            tracing::error!(%err, "ensure_guild failed");
            ApiError(StatusCode::INTERNAL_SERVER_ERROR, "database error".into())
        })
}

struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!(%err, "database error");
        Self(StatusCode::INTERNAL_SERVER_ERROR, "database error".into())
    }
}

impl From<inochi_db::DbError> for ApiError {
    fn from(err: inochi_db::DbError) -> Self {
        match err {
            inochi_db::DbError::UnknownGuild(_) => {
                Self(StatusCode::NOT_FOUND, "guild not found".into())
            }
            inochi_db::DbError::Settings(msg) => {
                Self(StatusCode::UNPROCESSABLE_ENTITY, msg.to_string())
            }
            other => {
                tracing::error!(error = %other, "database error");
                Self(StatusCode::INTERNAL_SERVER_ERROR, "database error".into())
            }
        }
    }
}
