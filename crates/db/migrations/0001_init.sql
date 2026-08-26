-- Inochi initial schema.
-- Guild configuration lives in validated JSONB; member XP uses an atomic
-- upsert so concurrent gateway events can never overwrite each other.

CREATE TABLE IF NOT EXISTS guilds (
    id          BIGINT PRIMARY KEY,
    settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
    guild_id        BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL,
    xp              BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
    weekly_xp       BIGINT NOT NULL DEFAULT 0 CHECK (weekly_xp >= 0),
    week_start      DATE NOT NULL DEFAULT date_trunc('week', now())::date,
    last_awarded_at TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS members_guild_xp_idx
    ON members (guild_id, xp DESC);

CREATE INDEX IF NOT EXISTS members_guild_weekly_idx
    ON members (guild_id, weekly_xp DESC);

-- Audit trail for dashboard actions (phase 1: settings changes).
CREATE TABLE IF NOT EXISTS audit_events (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id   BIGINT NOT NULL,
    kind       TEXT NOT NULL,
    actor_id   BIGINT,
    payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_guild_time_idx
    ON audit_events (guild_id, created_at DESC);
