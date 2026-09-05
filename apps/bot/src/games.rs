//! Chat games, auto-generated every round.
//!
//! Q&A games (scramble, math, quiz, reverse): first correct answer in the
//! channel wins. `highest` is competitive: everyone types a number, the
//! highest submission when the timer fires wins.
//!
//! Active rounds live in in-process maps keyed by `(guild, channel)` — one
//! round per channel, expired Q&A entries are evicted lazily; `highest`
//! rounds are finalized by a timer task spawned in `/play`.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use rand::seq::SliceRandom;
use rand::Rng;

/// How long a round stays open before it expires.
pub const ROUND_TIME: Duration = Duration::from_secs(90);
/// Bonus XP for winning a round.
pub const WIN_XP: i64 = 50;
/// Hard safety cap: active rounds are tiny, but this prevents a compromised or
/// unusually busy deployment from turning game state into an unbounded cache.
const MAX_ACTIVE_ROUNDS: usize = 50_000;

const WORDS: &[&str] = &[
    "inochi", "discord", "leaderboard", "karma", "neon", "server", "member",
    "reward", "message", "channel", "rocket", "puzzle", "garden", "castle",
    "planet", "wizard", "orange", "silver", "monkey", "dragon", "coffee",
    "winter", "summer", "forest", "bridge", "circle", "hammer", "jacket",
    "ladder", "magnet", "needle", "orchid", "pencil", "quartz", "ribbon",
];

// Every word here has a recognizable local illustration in gamecard.rs.
const IMAGE_WORDS: &[&str] = &["orange", "coffee", "planet", "castle"];

const CAPITALS: &[(&str, &str)] = &[
    ("Japan", "tokyo"),
    ("France", "paris"),
    ("Brazil", "brasilia"),
    ("Canada", "ottawa"),
    ("Australia", "canberra"),
    ("Egypt", "cairo"),
    ("Turkey", "ankara"),
    ("Norway", "oslo"),
    ("Kenya", "nairobi"),
    ("Peru", "lima"),
    ("Vietnam", "hanoi"),
    ("Morocco", "rabat"),
    ("Iceland", "reykjavik"),
    ("Indonesia", "jakarta"),
    ("Switzerland", "bern"),
    ("Nigeria", "abuja"),
];

const PRIMES: &[u64] = &[
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71,
    73, 79, 83, 89, 97,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, poise::ChoiceParameter)]
pub enum GameKind {
    #[name = "scramble"]
    Scramble,
    #[name = "math"]
    Math,
    #[name = "quiz"]
    Quiz,
    #[name = "reverse"]
    Reverse,
    #[name = "word image"]
    Word,
    #[name = "highest"]
    Highest,
}

impl GameKind {
    /// Display name used in round announcements.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Scramble => "Scramble",
            Self::Math => "Quick math",
            Self::Quiz => "Quiz",
            Self::Reverse => "Reverse",
            Self::Word => "Guess the word",
            Self::Highest => "Highest number",
        }
    }
}

struct ActiveGame {
    answer: String,
    expires_at: Instant,
}

static ACTIVE: LazyLock<std::sync::Mutex<HashMap<(i64, i64), ActiveGame>>> =
    LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

struct HighestRound {
    expires_at: Instant,
    best: Option<HighestEntry>,
}

struct HighestEntry {
    user_id: u64,
    mention: String,
    value: i64,
}

static HIGHEST: LazyLock<std::sync::Mutex<HashMap<(i64, i64), HighestRound>>> =
    LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

fn is_prime(n: u64) -> bool {
    if n < 2 {
        return false;
    }
    let mut d = 2;
    while d * d <= n {
        if n % d == 0 {
            return false;
        }
        d += 1;
    }
    true
}

/// Generate a quiz question and its canonical answer.
#[must_use]
pub fn quiz_question(rng: &mut impl Rng) -> (String, String) {
    match rng.gen_range(0..5) {
        // Percentages with round numbers.
        0 => {
            let pct = rng.gen_range(2..10) * 5;
            let base = rng.gen_range(2..25) * 20;
            (format!("What is **{pct}% of {base}**?"), (pct * base / 100).to_string())
        }
        // Time conversions.
        1 => {
            if rng.gen_bool(0.5) {
                let hours = rng.gen_range(2..13);
                (format!("How many **minutes** are in **{hours} hours**?"), (hours * 60).to_string())
            } else {
                let minutes = rng.gen_range(2..11) * 3;
                (format!("How many **seconds** are in **{minutes} minutes**?"), (minutes * 60).to_string())
            }
        }
        // Comparison.
        2 => {
            let a = rng.gen_range(100..10_000);
            let b = rng.gen_range(100..10_000);
            if a == b {
                let b = b + 1;
                return (format!("Which is larger, **{a}** or **{b}**? Answer with A or B."), "b".into());
            }
            let answer = if a > b { "a" } else { "b" };
            (format!("Which is larger, **{a}** or **{b}**? Answer with A or B."), answer.into())
        }
        // Prime check.
        3 => {
            let n = if rng.gen_bool(0.5) {
                *PRIMES.choose(rng).expect("non-empty")
            } else {
                let mut c = rng.gen_range(4..100);
                while is_prime(c) {
                    c += 1;
                }
                c
            };
            (
                format!("Is **{n}** prime? Answer **yes** or **no**."),
                if is_prime(n) { "yes" } else { "no" }.into(),
            )
        }
        // Capitals.
        _ => {
            let (country, capital) = CAPITALS.choose(rng).expect("non-empty");
            (format!("What is the capital of **{country}**?"), (*capital).into())
        }
    }
}

