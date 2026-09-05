//! Slash commands: `/rank`, `/rankcard`, `/top`, `/weekly`, `/play`,
//! `/addxp`, `/backup export|import`.

use poise::serenity_prelude::{self as serenity, Mentionable};
use sqlx::PgPool;

use crate::Context;

/// Fetch an image over HTTPS; `None` on any failure.
async fn fetch_image(url: &str) -> Option<image::DynamicImage> {
    let bytes = reqwest::get(url).await.ok()?.bytes().await.ok()?;
    image::load_from_memory(&bytes).ok()
}

/// Show a member's rank card: level, rank, XP and progress.
#[poise::command(slash_command, prefix_command)]
pub async fn rank(
    ctx: Context<'_>,
    #[description = "Member to inspect (defaults to you)"] user: Option<serenity::User>,
    #[description = "Show as text instead of the card image"] text_mode: Option<bool>,
    #[description = "Only you can see the reply"] hidden: Option<bool>,
) -> Result<(), crate::Error> {
    rank_impl(ctx, user, text_mode, hidden).await
}

/// Shared rank implementation — port of `showRank` in the original handler.
async fn rank_impl(
    ctx: Context<'_>,
    user: Option<serenity::User>,
    text_mode: Option<bool>,
    hidden: Option<bool>,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let target = user.unwrap_or_else(|| ctx.author().clone());
    let settings = inochi_db::repos::get_settings(&ctx.data().pool, gid)
        .await
        .unwrap_or_default();

    if !text_mode.unwrap_or(false) && !settings.rank_card.enabled {
        poise::send_reply(
            ctx,
            reply_ephemeral().content("Rank cards are turned off in this server. A manager can enable them from the dashboard."),
        )
        .await?;
        return Ok(());
    }

    let ephemeral = settings.rank_card.ephemeral || hidden.unwrap_or(false);
    // Card rendering + CDN fetches can exceed the 3 s interaction window.
    if ephemeral {
        ctx.defer_ephemeral().await?;
    } else {
        ctx.defer().await?;
    }

    let member = inochi_db::members::get_member(&ctx.data().pool, gid, target.id.get() as i64).await?;
    if member.xp <= 0 {
        let who = if target.id == ctx.author().id {
            "You have".into()
        } else {
            format!("**{}** has", target.display_name())
        };
        poise::send_reply(
            ctx,
            reply_ephemeral().content(format!(
                "{who} not earned any XP yet.\nSend a message in a channel where XP is enabled, then try again."
            )),
        )
        .await?;
        return Ok(());
    }

    let rank = inochi_db::members::rank_of(&ctx.data().pool, gid, target.id.get() as i64)
        .await?
        .unwrap_or(0);
    let curve = &settings.curve;
    let level = curve.level_for_xp(member.xp.max(0) as u64);
    let current_level_xp = curve.xp_for_level(level);
    let next_level_xp = curve.xp_to_next(level).saturating_add(current_level_xp);
    let progress = if next_level_xp > current_level_xp {
        ((member.xp.max(0) as u64 - current_level_xp) as f64
            / (next_level_xp - current_level_xp).max(1) as f64)
            .clamp(0.0, 1.0)
    } else {
        0.0
    };

    // Exact original text format: Name · Rank #n · Level n · X XP · p% to the next level
    if text_mode.unwrap_or(false) {
        poise::send_reply(
            ctx,
            reply().content(format!(
                "**{}** · Rank **#{rank}** · Level **{level}** · **{} XP** · {}% to the next level",
                target.display_name(),
                member.xp.max(0),
                (progress * 100.0).round() as u64
            )),
        )
        .await?;
        return Ok(());
    }

    // Background + avatar (CDN), then the card — plain attachment, no embed.
    let background = match settings.rank_background_url.as_deref().filter(|u| !u.is_empty()) {
        Some(url) => fetch_image(url).await,
        None => None,
    };
    let avatar = fetch_image(&target.face()).await;

    let accent = settings
        .rank_accent_color
        .as_deref()
        .and_then(parse_hex_color)
        .unwrap_or(VERMILION_DEFAULT);
    let dn = target.display_name().to_string();
    let input = crate::rankcard::CardInput {
        username: &dn,
        avatar: avatar.as_ref(),
        rank: Some(rank),
        level,
        xp: member.xp.max(0) as u64,
        current_level_xp: if settings.rank_card.relative_xp { current_level_xp } else { 0 },
        next_level_xp,
        background: background.as_ref(),
        accent,
        overlay: settings.rank_card.background_overlay as f32,
        avatar_radius: match settings.rank_card.avatar_shape {
            inochi_core::AvatarShape::Rounded => 6.0,
            inochi_core::AvatarShape::Circle => 94.0,
            inochi_core::AvatarShape::Square => 0.0,
        },
        technical_surface: settings.rank_card.surface == inochi_core::Surface::Technical,
        glow: settings.rank_card.progress_style == inochi_core::ProgressStyle::Glow,
    };
    let png = crate::rankcard::render(&input);
    let file = serenity::CreateAttachment::bytes(png, "rank.png");
    poise::send_reply(ctx, reply().attachment(file)).await?;
    Ok(())
}

const VERMILION_DEFAULT: [u8; 3] = [0xd3, 0x3c, 0x1c];

fn parse_hex_color(s: &str) -> Option<[u8; 3]> {
    let h = s.trim().trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&h[0..2], 16).ok()?;
    let g = u8::from_str_radix(&h[2..4], 16).ok()?;
    let b = u8::from_str_radix(&h[4..6], 16).ok()?;
    Some([r, g, b])
}

/// Render the rank card image for a member.
#[poise::command(slash_command, prefix_command)]
pub async fn rankcard(
    ctx: Context<'_>,
    #[description = "Member to inspect (defaults to you)"] user: Option<serenity::User>,
) -> Result<(), crate::Error> {
    rank_impl(ctx, user, None, None).await
}

/// Absolute XP leaderboard for this server.
#[poise::command(slash_command, prefix_command)]
pub async fn top(
    ctx: Context<'_>,
    #[description = "Page number"] #[min = 1] page: Option<i64>,
) -> Result<(), crate::Error> {
    top_impl(ctx, page).await
}

async fn top_impl(ctx: Context<'_>, page: Option<i64>) -> Result<(), crate::Error> {
    let page = page.unwrap_or(1).max(1);
    let limit = 10;
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let rows = inochi_db::members::leaderboard(
        &ctx.data().pool,
        guild_id.get() as i64,
        limit,
        (page - 1) * limit,
    )
    .await?;
    if rows.is_empty() {
        poise::say_reply(ctx, "No XP has been recorded yet.").await?;
        return Ok(());
    }
    let mut body = String::new();
    for row in rows {
        body.push_str(&format!("`#{:<3}` <@{}> — **{}** XP\n", row.position, row.user_id, row.xp));
    }
    let embed = serenity::CreateEmbed::new()
        .title(format!("Leaderboard — page {page}"))
        .description(body)
        .colour((0xEE, 0xEE, 0xEE));
    poise::send_reply(ctx, reply().embed(embed)).await?;
    Ok(())
}

