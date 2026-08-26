//! Chat games: `/play` starts a round in the current channel; the first
//! member to type the answer wins bonus XP.
//!
//! Active rounds live in an in-process map keyed by `(guild, channel)` —
//! one round per channel, expired entries are evicted lazily.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use rand::seq::SliceRandom;
use rand::Rng;

/// How long a round stays open before it expires.
pub const ROUND_TIME: Duration = Duration::from_secs(90);
/// Bonus XP for winning a round.
pub const WIN_XP: i64 = 50;

const WORDS: &[&str] = &[
    "inochi", "discord", "leaderboard", "karma", "neon", "server", "member",
    "reward", "message", "channel", "rocket", "puzzle", "garden", "castle",
    "planet", "wizard", "orange", "silver", "monkey", "dragon", "coffee",
    "winter", "summer", "forest", "bridge", "circle", "hammer", "jacket",
    "ladder", "magnet", "needle", "orchid", "pencil", "quartz", "ribbon",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, poise::ChoiceParameter)]
pub enum GameKind {
    #[name = "scramble"]
    Scramble,
    #[name = "math"]
    Math,
}

struct ActiveGame {
    answer: String,
    expires_at: Instant,
}

static ACTIVE: LazyLock<std::sync::Mutex<HashMap<(i64, i64), ActiveGame>>> =
    LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

/// Create a new round's prompt + answer.
#[must_use]
pub fn new_round(kind: GameKind, rng: &mut impl Rng) -> (String, String) {
    match kind {
        GameKind::Scramble => {
            let word = WORDS.choose(rng).expect("word list is not empty");
            let mut letters: Vec<char> = word.chars().collect();
            // Re-shuffle until the scramble actually differs from the source.
            while letters.len() > 1 {
                letters.shuffle(rng);
                if letters.iter().collect::<String>() != *word {
                    break;
                }
            }
            let scrambled: String = letters.into_iter().collect();
            (
                format!("Unscramble this word: **{scrambled}**"),
                (*word).to_string(),
            )
        }
        GameKind::Math => {
            let a = rng.gen_range(12..=99);
            let b = rng.gen_range(12..=99);
            match rng.gen_range(0..2) {
                0 => (
                    format!("What is **{a} + {b}**?"),
                    (a + b).to_string(),
                ),
                _ => {
                    let (hi, lo) = if a >= b { (a, b) } else { (b, a) };
                    (
                        format!("What is **{hi} − {lo}**?"),
                        (hi - lo).to_string(),
                    )
                }
            }
        }
    }
}

/// Register a round for `(guild_id, channel_id)`.
pub fn start(guild_id: i64, channel_id: i64, answer: String) {
    let mut map = ACTIVE.lock().expect("games mutex poisoned");
    map.insert(
        (guild_id, channel_id),
        ActiveGame { answer, expires_at: Instant::now() + ROUND_TIME },
    );
}

/// Check a chat message against the active round.
///
/// Returns `true` when the message won the round (the round is consumed);
/// expired rounds are evicted on sight.
pub fn check_answer(guild_id: i64, channel_id: i64, content: &str) -> bool {
    let mut map = ACTIVE.lock().expect("games mutex poisoned");
    let now = Instant::now();
    let Some(game) = map.get(&(guild_id, channel_id)) else {
        return false;
    };
    if game.expires_at <= now {
        map.remove(&(guild_id, channel_id));
        return false;
    }
    if content.trim().eq_ignore_ascii_case(&game.answer) {
        // Only a correct answer consumes the round.
        map.remove(&(guild_id, channel_id));
        true
    } else {
        false
    }
}

/// Whether a round is currently open in this channel.
#[must_use]
pub fn has_active(guild_id: i64, channel_id: i64) -> bool {
    let map = ACTIVE.lock().expect("games mutex poisoned");
    map
        .get(&(guild_id, channel_id))
        .is_some_and(|g| g.expires_at > Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn scramble_is_permutation() {
        let mut rng = StdRng::seed_from_u64(1);
        for _ in 0..50 {
            let (prompt, answer) = new_round(GameKind::Scramble, &mut rng);
            assert!(prompt.starts_with("Unscramble"));
            let shown = prompt.split("**").nth(1).unwrap().trim();
            let mut a: Vec<char> = answer.chars().collect();
            let mut b: Vec<char> = shown.chars().collect();
            a.sort_unstable();
            b.sort_unstable();
            assert_eq!(a, b, "scramble must be a permutation of {answer}");
        }
    }

    #[test]
    fn math_answers_match_prompt() {
        let mut rng = StdRng::seed_from_u64(7);
        for _ in 0..50 {
            let (prompt, answer) = new_round(GameKind::Math, &mut rng);
            let nums: Vec<i64> = prompt
                .split(|c: char| !c.is_ascii_digit())
                .filter(|s| !s.is_empty())
                .filter_map(|s| s.parse().ok())
                .collect();
            assert!(!nums.is_empty());
            let expected: i64 = if prompt.contains('+') {
                nums.iter().sum()
            } else {
                nums[0] - nums[1]
            };
            assert_eq!(answer, expected.to_string());
        }
    }

    #[test]
    fn answers_are_case_insensitive_and_consumed() {
        start(1, 2, "inochi".into());
        assert!(has_active(1, 2));
        assert!(!check_answer(1, 2, "wrong"));
        assert!(has_active(1, 2));
        assert!(check_answer(1, 2, "  Inochi "));
        assert!(!has_active(1, 2));
        // Round consumed; same guess again loses.
        assert!(!check_answer(1, 2, "inochi"));
    }
}
