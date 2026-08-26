//! Inochi dashboard API.
//!
//! Auth models: `ADMIN_TOKEN` bearer (full control), developer API keys
//! (`X-API-Key`, guild-scoped, v1 read endpoints), and Discord OAuth
//! sessions for the dashboard when `DISCORD_CLIENT_SECRET` is set.

mod auth;
mod v1;

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use sqlx::PgPool;

pub(crate) use crate::auth::{ct_eq as constant_time_eq, hash_key};

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    admin_token: Arc<String>,
    /// HMAC key for session cookies (falls back to the admin token).
    session_key: Arc<String>,
    /// Discord OAuth, enabled only with a client secret configured.
    oauth: Option<auth::OAuthConfig>,
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

    // OAuth is opt-in: needs a client secret. The public URL of the API is
    // required to build the redirect URI.
    let oauth = std::env::var("DISCORD_CLIENT_SECRET").ok().map(|secret| {
        let public_base = std::env::var("API_PUBLIC_URL")
            .unwrap_or_else(|_| format!("http://localhost:{port}"));
        let dashboard_url = origins.first().cloned().unwrap_or_default();
        auth::OAuthConfig {
            client_id: std::env::var("DISCORD_CLIENT_ID").unwrap_or_default(),
            client_secret: secret,
            redirect_uri: format!("{public_base}/auth/callback"),
            dashboard_url,
        }
    });

    let state = Arc::new(AppState {
        pool,
        admin_token: Arc::new(admin_token),
        session_key: Arc::new(
            std::env::var("SESSION_SECRET").unwrap_or_else(|_| "inochi-session".into()),
        ),
        oauth,
    });

    let cors = {
        let mut middleware = tower_http::cors::CorsLayer::new()
            .allow_methods(tower_http::cors::Any)
            .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::HeaderName::from_static("x-api-key")]);
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
        .route("/api/guilds/:guild_id/audit", get(audit))
        .route("/api/keys", get(list_keys_route).post(create_key_route))
        .route("/api/keys/:id", axum::routing::delete(revoke_key_route))
        .route("/webhooks/topgg", post(topgg_webhook))
        .route("/auth/login", get(auth::login))
        .route("/auth/callback", get(auth::callback))
        .route("/auth/me", get(auth::me))
        .route("/auth/logout", post(auth::logout))
        .merge(v1::router())
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

    let curve = match inochi_db::repos::get_settings(&state.pool, guild_id).await {
        Ok(s) => s.curve,
        Err(_) => inochi_core::Curve::default(),
    };

    let entries: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let level = curve.level_for_xp(row.xp.max(0) as u64);
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

pub(crate) fn api_db_error(err: inochi_db::DbError) -> ApiError {
    ApiError::from(err)
}

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

async fn ensure_guild(state: &AppState, guild_id: i64) -> Result<(), ApiError> {
    inochi_db::repos::ensure_guild(&state.pool, guild_id)
        .await
        .map_err(|err| {
            tracing::error!(%err, "ensure_guild failed");
            ApiError(StatusCode::INTERNAL_SERVER_ERROR, "database error".into())
        })
}

pub(crate) struct ApiError(pub StatusCode, pub String);

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

// ---------- audit trail ----------

/// GET /api/guilds/:id/audit — recent dashboard/bot configuration events.
async fn audit(
    State(state): SharedState,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    v1::authorize(&state, &headers).await?;
    let rows: Vec<(i64, String, Option<i64>, serde_json::Value, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            "SELECT id, kind, actor_id, payload, created_at FROM audit_events WHERE guild_id = $1 ORDER BY id DESC LIMIT 50",
        )
        .bind(guild_id)
        .fetch_all(&state.pool)
        .await?;
    let events: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(id, kind, actor, payload, at)| {
            serde_json::json!({ "id": id, "kind": kind, "actorId": actor.map(|a| a.to_string()), "payload": payload, "at": at })
        })
        .collect();
    Ok(Json(serde_json::json!({ "events": events })))
}

// ---------- developer API keys ----------

#[derive(Deserialize)]
struct CreateKeyBody {
    label: Option<String>,
    /// Restrict the key to one guild; omit for global read access.
    guild_id: Option<String>,
}

async fn create_key_route(
    State(state): SharedState,
    headers: HeaderMap,
    Json(body): Json<CreateKeyBody>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &headers)?;
    let raw = {
        use rand::Rng;
        let mut buf = [0u8; 24];
        rand::thread_rng().fill(&mut buf);
        format!("inochi_{}", hex::encode(buf))
    };
    let guild_id = body.guild_id.as_deref().and_then(|s| s.parse::<i64>().ok());
    let id = inochi_db::keys::create_key(
        &state.pool,
        &hash_key(&raw),
        body.label.as_deref().unwrap_or(""),
        guild_id,
        None,
    )
    .await
    .map_err(api_db_error)?;
    tracing::info!(key_id = id, "api key created");
    Ok(Json(serde_json::json!({ "id": id, "key": raw })))
}

async fn list_keys_route(
    State(state): SharedState,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &headers)?;
    let rows = inochi_db::keys::list_keys(&state.pool).await.map_err(api_db_error)?;
    let keys: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|k| {
            serde_json::json!({
                "id": k.id,
                "label": k.label,
                "guildId": k.guild_id.map(|g| g.to_string()),
                "createdAt": k.created_at,
                "revoked": k.revoked_at.is_some(),
            })
        })
        .collect();
    Ok(Json(serde_json::json!({ "keys": keys })))
}

async fn revoke_key_route(
    State(state): SharedState,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &headers)?;
    let revoked = inochi_db::keys::revoke_key(&state.pool, id).await.map_err(api_db_error)?;
    Ok(Json(serde_json::json!({ "revoked": revoked })))
}

// ---------- top.gg votes ----------

/// POST /webhooks/topgg — vote rewards.
///
/// Enabled only when `TOPGG_WEBHOOK_SECRET` is set. Votes reward
/// `TOPGG_VOTE_XP` (default 250) in every registered guild once per week.
async fn topgg_webhook(
    State(state): SharedState,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let Some(secret) = std::env::var("TOPGG_WEBHOOK_SECRET").ok().filter(|s| !s.is_empty()) else {
        return Err(ApiError(StatusCode::NOT_IMPLEMENTED, "top.gg webhook not configured".into()));
    };
    let provided = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !constant_time_eq(provided, &secret) {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "unauthorized".into()));
    }
    if body.len() > 16_384 {
        return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE, "Payload too large".into()));
    }
    let parsed: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid json".into()))?;
    let user_id = parsed["user"].as_str().unwrap_or_default();
    if !(16..=20).contains(&user_id.len()) || !user_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid user".into()));
    }
    let is_test = parsed["type"].as_str() == Some("test");
    let uid: i64 = user_id
        .parse()
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Invalid user".into()))?;

    let mut rewarded = 0u32;
    if !is_test && inochi_db::keys::record_vote(&state.pool, uid).await.map_err(api_db_error)? {
        let xp: i64 = std::env::var("TOPGG_VOTE_XP")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(250);
        for guild in inochi_db::keys::registered_guilds(&state.pool).await.map_err(api_db_error)? {
            if inochi_db::members::award_xp(&state.pool, guild, uid, xp, 0).await.is_ok() {
                rewarded += 1;
            }
        }
    }
    Ok(Json(serde_json::json!({ "accepted": true, "rewarded": rewarded })))
}