/// Weekly XP leaderboard for this server.
#[poise::command(slash_command, prefix_command)]
pub async fn weekly(
    ctx: Context<'_>,
    #[description = "Entries to show"] #[min = 1] #[max = 20] limit: Option<i64>,
) -> Result<(), crate::Error> {
    leaderboard_reply(ctx, limit.unwrap_or(10), true).await
}

async fn leaderboard_reply(
    ctx: Context<'_>,
    limit: i64,
    weekly: bool,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let pool: &PgPool = &ctx.data().pool;
    let rows = if weekly {
        inochi_db::members::weekly_leaderboard(pool, guild_id.get() as i64, limit, 0).await?
    } else {
        inochi_db::members::leaderboard(pool, guild_id.get() as i64, limit, 0).await?
    };

    if rows.is_empty() {
        poise::say_reply(ctx, "No XP has been recorded yet.").await?;
        return Ok(());
    }

    let mut body = String::new();
    for row in rows {
        let value = if weekly { row.weekly_xp } else { row.xp };
        body.push_str(&format!("`#{:<3}` <@{}> — **{value}** XP\n", row.position, row.user_id));
    }

    let title = if weekly { "Weekly leaderboard" } else { "Leaderboard" };
    let embed = serenity::CreateEmbed::new()
        .title(title)
        .description(body)
        .colour((0xEE, 0xEE, 0xEE));

    poise::send_reply(ctx, reply().embed(embed)).await?;
    Ok(())
}

fn reply() -> poise::CreateReply {
    poise::CreateReply::default().ephemeral(false)
}

// ---------- setup ----------

/// Register this server for XP tracking.
#[poise::command(slash_command)]
pub async fn setup(ctx: Context<'_>) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let pool = &ctx.data().pool;

    match inochi_db::repos::get_settings(pool, gid).await {
        Ok(_) => {
            poise::say_reply(ctx, "This server is already set up.").await?;
            return Ok(());
        }
        Err(inochi_db::DbError::UnknownGuild(_)) => {}
        Err(err) => return Err(err.into()),
    }

    // Defaults are validated by the core engine before persisting.
    inochi_db::repos::ensure_guild(pool, gid).await?;
    inochi_db::repos::put_settings(
        pool,
        gid,
        &inochi_core::GuildSettings::default(),
        Some(ctx.author().id.get() as i64),
    )
    .await?;
    ctx.data().invalidate_settings(gid);

    poise::say_reply(
        ctx,
        "Setup complete — members now earn **15 XP per message** (60 s cooldown). Tune everything in the dashboard.",
    )
    .await?;
    Ok(())
}

fn reply_ephemeral() -> poise::CreateReply {
    poise::CreateReply::default().ephemeral(true)
}

/// Base XP granted by a successful /daily claim.
const DAILY_BASE: i64 = 100;
/// Extra XP per day of streak, capped.
const DAILY_STREAK_BONUS: i64 = 25;
/// Maximum streak bonus steps.
const DAILY_STREAK_CAP: u32 = 6;

/// List every Inochi command.
#[poise::command(slash_command)]
pub async fn help(ctx: Context<'_>) -> Result<(), crate::Error> {
    let embed = serenity::CreateEmbed::new()
        .title("Inochi — commands")
        .colour((0xEE, 0xEE, 0xEE))
        .field(
            "Leveling",
            "`/rank [user] [text_mode] [hidden]` — card image or text\n`/rankcard` — card image\n`/member` — full profile\n`/top [page]`, `/weekly` — leaderboards\n`/daily` — daily XP + streak\n`/calculate [level]` — XP needed\n`/vote` — vote rewards\n`/wrapped` — your XP snapshot",
            false,
        )
        .field(
            "Games",
            "`/play scramble|math|quiz|reverse` — first answer wins\n`/play highest` — highest number wins\n`/coinflip [opponent] [wager] [side]` — solo or PvP wager\n`/bigtext` — emoji letters",
            false,
        )
        .field(
            "Managers",
            "`/setup` · `/addxp [set_xp|add_levels|set_level]` · `/clear` · `/reset`\n`/rewards set|remove|list` · `/rewardrole` · `/multiplier`\n`/joinrole` · `/blacklist add|remove|show` · `/xpchannel`\n`/threads` · `/leaderboard colour|background` · `/botstatus`\n`/refresh` · `/config` · `/diagnose` · `/import csv|scan` · `/backup export|import`",
            false,
        )
        .footer(serenity::CreateEmbedFooter::new("Dashboard: tune XP rates, multipliers and welcomes from the web UI"));
    poise::send_reply(ctx, reply().embed(embed)).await?;
    Ok(())
}

/// Claim your daily XP and grow the streak.
#[poise::command(slash_command)]
pub async fn daily(ctx: Context<'_>) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let uid = ctx.author().id.get() as i64;

    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;

    let claim =
        inochi_db::members::claim_daily(&ctx.data().pool, gid, uid, DAILY_BASE).await?;
    let Some(claim) = claim else {
        // Still inside the window — report time remaining.
        let member = inochi_db::members::get_member(&ctx.data().pool, gid, uid).await?;
        let remaining = member
            .last_daily
            .map(|t| t + chrono::Duration::hours(20) - chrono::Utc::now())
            .unwrap_or_default();
        let hours = remaining.num_hours().max(0);
        let minutes = remaining.num_minutes().max(0) % 60;
        poise::say_reply(
            ctx,
            format!("You already claimed today. Next claim in **{hours}h {minutes}m**."),
        )
        .await?;
        return Ok(());
    };

    let bonus_steps = (claim.streak.max(1) - 1).min(DAILY_STREAK_CAP as i32);
    let bonus = i64::from(bonus_steps) * DAILY_STREAK_BONUS;
    if bonus > 0 {
        // Streak bonus rides outside the cooldown path by design.
        inochi_db::members::add_xp_flat(&ctx.data().pool, gid, uid, bonus).await?;
    }

    let streak_note = if claim.streak_continued {
        format!("Streak **{}** days.", claim.streak)
    } else if claim.streak > 1 {
        format!("Streak reset — back to **{}**.", claim.streak)
    } else {
        "Start of a streak — come back tomorrow!".into()
    };
    poise::say_reply(
        ctx,
        format!(
            "{} claimed **{} XP** (+{} streak bonus). {}",
            ctx.author().mention(),
            DAILY_BASE + bonus,
            bonus,
            streak_note
        ),
    )
    .await?;
    Ok(())
}

