//! Leaderboard message importers — Rust port of `packages/importers`.
//!
//! Point `/import scan` at a channel where another leveling bot posts its
//! leaderboard; the text snapshot of each message (content + embed fields)
//! is matched against per-provider patterns and the best XP per user wins.

use inochi_core::Curve;
use regex::Regex;

/// A parsed leaderboard record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Record {
    pub user_id: i64,
    pub xp: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, poise::ChoiceParameter)]
pub enum Provider {
    #[name = "mee6"]
    Mee6,
    #[name = "amari"]
    Amari,
    #[name = "lurkr"]
    Lurkr,
    #[name = "arcane"]
    Arcane,
    #[name = "probot"]
    ProBot,
    #[name = "carl-bot"]
    CarlBot,
}

impl Provider {
    fn recognized(&self) -> &'static str {
        match self {
            Self::Mee6 => r"(?i)\bmee6\b|\bleaderboard\b|\bpage\s*[:#]?\s*\d+",
            Self::Amari => r"(?i)\bamari(?:bot)?\b|\bleaderboard\b|\brankings?\b|\bpage\s*[:#]?\s*\d+",
            Self::Lurkr => r"(?i)\blurkr\b|\bleaderboard\b|\brankings?\b|\bpage\s*[:#]?\s*\d+",
            Self::Arcane => r"(?i)\barcane\b|\bleaderboard\b|\brankings?\b|\bpage\s*[:#]?\s*\d+",
            Self::ProBot => r"(?i)\bprobot\b|\bleaderboard\b|\btop\s+(?:text|voice)\b|\bpage\s*[:#]?\s*\d+",
            Self::CarlBot => r"(?i)\bcarl(?:-?bot)?\b|\bleaderboard\b|\bpage\s*[:#]?\s*\d+",
        }
    }

    /// XP-word used by this provider's exact patterns.
    fn xp_word(&self) -> &'static str {
        match self {
            // Amari prints "Exp:", everyone else "XP".
            Self::Amari => r"(?:total\s*)?(?:exp|xp|experience)",
            Self::ProBot => r"(?:text\s*)?(?:xp|experience)",
            _ => r"(?:total\s*)?(?:xp|experience)",
        }
    }

    /// Provider-specific rejection with a human reason.
    fn reject(&self, text: &str) -> Option<&'static str> {
        match self {
            // ProBot voice boards rank voice time, not text XP.
            Self::ProBot if regex::Regex::new(r"(?i)\bvoice\b").unwrap().is_match(text) => {
                Some("Use ProBot's text leaderboard, not voice.")
            }
            // Carl-bot has many board types; only the level board is usable.
            Self::CarlBot
                if !regex::Regex::new(r"(?i)\blevel(?:s|ing)?\b").unwrap().is_match(text) =>
            {
                Some("Use Carl-bot's level leaderboard.")
            }
            _ => None,
        }
    }
}

fn num(caps_text: &str) -> Option<i64> {
    let cleaned: String = caps_text.chars().filter(|c| c.is_ascii_digit()).collect();
    if cleaned.is_empty() {
        return None;
    }
    cleaned.parse().ok().filter(|v| *v >= 0)
}

