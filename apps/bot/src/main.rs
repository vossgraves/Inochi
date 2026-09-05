//! Inochi Discord bot — Rust implementation of the leveling worker.
//!
//! Message XP is awarded through a single atomic PostgreSQL upsert; all level
//! math comes from `inochi-core` so the dashboard and the bot always agree.

mod commands;
mod games;
mod gamecard;
mod importers;
mod rankcard;

use poise::serenity_prelude::{self as serenity, Mentionable};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

/// Shared state handed to every command and event handler.
pub struct Data {
    pub pool: PgPool,
    /// Fast in-memory cooldown filter: drops rapid chat spam without sending
    /// queries to PostgreSQL. Entries are bounded and periodically pruned.
    pub cooldowns: RwLock<HashMap<(i64, i64), Instant>>,
    /// Bounded guild settings cache. A short TTL is a safety net; command
    /// writes invalidate immediately so dashboard-like changes take effect.
    pub settings: RwLock<HashMap<i64, (inochi_core::GuildSettings, Instant)>>,
}

impl Data {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            cooldowns: RwLock::new(HashMap::new()),
            settings: RwLock::new(HashMap::new()),
        }
    }

    /// Fast cached guild settings retrieval (30s TTL, bounded to 20k guilds).
    pub async fn get_cached_settings(
        &self,
        guild_id: i64,
    ) -> Result<inochi_core::GuildSettings, inochi_db::DbError> {
        let now = Instant::now();
        if let Ok(cache) = self.settings.read() {
            if let Some((settings, cached_at)) = cache.get(&guild_id) {
                if now.duration_since(*cached_at) < Duration::from_secs(30) {
                    return Ok(settings.clone());
                }
            }
        }
        let settings = inochi_db::repos::get_settings(&self.pool, guild_id).await?;
        if let Ok(mut cache) = self.settings.write() {
            // Remove stale entries before inserting so a long-lived process
            // does not retain one settings document per departed guild.
            cache.retain(|_, (_, cached_at)| now.duration_since(*cached_at) < Duration::from_secs(30));
            if cache.len() >= 20_000 {
                if let Some(oldest) = cache.iter().min_by_key(|(_, (_, at))| *at).map(|(id, _)| *id) {
                    cache.remove(&oldest);
                }
            }
            cache.insert(guild_id, (settings.clone(), Instant::now()));
        }
        Ok(settings)
    }

    /// Invalidate cache when settings are changed.
    pub fn invalidate_settings(&self, guild_id: i64) {
        if let Ok(mut cache) = self.settings.write() {
            cache.remove(&guild_id);
        }
    }

    /// Check if member is on cooldown. Returns false if message should be dropped.
    pub fn is_cooldown_expired(&self, guild_id: i64, user_id: i64, cooldown_secs: u64) -> bool {
        if cooldown_secs == 0 {
            return true;
        }
        let now = Instant::now();
        if let Ok(cache) = self.cooldowns.read() {
            if let Some(last_awarded) = cache.get(&(guild_id, user_id)) {
                if now.duration_since(*last_awarded) < Duration::from_secs(cooldown_secs) {
                    return false;
                }
            }
        }
        true
    }

    /// Record timestamp of successful XP award.
    pub fn record_awarded(&self, guild_id: i64, user_id: i64) {
        let now = Instant::now();
        if let Ok(mut cache) = self.cooldowns.write() {
            // 100k entries is a deliberately conservative ceiling for a
            // low-RAM deployment; stale entries are removed in the same lock.
            if cache.len() >= 100_000 {
                cache.retain(|_, instant| now.duration_since(*instant) < Duration::from_secs(300));
                if cache.len() >= 100_000 {
                    if let Some(oldest) = cache.iter().min_by_key(|(_, at)| *at).map(|(key, _)| *key) {
                        cache.remove(&oldest);
                    }
                }
            }
            cache.insert((guild_id, user_id), now);
        }
    }
}

type Error = Box<dyn std::error::Error + Send + Sync>;
type Context<'a> = poise::Context<'a, Data, Error>;

