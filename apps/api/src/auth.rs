//! Discord OAuth login + stateless signed session cookies.
//!
//! Enabled only when `DISCORD_CLIENT_SECRET` is set; otherwise the routes
//! report 501 and the dashboard keeps working with the admin token.

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use hmac::{Hmac, Mac};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{ApiError, AppState};

const MANAGE_GUILD: i64 = 0x20;
const STATE_COOKIE: &str = "inochi_oauth_state";
const SESSION_COOKIE: &str = "inochi_session";

#[derive(Clone)]
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub dashboard_url: String,
}

/// HMAC-SHA256 hex signature.
pub fn sign(key: &[u8], msg: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(msg.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Constant-time string equality.
pub fn ct_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn hash_key(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Serialize, Deserialize)]
pub struct SessionGuild {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize)]
pub struct Session {
    pub uid: String,
    pub username: String,
    pub avatar: Option<String>,
    pub guilds: Vec<SessionGuild>,
}

pub fn make_session_cookie(state: &AppState, session: &Session) -> Option<String> {
    let payload = serde_json::to_string(session).ok()?;
    let encoded = hex::encode(payload.as_bytes());
    let sig = sign(state.session_key.as_bytes(), &encoded);
    Some(format!("{encoded}.{sig}"))
}

pub fn verify_session(state: &AppState, cookie_value: &str) -> Option<Session> {
    let (encoded, sig) = cookie_value.rsplit_once('.')?;
    if !ct_eq(&sign(state.session_key.as_bytes(), encoded), sig) {
        return None;
    }
    let bytes = hex::decode(encoded).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn cookie_from(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|c| {
        let c = c.trim();
        c.strip_prefix(name).and_then(|rest| rest.strip_prefix('=').map(String::from))
    })
}

/// GET /auth/login — redirect to Discord with a signed state cookie.
pub async fn login(State(state): State<std::sync::Arc<crate::AppState>>) -> Response {
    let Some(oauth) = &state.oauth else {
        return ApiError(StatusCode::NOT_IMPLEMENTED, "OAuth not configured".into()).into_response();
    };
    let state_nonce: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let url = format!(
        "https://discord.com/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&scope=identify%20guilds&state={}",
        oauth.client_id,
        urlencode(&oauth.redirect_uri),
        state_nonce
    );
    let mut redirect = Redirect::to(&url).into_response();
    if let Ok(value) = header::HeaderValue::from_str(&format!(
        "{STATE_COOKIE}={state_nonce}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600"
    )) {
        redirect.headers_mut().append(header::SET_COOKIE, value);
    }
    redirect
}