/// Flip a coin — solo, or challenge someone for XP.
#[poise::command(slash_command, prefix_command)]
pub async fn coinflip(
    ctx: Context<'_>,
    #[description = "Challenge a member for the wager"] opponent: Option<serenity::User>,
    #[description = "XP wagered (challenge mode)"] #[min = 1] #[max = 100_000] wager: Option<i64>,
    #[description = "Your side"] side: Option<CoinSide>,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let flip = if rand::random() { "Heads" } else { "Tails" };

    match (opponent, wager) {
        (Some(opp), Some(wager)) => {
            if opp.bot || opp.id == ctx.author().id {
                poise::say_reply(ctx, "Pick a real opponent (not a bot or yourself).").await?;
                return Ok(());
            }
            inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;
            let me = ctx.author().id.get() as i64;
            let them = opp.id.get() as i64;
            let i_win = (side.as_ref().map(|s| s.label() == flip).unwrap_or(rand::random()));
            let (winner, loser) = if i_win { (me, them) } else { (them, me) };
            let moved = inochi_db::members::transfer_xp(&ctx.data().pool, gid, loser, winner, wager).await?;
            if !moved {
                poise::say_reply(
                    ctx,
                    format!("{} doesn't have **{wager} XP** to cover the wager — flip cancelled.", loser_me(&ctx, loser, ctx.author(), &opp)),
                )
                .await?;
                return Ok(());
            }
            let winner_mention = if i_win { ctx.author().mention() } else { opp.mention() };
            poise::say_reply(
                ctx,
                format!(
                    "The coin landed on **{flip}** — {} wins the flip and takes **{wager} XP** from {}!",
                    winner_mention,
                    if i_win { opp.mention() } else { ctx.author().mention() }
                ),
            )
            .await?;
        }
        _ => {
            let called = side.map(|s| s.label()).unwrap_or("—");
            let outcome = if flip == called && side.is_some() { "You called it!" } else { "Better luck next time." };
            poise::say_reply(ctx, format!("The coin landed on **{flip}** (you called: {called}). {outcome}")).await?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, poise::ChoiceParameter)]
pub enum CoinSide {
    #[name = "heads"]
    Heads,
    #[name = "tails"]
    Tails,
}

impl CoinSide {
    fn label(self) -> &'static str {
        match self {
            Self::Heads => "Heads",
            Self::Tails => "Tails",
        }
    }
}

fn loser_me(_ctx: &Context<'_>, loser: i64, author: &serenity::User, opp: &serenity::User) -> String {
    if loser == author.id.get() as i64 {
        author.mention().to_string()
    } else {
        opp.mention().to_string()
    }
}

// ---------- level role rewards ----------

/// Configure automatic level role rewards.
#[poise::command(
    slash_command,
    default_member_permissions = "MANAGE_GUILD",
    subcommands("rewards_set", "rewards_remove", "rewards_list")
)]
pub async fn rewards(_: Context<'_>) -> Result<(), crate::Error> {
    Ok(())
}

/// Grant a role when members reach a level.
#[poise::command(slash_command)]
pub async fn rewards_set(
    ctx: Context<'_>,
    #[description = "Level threshold"] #[min = 1] #[max = 500] level: i32,
    #[description = "Role to grant"] role: serenity::Role,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    if role.id.get() == guild_id.get() {
        poise::say_reply(ctx, "That's the @everyone role — pick a real role.").await?;
        return Ok(());
    }
    inochi_db::repos::ensure_guild(&ctx.data().pool, guild_id.get() as i64).await?;
    inochi_db::rewards::set_level_role(
        &ctx.data().pool,
        guild_id.get() as i64,
        level,
        role.id.get() as i64,
    )
    .await?;
    poise::say_reply(
        ctx,
        format!("Members reaching **level {level}** will receive {}.", role.mention()),
    )
    .await?;
    Ok(())
}

/// Remove the reward configured at a level.
#[poise::command(slash_command)]
pub async fn rewards_remove(
    ctx: Context<'_>,
    #[description = "Level threshold"] level: i32,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let removed =
        inochi_db::rewards::remove_level_role(&ctx.data().pool, guild_id.get() as i64, level)
            .await?;
    poise::say_reply(
        ctx,
        if removed {
            format!("Removed the level-{level} reward.")
        } else {
            format!("No reward was configured at level {level}.")
        },
    )
    .await?;
    Ok(())
}

/// Show all configured level rewards.
#[poise::command(slash_command)]
pub async fn rewards_list(ctx: Context<'_>) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let rows =
        inochi_db::rewards::list_level_roles(&ctx.data().pool, guild_id.get() as i64).await?;
    if rows.is_empty() {
        poise::say_reply(ctx, "No level rewards configured yet — try `/rewards set`.").await?;
        return Ok(());
    }
    let body: String = rows
        .iter()
        .map(|(level, role)| format!("Level **{level}** → <@&{role}>\n"))
        .collect();
    let embed = serenity::CreateEmbed::new()
        .title("Level rewards")
        .description(body)
        .colour((0xEE, 0xEE, 0xEE));
    poise::send_reply(ctx, reply().embed(embed)).await?;
    Ok(())
}

// ---------- games ----------

/// Start a chat game in this channel.
#[poise::command(slash_command)]
pub async fn play(
    ctx: Context<'_>,
    #[description = "Game to play"] game: crate::games::GameKind,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let cid = ctx.channel_id().get() as i64;

    if crate::games::has_active(gid, cid) {
        poise::say_reply(ctx, "A round is already running in this channel.").await?;
        return Ok(());
    }

    // members.guild_id has a FK to guilds; make sure the row exists before
    // the winner's XP award fires.
    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;

    if game == crate::games::GameKind::Highest {
        if !crate::games::start_highest(gid, cid) {
            poise::say_reply(ctx, "A round is already running in this channel.").await?;
            return Ok(());
        }

        // Timer finalizes the round and pays the winner.
        let http = ctx.serenity_context().http.clone();
        let pool = ctx.data().pool.clone();
        let channel = ctx.channel_id();
        tokio::spawn(async move {
            tokio::time::sleep(crate::games::ROUND_TIME).await;
            if let Some((uid, mention, value)) = crate::games::finalize_highest(gid, cid) {
                let _ = inochi_db::members::award_xp(
                    &pool,
                    gid,
                    uid as i64,
                    crate::games::WIN_XP,
                    0,
                )
                .await;
                let _ = channel
                    .say(
                        &http,
                        format!(
                            "Time! {mention} wins the Highest number round with **{value}** (+{} XP)!",
                            crate::games::WIN_XP
                        ),
                    )
                    .await;
            }
        });

        poise::say_reply(
            ctx,
            format!(
                "**{}** — type any **whole number**!\nThe highest number when time runs out (90 s) wins **{} XP**.",
                game.label(),
                crate::games::WIN_XP
            ),
        )
        .await?;
        return Ok(());
    }

    let Some((prompt, answer)) = crate::games::new_round(game, &mut rand::thread_rng()) else {
        return Ok(());
    };
    crate::games::start(gid, cid, answer);

    poise::say_reply(
        ctx,
        format!(
            "**{}** — {prompt}\nFirst correct answer wins **{} XP**. You have 90 seconds.",
            game.label(),
            crate::games::WIN_XP
        ),
    )
    .await?;
    Ok(())
}

// ---------- backups ----------

/// Export or restore this server's data.
#[poise::command(
    slash_command,
    default_member_permissions = "MANAGE_GUILD",
    subcommands("backup_export", "backup_import")
)]
pub async fn backup(_: Context<'_>) -> Result<(), crate::Error> {
    Ok(())
}