async fn on_message(
    ctx: &serenity::Context,
    data: &Data,
    message: &serenity::Message,
) -> Result<(), Error> {
    // Ignore bots, DMs and webhook echoes.
    if message.author.bot || message.guild_id.is_none() {
        return Ok(());
    }
    let guild_id = message.guild_id.unwrap().get() as i64;
    let user_id = message.author.id.get() as i64;
    let channel_id = message.channel_id.get() as i64;

    // Chat games take priority: a winning message consumes the round and
    // earns the bonus instead of regular XP.
    if games::check_answer(guild_id, channel_id, &message.content) {
        match inochi_db::members::award_xp(
            &data.pool,
            guild_id,
            user_id,
            games::WIN_XP,
            0,
        )
        .await
        {
            Ok(Some(_)) => {
                let _ = message
                    .channel_id
                    .say(
                        &ctx.http,
                        format!(
                            "{} won the round and earned **{} XP**!",
                            message.author.mention(),
                            games::WIN_XP
                        ),
                    )
                    .await;
                return Ok(());
            }
            // Guild not registered (no /setup yet): drop the round quietly.
            Ok(None) | Err(inochi_db::DbError::UnknownGuild(_)) => return Ok(()),
            Err(err) => return Err(err.into()),
        }
    }

    // Highest-number rounds: plain integer messages are submissions.
    if let Ok(value) = message.content.trim().parse::<i64>() {
        if games::submit_highest(
            guild_id,
            channel_id,
            user_id as u64,
            &message.author.mention().to_string(),
            value,
        ) == games::Submit::Improved
        {
            let _ = message
                .react(&ctx.http, serenity::ReactionType::Unicode("📈".into()))
                .await;
        }
    }

    // Fetch validated settings for this guild (using fast 60s in-memory cache).
    let settings = match data.get_cached_settings(guild_id).await {
        Ok(s) => s,
        // Guild never onboarded via /setup: nothing to do yet.
        Err(inochi_db::DbError::UnknownGuild(_)) => return Ok(()),
        Err(err) => return Err(err.into()),
    };

    // Fast in-memory cooldown filter: drops chat spam in nanoseconds
    // without hitting PostgreSQL.
    if !data.is_cooldown_expired(guild_id, user_id, settings.cooldown_seconds as u64) {
        return Ok(());
    }

    // MESSAGE_CREATE normally arrives with the member in Serenity's cache.
    // Avoiding an HTTP member lookup here is material at scale: this is the
    // hottest path and role data only changes on member/role events.
    let role_ids: Vec<i64> = message
        .member
        .as_ref()
        .map(|member| member.roles.iter().map(|role| role.get() as i64).collect())
        .or_else(|| {
            ctx.cache
                .member(message.guild_id.unwrap(), message.author.id)
                .map(|member| member.roles.iter().map(|role| role.get() as i64).collect())
        })
        .unwrap_or_default();
    let is_thread = is_thread_channel(ctx, message.channel_id).await;

    if !settings.message_earns_xp(channel_id, &role_ids, is_thread) {
        return Ok(());
    }
    // Roll the gain: ranged gain when configured, legacy flat value otherwise.
    let base = if settings.gain.max > 0 {
        rand::Rng::gen_range(&mut rand::thread_rng(), settings.gain.min..=settings.gain.max.max(settings.gain.min))
    } else {
        settings.xp_per_message
    };
    let mut amount = settings.award_amount(base, channel_id, &role_ids) as i64;

    // Active vote boost multiplies the gain.
    if settings.vote_boost.enabled
        && inochi_db::keys::active_vote(&data.pool, "topgg", user_id).await.unwrap_or(false)
    {
        amount = (amount as f64 * settings.vote_boost.multiplier).round() as i64;
    }

    if let Some(row) = inochi_db::members::award_xp(
        &data.pool,
        guild_id,
        user_id,
        amount,
        settings.cooldown_seconds as i64,
    )
    .await?
    {
        // Level-up announcement when the award crossed the boundary.
        let before_level = settings.curve.level_for_xp((row.xp - amount) as u64);
        let now_level = settings.curve.level_for_xp(row.xp as u64);
        if now_level > before_level {
            // Grant the highest configured level reward.
            if let Ok(Some(role_id)) =
                inochi_db::rewards::role_for_level(&data.pool, guild_id, now_level).await
            {
                if let Ok(member) = message.member(&ctx.http).await {
                    let _ = member
                        .add_role(
                            &ctx.http,
                            serenity::RoleId::new(role_id as u64),
                        )
                        .await;
                }
            }

            if let Some(announce_channel) = settings.announce_channel_id {
                let channel = serenity::ChannelId::new(announce_channel as u64);
                let _ = channel
                    .say(
                        &ctx.http,
                        format!(
                            "{} just reached **level {now_level}**!",
                            message.author.mention()
                        ),
                    )
                    .await;
            }
        }
        data.record_awarded(guild_id, user_id);
        tracing::debug!(guild_id, user_id, amount, xp = row.xp, "awarded xp");
    }
    Ok(())
}