/// GET /auth/callback — exchange code, build session cookie, bounce to dashboard.
pub async fn callback(
    State(state): State<std::sync::Arc<crate::AppState>>,
    headers: HeaderMap,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
) -> Response {
    let Some(oauth) = &state.oauth else {
        return ApiError(StatusCode::NOT_IMPLEMENTED, "OAuth not configured".into()).into_response();
    };
    let Some(query) = query else {
        return Redirect::to(&format!("{}/?error=oauth_state", oauth.dashboard_url)).into_response();
    };
    let params: Vec<(String, String)> = query
        .split('&')
        .filter_map(|kv| {
            let (k, v) = kv.split_once('=')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect();
    let code = params.iter().find(|(k, _)| k == "code").map(|(_, v)| v.clone());
    let returned_state = params.iter().find(|(k, _)| k == "state").map(|(_, v)| v.clone());

    let expected = cookie_from(&headers, STATE_COOKIE);
    let state_ok = match (&expected, &returned_state) {
        (Some(a), Some(b)) => ct_eq(a, b),
        _ => false,
    };
    if !state_ok {
        return Redirect::to(&format!("{}/?error=oauth_state", oauth.dashboard_url)).into_response();
    }

    let Some(code) = code else {
        return Redirect::to(&format!("{}/?error=oauth_code", oauth.dashboard_url)).into_response();
    };

    let client = reqwest::Client::new();
    let token: serde_json::Value = match client
        .post("https://discord.com/api/v10/oauth2/token")
        .form(&[
            ("client_id", oauth.client_id.as_str()),
            ("client_secret", oauth.client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", oauth.redirect_uri.as_str()),
        ])
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(_) => {
                return Redirect::to(&format!("{}/?error=oauth_token", oauth.dashboard_url))
                    .into_response()
            }
        },
        _ => {
            return Redirect::to(&format!("{}/?error=oauth_token", oauth.dashboard_url))
                .into_response()
        }
    };
    let Some(access_token) = token["access_token"].as_str().map(String::from) else {
        return Redirect::to(&format!("{}/?error=oauth_token", oauth.dashboard_url)).into_response();
    };

    let bearer = format!("Bearer {access_token}");
    let user: serde_json::Value = match client
        .get("https://discord.com/api/v10/users/@me")
        .header(header::AUTHORIZATION, &bearer)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => {
            return Redirect::to(&format!("{}/?error=oauth_user", oauth.dashboard_url)).into_response()
        }
    };
    let guilds: serde_json::Value = match client
        .get("https://discord.com/api/v10/users/@me/guilds")
        .header(header::AUTHORIZATION, &bearer)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => serde_json::json!([]),
    };

    let uid = user["id"].as_str().unwrap_or_default().to_string();
    let username = user["global_name"]
        .as_str()
        .or_else(|| user["username"].as_str())
        .unwrap_or("user")
        .to_string();
    let avatar = user["avatar"].as_str().map(String::from);

    let mut manageable = Vec::new();
    if let Some(list) = guilds.as_array() {
        for g in list {
            let owner = g["owner"].as_bool().unwrap_or(false);
            // Discord sends permission bitfields as decimal strings (not
            // octal). Parsing as octal silently hid manageable guilds.
            let perms = g["permissions"].as_str().and_then(|p| p.parse::<i64>().ok());
            let has_manage = g["permissions"].as_i64().map(|p| p & MANAGE_GUILD != 0).unwrap_or(false)
                || perms.map(|p| p & MANAGE_GUILD != 0).unwrap_or(false);
            if owner || has_manage {
                manageable.push(SessionGuild {
                    id: g["id"].as_str().unwrap_or_default().to_string(),
                    name: g["name"].as_str().unwrap_or_default().to_string(),
                });
            }
        }
    }

    let session = Session { uid, username, avatar, guilds: manageable };
    let Some(cookie_value) = make_session_cookie(&state, &session) else {
        return ApiError(StatusCode::INTERNAL_SERVER_ERROR, "session encode failed".into()).into_response();
    };

    let mut redirect = Redirect::to(&format!("{}/", oauth.dashboard_url)).into_response();
    if let Ok(value) = header::HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}={cookie_value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800"
    )) {
        redirect.headers_mut().append(header::SET_COOKIE, value);
    }
    redirect
}

/// GET /auth/me — the signed session contents.
pub async fn me(
    State(state): State<std::sync::Arc<crate::AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    if state.oauth.is_none() {
        return Err(ApiError(StatusCode::NOT_IMPLEMENTED, "OAuth not configured".into()));
    }
    match cookie_from(&headers, SESSION_COOKIE) {
        Some(value) => match verify_session(&state, &value) {
            Some(session) => Ok(Json(serde_json::json!({
                "user": { "id": session.uid, "username": session.username, "avatar": session.avatar },
                "guilds": session.guilds,
            }))),
            None => Err(ApiError(StatusCode::UNAUTHORIZED, "invalid session".into())),
        },
        None => Err(ApiError(StatusCode::UNAUTHORIZED, "no session".into())),
    }
}

/// POST /auth/logout — clear the session cookie.
pub async fn logout(State(state): State<std::sync::Arc<crate::AppState>>) -> Response {
    let url = state
        .oauth
        .as_ref()
        .map(|o| o.dashboard_url.clone())
        .unwrap_or_else(|| "/".into());
    let mut redirect = Redirect::to(&url).into_response();
    if let Ok(value) = header::HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    )) {
        redirect.headers_mut().append(header::SET_COOKIE, value);
    }
    redirect
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