/// Download a JSON backup of settings and XP.
#[poise::command(slash_command)]
pub async fn backup_export(ctx: Context<'_>) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;

    let doc = inochi_db::backup::export_guild(&ctx.data().pool, gid).await?;
    let Some(doc) = doc else {
        poise::send_reply(ctx, reply_ephemeral().content("Nothing to back up yet — run /setup or wait for the first messages.")).await?;
        return Ok(());
    };

    let bytes = serde_json::to_vec_pretty(&doc)?;
    let file =
        serenity::CreateAttachment::bytes(bytes, format!("inochi-backup-{gid}.json"));
    poise::send_reply(
        ctx,
        reply_ephemeral()
            .content(format!("Backup of **{}** members.", doc.members.len()))
            .attachment(file),
    )
    .await?;
    Ok(())
}

/// Restore from a JSON backup file.
#[poise::command(slash_command)]
pub async fn backup_import(
    ctx: Context<'_>,
    #[description = "Backup JSON produced by /backup export"] backup: serenity::Attachment,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;

    if !backup.filename.ends_with(".json") {
        poise::say_reply(ctx, "Please attach a `.json` backup file.").await?;
        return Ok(());
    }

    let bytes = backup.download().await?;
    let doc: inochi_db::backup::BackupDoc = serde_json::from_slice(&bytes).map_err(|err| {
        format!("Not a valid Inochi backup: {err}")
    })?;
    if doc.version != 1 {
        poise::say_reply(ctx, format!("Unsupported backup version {}.", doc.version)).await?;
        return Ok(());
    }

    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;
    let summary = inochi_db::backup::import_guild(&ctx.data().pool, gid, &doc).await?;

    poise::say_reply(
        ctx,
        format!(
            "Restore complete: settings {}, **{}** member entries merged.",
            if summary.settings_applied { "applied" } else { "untouched" },
            summary.members_merged
        ),
    )
    .await?;
    Ok(())
}

// ---------- CSV import ----------

/// Parse a leaderboard CSV (`user_id,xp` per line) into backup members.
///
/// Tolerates a header row, extra columns and negative XP (skipped).
pub(crate) fn parse_leaderboard_csv(bytes: &[u8]) -> Vec<inochi_db::backup::BackupMember> {
    let mut out = Vec::new();
    for (idx, line) in std::str::from_utf8(bytes)
        .unwrap_or("")
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .enumerate()
    {
        let mut fields = line.split(',');
        let Some(user_field) = fields.next() else { continue };
        let xp_field = fields.next().unwrap_or("");
        let user_id = user_field.trim();
        // First non-empty field that isn't numeric means a header row.
        if idx == 0 && !user_id.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let (Ok(user_id), Ok(xp)) = (user_id.parse::<i64>(), xp_field.trim().parse::<i64>()) else {
            continue;
        };
        if user_id <= 0 || xp <= 0 {
            continue;
        }
        out.push(inochi_db::backup::BackupMember { user_id, xp });
    }
    out
}

/// Import member XP from other bots.
#[poise::command(
    slash_command,
    default_member_permissions = "MANAGE_GUILD",
    subcommands("import_csv", "import_scan")
)]
pub async fn import(_: Context<'_>) -> Result<(), crate::Error> {
    Ok(())
}

/// Import member XP from a CSV file (`user_id,xp` rows).
#[poise::command(slash_command)]
pub async fn import_csv(
    ctx: Context<'_>,
    #[description = "CSV file with user_id,xp rows"] csv: serenity::Attachment,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;

    if !csv.filename.ends_with(".csv") {
        poise::say_reply(ctx, "Please attach a `.csv` file.").await?;
        return Ok(());
    }

    let bytes = csv.download().await?;
    let members = parse_leaderboard_csv(&bytes);
    if members.is_empty() {
        poise::say_reply(ctx, "No usable `user_id,xp` rows found in that file.").await?;
        return Ok(());
    }

    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;
    let summary = inochi_db::backup::import_guild(
        &ctx.data().pool,
        gid,
        &inochi_db::backup::BackupDoc {
            version: 1,
            guild_id: gid,
            settings: None,
            members,
        },
    )
    .await?;

    poise::say_reply(
        ctx,
        format!("Imported **{}** members from CSV.", summary.members_merged),
    )
    .await?;
    Ok(())
}

/// Flatten one message into the text snapshot the parsers read.
fn snapshot_text(m: &serenity::Message) -> String {
    let mut parts = vec![m.content.clone()];
    for e in &m.embeds {
        if let Some(author) = &e.author {
            parts.push(author.name.clone());
        }
        if let Some(t) = &e.title {
            parts.push(t.clone());
        }
        if let Some(d) = &e.description {
            parts.push(d.clone());
        }
        for f in &e.fields {
            parts.push(format!("{}: {}", f.name, f.value));
        }
        if let Some(footer) = &e.footer {
            parts.push(footer.text.clone());
        }
    }
    parts.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n")
}

/// Scan a channel's leaderboard messages and import XP from another bot.
#[poise::command(slash_command)]
pub async fn import_scan(
    ctx: Context<'_>,
    #[description = "Which bot posted the leaderboard"] provider: crate::importers::Provider,
    #[description = "Channel to scan (defaults to this one)"] channel: Option<serenity::Channel>,
    #[description = "Messages to scan"] #[min = 1] #[max = 500] limit: Option<u32>,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let target = channel.map(|c| c.id()).unwrap_or(ctx.channel_id());

    let curve = inochi_db::repos::get_settings(&ctx.data().pool, gid)
        .await
        .map(|s| s.curve)
        .unwrap_or_default();

    poise::say_reply(ctx, format!("Scanning up to {} messages…", limit.unwrap_or(100))).await?;

    use serenity::futures::StreamExt;
    let mut records: Vec<crate::importers::Record> = Vec::new();
    let mut scanned = 0u32;
    let mut stream = Box::pin(target.messages_iter(ctx.http()).take(limit.unwrap_or(100) as usize));
    while let Some(item) = stream.next().await {
        match item {
            Ok(m) => {
                scanned += 1;
                let text = snapshot_text(&m);
                crate::importers::parse_message(provider, &text, &curve, &mut records);
            }
            Err(err) => {
                tracing::warn!(%err, "history fetch error during import scan");
                break;
            }
        }
    }

    if records.is_empty() {
        poise::send_reply(
            ctx,
            reply_ephemeral().content(format!(
                "Scanned {scanned} messages — no {} leaderboard records found.",
                match provider {
                    crate::importers::Provider::Mee6 => "MEE6",
                    crate::importers::Provider::Amari => "Amari",
                    crate::importers::Provider::Lurkr => "Lurkr",
                    crate::importers::Provider::Arcane => "Arcane",
                    crate::importers::Provider::ProBot => "ProBot",
                    crate::importers::Provider::CarlBot => "Carl-bot",
                }
            )),
        )
        .await?;
        return Ok(());
    }

    let members: Vec<inochi_db::backup::BackupMember> = records
        .iter()
        .map(|r| inochi_db::backup::BackupMember { user_id: r.user_id, xp: r.xp })
        .collect();
    let count = members.len();

    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;
    let summary = inochi_db::backup::import_guild(
        &ctx.data().pool,
        gid,
        &inochi_db::backup::BackupDoc {
            version: 1,
            guild_id: gid,
            settings: None,
            members,
        },
    )
    .await?;

    poise::send_reply(
        ctx,
        reply_ephemeral().content(format!(
            "Scanned **{scanned}** messages, found **{count}** members, merged **{}** entries. XP merged as max(current, imported).",
            summary.members_merged
        )),
    )
    .await?;
    Ok(())
}

