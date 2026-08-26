//! Inochi Discord bot — Rust implementation of the leveling worker.
//!
//! Message XP is awarded through a single atomic PostgreSQL upsert; all level
//! math comes from `inochi-core` so the dashboard and the bot always agree.

mod commands;
mod games;
mod rankcard;

use poise::serenity_prelude::{self as serenity, Mentionable};
use sqlx::PgPool;

/// Shared state handed to every command and event handler.
pub struct Data {
    pub pool: PgPool,
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

    // Fetch validated settings for this guild.
    let settings = match inochi_db::repos::get_settings(&data.pool, guild_id).await {
        Ok(s) => s,
        // Guild never onboarded via /setup: nothing to do yet.
        Err(inochi_db::DbError::UnknownGuild(_)) => return Ok(()),
        Err(err) => return Err(err.into()),
    };

    let role_ids: Vec<i64> = {
        match message.member(&ctx.http).await {
            Ok(member) => member.roles.iter().map(|r| r.get() as i64).collect(),
            Err(_) => Vec::new(),
        }
    };

    if !settings.message_earns_xp(channel_id, &role_ids) {
        return Ok(());
    }
    let amount = settings.award(channel_id, &role_ids) as i64;

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
        let before_level = inochi_core::level_for_xp((row.xp - amount) as u64);
        let now_level = inochi_core::level_for_xp(row.xp as u64);
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
        tracing::debug!(guild_id, user_id, amount, xp = row.xp, "awarded xp");
    }
    Ok(())
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
                commands::top(),
                commands::weekly(),
                commands::daily(),
                commands::coinflip(),
                commands::play(),
                commands::rewards(),
                commands::addxp(),
                commands::importcsv(),
                commands::backup(),
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
                Ok(Data { pool })
            })
        })
        .build();

    let mut client = serenity::ClientBuilder::new(token, intents)
        .framework(framework)
        .await
        .expect("client build failed");

    // Keep the gateway alive; reconnects are handled by serenity.
    let shard_manager = client.shard_manager.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        shard_manager.shutdown_all().await;
    });

    if let Err(err) = client.start().await {
        tracing::error!(%err, "gateway error");
        std::process::exit(1);
    }
}