/// Extract `(user, xp)` records from one message snapshot.
///
/// `curve` converts level readings into XP. Records are merged with
/// max-per-user inside a single snapshot.
#[must_use]
pub fn parse_message(
    provider: Provider,
    text: &str,
    curve: &Curve,
    out: &mut Vec<Record>,
) {
    let Ok(recognized) = Regex::new(provider.recognized()) else {
        return;
    };
    if !recognized.is_match(text) {
        return;
    }
    if let Some(reason) = provider.reject(text) {
        tracing::debug!(%reason, "import snapshot rejected");
        return;
    }

    let xp_word = provider.xp_word();
    // Mention joined to its value without crossing into the next mention.
    let within = r#"(?s)[^\n<]{0,120}"#;
    let mention = r"<@!?(\d{15,21})>";

    let exact = Regex::new(&format!(
        r"(?i){mention}{within}{xp_word}\s*[:=\-]?\s*([\d,_ ]+)"
    ))
    .ok();
    let trailing = Regex::new(&format!(
        r"(?i){mention}{within}([\d,_]+)[ \t]*(?:text\s*)?{xp_word}\b"
    ))
    .ok();
    let level =
        Regex::new(&format!(r"(?i){mention}{within}(?:level|lvl)\s*[:=\-]?\s*(\d+)")).ok();

    let mut push = |user_id: i64, xp: i64, out: &mut Vec<Record>| {
        if xp > 0 {
            if let Some(existing) = out.iter_mut().find(|r| r.user_id == user_id) {
                existing.xp = existing.xp.max(xp);
            } else {
                out.push(Record { user_id, xp });
            }
        }
    };

    if let Some(re) = &exact {
        for caps in re.captures_iter(text) {
            let Some(uid) = caps.get(1).and_then(|m| num(m.as_str())) else {
                continue;
            };
            let raw = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            // Amari prints "Exp: 35/55" — progress, not lifetime. A slash
            // invalidates the exact reading; the level pattern supplies it.
            if raw.contains('/') {
                continue;
            }
            if let Some(xp) = num(raw) {
                push(uid, xp, out);
            }
        }
    }
    if let Some(re) = &trailing {
        for caps in re.captures_iter(text) {
            if let (Some(uid), Some(xp)) =
                (caps.get(1).and_then(|m| num(m.as_str())), caps.get(2).and_then(|m| num(m.as_str())))
            {
                push(uid, xp, out);
            }
        }
    }
    if let Some(re) = &level {
        for caps in re.captures_iter(text) {
            if let (Some(uid), Some(level)) =
                (caps.get(1).and_then(|m| num(m.as_str())), caps.get(2).and_then(|m| num(m.as_str())))
            {
                if let Ok(level) = u32::try_from(level) {
                    push(uid, curve.xp_for_level(level) as i64, out);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(provider: Provider, text: &str) -> Vec<Record> {
        let mut out = Vec::new();
        parse_message(provider, text, &Curve::mee6(), &mut out);
        out
    }

    const U1: &str = "111111111111111111";
    const U2: &str = "222222222222222222";
    const U3: &str = "333333333333333333";
    const U4: &str = "444444444444444444";
    const U6: &str = "666666666666666666";

    #[test]
    fn mee6_embed_board_parses() {
        let text = format!(
            "**MEE6 Leaderboard** page 1\n<@{U1}> Level 42\nXP: 0\n<@{U2}> Level 10 : XP 12,300"
        );
        let got = parse(Provider::Mee6, &text);
        // Both an XP reading (12,300) and a level reading (10) matched; the
        // max-merge keeps whichever implies more XP.
        let expected = 12_300.max(Curve::mee6().xp_for_level(10) as i64);
        assert!(
            got.iter().any(|r| r.user_id == 222222222222222222 && r.xp == expected),
            "expected the larger of xp/level readings"
        );
        assert!(got.iter().any(|r| r.user_id == 111111111111111111 && r.xp > 0));
    }

    #[test]
    fn amari_progress_slash_falls_back_to_level() {
        let text = format!("AmariBot Rankings\n<@{U3}> Level: 7 Exp: 35/55");
        let got = parse(Provider::Amari, &text);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].user_id, 333333333333333333);
        // Level 7 on the MEE6 conversion curve.
        assert_eq!(got[0].xp, Curve::mee6().xp_for_level(7) as i64);
    }

    #[test]
    fn probot_voice_board_rejected() {
        let voice = format!("ProBot | TOP VOICE\n<@{U4}> XP: 5000");
        assert!(parse(Provider::ProBot, &voice).is_empty());
        let text_board = format!("ProBot | TOP TEXT\n<@{U4}> XP: 5000");
        assert_eq!(parse(Provider::ProBot, &text_board).len(), 1);
    }

    #[test]
    fn unrecognized_board_yields_nothing() {
        let text = format!("Some random chat\n<@{U4}> xp: 999");
        assert!(parse(Provider::Mee6, &text).is_empty());
    }

    #[test]
    fn max_per_user_wins() {
        let text = format!("MEE6 leaderboard\n<@{U6}> xp 100\n<@{U6}> xp 9000");
        let got = parse(Provider::Mee6, &text);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].xp, 9000);
    }
}