// ---------- emoji art ----------

/// Render text as big emoji letters.
#[poise::command(slash_command)]
pub async fn bigtext(
    ctx: Context<'_>,
    #[description = "Text to render (max 24 chars)"] #[min_length = 1] text: String,
) -> Result<(), crate::Error> {
    let rendered: String = text
        .chars()
        .take(24)
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' => {
                let offset = (c.to_ascii_lowercase() as u32) - ('a' as u32);
                char::from_u32(0x1F1E6 + offset)
                    .map(|r| format!("{r} "))
                    .unwrap_or_default()
            }
            '0'..='9' => format!("{c}\u{FE0F}\u{20E3} "),
            ' ' => "\u{3000}".into(),
            other => other.to_string(),
        })
        .collect();

    if rendered.trim().is_empty() {
        poise::say_reply(ctx, "Nothing renderable in that text.").await?;
        return Ok(());
    }
    poise::say_reply(ctx, rendered).await?;
    Ok(())
}

// ---------- profile & utilities ----------

/// Show a member's full XP profile.
#[poise::command(slash_command, prefix_command)]
pub async fn member(
    ctx: Context<'_>,
    #[description = "Member to inspect (defaults to you)"] user: Option<serenity::User>,
) -> Result<(), crate::Error> {
    let target = user.unwrap_or_else(|| ctx.author().clone());
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    ctx.defer().await?;

    let m = inochi_db::members::get_member(&ctx.data().pool, gid, target.id.get() as i64).await?;
    let rank = inochi_db::members::rank_of(&ctx.data().pool, gid, target.id.get() as i64).await?;
    let curve = inochi_db::repos::get_settings(&ctx.data().pool, gid)
        .await
        .map(|s| s.curve)
        .unwrap_or_default();
    let embed = serenity::CreateEmbed::new()
        .title(format!("{} — member profile", target.name))
        .thumbnail(target.face())
        .field("Level", curve.level_for_xp(m.xp.max(0) as u64).to_string(), true)
        .field("Rank", rank.map(|r| format!("#{r}")).unwrap_or_else(|| "—".into()), true)
        .field("Total XP", m.xp.max(0).to_string(), true)
        .field("Weekly XP", m.weekly_xp.to_string(), true)
        .field("Daily streak", m.daily_streak.to_string(), true)
        .colour((0xEE, 0xEE, 0xEE));
    poise::send_reply(ctx, reply().embed(embed)).await?;
    Ok(())
}

/// See how much XP is needed to reach a level.
#[poise::command(slash_command, prefix_command)]
pub async fn calculate(
    ctx: Context<'_>,
    #[description = "Target level"] #[min = 1] #[max = 1000] level: i64,
    #[description = "Member to compare (defaults to you)"] user: Option<serenity::User>,
) -> Result<(), crate::Error> {
    let target = user.unwrap_or_else(|| ctx.author().clone());
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let curve = inochi_db::repos::get_settings(&ctx.data().pool, gid)
        .await
        .map(|s| s.curve)
        .unwrap_or_default();
    let target_xp = curve.xp_for_level(level as u32);
    let member = inochi_db::members::get_member(&ctx.data().pool, gid, target.id.get() as i64).await?;
    let have = member.xp.max(0) as u64;
    let remaining = target_xp.saturating_sub(have);
    let msg = if remaining == 0 {
        format!("{} is already at or beyond **level {level}**.", target.mention())
    } else {
        format!(
            "{} needs **{remaining}** more XP to reach **level {level}** ({} total).",
            target.mention(),
            comma_u64(target_xp)
        )
    };
    poise::say_reply(ctx, msg).await?;
    Ok(())
}

/// Vote for Inochi on top.gg and activate your XP boost.
#[poise::command(slash_command, prefix_command)]
pub async fn vote(ctx: Context<'_>) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let uid = ctx.author().id.get() as i64;
    let settings = inochi_db::repos::get_settings(&ctx.data().pool, guild_id.get() as i64)
        .await
        .unwrap_or_default();
    let boost = &settings.vote_boost;

    let hours_left = inochi_db::keys::vote_hours_left(&ctx.data().pool, "topgg", uid)
        .await
        .unwrap_or(None);
    if let Some(hours) = hours_left {
        poise::say_reply(
            ctx,
            format!(
                "Your vote boost is active — **{}× XP** for ~{} more hour(s).",
                boost.multiplier, hours
            ),
        )
        .await?;
        return Ok(());
    }
    if !boost.enabled {
        poise::say_reply(ctx, "Vote boosts are not enabled in this server.").await?;
        return Ok(());
    }

    let url = std::env::var("TOPGG_VOTE_URL").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| {
        let client_id = std::env::var("DISCORD_CLIENT_ID").unwrap_or_default();
        format!("https://top.gg/bot/{client_id}/vote")
    });
    let embed = serenity::CreateEmbed::new()
        .title("Vote for Inochi")
        .description(format!(
            "[Click here to vote]({url}) — voting grants **{}× XP** for **{} hours**.",
            boost.multiplier, boost.duration_hours
        ))
        .colour((0x7C, 0xB4, 0xFF));
    poise::send_reply(ctx, reply().embed(embed)).await?;
    Ok(())
}

/// A year-in-review style snapshot of your XP in this server.
#[poise::command(slash_command, prefix_command)]
pub async fn wrapped(ctx: Context<'_>) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    ctx.defer().await?;
    let uid = ctx.author().id.get() as i64;

    let m = inochi_db::members::get_member(&ctx.data().pool, gid, uid).await?;
    let rank = inochi_db::members::rank_of(&ctx.data().pool, gid, uid).await?;
    let totals: (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(xp), 0), COUNT(*) FROM members WHERE guild_id = $1 AND xp > 0",
    )
    .bind(gid)
    .fetch_one(&ctx.data().pool)
    .await?;
    let (guild_total, members_count) = totals;
    let share = if guild_total > 0 {
        (m.xp.max(0) as f64 / guild_total as f64 * 1000.0).round() / 10.0
    } else {
        0.0
    };
    let curve = inochi_db::repos::get_settings(&ctx.data().pool, gid)
        .await
        .map(|s| s.curve)
        .unwrap_or_default();
    let embed = serenity::CreateEmbed::new()
        .title(format!("{} — wrapped", ctx.author().name))
        .field("Level", curve.level_for_xp(m.xp.max(0) as u64).to_string(), true)
        .field("Server rank", rank.map(|r| format!("#{r} of {members_count}")).unwrap_or_else(|| "—".into()), true)
        .field("Share of server XP", format!("{share}%"), true)
        .field("Total XP", m.xp.max(0).to_string(), true)
        .field("Weekly XP", m.weekly_xp.to_string(), true)
        .field("Daily streak", format!("{} days", m.daily_streak), true)
        .colour((0xEE, 0xEE, 0xEE));
    poise::send_reply(ctx, reply().embed(embed)).await?;
    Ok(())
}