/// Create a new Q&A round's prompt + answer. `None` for [`GameKind::Highest`],
/// which uses [`start_highest`] instead.
pub fn new_round(kind: GameKind, rng: &mut impl Rng) -> Option<(String, String)> {
    match kind {
        GameKind::Highest => None,
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
            Some((
                format!("Unscramble this word: **{scrambled}**"),
                (*word).to_string(),
            ))
        }
        GameKind::Math => {
            let a = rng.gen_range(12..=99);
            let b = rng.gen_range(12..=99);
            match rng.gen_range(0..2) {
                0 => Some((format!("What is **{a} + {b}**?"), (a + b).to_string())),
                _ => {
                    let (hi, lo) = if a >= b { (a, b) } else { (b, a) };
                    Some((format!("What is **{hi} − {lo}**?"), (hi - lo).to_string()))
                }
            }
        }
        GameKind::Quiz => Some(quiz_question(rng)),
        GameKind::Reverse => {
            let word = WORDS.choose(rng).expect("word list is not empty");
            let reversed: String = word.chars().rev().collect();
            Some((
                format!("Type this word **backwards**: **{word}**"),
                reversed,
            ))
        }
        GameKind::Word => {
            let word = IMAGE_WORDS.choose(rng).expect("image word list is not empty");
            Some(("Open the spoiler image and guess the word.".into(), (*word).into()))
        }
    }
}

/// Register a Q&A round for `(guild_id, channel_id)`.
pub fn start(guild_id: i64, channel_id: i64, answer: String) {
    let mut map = ACTIVE.lock().expect("games mutex poisoned");
    let now = Instant::now();
    map.retain(|_, game| game.expires_at > now);
    if map.len() >= MAX_ACTIVE_ROUNDS {
        // Do not grow memory under load. The oldest expiry is the safest
        // entry to evict because it has the least remaining player value.
        if let Some(oldest) = map.iter().min_by_key(|(_, game)| game.expires_at).map(|(key, _)| *key) {
            map.remove(&oldest);
        }
    }
    map.insert(
        (guild_id, channel_id),
        ActiveGame { answer, expires_at: now + ROUND_TIME },
    );
}

/// Open a `highest` round. Returns `false` when one is already running.
pub fn start_highest(guild_id: i64, channel_id: i64) -> bool {
    let mut map = HIGHEST.lock().expect("highest mutex poisoned");
    let now = Instant::now();
    if let Some(r) = map.get(&(guild_id, channel_id)) {
        if r.expires_at > now {
            return false;
        }
    }
    map.retain(|_, round| round.expires_at > now);
    if map.len() >= MAX_ACTIVE_ROUNDS {
        if let Some(oldest) = map.iter().min_by_key(|(_, round)| round.expires_at).map(|(key, _)| *key) {
            map.remove(&oldest);
        }
    }
    map.insert(
        (guild_id, channel_id),
        HighestRound { expires_at: now + ROUND_TIME, best: None },
    );
    true
}

/// Outcome of a number submission to a `highest` round.
#[derive(Debug, PartialEq, Eq)]
pub enum Submit {
    /// No round is running here.
    NoRound,
    /// Recorded (and it is the new best).
    Improved,
    /// Recorded, but someone is already higher.
    Kept,
}

/// Record a number submission.
pub fn submit_highest(
    guild_id: i64,
    channel_id: i64,
    user_id: u64,
    mention: &str,
    value: i64,
) -> Submit {
    let mut map = HIGHEST.lock().expect("highest mutex poisoned");
    let now = Instant::now();
    let Some(round) = map.get_mut(&(guild_id, channel_id)) else {
        return Submit::NoRound;
    };
    if round.expires_at <= now {
        return Submit::NoRound;
    }
    let better = match &round.best {
        None => true,
        Some(best) => value > best.value,
    };
    if better {
        round.best = Some(HighestEntry {
            user_id,
            mention: mention.to_string(),
            value,
        });
        Submit::Improved
    } else {
        Submit::Kept
    }
}

