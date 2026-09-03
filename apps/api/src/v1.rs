//! Public v1 API: Amari-compatible leaderboards, member lookups, bulk queries,
//! role rewards, guild statistics, OpenAPI specification, and interactive docs.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use std::sync::Arc;

use crate::{ApiError, AppState};

/// Who is calling: the dashboard admin or a scoped developer API key.
pub enum Caller {
    Admin,
    Key { guild_id: Option<i64> },
}

/// Accept the admin bearer token, an `X-API-Key` developer key,
/// or an AmariBot-compatible `Authorization: <api_key>` header.
pub async fn authorize(state: &AppState, headers: &HeaderMap) -> Result<Caller, ApiError> {
    if let Some(auth_val) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
    {
        let token = auth_val.strip_prefix("Bearer ").unwrap_or(auth_val).trim();
        // Check admin token first (constant-time comparison)
        if crate::constant_time_eq(token, &state.admin_token) {
            return Ok(Caller::Admin);
        }
        // Check API key (hashed in database)
        if let Ok(Some(row)) =
            inochi_db::keys::verify_key(&state.pool, &crate::hash_key(token)).await
        {
            return Ok(Caller::Key {
                guild_id: row.guild_id,
            });
        }
    }
    if let Some(raw) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        let row = inochi_db::keys::verify_key(&state.pool, &crate::hash_key(raw.trim()))
            .await
            .map_err(crate::api_db_error)?
            .ok_or_else(|| {
                ApiError(
                    StatusCode::UNAUTHORIZED,
                    "invalid api key".into(),
                )
            })?;
        return Ok(Caller::Key {
            guild_id: row.guild_id,
        });
    }
    Err(ApiError(
        StatusCode::UNAUTHORIZED,
        "unauthorized: provide Authorization or X-API-Key header".into(),
    ))
}

/// Reject when the caller cannot read `guild_id`.
pub fn ensure_scope(caller: &Caller, guild_id: i64) -> Result<(), ApiError> {
    match caller {
        Caller::Admin => Ok(()),
        Caller::Key { guild_id: scope } => match scope {
            None => Ok(()),
            Some(s) if *s == guild_id => Ok(()),
            Some(_) => Err(ApiError(
                StatusCode::FORBIDDEN,
                "api key is scoped to another guild".into(),
            )),
        },
    }
}

/// Query parameters supporting both page-based (Amari style) and offset-based pagination.
#[derive(Debug, Deserialize, Default)]
pub struct PaginationQuery {
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

impl PaginationQuery {
    pub fn resolved_limit(&self) -> i64 {
        self.limit.unwrap_or(50).clamp(1, 100)
    }

    pub fn resolved_offset(&self) -> i64 {
        if let Some(off) = self.offset {
            off.max(0)
        } else if let Some(pg) = self.page {
            (pg.max(1) - 1) * self.resolved_limit()
        } else {
            0
        }
    }

    pub fn resolved_page(&self) -> i64 {
        if let Some(pg) = self.page {
            pg.max(1)
        } else {
            (self.resolved_offset() / self.resolved_limit()) + 1
        }
    }
}

// -----------------------------------------------------------------------------
// Leaderboards (All-time & Weekly & Raw)
// -----------------------------------------------------------------------------

/// GET /api/v1/guilds/:guild_id/leaderboard (Amari-compatible all-time leaderboard)
pub async fn leaderboard_all_time(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
    Query(q): Query<PaginationQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    ensure_scope(&caller, guild_id)?;

    let limit = q.resolved_limit();
    let offset = q.resolved_offset();
    let page = q.resolved_page();

    let rows = inochi_db::members::leaderboard(&state.pool, guild_id, limit, offset).await?;
    let total_count = inochi_db::members::count_members(&state.pool, guild_id, false)
        .await
        .unwrap_or(0);

    let curve = match inochi_db::repos::get_settings(&state.pool, guild_id).await {
        Ok(s) => s.curve,
        Err(_) => inochi_core::Curve::default(),
    };

    let entries: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "userId": row.user_id.to_string(),
                "id": row.user_id.to_string(),
                "position": row.position,
                "rank": row.position,
                "xp": row.xp,
                "weeklyXp": row.weekly_xp,
                "level": curve.level_for_xp(row.xp.max(0) as u64),
            })
        })
        .collect();

    let total_pages = if total_count > 0 {
        (total_count + limit - 1) / limit
    } else {
        1
    };

    Ok(Json(serde_json::json!({
        "guildId": guild_id.to_string(),
        "kind": "total",
        "page": page,
        "limit": limit,
        "total": total_count,
        "totalPages": total_pages,
        "entries": entries,
    })))
}