async fn is_thread_channel(ctx: &serenity::Context, channel_id: serenity::ChannelId) -> bool {
    use serenity::model::channel::ChannelType;
    ctx.cache
        .channel(channel_id)
        .map(|gc| matches!(gc.kind, ChannelType::PublicThread | ChannelType::PrivateThread | ChannelType::NewsThread))
        .unwrap_or(false)
}

async fn on_member_join(
    ctx: &serenity::Context,
    data: &Data,
    member: &serenity::Member,
) -> Result<(), Error> {
    if member.user.bot {
        return Ok(());
    }
    let guild_id = member.guild_id;
    let settings =
        match inochi_db::repos::get_settings(&data.pool, guild_id.get() as i64).await {
            Ok(s) => s,
            Err(_) => return Ok(()),
        };

    // Join role.
    if let Some(role_id) = settings.join_role_id {
        let _ = member
            .add_role(&ctx.http, serenity::RoleId::new(role_id as u64))
            .await;
    }

    let server = ctx
        .cache
        .guild(guild_id)
        .map(|g| g.name.clone())
        .unwrap_or_else(|| "the server".into());
    if let Some(text) = settings.render_welcome(
        &member.user.mention().to_string(),
        &member.user.name,
        &server,
    ) {
        if let Some(channel_id) = settings.welcome_channel_id {
            let _ = serenity::ChannelId::new(channel_id as u64)
                .say(&ctx.http, text)
                .await;
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let token = std::env::var("DISCORD_TOKEN").expect("DISCORD_TOKEN must be set");
    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL (Neon) must be set");

    let pool = inochi_db::connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL");
    inochi_db::migrate(&pool).await.expect("migrations failed");
    tracing::info!("database ready");

    let intents = serenity::GatewayIntents::non_privileged()
        | serenity::GatewayIntents::MESSAGE_CONTENT
        | serenity::GatewayIntents::GUILD_MEMBERS;

    let framework = poise::Framework::builder()
        .options(poise::FrameworkOptions {
            commands: vec![
                commands::setup(),
                commands::help(),
                commands::rank(),
                commands::rankcard(),
                commands::member(),
                commands::top(),
                commands::weekly(),
                commands::daily(),
                commands::calculate(),
                commands::vote(),
                commands::wrapped(),
                commands::coinflip(),
                commands::play(),
                commands::rewards(),
                commands::rewardrole(),
                commands::multiplier(),
                commands::joinrole(),
                commands::blacklist(),
                commands::xpchannel(),
                commands::threads(),
                commands::leaderboard(),
                commands::botstatus(),
                commands::addxp(),
                commands::clear(),
                commands::reset(),
                commands::refresh(),
                commands::config(),
                commands::diagnose(),
                commands::import(),
                commands::backup(),
                commands::check_xp(),
                commands::view_on_leaderboard(),
            ],
            prefix_options: poise::PrefixFrameworkOptions {
                prefix: Some("!".into()),
                ..Default::default()
            },
            event_handler: |ctx, event, _framework, data| {
                Box::pin(async move {
                    match event {
                        serenity::FullEvent::Message { new_message } => {
                            on_message(ctx, data, new_message).await?;
                        }
                        serenity::FullEvent::GuildMemberAddition { new_member } => {
                            on_member_join(ctx, data, &new_member).await?;
                        }
                        _ => {}
                    }
                    Ok(())
                })
            },
            ..Default::default()
        })
        .setup(move |ctx, _ready, framework| {
            let pool = pool.clone();
            Box::pin(async move {
                tracing::info!(user = %_ready.user.name, "bot connected");
                poise::builtins::register_globally(ctx, &framework.options().commands)
                    .await?;
                Ok(Data::new(pool))
            })
        })
        .build();

    let mut client = serenity::ClientBuilder::new(token, intents)
        .framework(framework)
        .await
        .expect("client build failed");

    // Ask Discord for the recommended shard count instead of pinning this
    // process to one gateway connection. This is required beyond 2,500 guilds
    // and lets the same binary scale to 10k+ guilds without a code change.
    let shard_manager = client.shard_manager.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        shard_manager.shutdown_all().await;
    });

    if let Err(err) = client.start_autosharded().await {
        tracing::error!(%err, "gateway error");
        std::process::exit(1);
    }
}