/// Close the `highest` round and return its winner, if anyone played.
pub fn finalize_highest(guild_id: i64, channel_id: i64) -> Option<(u64, String, i64)> {
    let mut map = HIGHEST.lock().expect("highest mutex poisoned");
    let round = map.remove(&(guild_id, channel_id))?;
    round.best.map(|b| (b.user_id, b.mention, b.value))
}

/// Whether any round (Q&A or highest) is currently open in this channel.
#[must_use]
pub fn has_active(guild_id: i64, channel_id: i64) -> bool {
    let now = Instant::now();
    let qa = ACTIVE.lock().expect("games mutex poisoned");
    if qa
        .get(&(guild_id, channel_id))
        .is_some_and(|g| g.expires_at > now)
    {
        return true;
    }
    drop(qa);
    let h = HIGHEST.lock().expect("highest mutex poisoned");
    h.get(&(guild_id, channel_id))
        .is_some_and(|r| r.expires_at > now)
}

/// Check a chat message against the active Q&A round.
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

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn scramble_is_permutation() {
        let mut rng = StdRng::seed_from_u64(1);
        for _ in 0..50 {
            let (prompt, answer) = new_round(GameKind::Scramble, &mut rng).unwrap();
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
            let (prompt, answer) = new_round(GameKind::Math, &mut rng).unwrap();
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
    fn quiz_answers_are_verifiable() {
        let mut rng = StdRng::seed_from_u64(11);
        for _ in 0..200 {
            let (prompt, answer) = quiz_question(&mut rng);
            assert!(!prompt.is_empty());
            assert!(!answer.is_empty());
            if prompt.contains("larger") {
                assert!(answer == "a" || answer == "b");
                let nums: Vec<i64> = prompt
                    .split(|c: char| !c.is_ascii_digit())
                    .filter_map(|s| s.parse().ok())
                    .collect();
                assert_eq!(nums.len(), 2);
                let expect = if nums[0] > nums[1] { "a" } else { "b" };
                assert_eq!(answer, expect, "comparison answer wrong for {prompt}");
            } else if prompt.contains("prime") {
                let n: u64 = prompt
                    .split("**")
                    .nth(1)
                    .unwrap()
                    .parse()
                    .expect("prime prompt carries the number");
                assert_eq!(answer, if is_prime(n) { "yes" } else { "no" });
            } else if prompt.contains("capital") {
                let country = prompt.split("**").nth(1).unwrap();
                assert!(
                    CAPITALS.iter().any(|(c, cap)| *c == country && *cap == answer),
                    "capital answer must match table for {country}"
                );
            } else if prompt.contains('%') {
                let nums: Vec<i64> = prompt
                    .split(|c: char| !c.is_ascii_digit())
                    .filter_map(|s| s.parse().ok())
                    .collect();
                assert_eq!(nums.len(), 2);
                assert_eq!(answer, (nums[0] * nums[1] / 100).to_string());
            }
        }
    }

    #[test]
    fn reverse_round_reverses() {
        let mut rng = StdRng::seed_from_u64(3);
        let (prompt, answer) = new_round(GameKind::Reverse, &mut rng).unwrap();
        let word = prompt.split("**").nth(3).unwrap().trim();
        let mut back: String = answer.chars().rev().collect();
        back = back.to_lowercase();
        assert_eq!(word.to_lowercase(), back);
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

    #[test]
    fn highest_tracks_best_and_finalizes() {
        assert!(start_highest(5, 6));
        assert!(!start_highest(5, 6));
        assert_eq!(submit_highest(5, 6, 10, "<@10>", 100), Submit::Improved);
        assert_eq!(submit_highest(5, 6, 11, "<@11>", 50), Submit::Kept);
        assert_eq!(submit_highest(5, 6, 11, "<@11>", 500), Submit::Improved);
        assert_eq!(
            finalize_highest(5, 6),
            Some((11, "<@11>".into(), 500))
        );
        // Round consumed.
        assert_eq!(submit_highest(5, 6, 10, "<@10>", 1), Submit::NoRound);
        assert!(finalize_highest(5, 6).is_none());
    }

    #[test]
    fn highest_without_submissions_finalizes_empty() {
        assert!(start_highest(7, 8));
        assert_eq!(finalize_highest(7, 8), None);
    }

    #[test]
    fn prime_helper_matches_known_values() {
        assert!(is_prime(2));
        assert!(is_prime(97));
        assert!(!is_prime(1));
        assert!(!is_prime(96));
    }
}