/// GET /api/v1/guilds/:guild_id/weekly (Amari-compatible weekly leaderboard)
pub async fn leaderboard_weekly(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
    Query(q): Query<PaginationQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    ensure_scope(&caller, guild_id)?;

    let limit = q.resolved_limit();
    let offset = q.resolved_offset();
    let page = q.resolved_page();

    let rows =
        inochi_db::members::weekly_leaderboard(&state.pool, guild_id, limit, offset).await?;
    let total_count = inochi_db::members::count_members(&state.pool, guild_id, true)
        .await
        .unwrap_or(0);

    let curve = match inochi_db::repos::get_settings(&state.pool, guild_id).await {
        Ok(s) => s.curve,
        Err(_) => inochi_core::Curve::default(),
    };

    let entries: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "userId": row.user_id.to_string(),
                "id": row.user_id.to_string(),
                "position": row.position,
                "rank": row.position,
                "xp": row.weekly_xp,
                "totalXp": row.xp,
                "weeklyXp": row.weekly_xp,
                "level": curve.level_for_xp(row.xp.max(0) as u64),
            })
        })
        .collect();

    let total_pages = if total_count > 0 {
        (total_count + limit - 1) / limit
    } else {
        1
    };

    Ok(Json(serde_json::json!({
        "guildId": guild_id.to_string(),
        "kind": "weekly",
        "page": page,
        "limit": limit,
        "total": total_count,
        "totalPages": total_pages,
        "entries": entries,
    })))
}

/// GET /api/v1/guilds/:guild_id/raw/leaderboard (Amari raw compact array format)
pub async fn leaderboard_raw(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
    Query(q): Query<PaginationQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    ensure_scope(&caller, guild_id)?;

    let limit = q.resolved_limit();
    let offset = q.resolved_offset();
    let page = q.resolved_page();

    let rows = inochi_db::members::leaderboard(&state.pool, guild_id, limit, offset).await?;
    let total_count = inochi_db::members::count_members(&state.pool, guild_id, false)
        .await
        .unwrap_or(0);

    let data: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.user_id.to_string(),
                "xp": row.xp,
                "weeklyXp": row.weekly_xp,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "guildId": guild_id.to_string(),
        "page": page,
        "limit": limit,
        "total": total_count,
        "data": data,
    })))
}

/// Legacy / generic route: GET /api/v1/guilds/:guild_id/leaderboards/:kind
pub async fn leaderboard_by_kind(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((guild_id, kind)): Path<(i64, String)>,
    Query(q): Query<PaginationQuery>,
) -> Result<Response, ApiError> {
    if kind == "weekly" {
        Ok(leaderboard_weekly(State(state), headers, Path(guild_id), Query(q)).await?.into_response())
    } else {
        Ok(leaderboard_all_time(State(state), headers, Path(guild_id), Query(q)).await?.into_response())
    }
}

// -----------------------------------------------------------------------------
// Member Lookups (Single & Bulk)
// -----------------------------------------------------------------------------

/// GET /api/v1/guilds/:guild_id/members/:user_id
pub async fn member(
    State(state): State<Arc<AppState>>,
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
        "id": user_id.to_string(),
        "xp": member.xp,
        "weeklyXp": member.weekly_xp,
        "level": curve.level_for_xp(member.xp.max(0) as u64),
        "position": rank,
        "rank": rank,
        "dailyStreak": member.daily_streak,
    })))
}

