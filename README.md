# Inochi (Rust + Svelte)

A Rust rewrite of the [Inochi](https://github.com/vossgraves/Inochi) Discord
leveling bot, with a Svelte 5 dashboard. Same product, a fraction of the
runtime footprint: one statically-linked bot binary, one API binary, no Node
in production.

## Status — phase 1 (core leveling)

Implemented now:

- **Atomic XP engine** — message XP is awarded through a single PostgreSQL
  upsert (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), so concurrent gateway
  events can never overwrite each other. Weekly XP resets automatically on ISO
  week rollover.
- **Level curve** — MEE6-compatible curve in `crates/core`, unit-tested for
  cumulative/inverse consistency.
- **Validated settings** — guild configuration stored as validated JSONB,
  identical rules in bot and dashboard; multipliers stack multiplicatively;
  channel/role blacklists.
- **Bot commands** — `/setup`, `/rank`, `/rankcard` (rendered PNG),
  `/top`, `/weekly`, `/play scramble|math` (chat games, 50 XP win bonus),
  `/addxp` and `/importcsv` (manager-only), `/backup export|import`
  (manager-only), level-up announcements, per-guild cooldowns.
- **Dashboard API** — axum server: `/api/health`, leaderboard, settings
  get/put with audit trail, bearer-token auth, CORS.
- **Svelte 5 dashboard** — leaderboard viewer (all-time/weekly), settings
  editor with multiplier management, health/token panel.

Not yet ported from the TypeScript original: top.gg vote boosts (needs a
top.gg token) and Discord OAuth session auth for the dashboard (phase 2 —
a shared admin token covers it today).

## Layout

```
crates/core    level curve, multipliers, settings validation (pure logic)
crates/db      sqlx + PostgreSQL (Neon-compatible), migrations, repositories
apps/bot       poise/serenity Discord worker
apps/api       axum REST API for the dashboard
apps/dashboard Svelte 5 + Vite SPA
```

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — your Neon pooler connection string
     (`...?sslmode=require`). Connections always use TLS (rustls).
   - `DISCORD_TOKEN` — from the Discord developer portal, with Server Members
     and Message Content privileged intents enabled.
   - `ADMIN_TOKEN` — long random string the dashboard will use as its bearer
     token.
2. Rust side:

   ```
   cargo run --release -p inochi-bot   # gateway worker + slash commands
   cargo run --release -p inochi-api   # dashboard API on API_PORT
   ```

   Migrations are embedded and applied automatically at startup.

3. Dashboard:

   ```
   cd apps/dashboard
   npm install
   npm run dev        # http://localhost:5173
   ```

   Set `VITE_API_BASE` when building for production.

4. Slash commands register globally on first bot boot.

## Verification

```
cargo test -p inochi-core     # curve + settings engine tests
cargo check --workspace
cd apps/dashboard && npm run build
```

## Notes

- The API's phase-1 auth is a single admin bearer token; it exists so the
  dashboard works today. Phase 2 replaces it with Discord OAuth sessions
  hashed at rest, matching upstream behavior.
- Manual `/addxp` rewards intentionally bypass cooldowns and multipliers, as
  upstream.
- Guild XP stays paused until settings exist for that guild (the bot ignores
  unknown guilds until the first save or `/addxp`).
