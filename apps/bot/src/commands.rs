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

/// Build the rank card PNG for a member (shared by /rank and /rankcard).
async fn build_rank_card(
    ctx: Context<'_>,
    gid: i64,
    target: &serenity::User,
) -> Result<Vec<u8>, crate::Error> {
    let member = inochi_db::members::get_member(&ctx.data().pool, gid, target.id.get() as i64).await?;
    let rank = inochi_db::members::rank_of(&ctx.data().pool, gid, target.id.get() as i64).await?;
    let settings = inochi_db::repos::get_settings(&ctx.data().pool, gid)
        .await
        .unwrap_or_default();

    let level = settings.curve.level_for_xp(member.xp.max(0) as u64);
    let current_level_xp = settings.curve.xp_for_level(level);
    let next_level_xp = settings
        .curve
        .xp_to_next(level)
        .saturating_add(current_level_xp);

    let background = match settings.rank_background_url.as_deref().filter(|u| !u.is_empty()) {
        Some(url) => fetch_image(url).await,
        None => None,
    };
    let avatar = fetch_image(&target.face()).await;

    let input = crate::rankcard::CardInput {
        username: &target.name,
        avatar: avatar.as_ref(),
        rank,
        level,
        xp: member.xp.max(0) as u64,
        current_level_xp,
        next_level_xp,
        background: background.as_ref(),
    };
    Ok(crate::rankcard::render(&input))
}

/// Show a member's rank card: level, rank, XP and progress.
#[poise::command(slash_command)]
pub async fn rank(
    ctx: Context<'_>,
    #[description = "Member to inspect (defaults to you)"] user: Option<serenity::User>,
) -> Result<(), crate::Error> {
    let target = user.unwrap_or_else(|| ctx.author().clone());
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };

    let png = build_rank_card(ctx, guild_id.get() as i64, &target).await?;
    let file = serenity::CreateAttachment::bytes(png, "rank.png");
    let embed = serenity::CreateEmbed::new()
        .title(format!("{} — rank card", target.name))
        .image("attachment://rank.png")
        .colour((0xd3, 0x3c, 0x1c));
    poise::send_reply(ctx, reply().embed(embed).attachment(file)).await?;
    Ok(())
}

/// Render the rank card image for a member.
#[poise::command(slash_command)]
pub async fn rankcard(
    ctx: Context<'_>,
    #[description = "Member to inspect (defaults to you)"] user: Option<serenity::User>,
) -> Result<(), crate::Error> {
    let target = user.unwrap_or_else(|| ctx.author().clone());
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };

    let png = build_rank_card(ctx, guild_id.get() as i64, &target).await?;
    let file = serenity::CreateAttachment::bytes(png, "rank.png");
    poise::send_reply(ctx, reply().attachment(file)).await?;
    Ok(())
}

/// Absolute XP leaderboard for this server.
#[poise::command(slash_command)]
pub async fn top(
    ctx: Context<'_>,
    #[description = "Entries to show"] #[min = 1] #[max = 20] limit: Option<i64>,
) -> Result<(), crate::Error> {
    leaderboard_reply(ctx, limit.unwrap_or(10), false).await
}

/// Weekly XP leaderboard for this server.
#[poise::command(slash_command)]
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

/// (Manager) Grant XP to a member directly.
#[poise::command(slash_command, default_member_permissions = "MANAGE_GUILD")]
pub async fn addxp(
    ctx: Context<'_>,
    #[description = "Member to reward"] user: serenity::User,
    #[description = "Amount of XP"] #[min = 1] amount: i64,
) -> Result<(), crate::Error> {
    let Some(guild_id) = ctx.guild_id() else {
        poise::say_reply(ctx, "This command only works in servers.").await?;
        return Ok(());
    };
    let gid = guild_id.get() as i64;

    // Manual rewards ignore cooldowns and multipliers by design.
    inochi_db::repos::ensure_guild(&ctx.data().pool, gid).await?;
    let row =
        inochi_db::members::award_xp(&ctx.data().pool, gid, user.id.get() as i64, amount, 0)
            .await?
            .ok_or_else(|| -> crate::Error { "award unexpectedly skipped".into() })?;

    poise::say_reply(
        ctx,
        format!("Gave **{amount}** XP to {} — now at {}", user.mention(), row.xp),
    )
    .await?;
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
            "`/rank` — your level and XP\n`/rankcard` — card image\n`/top`, `/weekly` — leaderboards\n`/daily` — claim daily XP, keep the streak",
            false,
        )
        .field(
            "Games",
            "`/play scramble` — unscramble the word\n`/play math` — quick math\n`/play quiz` — auto-generated trivia\n`/play reverse` — type it backwards\n`/play highest` — highest number wins\n`/coinflip` — flip a coin",
            false,
        )
        .field(
            "Managers",
            "`/setup` — enable tracking\n`/addxp` — grant XP\n`/rewards set|remove|list` — level roles\n`/importcsv` — import user_id,xp CSV\n`/backup export|import` — full data",
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

/// Flip a coin.
#[poise::command(slash_command)]
pub async fn coinflip(ctx: Context<'_>) -> Result<(), crate::Error> {
    let result = if rand::random() { "Heads" } else { "Tails" };
    poise::say_reply(ctx, format!("The coin landed on **{result}**.")).await?;
    Ok(())
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
