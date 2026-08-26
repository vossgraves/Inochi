-- Vote boosts: a vote activates a multiplier until it expires (port of
-- external_votes). Replaces the earlier weekly-reward votes table.

DROP TABLE IF EXISTS votes;

CREATE TABLE IF NOT EXISTS external_votes (
    provider   TEXT NOT NULL,
    user_id    BIGINT NOT NULL,
    voted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (provider, user_id)
);
