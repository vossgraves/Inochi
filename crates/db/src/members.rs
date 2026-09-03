//! Member XP queries. The award path is a single atomic statement so
//! concurrent gateway events can never clobber one another.

use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::DbResult;

#[derive(Debug, sqlx::FromRow)]
pub struct MemberRow {
    pub guild_id: i64,
    pub user_id: i64,
    pub xp: i64,
    pub weekly_xp: i64,
    #[allow(dead_code)]
    pub week_start: chrono::NaiveDate,
    pub last_awarded_at: Option<DateTime<Utc>>,
    /// Current /daily streak length.
    #[allow(dead_code)]
    pub daily_streak: i32,
    /// Last time /daily was claimed.
    #[allow(dead_code)]
    pub last_daily: Option<DateTime<Utc>>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct RankedMember {
    pub user_id: i64,
    pub xp: i64,
    pub weekly_xp: i64,
    /// 1-based position in the guild leaderboard.
    pub position: i64,
}

/// Award `amount` XP to `(guild_id, user_id)` unless the member is still in
/// their cooldown window.
///
/// Returns the updated totals, or `None` when the message fell inside the
/// cooldown and no XP was granted. Weekly XP resets automatically when the
/// ISO week rolls over.
pub async fn award_xp(
    pool: &PgPool,
    guild_id: i64,
    user_id: i64,
    amount: i64,
    cooldown_seconds: i64,
) -> DbResult<Option<MemberRow>> {
    let row = sqlx::query_as::<_, MemberRow>(
        r#"
        WITH inserted AS (
            INSERT INTO members (guild_id, user_id, xp, weekly_xp, week_start, last_awarded_at)
            VALUES ($1, $2, $3, $3, date_trunc('week', now())::date, now())
            ON CONFLICT (guild_id, user_id) DO UPDATE SET
                xp         = members.xp + EXCLUDED.xp,
                weekly_xp  = CASE
                    WHEN members.week_start = date_trunc('week', now())::date
                        THEN members.weekly_xp + EXCLUDED.weekly_xp
                    ELSE EXCLUDED.weekly_xp
                END,
                week_start      = date_trunc('week', now())::date,
                last_awarded_at = now(),
                updated_at      = now()
            WHERE members.last_awarded_at IS NULL
               OR members.last_awarded_at <= now() - make_interval(secs => $4)
            RETURNING guild_id, user_id, xp, weekly_xp, week_start, last_awarded_at,
                      daily_streak, last_daily
        )
        SELECT * FROM inserted
        "#,
    )
    .bind(guild_id)
    .bind(user_id)
    .bind(amount)
    .bind(cooldown_seconds)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Fetch one member, creating a zero-XP row lazily if absent.
pub async fn get_member(
    pool: &PgPool,
    guild_id: i64,
    user_id: i64,
) -> DbResult<MemberRow> {
    let row = sqlx::query_as::<_, MemberRow>(
        r#"
        INSERT INTO members (guild_id, user_id) VALUES ($1, $2)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
        RETURNING guild_id, user_id, xp, weekly_xp, week_start, last_awarded_at,
                  daily_streak, last_daily
        "#
    )
    .bind(guild_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// Outcome of a successful `/daily` claim.
#[derive(Debug)]
pub struct DailyClaim {
    pub row: MemberRow,
    /// Streak after this claim.
    pub streak: i32,
    /// Whether the streak continued (claimed within 44 h of the last one).
    pub streak_continued: bool,
}

/// Claim the daily reward atomically.
///
/// Returns `None` while the member is still inside the 20-hour claim
/// window. Streak continues when the previous claim is within 44 hours,
/// otherwise it resets to 1.
pub async fn claim_daily(
    pool: &PgPool,
    guild_id: i64,
    user_id: i64,
    base_amount: i64,
) -> DbResult<Option<DailyClaim>> {
    let row = sqlx::query_as::<_, MemberRow>(
        r#"
        WITH claimed AS (
            INSERT INTO members (guild_id, user_id, xp, weekly_xp, week_start,
                                 daily_streak, last_daily)
            VALUES ($1, $2, $3, $3, date_trunc('week', now())::date, 1, now())
            ON CONFLICT (guild_id, user_id) DO UPDATE SET
                xp           = CASE WHEN members.last_daily <= now() - interval '20 hours'
                                    THEN members.xp + EXCLUDED.xp ELSE members.xp END,
                weekly_xp    = CASE
                    WHEN members.last_daily <= now() - interval '20 hours'
                         AND members.week_start = date_trunc('week', now())::date
                        THEN members.weekly_xp + EXCLUDED.weekly_xp
                    ELSE CASE WHEN members.last_daily <= now() - interval '20 hours'
                              THEN EXCLUDED.weekly_xp ELSE members.weekly_xp END
                END,
                daily_streak = CASE WHEN members.last_daily >= now() - interval '44 hours'
                                    THEN members.daily_streak + 1 ELSE 1 END,
                last_daily   = now(),
                updated_at   = now()
            WHERE members.last_daily IS NULL
               OR members.last_daily <= now() - interval '20 hours'
            RETURNING guild_id, user_id, xp, weekly_xp, week_start, last_awarded_at,
                      daily_streak, last_daily
        )
        SELECT * FROM claimed
        "#,
    )
    .bind(guild_id)
    .bind(user_id)
    .bind(base_amount)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else { return Ok(None) };
    let streak = row.daily_streak;
    // A brand-new row starts at streak 1 with no prior claim; anything that
    // already had a streak and grew means the chain continued.
    let continued = streak > 1;
    Ok(Some(DailyClaim { row, streak, streak_continued: continued }))
}

/// Add XP directly, bypassing cooldowns and weekly-window logic.
///
/// Used for streak bonuses and other policy-side rewards.
pub async fn add_xp_flat(
    pool: &PgPool,
    guild_id: i64,
    user_id: i64,
    amount: i64,
) -> DbResult<()> {
    sqlx::query(
        "UPDATE members SET xp = xp + $3, weekly_xp = weekly_xp + $3, updated_at = now()
         WHERE guild_id = $1 AND user_id = $2",
    )
    .bind(guild_id)
    .bind(user_id)
    .bind(amount)
    .execute(pool)
    .await?;
    Ok(())
}

/// Hard-set a member's XP (manager operation).
pub async fn set_xp(pool: &PgPool, guild_id: i64, user_id: i64, xp: i64) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO members (guild_id, user_id, xp, weekly_xp, week_start)
         VALUES ($1, $2, $3, 0, date_trunc('week', now())::date)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = $3, updated_at = now()",
    )
    .bind(guild_id)
    .bind(user_id)
    .bind(xp.max(0))
    .execute(pool)
    .await?;
    Ok(())
}

/// Atomically move `amount` XP from `from` to `to` (coinflip wagers).
///
/// Returns `false` when the loser cannot cover the wager — nothing moves.
pub async fn transfer_xp(
    pool: &PgPool,
    guild_id: i64,
    from: i64,
    to: i64,
    amount: i64,
) -> DbResult<bool> {
    if from == to || amount <= 0 {
        return Ok(false);
    }
    let mut tx = pool.begin().await?;
    let deducted = sqlx::query(
        "UPDATE members SET xp = xp - $3, updated_at = now()
         WHERE guild_id = $1 AND user_id = $2 AND xp >= $3",
    )
    .bind(guild_id)
    .bind(from)
    .bind(amount)
    .execute(&mut *tx)
    .await?;
    if deducted.rows_affected() == 0 {
        return Ok(false);
    }
    sqlx::query(
        "INSERT INTO members (guild_id, user_id, xp, weekly_xp, week_start)
         VALUES ($1, $2, $3, $3, date_trunc('week', now())::date)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET
            xp = members.xp + $3, weekly_xp = members.weekly_xp + $3, updated_at = now()",
    )
    .bind(guild_id)
    .bind(to)
    .bind(amount)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

/// Absolute XP leaderboard for a guild.
pub async fn leaderboard(
    pool: &PgPool,
    guild_id: i64,
    limit: i64,
    offset: i64,
) -> DbResult<Vec<RankedMember>> {
    let rows = sqlx::query_as::<_, RankedMember>(
        r#"
        SELECT user_id, xp, weekly_xp,
               ROW_NUMBER() OVER (ORDER BY xp DESC, user_id ASC)::bigint AS position
        FROM members
        WHERE guild_id = $1 AND xp > 0
        ORDER BY xp DESC, user_id ASC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(guild_id)
    .bind(limit.clamp(1, 100))
    .bind(offset.max(0))
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Weekly XP leaderboard for a guild.
pub async fn weekly_leaderboard(
    pool: &PgPool,
    guild_id: i64,
    limit: i64,
    offset: i64,
) -> DbResult<Vec<RankedMember>> {
    let rows = sqlx::query_as::<_, RankedMember>(
        r#"
        SELECT user_id, xp, weekly_xp,
               ROW_NUMBER() OVER (ORDER BY weekly_xp DESC, user_id ASC)::bigint AS position
        FROM members
        WHERE guild_id = $1 AND weekly_xp > 0
          AND week_start = date_trunc('week', now())::date
        ORDER BY weekly_xp DESC, user_id ASC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(guild_id)
    .bind(limit.clamp(1, 100))
    .bind(offset.max(0))
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A member's absolute rank (1-based). `None` when they have no XP yet.
pub async fn rank_of(pool: &PgPool, guild_id: i64, user_id: i64) -> DbResult<Option<i64>> {
    let row: Option<(i64,)> = sqlx::query_as(
        r#"
        WITH ranked AS (
            SELECT user_id, ROW_NUMBER() OVER (ORDER BY xp DESC, user_id ASC) AS pos
            FROM members WHERE guild_id = $1 AND xp > 0
        )
        SELECT pos::bigint FROM ranked WHERE user_id = $2
        "#,
    )
    .bind(guild_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(pos,)| pos))
}

/// Bulk fetch result for multiple members in a single query.
#[derive(Debug, sqlx::FromRow)]
pub struct BulkMember {
    pub user_id: i64,
    pub xp: i64,
    pub weekly_xp: i64,
    pub daily_streak: i32,
    pub position: i64,
}

/// Fetch multiple members by their user IDs in a single query with their positions.
pub async fn get_members_bulk(
    pool: &PgPool,
    guild_id: i64,
    user_ids: &[i64],
) -> DbResult<Vec<BulkMember>> {
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query_as::<_, BulkMember>(
        r#"
        WITH ranked AS (
            SELECT user_id, xp, weekly_xp, daily_streak,
                   ROW_NUMBER() OVER (ORDER BY xp DESC, user_id ASC)::bigint AS position
            FROM members
            WHERE guild_id = $1 AND xp > 0
        )
        SELECT user_id, xp, weekly_xp, daily_streak, position
        FROM ranked
        WHERE user_id = ANY($2)
        ORDER BY position ASC
        "#,
    )
    .bind(guild_id)
    .bind(user_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Total count of active members with XP in a guild.
pub async fn count_members(pool: &PgPool, guild_id: i64, weekly_only: bool) -> DbResult<i64> {
    let count: (i64,) = if weekly_only {
        sqlx::query_as(
            r#"
            SELECT COUNT(*)::bigint FROM members
            WHERE guild_id = $1 AND weekly_xp > 0
              AND week_start = date_trunc('week', now())::date
            "#,
        )
        .bind(guild_id)
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_as("SELECT COUNT(*)::bigint FROM members WHERE guild_id = $1 AND xp > 0")
            .bind(guild_id)
            .fetch_one(pool)
            .await?
    };
    Ok(count.0)
}

/// Guild-level leveling statistics.
#[derive(Debug, sqlx::FromRow)]
pub struct GuildStats {
    pub total_members: i64,
    pub total_xp: i64,
    pub max_xp: i64,
}

pub async fn guild_stats(pool: &PgPool, guild_id: i64) -> DbResult<GuildStats> {
    let stats = sqlx::query_as::<_, GuildStats>(
        r#"
        SELECT 
            COUNT(*)::bigint AS total_members,
            COALESCE(SUM(xp), 0)::bigint AS total_xp,
            COALESCE(MAX(xp), 0)::bigint AS max_xp
        FROM members
        WHERE guild_id = $1 AND xp > 0
        "#,
    )
    .bind(guild_id)
    .fetch_one(pool)
    .await?;
    Ok(stats)
}
