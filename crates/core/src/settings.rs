//! Validated guild settings stored as JSONB (mirrors `packages/core` upstream).
//!
//! Settings evolve frequently, so they are kept as one validated document per
//! guild instead of many columns.

use serde::{Deserialize, Serialize};

use crate::curve::Curve;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct GuildSettings {
    /// Base XP granted per qualifying message (legacy single-value gain).
    pub xp_per_message: u64,
    /// Randomized XP gain range; when `max > 0` it supersedes
    /// `xp_per_message`.
    pub gain: Gain,
    /// Minimum seconds between two rewarded messages per member.
    pub cooldown_seconds: u64,
    /// Whether XP accumulation is paused (e.g. before `/setup` completes).
    pub xp_paused: bool,
    /// The level curve (MEE6 by default; presets swap it wholesale).
    pub curve: Curve,
    /// Channel where level-up announcements are posted, if enabled.
    pub announce_channel_id: Option<i64>,
    /// Channel for welcome greetings, if enabled.
    pub welcome_channel_id: Option<i64>,
    /// Welcome message template. Tokens: `{user}` mention, `{name}` username,
    /// `{server}` guild name. `None` disables greetings.
    pub welcome_template: Option<String>,
    /// Optional background image URL drawn behind rank cards.
    pub rank_background_url: Option<String>,
    /// Rank card accent colour as `#rrggbb`; defaults to vermilion.
    pub rank_accent_color: Option<String>,
    /// Rank card rendering options (port of `settings.rankCard`).
    pub rank_card: RankCardSettings,
    /// Vote boost: multiplier applied while a vote is active.
    pub vote_boost: VoteBoost,
    /// Role granted to members when they join.
    pub join_role_id: Option<i64>,
    /// Whether threaded channels earn XP (default true).
    pub xp_in_threads: bool,
    /// When true, ONLY the channels in `blacklist.channels` earn XP
    /// (allowlist mode); otherwise the list acts as a denylist.
    pub channel_allowlist: bool,
    pub multipliers: Vec<Multiplier>,
    pub blacklist: Blacklist,
}

/// Rank card rendering options (port of `settings.rankCard`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RankCardSettings {
    /// Whether /rank renders a card at all.
    pub enabled: bool,
    /// Whether card replies are ephemeral by default.
    pub ephemeral: bool,
    /// Show the progress bar relative to the current level instead of from zero.
    pub relative_xp: bool,
    /// Ink veil strength over background images (0..=0.95).
    pub background_overlay: f64,
    /// Avatar corner style.
    pub avatar_shape: AvatarShape,
    /// Card texture: measuring grid or clean.
    pub surface: Surface,
    /// Progress bar style.
    pub progress_style: ProgressStyle,
}

impl Default for RankCardSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            ephemeral: false,
            relative_xp: false,
            background_overlay: 0.86,
            avatar_shape: AvatarShape::Rounded,
            surface: Surface::Technical,
            progress_style: ProgressStyle::Glow,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AvatarShape {
    Rounded,
    Circle,
    Square,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Surface {
    Technical,
    Clean,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgressStyle {
    Solid,
    Glow,
}

/// Vote boost configuration (port of `settings.multipliers.vote`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct VoteBoost {
    pub enabled: bool,
    pub multiplier: f64,
    pub duration_hours: i64,
}

impl Default for VoteBoost {
    fn default() -> Self {
        Self { enabled: false, multiplier: 2.0, duration_hours: 168 }
    }
}

/// Randomized XP gain per qualifying message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Gain {
    pub min: u64,
    pub max: u64,
}

impl Default for Gain {
    fn default() -> Self {
        Self { min: 15, max: 25 }
    }
}

impl Default for GuildSettings {
    fn default() -> Self {
        Self {
            xp_per_message: 15,
            gain: Gain::default(),
            cooldown_seconds: 60,
            xp_paused: false,
            curve: Curve::default(),
            announce_channel_id: None,
            welcome_channel_id: None,
            welcome_template: None,
            rank_background_url: None,
            rank_accent_color: None,
            rank_card: RankCardSettings::default(),
            vote_boost: VoteBoost::default(),
            join_role_id: None,
            xp_in_threads: true,
            channel_allowlist: false,
            multipliers: Vec::new(),
            blacklist: Blacklist::default(),
        }
    }
}

/// The shipped leveling presets (port of `packages/core/src/presets.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    Inochi,
    Lurkr,
    Mee6,
    Amari,
    Custom,
}

