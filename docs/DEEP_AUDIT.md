# Deep code/performance audit

**Date:** 2026-09-05. This is a static review of every production source area in the checkout. The goal is not to make code shorter at the cost of correctness: fewer lines only help when they remove allocations, I/O, lock contention, or duplicated policy.

## Changes made in this pass

- Fixed a real inconsistency: the settings fast path claimed a 30-second TTL but still accepted 60 seconds. It now uses 30 seconds in both places.
- Replaced the per-message `message.member(&ctx.http)` lookup with Serenity's member cache. This removes an HTTP request from the hottest path; the cache is updated by gateway member/role events.
- Added a separate, allocation-bounded game-card renderer. Math challenges now send a readable PNG card. Word-image challenges send an illustrated PNG under Discord's `SPOILER_` filename convention, so the image is hidden until a user reveals it.
- Added the `word image` game kind and tests for valid PNG output.
- Kept game rendering synchronous and deterministic: no remote image generation, no API key, no per-round network call. This is materially safer than a remote image service at 10k guilds.

## Findings by production area

### `apps/bot/src/main.rs`

- **Hot path:** bot/DM/webhook filtering happens before all database work.
- **Correctness:** XP is still authoritative in one atomic PostgreSQL upsert, so the local cooldown is only a fast rejection filter and cannot create lost updates.
- **Performance:** settings read is lock-only on a hit; role lookup is now cache-only. Vote status remains a database lookup when enabled and is the next obvious hot-path optimization: cache active vote expiry locally and invalidate on vote webhook.
- **Memory:** settings and cooldown maps have hard bounds and stale cleanup. Game state has independent bounds.
- **Concurrency:** the local pre-check and record are intentionally not a lock-based reservation; PostgreSQL's cooldown predicate is the final authority. This avoids serializing all message events on a process-wide mutex.
- **Remaining scale issue:** explicit shard lifecycle and cross-process settings/game invalidation are still required for 10k+ guilds.

### `apps/bot/src/games.rs` and `gamecard.rs`

- `HashMap<(guild, channel), round>` is the right compact key for one group round, but it is process-local and disposable. A restart currently cancels rounds; that is acceptable for casual games, not for a paid/competitive economy.
- Expired entries are cleaned at insertion and active maps are capped. A coordinated deployment should move only the small round state to Redis/Postgres with TTL and an atomic winner claim; do not persist PNG bytes.
- The answer is removed before XP is awarded. This prevents double winners under concurrent messages, but a transient database failure can consume a round without payment. If games become important, store `round_id` and use an idempotent reward ledger; do not “fix” this by unlocking before payment, which reintroduces double-payouts.
- Cards are pure software rasterization with embedded fonts. They avoid CDN calls and external image generation. The word game uses small deterministic vector illustrations, not a literal answer image; the Discord `SPOILER_` filename hides the clue until reveal.

### `apps/bot/src/rankcard.rs`

- The renderer does O(width × height) software blending and is appropriate for occasional `/rank` commands, not message-event work.
- Avatar/background downloads are on the command path and are deferred before work, so Discord's interaction deadline is respected. Add a bounded per-URL image cache and a semaphore if rank cards become a high-volume feature.
- `measure` and `draw_text` rasterize glyphs repeatedly. A glyph bitmap cache would reduce CPU, but the current 960×300 card and low request frequency make the added complexity a tradeoff, not an unconditional win.

### `crates/db/src/members.rs`

- The award statement is atomic and uses the composite primary key correctly.
- Leaderboard queries are bounded to 100 rows. Deep `OFFSET` pagination will degrade for very large guilds; keyset pagination by `(xp, user_id)` is the lower-latency future change.
- `rank_of` computes a window over the whole guild for each request. Cache short-lived rank responses or maintain a materialized ranking only after measurements show this is a bottleneck.
- Daily claims and wagers use database predicates/transactions, which is preferable to an in-memory balance.

### `crates/core/src/settings.rs` and `curve.rs`

- These are pure functions and already have the best performance profile: no locks, I/O, or allocation in the message policy/curve path except JSON configuration load.
- Multipliers intentionally compose multiplicatively. Changing that for fewer operations would change product behavior.
- Validation should remain at the boundary; re-validating every message would be wasted work.

### API/dashboard

- Axum and Svelte are not on the gateway event path. API settings writes should publish an invalidation/version event once multiple bot workers exist.
- Bearer/admin auth is still a product security limitation. The existing OAuth code is not a substitute for a complete per-guild authorization check until it verifies the actor's permissions for the requested guild.
- The API leaderboard is correctly bounded, but should adopt keyset pagination under large guilds.

## “Less code” decisions

1. Do not collapse the atomic SQL into `SELECT` + `UPDATE`: that is fewer-looking code but worse correctness under concurrent shards.
2. Do not replace bounded maps with a global cache crate merely for fewer lines: the current policy is explicit and auditable; Redis is justified when there are multiple workers.
3. Do not generate cards through a remote AI call: it adds latency, cost, failure modes, privacy exposure, and rate-limit pressure.
4. Do not cache all Discord member roles forever: gateway cache state can change; cache lookup is cheap and gateway events are the invalidation mechanism.
5. Do not parallelize every small operation: extra tasks and channels can consume more memory than the work saved. Parallelize only independent network/database work after metrics prove it matters.

## ChatFight research conclusions

ChatFight's public update channel describes image-based games, math calculations embedded in its fast-writing game, timed expiry/edit behavior, and prior outages caused by game-image generation. Its public product listing emphasizes group activity, rankings, and prizes. The implementation here copies the useful interaction pattern—visual prompt, spoiler reveal, fast group answer—without copying the fragile architecture of generating every image through an external service.

Telegram's Bot API supports `has_spoiler` on photos and a `SPOILER_` filename is the corresponding Discord convention. Telegram's official Games and Bot API documentation also support the broader lesson: make the game launch obvious, keep group state explicit, and use platform-native media controls.

Sources:

- https://t.me/s/ChatFightUpdates?before=220
- https://www.findmini.app/chatfightbot/
- https://core.telegram.org/bots/api
- https://core.telegram.org/bots/games
- https://discord.com/developers/docs/topics/gateway
- https://serenity-rs.github.io/poise/current/serenity/builder/struct.CreateAttachment.html

## Verification limitation

The environment used for this pass does not contain `cargo` or `rustc`, so compilation, rustfmt, clippy, and tests could not be executed here. The new renderer includes a unit test and uses only dependencies already present in `apps/bot/Cargo.toml`; run `cargo fmt --all && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings` in a Rust-enabled CI environment before deployment.
