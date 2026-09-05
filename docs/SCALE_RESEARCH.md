# Scale review: 10k+ Discord guilds and chat games

**Reviewed 2026-09-05.** This is an engineering review of the current Rust bot, not a promise that a single process can serve an arbitrary traffic rate. Load-test gateway events and database latency with production-like traffic before changing capacity limits.

## Findings

### 1. Discord gateway and sharding
Discord requires sharding at 2,500 guilds and provides the recommended shard count from `Get Gateway Bot`; each shard supports at most 2,500 guilds. At 10,000 guilds, the deployment must therefore run at least four gateway shards. The current Poise/Serenity client uses the framework's default client builder and does not explicitly configure a shard count. That is the largest remaining scale gap: configure a shard manager (or multiple worker processes) from the gateway recommendation before onboarding 2,500+ guilds.

Sharding does not require sharing Discord gateway state, but application state does need a shared source of truth. PostgreSQL is already authoritative for XP and settings. In-process rounds and caches are intentionally treated as disposable; they must not be used as durable economy state.

Source: [Discord Gateway documentation](https://discord.com/developers/docs/topics/gateway).

### 2. XP hot path
The good parts already present are important:

- XP writes use an atomic `INSERT ... ON CONFLICT DO UPDATE`, avoiding lost updates.
- Message cooldowns reject most spam before PostgreSQL.
- Settings are validated once and cached.
- Leaderboards have guild/XP indexes and use bounded result pages.

The cache now has explicit bounds (20,000 settings entries and 100,000 cooldown entries), removes stale entries before growth, and invalidates after bot command writes. This keeps cache memory bounded on a cheap-RAM instance. A future multi-process deployment should move settings invalidation to a small Redis pub/sub channel or use a version column; process-local invalidation cannot update another shard.

Redis guidance is consistent with this design: cache entries should have TTLs, caches should be rebuildable/non-authoritative, and eviction should bound memory. See [Redis cache guidance](https://redis.io/docs/latest/develop/use-cases/semantic-cache/) and [Redis client-side caching](https://redis.io/docs/latest/develop/clients/client-side-caching/).

### 3. Database and connection budget
Keep PostgreSQL authoritative and keep the pool small per process. Do not multiply a large pool by the number of shards. At 10k guilds, use connection pooling/proxying, monitor p95/p99 query latency, and batch or queue non-critical work such as rank-card rendering and analytics. The current level-up path can issue role HTTP plus announcement HTTP after the XP write; those calls must never block or roll back the XP award.

Recommended operational guardrails:

- Postgres: composite primary key `(guild_id, user_id)` and guild leaderboard indexes (already present).
- Cache: TTL plus hard max entries (now present); record hit/miss ratio and eviction count.
- Backpressure: bounded worker queues for imports, backups, and image generation.
- Reliability: retry transient database errors with jitter, but never blindly retry a non-idempotent reward without an idempotency key.
- Observability: gateway reconnects, shard latency, event lag, DB pool wait time, award success/cooldown ratio, and level-up HTTP failures.

### 4. Games: the useful part of Telegram's model
Telegram supports games as messages, inline games, callback buttons, and HTML5/Web Apps. The relevant product lesson for Inochi is not to copy the transport: make games quick to enter, explicit about the round state, and friendly to group play. Buttons/callbacks are especially useful for choices; free-text answers remain a good fit for scramble/math/quiz.

Sources: [Telegram Games](https://core.telegram.org/bots/games) and [Telegram Bot API](https://core.telegram.org/bots/api).

Current games provide first-correct rounds, a timed highest-number round, quiz variety, and an XP reward. Their state is process-local, so a restart expires rounds and a round cannot be coordinated across two bot processes. That is acceptable for casual games and cheap RAM, provided the product labels rounds as ephemeral. If games become competitive or sharded, persist a small round record in Redis/PostgreSQL with:

- `round_id`, guild, channel, kind, canonical answer hash, expiry;
- atomic winner claim (`SETNX`/transaction) so only one answer pays;
- idempotent reward key `(round_id, winner_id)`;
- expiry/TTL and a maximum active-round quota per guild.

The in-process implementation now evicts expired rounds and caps active Q&A and highest-number rounds at 50,000 each, preventing unbounded memory growth from abandoned channels.

## Decision

The bot has the right low-memory primitives for a single process serving thousands of moderate-traffic guilds, but it is **not yet flawless for 10k+ guilds** until explicit sharding and multi-process cache invalidation are added. The safest cheap-RAM rollout is:

1. use Discord's recommended shard count;
2. run one gateway worker per shard or a shard-aware manager;
3. share only PostgreSQL-authoritative state;
4. keep local bounded caches for hot reads;
5. add Redis only when more than one process needs coordinated TTL state or game winners;
6. load-test before raising guild limits.

No GitHub pull requests were open in this checkout at review time, so there was nothing to merge or reject.