#[derive(Debug, Deserialize, Default)]
pub struct BulkMembersBody {
    #[serde(default)]
    pub members: Vec<String>,
    #[serde(default)]
    pub uids: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct BulkMembersQuery {
    #[serde(default)]
    pub uids: Option<String>,
}

/// POST /api/v1/guilds/:guild_id/members (Amari-compatible bulk lookup)
/// Also handles GET /api/v1/guilds/:guild_id/members?uids=1,2,3
pub async fn members_bulk_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
    body: Option<Json<BulkMembersBody>>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    ensure_scope(&caller, guild_id)?;

    let mut raw_ids: Vec<String> = Vec::new();
    if let Some(Json(b)) = body {
        raw_ids.extend(b.members);
        raw_ids.extend(b.uids);
    }

    resolve_bulk_members(&state, guild_id, raw_ids).await
}

/// GET /api/v1/guilds/:guild_id/members?uids=1,2,3
pub async fn members_bulk_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
    Query(q): Query<BulkMembersQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    ensure_scope(&caller, guild_id)?;

    let raw_ids: Vec<String> = q
        .uids
        .map(|s| s.split(',').map(str::trim).map(String::from).collect())
        .unwrap_or_default();

    resolve_bulk_members(&state, guild_id, raw_ids).await
}

async fn resolve_bulk_members(
    state: &AppState,
    guild_id: i64,
    raw_ids: Vec<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut parsed_ids: Vec<i64> = raw_ids
        .into_iter()
        .filter_map(|s| s.parse::<i64>().ok())
        .take(100) // cap at 100 members per bulk request
        .collect();

    parsed_ids.sort_unstable();
    parsed_ids.dedup();

    if parsed_ids.is_empty() {
        return Ok(Json(serde_json::json!({
            "guildId": guild_id.to_string(),
            "total": 0,
            "members": []
        })));
    }

    let rows = inochi_db::members::get_members_bulk(&state.pool, guild_id, &parsed_ids).await?;
    let curve = match inochi_db::repos::get_settings(&state.pool, guild_id).await {
        Ok(s) => s.curve,
        Err(_) => inochi_core::Curve::default(),
    };

    let members: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "userId": row.user_id.to_string(),
                "id": row.user_id.to_string(),
                "xp": row.xp,
                "weeklyXp": row.weekly_xp,
                "level": curve.level_for_xp(row.xp.max(0) as u64),
                "position": row.position,
                "rank": row.position,
                "dailyStreak": row.daily_streak,
            })
        })
        .collect();

    let total = members.len();
    Ok(Json(serde_json::json!({
        "guildId": guild_id.to_string(),
        "total": total,
        "members": members,
    })))
}

// -----------------------------------------------------------------------------
// Role Rewards (Amari rewards endpoint)
// -----------------------------------------------------------------------------

/// GET /api/v1/guilds/:guild_id/rewards
pub async fn rewards_list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    ensure_scope(&caller, guild_id)?;

    let rewards_raw = inochi_db::rewards::list_level_roles(&state.pool, guild_id).await?;
    let rewards: Vec<serde_json::Value> = rewards_raw
        .into_iter()
        .map(|(level, role_id)| {
            serde_json::json!({
                "level": level,
                "roleId": role_id.to_string(),
                "role_id": role_id.to_string(),
            })
        })
        .collect();

    let count = rewards.len();
    Ok(Json(serde_json::json!({
        "guildId": guild_id.to_string(),
        "count": count,
        "rewards": rewards,
    })))
}

#[derive(Debug, Deserialize)]
pub struct SetRewardBody {
    pub level: i32,
    #[serde(alias = "role_id")]
    pub role_id: serde_json::Value,
}