impl Preset {
    /// Apply a preset's gain + curve to `settings` (multipliers untouched).
    #[must_use]
    pub fn apply(self, settings: &GuildSettings) -> GuildSettings {
        let mut s = settings.clone();
        let max_level = s.curve.max_level;
        match self {
            Self::Inochi => {
                s.gain = Gain { min: 50, max: 100 };
                s.cooldown_seconds = 60;
                s.curve = Curve {
                    constant: 0.0,
                    cubic: 1.0,
                    quadratic: 50.0,
                    linear: 100.0,
                    rounding: 100.0,
                    max_level,
                };
            }
            Self::Lurkr => {
                s.gain = Gain { min: 15, max: 40 };
                s.cooldown_seconds = 60;
                s.curve = Curve::lurkr();
                s.curve.max_level = max_level;
            }
            Self::Mee6 => {
                s.gain = Gain { min: 15, max: 25 };
                s.cooldown_seconds = 60;
                s.curve = Curve::mee6();
                s.curve.max_level = max_level;
            }
            Self::Amari => {
                s.gain = Gain { min: 1, max: 1 };
                s.cooldown_seconds = 8;
                s.curve = Curve::amari();
                s.curve.max_level = max_level;
            }
            Self::Custom => {}
        }
        s
    }

    /// Detect which preset (if any) matches these settings.
    #[must_use]
    pub fn detect(settings: &GuildSettings) -> Self {
        if settings.gain == (Gain { min: 50, max: 100 })
            && settings.cooldown_seconds == 60
            && settings.curve.constant == 0.0
            && settings.curve.cubic == 1.0
            && settings.curve.quadratic == 50.0
            && settings.curve.linear == 100.0
        {
            Self::Inochi
        } else if settings.gain == (Gain { min: 15, max: 40 })
            && settings.cooldown_seconds == 60
            && settings.curve.constant == 150.0
            && settings.curve.cubic == 0.0
            && settings.curve.quadratic == 50.0
            && settings.curve.linear == -100.0
        {
            Self::Lurkr
        } else if settings.gain == (Gain { min: 15, max: 25 })
            && settings.cooldown_seconds == 60
            && settings.curve.constant == 0.0
            && (settings.curve.cubic - 5.0 / 3.0).abs() < 1e-9
            && settings.curve.quadratic == 22.5
            && (settings.curve.linear - 455.0 / 6.0).abs() < 1e-9
        {
            Self::Mee6
        } else if settings.gain == (Gain { min: 1, max: 1 })
            && settings.cooldown_seconds == 8
            && settings.curve.constant == 55.0
            && settings.curve.cubic == 0.0
            && settings.curve.quadratic == 20.0
            && settings.curve.linear == -40.0
        {
            Self::Amari
        } else {
            Self::Custom
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MultiplierScope {
    All,
    Channel,
    Role,
}

impl MultiplierScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Channel => "channel",
            Self::Role => "role",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Multiplier {
    #[serde(rename = "type")]
    pub scope: MultiplierScope,
    /// Target channel or role ID; ignored for `all`.
    #[serde(default)]
    pub id: Option<i64>,
    /// Multiplier factor (1.5 = +50% XP). Clamped to [0, 10].
    pub factor: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Blacklist {
    #[serde(default)]
    pub channels: Vec<i64>,
    #[serde(default)]
    pub roles: Vec<i64>,
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("xp_per_message must be between 1 and 500")]
    XpPerMessage,
    #[error("cooldown_seconds must be between 0 and 3600")]
    Cooldown,
    #[error("multiplier {0} has an invalid factor (allowed 0..=10)")]
    MultiplierFactor(usize),
    #[error("multiplier {0} of type channel/role requires an id")]
    MultiplierMissingId(usize),
    #[error("failed to serialize settings")]
    Serialize,
}

impl GuildSettings {
    /// Parse and validate the JSONB document coming from PostgreSQL.
    ///
    /// # Errors
    /// Returns [`SettingsError`] when values fall outside allowed ranges.
    pub fn from_json(raw: &serde_json::Value) -> Result<Self, SettingsError> {
        let settings: Self = serde_json::from_value(raw.clone())
            .map_err(|_| SettingsError::XpPerMessage)?;
        settings.validate()?;
        Ok(settings)
    }

    /// # Errors
    /// See [`SettingsError`].
    pub fn validate(&self) -> Result<(), SettingsError> {
        if !(1..=500).contains(&self.xp_per_message) {
            return Err(SettingsError::XpPerMessage);
        }
        if self.cooldown_seconds > 3600 {
            return Err(SettingsError::Cooldown);
        }
        for (i, mult) in self.multipliers.iter().enumerate() {
            if !(0.0..=10.0).contains(&mult.factor) {
                return Err(SettingsError::MultiplierFactor(i));
            }
            if !matches!(mult.scope, MultiplierScope::All) && mult.id.is_none() {
                return Err(SettingsError::MultiplierMissingId(i));
            }
        }
        Ok(())
    }

    /// Effective multiplier applied to a message authored in `channel_id` by
    /// a member holding `role_ids`.
    #[must_use]
    pub fn effective_multiplier(
        &self,
        channel_id: i64,
        role_ids: &[i64],
    ) -> f64 {
        let mut factor = 1.0f64;
        for mult in &self.multipliers {
            let applies = match mult.scope {
                MultiplierScope::All => true,
                MultiplierScope::Channel => mult.id == Some(channel_id),
                MultiplierScope::Role => {
                    role_ids.iter().any(|r| Some(*r) == mult.id)
                }
            };
            if applies {
                factor *= mult.factor;
            }
        }
        factor.clamp(0.0, 10.0)
    }

    /// Whether a message in `channel_id` by a member with `role_ids` earns XP.
    ///
    /// `is_thread` gates XP when `xp_in_threads` is off; `channel_allowlist`
    /// flips `blacklist.channels` from denylist to allowlist semantics.
    #[must_use]
    pub fn message_earns_xp(
        &self,
        channel_id: i64,
        role_ids: &[i64],
        is_thread: bool,
    ) -> bool {
        if self.xp_paused {
            return false;
        }
        if is_thread && !self.xp_in_threads {
            return false;
        }
        let listed = self.blacklist.channels.contains(&channel_id);
        if self.channel_allowlist {
            if !listed {
                return false;
            }
        } else if listed {
            return false;
        }
        !role_ids.iter().any(|r| self.blacklist.roles.contains(r))
    }

    /// XP awarded for one qualifying message with the rolled `base` gain.
    #[must_use]
    pub fn award_amount(&self, base: u64, channel_id: i64, role_ids: &[i64]) -> u64 {
        (base as f64 * self.effective_multiplier(channel_id, role_ids)).round() as u64
    }

    /// Render the welcome template, or `None` when greetings are disabled.
    #[must_use]
    pub fn render_welcome(&self, mention: &str, name: &str, server: &str) -> Option<String> {
        let template = self.welcome_template.as_deref()?;
        if template.trim().is_empty() {
            return None;
        }
        Some(
            template
                .replace("{user}", mention)
                .replace("{name}", name)
                .replace("{server}", server),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_validate() {
        assert!(GuildSettings::default().validate().is_ok());
    }

    #[test]
    fn rejects_bad_xp() {
        let raw = serde_json::json!({ "xp_per_message": 0 });
        assert!(GuildSettings::from_json(&raw).is_err());
    }

    #[test]
    fn multipliers_stack_multiplicatively() {
        let settings = GuildSettings {
            multipliers: vec![
                Multiplier { scope: MultiplierScope::Channel, id: Some(10), factor: 2.0 },
                Multiplier { scope: MultiplierScope::Role, id: Some(20), factor: 1.5 },
                Multiplier { scope: MultiplierScope::All, id: None, factor: 1.1 },
            ],
            ..Default::default()
        };
        // 15 * 2 * 1.5 * 1.1 = 49.5 -> rounds to 50
        assert_eq!(settings.award_amount(15, 10, &[20]), 50);
        // Only the global applies elsewhere: 15 * 1.1 = 16.5 -> 17
        assert_eq!(settings.award_amount(15, 99, &[]), 17);
    }

    #[test]
    fn blacklist_blocks() {
        let settings = GuildSettings {
            blacklist: Blacklist { channels: vec![5], roles: vec![9] },
            ..Default::default()
        };
        assert!(!settings.message_earns_xp(5, &[], false));
        assert!(!settings.message_earns_xp(1, &[9], false));
        assert!(settings.message_earns_xp(1, &[2], false));
        // Thread gating: only when xp_in_threads is off.
        let no_threads = GuildSettings { xp_in_threads: false, ..settings.clone() };
        assert!(!no_threads.message_earns_xp(1, &[], true));
        assert!(no_threads.message_earns_xp(1, &[], false));
        // Allowlist mode inverts the channel list.
        let allow = GuildSettings { channel_allowlist: true, ..settings };
        assert!(allow.message_earns_xp(5, &[], false));
        assert!(!allow.message_earns_xp(1, &[], false));
    }

    #[test]
    fn welcome_renders_tokens_and_respects_disabled() {
        let mut settings = GuildSettings::default();
        assert!(settings.render_welcome("<@1>", "amy", "srv").is_none());

        settings.welcome_template =
            Some("Welcome {user} ({name}) to {server}!".into());
        assert_eq!(
            settings.render_welcome("<@1>", "amy", "srv"),
            Some("Welcome <@1> (amy) to srv!".into())
        );

        // Empty template counts as disabled.
        settings.welcome_template = Some("   ".into());
        assert!(settings.render_welcome("<@1>", "amy", "srv").is_none());
    }

    #[test]
    fn old_settings_documents_still_parse() {
        // Documents written before welcome fields existed must deserialize.
        let raw = serde_json::json!({ "xp_per_message": 15, "cooldown_seconds": 60 });
        let s = GuildSettings::from_json(&raw).expect("legacy doc parses");
        assert_eq!(s.welcome_template, None);
    }
}
