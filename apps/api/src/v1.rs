//! Public v1 API: leaderboards and member lookups, authenticated with a
//! developer API key (or the admin token), plus the OpenAPI contract.

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::{ApiError, AppState};

/// Who is calling: the dashboard admin or a scoped API key.
pub enum Caller {
    Admin,
    Key { guild_id: Option<i64> },
}

/// Accept the admin bearer token or an `X-API-Key` developer key.
pub async fn authorize(state: &AppState, headers: &HeaderMap) -> Result<Caller, ApiError> {
    if let Some(bearer) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        if crate::constant_time_eq(bearer, &state.admin_token) {
            return Ok(Caller::Admin);
        }
    }
    if let Some(raw) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        let row = inochi_db::keys::verify_key(&state.pool, &crate::hash_key(raw))
            .await
            .map_err(crate::api_db_error)?
            .ok_or_else(|| ApiError(axum::http::StatusCode::UNAUTHORIZED, "invalid api key".into()))?;
        return Ok(Caller::Key { guild_id: row.guild_id });
    }
    Err(ApiError(axum::http::StatusCode::UNAUTHORIZED, "unauthorized".into()))
}

/// Reject when the caller cannot read `guild_id`.
pub fn ensure_scope(caller: &Caller, guild_id: i64) -> Result<(), ApiError> {
    match caller {
        Caller::Admin => Ok(()),
        Caller::Key { guild_id: scope } => match scope {
            None => Ok(()),
            Some(s) if *s == guild_id => Ok(()),
            Some(_) => Err(ApiError(
                axum::http::StatusCode::FORBIDDEN,
                "api key is scoped to another guild".into(),
            )),
        },
    }
}

#[derive(Deserialize)]
pub struct V1Query {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

/// GET /api/v1/guilds/:guild_id/leaderboards/:kind (total | weekly)
pub async fn leaderboard(
    State(state): State<std::sync::Arc<crate::AppState>>,
    headers: HeaderMap,
    Path((guild_id, kind)): Path<(i64, String)>,
    Query(q): Query<V1Query>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    ensure_scope(&caller, guild_id)?;

    let weekly = matches!(kind.as_str(), "weekly");
    let rows = if weekly {
        inochi_db::members::weekly_leaderboard(&state.pool, guild_id, q.limit.unwrap_or(25), q.offset.unwrap_or(0)).await?
    } else {
        inochi_db::members::leaderboard(&state.pool, guild_id, q.limit.unwrap_or(25), q.offset.unwrap_or(0)).await?
    };

    let curve = match inochi_db::repos::get_settings(&state.pool, guild_id).await {
        Ok(s) => s.curve,
        Err(_) => inochi_core::Curve::default(),
    };
    let entries: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "userId": row.user_id.to_string(),
                "position": row.position,
                "xp": if weekly { row.weekly_xp } else { row.xp },
                "level": curve.level_for_xp(row.xp.max(0) as u64),
            })
        })
        .collect();
    Ok(Json(serde_json::json!({ "guildId": guild_id.to_string(), "kind": kind, "entries": entries })))
}

/// GET /api/v1/guilds/:guild_id/members/:user_id
pub async fn member(
    State(state): State<std::sync::Arc<crate::AppState>>,
    headers: HeaderMap,
    Path((guild_id, user_id)): Path<(i64, i64)>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    ensure_scope(&caller, guild_id)?;

    let member = inochi_db::members::get_member(&state.pool, guild_id, user_id).await?;
    let rank = inochi_db::members::rank_of(&state.pool, guild_id, user_id).await?;
    let curve = match inochi_db::repos::get_settings(&state.pool, guild_id).await {
        Ok(s) => s.curve,
        Err(_) => inochi_core::Curve::default(),
    };
    Ok(Json(serde_json::json!({
        "guildId": guild_id.to_string(),
        "userId": user_id.to_string(),
        "xp": member.xp,
        "weeklyXp": member.weekly_xp,
        "level": curve.level_for_xp(member.xp.max(0) as u64),
        "rank": rank,
        "dailyStreak": member.daily_streak,
    })))
}

/// GET /api/v1/openapi.json — the machine-readable contract.
pub async fn openapi() -> impl IntoResponse {
    Json(serde_json::json!({
        "openapi": "3.0.3",
        "info": { "title": "Inochi public API", "version": "1.0.0" },
        "paths": {
            "/api/v1/guilds/{guildId}/leaderboards/{kind}": {
                "get": {
                    "summary": "Guild leaderboard",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } },
                        { "name": "kind", "in": "path", "required": true, "schema": { "type": "string", "enum": ["total", "weekly"] } },
                        { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 25 } },
                        { "name": "offset", "in": "query", "schema": { "type": "integer", "default": 0 } }
                    ],
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                }
            },
            "/api/v1/guilds/{guildId}/members/{userId}": {
                "get": {
                    "summary": "Member level profile",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } },
                        { "name": "userId", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                }
            }
        },
        "components": {
            "securitySchemes": {
                "ApiKeyAuth": { "type": "apiKey", "in": "header", "name": "X-API-Key" },
                "bearerAuth": { "type": "http", "scheme": "bearer" }
            }
        }
    }))
}

/// Shared handler entry so main.rs can nest these under one router.
pub fn router() -> axum::Router<std::sync::Arc<crate::AppState>> {
    axum::Router::new()
        .route(
            "/api/v1/guilds/:guild_id/leaderboards/:kind",
            axum::routing::get(leaderboard),
        )
        .route("/api/v1/guilds/:guild_id/members/:user_id", axum::routing::get(member))
        .route("/api/v1/openapi.json", axum::routing::get(openapi))
}