/// POST /api/v1/guilds/:guild_id/rewards (Set or update a level role reward)
pub async fn rewards_set(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
    Json(body): Json<SetRewardBody>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    match caller {
        Caller::Admin => {}
        Caller::Key { .. } => {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "role rewards configuration requires admin token".into(),
            ))
        }
    }

    let role_id: i64 = match body.role_id {
        serde_json::Value::Number(n) => n.as_i64().ok_or_else(|| {
            ApiError(StatusCode::BAD_REQUEST, "invalid role_id number".into())
        })?,
        serde_json::Value::String(s) => s.parse::<i64>().map_err(|_| {
            ApiError(StatusCode::BAD_REQUEST, "invalid role_id string".into())
        })?,
        _ => {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "role_id must be a string or number".into(),
            ))
        }
    };

    inochi_db::rewards::set_level_role(&state.pool, guild_id, body.level, role_id).await?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "guildId": guild_id.to_string(),
            "level": body.level,
            "roleId": role_id.to_string(),
            "status": "reward_updated"
        })),
    ))
}

/// DELETE /api/v1/guilds/:guild_id/rewards/:level
pub async fn rewards_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((guild_id, level)): Path<(i64, i32)>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    match caller {
        Caller::Admin => {}
        Caller::Key { .. } => {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "role rewards configuration requires admin token".into(),
            ))
        }
    }

    inochi_db::rewards::remove_level_role(&state.pool, guild_id, level).await?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "guildId": guild_id.to_string(),
            "level": level,
            "status": "reward_removed"
        })),
    ))
}

// -----------------------------------------------------------------------------
// Guild Statistics
// -----------------------------------------------------------------------------

/// GET /api/v1/guilds/:guild_id/stats
pub async fn guild_stats(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(guild_id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    let caller = authorize(&state, &headers).await?;
    ensure_scope(&caller, guild_id)?;

    let stats = inochi_db::members::guild_stats(&state.pool, guild_id).await?;
    let rewards = inochi_db::rewards::list_level_roles(&state.pool, guild_id)
        .await
        .unwrap_or_default();

    let curve = match inochi_db::repos::get_settings(&state.pool, guild_id).await {
        Ok(s) => s.curve,
        Err(_) => inochi_core::Curve::default(),
    };

    let top_level = curve.level_for_xp(stats.max_xp.max(0) as u64);

    Ok(Json(serde_json::json!({
        "guildId": guild_id.to_string(),
        "totalMembers": stats.total_members,
        "totalXp": stats.total_xp,
        "topXp": stats.max_xp,
        "topLevel": top_level,
        "rewardsCount": rewards.len(),
    })))
}

// -----------------------------------------------------------------------------
// OpenAPI 3.0 & Interactive Docs
// -----------------------------------------------------------------------------

/// GET /api/v1/openapi.json — complete OpenAPI 3.0.3 machine-readable contract.
pub async fn openapi() -> impl IntoResponse {
    Json(serde_json::json!({
        "openapi": "3.0.3",
        "info": {
            "title": "Inochi REST API",
            "version": "1.0.0",
            "description": "High-performance Discord leveling and leaderboard API with AmariBot-compatible routes and sub-millisecond latencies."
        },
        "servers": [
            { "url": "/api/v1", "description": "Current Inochi instance" }
        ],
        "paths": {
            "/guilds/{guildId}/members/{userId}": {
                "get": {
                    "summary": "Get member profile",
                    "description": "Retrieve XP, weekly XP, rank, level, and streak for a guild member.",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } },
                        { "name": "userId", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": { "200": { "description": "Member profile" } },
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                }
            },
            "/guilds/{guildId}/members": {
                "post": {
                    "summary": "Bulk get member profiles",
                    "description": "Retrieve profiles for multiple user IDs in a single query.",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "members": { "type": "array", "items": { "type": "string" } }
                                    }
                                }
                            }
                        }
                    },
                    "responses": { "200": { "description": "List of member profiles" } },
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                },
                "get": {
                    "summary": "Bulk get member profiles via query param",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } },
                        { "name": "uids", "in": "query", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": { "200": { "description": "List of member profiles" } },
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                }
            },
            "/guilds/{guildId}/leaderboard": {
                "get": {
                    "summary": "Get all-time leaderboard",
                    "description": "Paginated leaderboard of members ordered by total XP.",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } },
                        { "name": "page", "in": "query", "schema": { "type": "integer", "default": 1 } },
                        { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 50 } }
                    ],
                    "responses": { "200": { "description": "All-time leaderboard" } },
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                }
            },
            "/guilds/{guildId}/weekly": {
                "get": {
                    "summary": "Get weekly leaderboard",
                    "description": "Paginated weekly leaderboard with automatic ISO Monday 00:00 UTC resets.",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } },
                        { "name": "page", "in": "query", "schema": { "type": "integer", "default": 1 } },
                        { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 50 } }
                    ],
                    "responses": { "200": { "description": "Weekly leaderboard" } },
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                }
            },
            "/guilds/{guildId}/raw/leaderboard": {
                "get": {
                    "summary": "Get raw compact leaderboard",
                    "description": "Compact array payload containing member IDs and XP.",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": { "200": { "description": "Compact leaderboard" } },
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                }
            },
            "/guilds/{guildId}/rewards": {
                "get": {
                    "summary": "List role rewards",
                    "description": "Retrieve configured level-to-role mappings.",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": { "200": { "description": "List of role rewards" } },
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                },
                "post": {
                    "summary": "Set role reward (Admin)",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": { "200": { "description": "Reward updated" } },
                    "security": [ { "bearerAuth": [] } ]
                }
            },
            "/guilds/{guildId}/stats": {
                "get": {
                    "summary": "Get server leveling statistics",
                    "parameters": [
                        { "name": "guildId", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": { "200": { "description": "Guild statistics" } },
                    "security": [ { "ApiKeyAuth": [] }, { "bearerAuth": [] } ]
                }
            }
        },
        "components": {
            "securitySchemes": {
                "ApiKeyAuth": { "type": "apiKey", "in": "header", "name": "Authorization", "description": "Direct API key in Authorization or X-API-Key header" },
                "bearerAuth": { "type": "http", "scheme": "bearer", "description": "Bearer token authentication" }
            }
        }
    }))
}

