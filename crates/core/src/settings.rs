//! Validated guild settings stored as JSONB (mirrors `packages/core` upstream).
//!
//! Settings evolve frequently, so they are kept as one validated document per
//! guild instead of many columns.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct GuildSettings {
    /// Base XP granted per qualifying message.
    pub xp_per_message: u64,
    /// Minimum seconds between two rewarded messages per member.
    pub cooldown_seconds: u64,
    /// Whether XP accumulation is paused (e.g. before `/setup` completes).
    pub xp_paused: bool,
    /// Channel where level-up announcements are posted, if enabled.
    pub announce_channel_id: Option<i64>,
    pub multipliers: Vec<Multiplier>,
    pub blacklist: Blacklist,
}

impl Default for GuildSettings {
    fn default() -> Self {
        Self {
            xp_per_message: 15,
            cooldown_seconds: 60,
            xp_paused: false,
            announce_channel_id: None,
            multipliers: Vec::new(),
            blacklist: Blacklist::default(),
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
    #[must_use]
    pub fn message_earns_xp(&self, channel_id: i64, role_ids: &[i64]) -> bool {
        if self.xp_paused {
            return false;
        }
        if self.blacklist.channels.contains(&channel_id) {
            return false;
        }
        !role_ids.iter().any(|r| self.blacklist.roles.contains(r))
    }

    /// XP awarded for one qualifying message.
    #[must_use]
    pub fn award(&self, channel_id: i64, role_ids: &[i64]) -> u64 {
        let base = self.xp_per_message as f64;
        (base * self.effective_multiplier(channel_id, role_ids)).round() as u64
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
        assert_eq!(settings.award(10, &[20]), 50);
        // Only the global applies elsewhere: 15 * 1.1 = 16.5 -> 17
        assert_eq!(settings.award(99, &[]), 17);
    }

    #[test]
    fn blacklist_blocks() {
        let settings = GuildSettings {
            blacklist: Blacklist { channels: vec![5], roles: vec![9] },
            ..Default::default()
        };
        assert!(!settings.message_earns_xp(5, &[]));
        assert!(!settings.message_earns_xp(1, &[9]));
        assert!(settings.message_earns_xp(1, &[2]));
    }
}