fn comma_u64(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

// ---------- manager operations ----------

/// Adjust a member's XP or level directly.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn addxp(
    ctx: Context<'_>,
    #[description = "Member to adjust"] user: serenity::User,
    #[description = "Amount"] #[min = 1] amount: i64,
    #[description = "Operation"] operation: Option<XpOperation>,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let uid = user.id.get() as i64;
    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;

    match operation.unwrap_or(XpOperation::AddXp) {
        XpOperation::AddXp => {
            let row = inochi_db::members::award_xp(&ctx.data().pool, gid, uid, amount, 0)
                .await?
                .ok_or_else(|| -> crate::Error { "award unexpectedly skipped".into() })?;
            poise::say_reply(ctx, format!("Gave **{amount}** XP to {} — now at {}", user.mention(), row.xp)).await?;
        }
        XpOperation::SetXp => {
            inochi_db::members::set_xp(&ctx.data().pool, gid, uid, amount).await?;
            poise::say_reply(ctx, format!("Set {} to **{amount} XP**.", user.mention())).await?;
        }
        XpOperation::AddLevels | XpOperation::SetLevel => {
            let curve = inochi_db::repos::get_settings(&ctx.data().pool, gid)
                .await
                .map(|s| s.curve)
                .unwrap_or_default();
            let target_level = match operation.unwrap() {
                XpOperation::SetLevel => amount as u32,
                XpOperation::AddLevels => {
                    let m = inochi_db::members::get_member(&ctx.data().pool, gid, uid).await?;
                    curve.level_for_xp(m.xp.max(0) as u64).saturating_add(amount as u32)
                }
                _ => unreachable!(),
            };
            let xp = curve.xp_for_level(target_level) as i64;
            inochi_db::members::set_xp(&ctx.data().pool, gid, uid, xp).await?;
            poise::say_reply(ctx, format!("Set {} to **level {target_level}** ({} XP).", user.mention(), comma_u64(xp as u64))).await?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, poise::ChoiceParameter)]
pub enum XpOperation {
    #[name = "Add XP"]
    AddXp,
    #[name = "Set XP"]
    SetXp,
    #[name = "Add levels"]
    AddLevels,
    #[name = "Set level"]
    SetLevel,
}

/// Wipe a member's XP and streak.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn clear(
    ctx: Context<'_>,
    #[description = "Member to wipe"] user: serenity::User,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;
    inochi_db::members::set_xp(&ctx.data().pool, gid, user.id.get() as i64, 0).await?;
    poise::say_reply(ctx, format!("Cleared all XP for {}.", user.mention())).await?;
    Ok(())
}

/// Reset a member's data — requires typing the member ID as confirmation.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn reset(
    ctx: Context<'_>,
    #[description = "Member to reset"] user: serenity::User,
    #[description = "Type the member's ID to confirm"] confirmation: String,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    if confirmation.trim() != user.id.get().to_string() {
        poise::say_reply(
            ctx,
            format!("Confirmation mismatch — type `{}` as the confirmation to reset {}.", user.id, user.mention()),
        )
        .await?;
        return Ok(());
    }
    let gid = guild_id.get() as i64;
    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;
    inochi_db::members::set_xp(&ctx.data().pool, gid, user.id.get() as i64, 0).await?;
    poise::say_reply(ctx, format!("Reset {} — XP and streak wiped.", user.mention())).await?;
    Ok(())
}

/// Re-evaluate level roles or recompute leaderboard positions.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn refresh(
    ctx: Context<'_>,
    #[description = "Data to refresh"] scope: RefreshScope,
    #[description = "Type CONFIRM to run"] confirmation: Option<String>,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    if confirmation.as_deref().map(|s| s.eq_ignore_ascii_case("confirm")) != Some(true) {
        poise::say_reply(ctx, "This touches every member — re-run with confirmation set to `CONFIRM`.").await?;
        return Ok(());
    }
    ctx.defer().await?;

    match scope {
        RefreshScope::Roles => {
            let curve = inochi_db::repos::get_settings(&ctx.data().pool, gid)
                .await
                .map(|s| s.curve)
                .unwrap_or_default();
            let rows: Vec<(i64, i64)> = sqlx::query_as(
                "SELECT user_id, xp FROM members WHERE guild_id = $1 AND xp > 0 LIMIT 1000",
            )
            .bind(gid)
            .fetch_all(&ctx.data().pool)
            .await?;
            let mut granted = 0u32;
            for (uid, xp) in rows {
                let level = curve.level_for_xp(xp.max(0) as u64);
                if let Ok(Some(role_id)) = inochi_db::rewards::role_for_level(&ctx.data().pool, gid, level).await {
                    if let Ok(member) = serenity::GuildId::new(gid as u64).member(ctx.http(), uid as u64).await {
                        if member
                            .add_role(ctx.http(), serenity::RoleId::new(role_id as u64))
                            .await
                            .is_ok()
                        {
                            granted += 1;
                        }
                    }
                }
            }
            poise::say_reply(ctx, format!("Re-evaluated level roles — granted **{granted}** roles.")).await?;
        }
        RefreshScope::Points => {
            // Leaderboard positions are computed live; nothing to rebuild.
            poise::say_reply(ctx, "Leaderboard positions are computed live — nothing to refresh.").await?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, poise::ChoiceParameter)]
pub enum RefreshScope {
    #[name = "Reward roles"]
    Roles,
    #[name = "All points"]
    Points,
}

/// Set the role granted to new members.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn joinrole(
    ctx: Context<'_>,
    #[description = "Role for new members (omit to disable)"] role: Option<serenity::Role>,
) -> Result<(), crate::Error> {
    update_setting(
        ctx,
        |s| s.join_role_id = role.map(|r| r.id.get() as i64),
        |s, _| {
            match s.join_role_id {
                Some(id) => format!("New members will receive <@&{id}>."),
                None => "Join role disabled.".into(),
            }
        },
    )
    .await
}

