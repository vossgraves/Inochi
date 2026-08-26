-- Developer API keys and top.gg vote tracking.

CREATE TABLE IF NOT EXISTS api_keys (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key_hash   TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL DEFAULT '',
    guild_id   BIGINT,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS votes (
    user_id       BIGINT PRIMARY KEY,
    last_vote_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    streak        INT NOT NULL DEFAULT 1
);
