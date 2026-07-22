# Inochi

Inochi is a self-hosted Discord leveling bot and dashboard. It is a full TypeScript rewrite of Polaris with PostgreSQL, a monochrome Next.js dashboard, atomic XP updates, image chat games, rank cards, voting boosts, backups, and migration tools.

The original Polaris source was created by [Colon](https://github.com/GDColon). Inochi remains subject to the repository's non-commercial `LICENSE`: do not sell it or add monetized features.

## Architecture

- `apps/bot`: Discord.js worker and application commands
- `apps/web`: Next.js dashboard, OAuth, settings and public leaderboards
- `packages/core`: validated settings, level curve and multiplier engine
- `packages/database`: Drizzle schema, PostgreSQL migrations and repositories
- `packages/importers`: JSON, CSV, MEE6 and public-message import adapters
- `packages/rank-card`: monochrome PNG rank-card renderer

Legacy runtime code has been removed. Compatibility with old Polaris exports is limited to the isolated TypeScript importer in `packages/importers/src/legacy-polaris.ts`.

## Requirements

- Node.js 22
- PostgreSQL 16 recommended
- A Discord application with the Server Members and Message Content privileged intents enabled

## Setup

1. Copy `.env.example` to `.env` and fill in all Discord and session values.
2. Start PostgreSQL with `docker compose up -d postgres`, or provide any PostgreSQL connection in `DATABASE_URL`.
3. Install dependencies with `npm ci`.
4. Apply the schema with `npm run db:migrate`.
5. Add the exact `DISCORD_REDIRECT_URI` to the Discord developer portal.
6. Deploy slash commands with `npm run deploy:commands`.
7. Start development services with `npm run dev`.

Production services can be built with `npm run build`, then run independently:

```sh
npm run start -w @inochi/web
npm run start -w @inochi/bot
```

## Railway deployment

Create one Railway project with PostgreSQL and two services sourced from the repository root. In each service's source settings, set the Railway config file path shown below; the committed files select Railpack and provide all build, start, migration, restart, and health-check behavior.

1. **Web service:** set the config path to `/railway.web.toml` and generate a public domain.
2. **Bot service:** set the config path to `/railway.bot.toml`; do not generate a domain or add an HTTP health check.
3. Reference the PostgreSQL service's internal `DATABASE_URL` from both services.
4. Set `APP_URL` in both services to the web domain, without a trailing slash.
5. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, and a 32-or-more-character `SESSION_SECRET` on the web service.
6. Set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` on the bot service.
7. Set `DISCORD_REDIRECT_URI` to `https://<web-domain>/api/auth/callback` and register the exact value in Discord's OAuth2 settings.
8. Run `npm run deploy:commands` once with the bot service variables after deployment.

The web manifest applies database migrations before each release and checks configuration plus PostgreSQL at `/api/health`. The bot verifies PostgreSQL before connecting to Discord. Optional `TOPGG_WEBHOOK_SECRET` belongs to the web service; optional `TOPGG_BOT_ID` and `S3_*` variables belong to the bot service.

The web build intentionally opens no database connection. The connection is created lazily when Railway starts serving requests.

## PostgreSQL model

Guild configuration is validated JSONB because settings evolve frequently. Member XP, weekly XP, cooldowns, game rounds, imports, OAuth sessions and audit events use normalized tables. Message XP is awarded with an atomic PostgreSQL upsert so concurrent gateway events cannot overwrite one another.

OAuth access tokens are encrypted at rest with AES-256-GCM using `SESSION_SECRET`. Browser sessions use random opaque tokens stored only as hashes, and cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

## Chat games and voting

Inochi supports persistent image-based word and math races. Configure one to three winners and a separate XP reward for each place, answer windows, hints, math difficulty, channels, intervals, and random or round-robin rotation in the dashboard. Winner placement and XP are committed together in PostgreSQL so concurrent correct answers cannot claim the same place.

Set a top.gg webhook URL to `/api/webhooks/votes/topgg` and use `TOPGG_WEBHOOK_SECRET` as its authorization value. Verified voters receive the configured chat-XP multiplier for the configured duration. Vote boosts never alter manual or game rewards.

Rank background uploads use S3-compatible storage. Configure the `S3_*` variables and expose objects through `S3_PUBLIC_URL`.

## Backups

The dashboard can create and download complete, versioned Inochi backups. Uploaded backups are validated and previewed before restore. Restore modes are `settings`, `merge`, and `replace`; all create a pre-restore safety snapshot and audit event. OAuth sessions, API secrets, and webhook secrets are never exported.

## Imports

The dashboard accepts an isolated legacy Polaris JSON format, Lurkr's official JSON export, and ID/XP CSV. `/import mee6` reads a deliberately public MEE6 leaderboard.

For ProBot, Arcane, AmariBot, Lurkr, and Carl-bot:

1. Run `/import begin source:<bot>` in a private administrator channel.
2. Invoke the source bot's public leaderboard.
3. Manually advance every page.
4. Run `/import review`, then `/import apply`.

Inochi only observes public messages in the selected channel during the 30-minute, administrator-owned session. It cannot read ephemeral messages or click another bot's components. Official exports remain preferred. If a source exposes only levels, Inochi uses the minimum XP for that level and marks the record approximate during review.

## Commands

- `/rank`, `/top`, `/weekly`, `/winner`, `/calculate`, `/sync`
- `/addxp`, `/clear`, `/config`, `/rewardrole`, `/multiplier`
- `/joinrole`, `/blacklist`, `/reset`, `/refresh`
- `/game start`, `/game status`, `/guess`, `/vote`, `/xpchannel`
- `/privacy`, `/colour`, `/background`, `/wrapped`, `/diagnose`, `/help`
- `/import`, `/botstatus`
- User context menus: **Check XP** and **View on leaderboard**

Developer remote-evaluation and arbitrary-database commands from the legacy project were intentionally removed.

## Verification

```sh
npm run typecheck
npm test
npm run build
```