/// Manage the role blacklist.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn blacklist(
    ctx: Context<'_>,
    #[description = "Action"] action: BlacklistAction,
    #[description = "Role (for add/remove)"] role: Option<serenity::Role>,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let pool = &ctx.data().pool;
    let mut settings = inochi_db::repos::get_settings(pool, gid).await.unwrap_or_default();
    let role_id = role.map(|r| r.id.get() as i64);
    match action {
        BlacklistAction::Add => {
            let Some(id) = role_id else {
                poise::say_reply(ctx, "Pick a role to blacklist.").await?;
                return Ok(());
            };
            if !settings.blacklist.roles.contains(&id) {
                settings.blacklist.roles.push(id);
            }
            inochi_db::repos::put_settings(pool, gid, &settings, Some(ctx.author().id.get() as i64)).await?;
            ctx.data().invalidate_settings(gid);
            poise::say_reply(ctx, format!("Members with <@&{id}> no longer earn XP.")).await?;
        }
        BlacklistAction::Remove => {
            let Some(id) = role_id else {
                poise::say_reply(ctx, "Pick a role to un-blacklist.").await?;
                return Ok(());
            };
            settings.blacklist.roles.retain(|r| *r != id);
            inochi_db::repos::put_settings(pool, gid, &settings, Some(ctx.author().id.get() as i64)).await?;
            ctx.data().invalidate_settings(gid);
            poise::say_reply(ctx, format!("<@&{id}> removed from the blacklist.")).await?;
        }
        BlacklistAction::Show => {
            let list: Vec<String> = settings.blacklist.roles.iter().map(|r| format!("<@&{r}>")).collect();
            poise::say_reply(
                ctx,
                if list.is_empty() {
                    "No blacklisted roles.".to_string()
                } else {
                    format!("Blacklisted roles: {}", list.join(", "))
                },
            )
            .await?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, poise::ChoiceParameter)]
pub enum BlacklistAction {
    #[name = "Add"]
    Add,
    #[name = "Remove"]
    Remove,
    #[name = "Show"]
    Show,
}

/// Configure a level role reward.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn rewardrole(
    ctx: Context<'_>,
    #[description = "Role to grant"] role: serenity::Role,
    #[description = "Level threshold"] #[min = 1] #[max = 500] level: i64,
    #[description = "Keep when a higher reward is earned"] keep: Option<bool>,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;
    inochi_db::rewards::set_level_role(&ctx.data().pool, gid, level as i32, role.id.get() as i64).await?;
    let keep_note = match keep {
        Some(true) => " Members keep it when they earn higher rewards.",
        Some(false) | None => " Higher rewards replace this one.",
    };
    poise::say_reply(
        ctx,
        format!("Level **{level}** now grants {}.{keep_note}", role.mention()),
    )
    .await?;
    Ok(())
}

/// Set a role XP multiplier.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn multiplier(
    ctx: Context<'_>,
    #[description = "Role"] role: serenity::Role,
    #[description = "Multiplier (0 clears, e.g. 1.5)"] #[min = 0] #[max = 10] value: f64,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let pool = &ctx.data().pool;
    let mut settings = inochi_db::repos::get_settings(pool, gid).await.unwrap_or_default();
    let id = role.id.get() as i64;
    settings.multipliers.retain(|m| !(m.scope == inochi_core::MultiplierScope::Role && m.id == Some(id)));
    if value > 0.0 {
        settings.multipliers.push(inochi_core::Multiplier {
            scope: inochi_core::MultiplierScope::Role,
            id: Some(id),
            factor: value,
        });
    }
    inochi_db::repos::put_settings(pool, gid, &settings, Some(ctx.author().id.get() as i64)).await?;
            ctx.data().invalidate_settings(gid);
    let msg = if value > 0.0 {
        format!("<@&{id}> members now earn **{value}×** XP.")
    } else {
        format!("Multiplier cleared for <@&{id}>.")
    };
    poise::say_reply(ctx, msg).await?;
    Ok(())
}

/// Manage which channels earn XP.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn xpchannel(
    ctx: Context<'_>,
    #[description = "Mode: allowlist or denylist"] mode: Option<ChannelMode>,
    #[description = "Action"] action: Option<ChannelAction>,
    #[description = "Channel (for add/remove)"] channel: Option<serenity::Channel>,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let pool = &ctx.data().pool;
    let mut settings = inochi_db::repos::get_settings(pool, gid).await.unwrap_or_default();
    let cid = channel.map(|c| c.id().get() as i64);

    if let Some(m) = mode {
        settings.channel_allowlist = matches!(m, ChannelMode::Allowlist);
    }
    let mut note = String::new();
    match (action, cid) {
        (Some(ChannelAction::Add), Some(cid)) => {
            if !settings.blacklist.channels.contains(&cid) {
                settings.blacklist.channels.push(cid);
            }
            note = format!("Channel <#{cid}> updated.");
        }
        (Some(ChannelAction::Remove), Some(cid)) => {
            settings.blacklist.channels.retain(|c| *c != cid);
            note = format!("Channel <#{cid}> removed from the list.");
        }
        (Some(ChannelAction::List), _) | (None, None) => {
            let list: Vec<String> = settings
                .blacklist
                .channels
                .iter()
                .map(|c| format!("<#{c}>"))
                .collect();
            let mode_word = if settings.channel_allowlist { "allowlist (only these earn XP)" } else { "denylist (these never earn XP)" };
            note = if list.is_empty() {
                format!("Channel list is empty — mode: {mode_word}.")
            } else {
                format!("Mode: {mode_word}\nChannels: {}", list.join(", "))
            };
        }
        _ => {}
    }
    inochi_db::repos::put_settings(pool, gid, &settings, Some(ctx.author().id.get() as i64)).await?;
            ctx.data().invalidate_settings(gid);
    poise::say_reply(ctx, note).await?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, poise::ChoiceParameter)]
pub enum ChannelMode {
    #[name = "Allowlist"]
    Allowlist,
    #[name = "Denylist"]
    Denylist,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, poise::ChoiceParameter)]
pub enum ChannelAction {
    #[name = "Add"]
    Add,
    #[name = "Remove"]
    Remove,
    #[name = "List"]
    List,
}

/// Set the bot's playing status.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn botstatus(
    ctx: Context<'_>,
    #[description = "Status text (omit to clear)"] word: Option<String>,
) -> Result<(), crate::Error> {
    match word.filter(|w| !w.trim().is_empty()) {
        Some(text) => {
            ctx.serenity_context()
                .set_presence(Some(serenity::ActivityData::playing(text.clone())), serenity::OnlineStatus::Online);
            poise::say_reply(ctx, format!("Status set to **{text}**.")).await?;
        }
        None => {
            ctx.serenity_context().set_presence(None, serenity::OnlineStatus::Online);
            poise::say_reply(ctx, "Status cleared.").await?;
        }
    }
    Ok(())
}

/// Whether XP counts in threads.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn threads(
    ctx: Context<'_>,
    #[description = "Earn XP in threads?"] enabled: Option<bool>,
) -> Result<(), crate::Error> {
    update_setting(ctx, |s| {
        if let Some(e) = enabled {
            s.xp_in_threads = e;
        }
    }, |s, _| {
        if s.xp_in_threads { "XP counts in threads.".into() } else { "XP is ignored in threads.".into() }
    })
    .await
}

