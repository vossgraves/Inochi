-- Level rewards + daily streaks.
-- level_roles: role granted automatically when a member reaches `level`.
-- members.daily_* : /daily claim tracking (streak continues within 44h).

ALTER TABLE members ADD COLUMN IF NOT EXISTS daily_streak INT NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_daily TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS level_roles (
    guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    level    INT NOT NULL CHECK (level > 0),
    role_id  BIGINT NOT NULL,
    PRIMARY KEY (guild_id, level)
);

CREATE INDEX IF NOT EXISTS level_roles_guild_idx ON level_roles (guild_id, level DESC);
