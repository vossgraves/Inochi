//! The Inochi level curve.
//!
//! XP required to advance from level `L` to `L + 1`:
//!
//! ```text
//! increment(L) = 5/6 * L * (2L^2 + 27L + 91)   -- MEE6-compatible curve
//! ```
//!
//! Total XP for a level is the cumulative sum, computed in constant time via
//! the closed form (verified against the incremental sum in tests).

/// XP needed to go from `level` to `level + 1`. Level 0 -> 1 costs 100.
#[must_use]
pub fn xp_to_next_level(level: u32) -> u64 {
    // MEE6-style formula evaluated at the target level.
    let l = f64::from(level + 1);
    let raw = 5.0 / 6.0 * l * (2.0 * l * l + 27.0 * l + 91.0);
    (raw + 0.5).floor() as u64
}

/// Total XP required to have reached `level` from zero.
#[must_use]
pub fn xp_for_level(level: u32) -> u64 {
    if level == 0 {
        return 0;
    }
    let n = f64::from(level);
    // Sum_{i=1}^{n} 5/6 * i * (2i^2+27i+91)
    //   = 5/6 * [ 2*S3(n) + 27*S2(n) + 91*S1(n) ]
    // with S_k = sum of i^k for i in 1..=n.
    let s1 = n * (n + 1.0) / 2.0;
    let s2 = n * (n + 1.0) * (2.0 * n + 1.0) / 6.0;
    let s3 = s1 * s1;
    let raw = 5.0 / 6.0 * (2.0 * s3 + 27.0 * s2 + 91.0 * s1);
    (raw + 0.5).floor() as u64
}

/// Level a member with `total_xp` currently sits at.
#[must_use]
pub fn level_for_xp(total_xp: u64) -> u32 {
    // Closed form inverted numerically; the curve is monotonic so binary
    // search is exact and fast even for absurd XP values.
    let mut lo = 0u32;
    let mut hi = 10_000u32;
    while lo < hi {
        let mid = lo + (hi - lo + 1) / 2;
        if xp_for_level(mid) <= total_xp {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    lo
}

/// Progress within the current level as `(current, needed)` pair.
#[must_use]
pub fn level_progress(total_xp: u64) -> (u64, u64) {
    let level = level_for_xp(total_xp);
    let base = xp_for_level(level);
    let need = xp_to_next_level(level);
    (total_xp - base, need)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_level_costs_100() {
        assert_eq!(xp_to_next_level(0), 100);
        assert_eq!(xp_for_level(1), 100);
    }

    #[test]
    fn cumulative_matches_incremental() {
        let mut total = 0u64;
        for level in 0..=200u32 {
            assert_eq!(xp_for_level(level), total, "cumulative mismatch at {level}");
            total += xp_to_next_level(level);
        }
    }

    #[test]
    fn inverse_is_exact() {
        for level in [0, 1, 5, 42, 100, 999] {
            assert_eq!(level_for_xp(xp_for_level(level)), level);
        }
        // One XP below a boundary stays on the previous level.
        assert_eq!(level_for_xp(xp_for_level(7) - 1), 6);
    }
}