/// Customize the rank card.
#[poise::command(
    slash_command,
    default_member_permissions = "MANAGE_GUILD",
    subcommands("leaderboard_colour", "leaderboard_background")
)]
pub async fn leaderboard(_: Context<'_>) -> Result<(), crate::Error> {
    Ok(())
}

/// Set the rank card accent colour.
#[poise::command(slash_command)]
pub async fn leaderboard_colour(
    ctx: Context<'_>,
    #[description = "Hex colour like #d33c1c (omit to reset)"] colour: Option<String>,
) -> Result<(), crate::Error> {
    if let Some(hex) = &colour {
        let h = hex.trim().trim_start_matches('#');
        if h.len() != 6 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
            poise::say_reply(ctx, "Use a 6-digit hex colour like `#d33c1c`.").await?;
            return Ok(());
        }
    }
    update_setting(ctx, |s| {
        s.rank_accent_color = colour.as_deref().map(|c| format!("#{c}", c = c.trim().trim_start_matches('#')));
    }, |_, _| "Rank card colour updated.".into())
    .await
}

/// Set or remove the rank card background image.
#[poise::command(slash_command)]
pub async fn leaderboard_background(
    ctx: Context<'_>,
    #[description = "Background image URL (omit to delete)"] image: Option<String>,
) -> Result<(), crate::Error> {
    update_setting(ctx, |s| {
        s.rank_background_url = image.clone().filter(|u| !u.is_empty());
    }, |_, _| "Rank card background updated.".into())
    .await
}

/// Overview of the current configuration.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn config(ctx: Context<'_>) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let s = inochi_db::repos::get_settings(&ctx.data().pool, gid).await.unwrap_or_default();
    let preset = inochi_core::Preset::detect(&s);
    let preset_name = match preset {
        inochi_core::Preset::Inochi => "Inochi",
        inochi_core::Preset::Lurkr => "Lurkr",
        inochi_core::Preset::Mee6 => "MEE6",
        inochi_core::Preset::Amari => "Amari",
        inochi_core::Preset::Custom => "Custom",
    };
    let mode = if s.channel_allowlist { "allowlist" } else { "denylist" };
    let embed = serenity::CreateEmbed::new()
        .title("Inochi configuration")
        .field("Preset", preset_name, true)
        .field("XP gain", format!("{}-{} / {} s", s.gain.min, s.gain.max, s.cooldown_seconds), true)
        .field("Paused", if s.xp_paused { "yes" } else { "no" }, true)
        .field("Channels", format!("{} mode, {} listed", mode, s.blacklist.channels.len()), true)
        .field("Blacklisted roles", s.blacklist.roles.len().to_string(), true)
        .field("Multipliers", s.multipliers.len().to_string(), true)
        .field("Threads earn XP", if s.xp_in_threads { "yes" } else { "no" }, true)
        .field("Join role", s.join_role_id.map(|r| format!("<@&{r}>")).unwrap_or_else(|| "—".into()), true)
        .field("Welcome", if s.welcome_template.is_some() { "on" } else { "off" }, true)
        .colour((0xEE, 0xEE, 0xEE));
    poise::send_reply(ctx, reply().embed(embed)).await?;
    Ok(())
}

/// Run a health check on the bot's configuration.
#[poise::command(slash_command, prefix_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn diagnose(ctx: Context<'_>) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let mut checks: Vec<(&str, String)> = Vec::new();

    match inochi_db::repos::get_settings(&ctx.data().pool, gid).await {
        Ok(s) => {
            checks.push(("Database", "connected, settings valid".into()));
            checks.push(("Preset", format!("{:?}", inochi_core::Preset::detect(&s))));
            if let Some(ch) = s.announce_channel_id {
                let reachable = serenity::ChannelId::new(ch as u64)
                    .to_channel(ctx.http())
                    .await
                    .is_ok();
                checks.push((
                    "Announce channel",
                    if reachable { "reachable".into() } else { "bot cannot see the announcement channel".into() },
                ));
            }
            let rewards = inochi_db::rewards::list_level_roles(&ctx.data().pool, gid).await?;
            checks.push(("Level rewards", format!("{} configured", rewards.len())));
        }
        Err(inochi_db::DbError::UnknownGuild(_)) => {
            checks.push(("Database", "connected — server not registered yet, run /setup".into()));
        }
        Err(err) => checks.push(("Database", format!("settings error: {err}"))),
    }

    let body: String = checks
        .iter()
        .map(|(k, v)| format!("**{k}:** {v}\n"))
        .collect();
    let embed = serenity::CreateEmbed::new()
        .title("Diagnosis")
        .description(body)
        .colour((0xEE, 0xEE, 0xEE));
    poise::send_reply(ctx, reply().embed(embed)).await?;
    Ok(())
}

// ---------- context menu commands ----------

/// Check a member's XP (user context menu).
#[poise::command(context_menu_command = "Check XP")]
pub async fn check_xp(
    ctx: Context<'_>,
    user: serenity::User,
) -> Result<(), crate::Error> {
    rank_impl(ctx, Some(user), Some(true), Some(true)).await
}

/// Show where a member sits on the leaderboard (user context menu).
#[poise::command(context_menu_command = "View on leaderboard")]
pub async fn view_on_leaderboard(
    ctx: Context<'_>,
    user: serenity::User,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let uid = user.id.get() as i64;
    let rank = inochi_db::members::rank_of(&ctx.data().pool, gid, uid).await?;
    match rank {
        Some(r) => {
            let page = (r - 1) / 10 + 1;
            poise::say_reply(
                ctx,
                format!("{} is **#{r}** — showing leaderboard page {page}.", user.mention()),
            )
            .await?;
            top_impl(ctx, Some(page)).await
        }
        None => {
            poise::say_reply(ctx, format!("{} hasn't earned any XP yet.", user.mention())).await?;
            Ok(())
        }
    }
}

// ---------- shared helpers ----------

/// Load settings, apply a mutation, validate and persist.
async fn update_setting(
    ctx: Context<'_>,
    mutate: impl FnOnce(&mut inochi_core::GuildSettings),
    describe: impl FnOnce(&inochi_core::GuildSettings, Option<i64>) -> String,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;
    let pool = &ctx.data().pool;
    let mut settings = inochi_db::repos::get_settings(pool, gid).await.unwrap_or_default();
    mutate(&mut settings);
    inochi_db::repos::put_settings(pool, gid, &settings, Some(ctx.author().id.get() as i64)).await?;
            ctx.data().invalidate_settings(gid);
    poise::say_reply(ctx, describe(&settings, settings.join_role_id)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_parses_rows_skips_header_and_junk() {
        let csv = b"user_id,xp\n123,4500\n456,10,extra\nnot-a-user,5\n789,-3\n\n999,7";
        let got = parse_leaderboard_csv(csv);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].user_id, 123);
        assert_eq!(got[0].xp, 4500);
        assert_eq!(got[1].user_id, 456);
        assert_eq!(got[1].xp, 10);
        assert_eq!(got[2].user_id, 999);
    }

    #[test]
    fn csv_without_header_still_parses() {
        let got = parse_leaderboard_csv(b"42,100");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].xp, 100);
    }
}
