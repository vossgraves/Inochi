//! Inochi core: pure leveling logic.
//!
//! No I/O lives here. The database layer (`inochi-db`) and the Discord bot
//! call into this crate for every XP decision so the rules are identical in
//! the bot, the API and the dashboard.

pub mod curve;
pub mod settings;

pub use curve::Curve;
pub use settings::{
    Blacklist, Gain, GuildSettings, Multiplier, MultiplierScope, Preset, SettingsError,
};