/// GET /api/v1/docs (and /docs) — HTML interactive documentation browser.
pub async fn docs_page() -> impl IntoResponse {
    Html(r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inochi REST API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
  <style>
    body { max-width: 960px; margin: 0 auto; padding: 2rem 1rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .badge { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; color: #fff; }
    .badge-get { background: #059669; }
    .badge-post { background: #2563eb; }
    .badge-delete { background: #dc2626; }
    .endpoint { margin-bottom: 2rem; padding: 1.25rem; border: 1px solid var(--border); border-radius: 8px; }
    pre { background: var(--background-alt); padding: 1rem; border-radius: 6px; overflow-x: auto; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body>
  <h1>Inochi REST API Documentation</h1>
  <p>High-performance Discord leveling and leaderboard API. Built with Rust and Axum for maximum throughput and predictable sub-millisecond response times. Provides drop-in compatibility patterns for <strong>AmariBot</strong> developers.</p>
  
  <h2>Authentication</h2>
  <p>Provide your API key in either of the following headers:</p>
  <ul>
    <li><code>Authorization: YOUR_API_KEY</code> (AmariBot style)</li>
    <li><code>Authorization: Bearer YOUR_TOKEN</code></li>
    <li><code>X-API-Key: YOUR_API_KEY</code></li>
  </ul>

  <h2>Endpoints</h2>

  <div class="endpoint">
    <h3><span class="badge badge-get">GET</span> <code>/api/v1/guilds/{guildId}/members/{userId}</code></h3>
    <p>Fetch level, XP, weekly XP, rank, and daily streak for a single member.</p>
    <p><em>Alias: <code>/api/v1/guild/{guildId}/member/{userId}</code></em></p>
    <pre><code>curl -H "Authorization: YOUR_KEY" http://localhost:3000/api/v1/guilds/123/members/456</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="badge badge-post">POST</span> <code>/api/v1/guilds/{guildId}/members</code></h3>
    <p>Bulk query up to 100 member profiles in a single query.</p>
    <pre><code>curl -X POST -H "Authorization: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"members": ["123", "456"]}' \
  http://localhost:3000/api/v1/guilds/123/members</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="badge badge-get">GET</span> <code>/api/v1/guilds/{guildId}/leaderboard</code></h3>
    <p>All-time leaderboard with page-based (<code>?page=1&limit=50</code>) or offset-based pagination.</p>
    <pre><code>curl -H "Authorization: YOUR_KEY" "http://localhost:3000/api/v1/guilds/123/leaderboard?page=1&limit=50"</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="badge badge-get">GET</span> <code>/api/v1/guilds/{guildId}/weekly</code></h3>
    <p>Weekly leaderboard with automatic ISO Monday 00:00 UTC resets.</p>
    <pre><code>curl -H "Authorization: YOUR_KEY" "http://localhost:3000/api/v1/guilds/123/weekly?page=1&limit=50"</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="badge badge-get">GET</span> <code>/api/v1/guilds/{guildId}/raw/leaderboard</code></h3>
    <p>Compact array format containing user IDs, total XP, and weekly XP.</p>
  </div>

  <div class="endpoint">
    <h3><span class="badge badge-get">GET</span> <code>/api/v1/guilds/{guildId}/rewards</code></h3>
    <p>List all level-to-role mappings configured on the server.</p>
  </div>

  <div class="endpoint">
    <h3><span class="badge badge-get">GET</span> <code>/api/v1/guilds/{guildId}/stats</code></h3>
    <p>Server leveling overview: total members tracked, total XP, and top level.</p>
  </div>

  <h2>Machine-Readable Contracts</h2>
  <p>OpenAPI 3.0 specification available at <a href="/api/v1/openapi.json"><code>/api/v1/openapi.json</code></a>.</p>
</body>
</html>"#)
}

/// Shared handler entry nesting all v1 and Amari-compatible routes under one router.
pub fn router() -> axum::Router<Arc<AppState>> {
    use axum::routing::{delete, get, post};

    axum::Router::new()
        // Leaderboard routes (Standard & Amari alias)
        .route(
            "/api/v1/guilds/:guild_id/leaderboard",
            get(leaderboard_all_time),
        )
        .route(
            "/api/v1/guild/:guild_id/leaderboard",
            get(leaderboard_all_time),
        )
        .route("/api/v1/guilds/:guild_id/weekly", get(leaderboard_weekly))
        .route("/api/v1/guild/:guild_id/weekly", get(leaderboard_weekly))
        .route(
            "/api/v1/guilds/:guild_id/raw/leaderboard",
            get(leaderboard_raw),
        )
        .route(
            "/api/v1/guild/:guild_id/raw/leaderboard",
            get(leaderboard_raw),
        )
        .route(
            "/api/v1/guilds/:guild_id/leaderboards/:kind",
            get(leaderboard_by_kind),
        )
        // Member profile routes (Standard & Amari alias)
        .route("/api/v1/guilds/:guild_id/members/:user_id", get(member))
        .route("/api/v1/guild/:guild_id/member/:user_id", get(member))
        // Bulk member routes (POST & GET with ?uids=)
        .route(
            "/api/v1/guilds/:guild_id/members",
            post(members_bulk_post).get(members_bulk_get),
        )
        .route(
            "/api/v1/guild/:guild_id/members",
            post(members_bulk_post).get(members_bulk_get),
        )
        // Rewards routes (List & Admin management)
        .route(
            "/api/v1/guilds/:guild_id/rewards",
            get(rewards_list).post(rewards_set),
        )
        .route(
            "/api/v1/guild/:guild_id/rewards",
            get(rewards_list).post(rewards_set),
        )
        .route(
            "/api/v1/guilds/:guild_id/rewards/:level",
            delete(rewards_delete),
        )
        // Guild stats
        .route("/api/v1/guilds/:guild_id/stats", get(guild_stats))
        .route("/api/v1/guild/:guild_id/stats", get(guild_stats))
        // OpenAPI specification and Docs
        .route("/api/v1/openapi.json", get(openapi))
        .route("/api/v1/docs", get(docs_page))
        .route("/docs", get(docs_page))
}
