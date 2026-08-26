//! Rank card renderer — faithful Rust port of `packages/rank-card/src/index.ts`.
//!
//! 960×300 "sumi ink" card: optional cover-cropped background with an ink
//! veil, technical measuring grid, avatar panel, level/rank readouts, XP
//! columns and a vermilion progress bar. Pure software rasterization with
//! `image` + `fontdue`; DejaVu faces stand in for Satoshi/JetBrains Mono.

use image::{Rgba, RgbaImage};

const FONT_SANS: &[u8] = include_bytes!("../assets/DejaVuSans-Bold.ttf");
const FONT_MONO: &[u8] = include_bytes!("../assets/DejaVuSansMono.ttf");

const W: u32 = 960;
const H: u32 = 300;

const INK: [u8; 3] = [0x14, 0x11, 0x0f];
const INK_PANEL: [u8; 3] = [0x1c, 0x19, 0x17];
const PAPER: [u8; 3] = [0xf4, 0xf1, 0xea];
const PAPER_DIM: [u8; 3] = [0xcf, 0xc9, 0xc0];
const MUTED: [u8; 3] = [0xa8, 0xa1, 0x99];
const MUTED_DIM: [u8; 3] = [0x8a, 0x83, 0x7c];
const VERMILION: [u8; 3] = [0xd3, 0x3c, 0x1c];
const CARD_RADIUS: f64 = 6.0;

fn font(data: &[u8]) -> fontdue::Font {
    fontdue::Font::from_bytes(
        data,
        fontdue::FontSettings { scale: 40., ..Default::default() },
    )
    .expect("embedded font is valid")
}

/// Alpha-blend one pixel.
fn blend(img: &mut RgbaImage, x: i64, y: i64, c: [u8; 3], alpha: f32) {
    if x < 0 || y < 0 || x >= img.width() as i64 || y >= img.height() as i64 {
        return;
    }
    let bg = img.get_pixel(x as u32, y as u32);
    let out = Rgba([
        ((bg[0] as f32) * (1.0 - alpha) + c[0] as f32 * alpha).round() as u8,
        ((bg[1] as f32) * (1.0 - alpha) + c[1] as f32 * alpha).round() as u8,
        ((bg[2] as f32) * (1.0 - alpha) + c[2] as f32 * alpha).round() as u8,
        255,
    ]);
    img.put_pixel(x as u32, y as u32, out);
}

/// Signed distance to a rounded rectangle (negative inside).
fn round_rect_sdf(px: f64, py: f64, x: f64, y: f64, w: f64, h: f64, r: f64) -> f64 {
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let hw = w / 2.0 - r;
    let hh = h / 2.0 - r;
    let qx = (px - cx).abs() - hw;
    let qy = (py - cy).abs() - hh;
    let outside = (qx.max(0.0).hypot(qy.max(0.0)));
    let inside = qx.max(qy).min(0.0);
    outside + inside - r
}

/// Fill (and optionally stroke) a rounded rectangle with alpha blending.
fn round_rect(
    img: &mut RgbaImage,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    r: f64,
    fill: Option<([u8; 3], f32)>,
    stroke: Option<([u8; 3], f32, f64)>,
) {
    let x0 = x.floor().max(0.0) as i64;
    let y0 = y.floor().max(0.0) as i64;
    let x1 = (x + w).ceil().min(img.width() as f64) as i64;
    let y1 = (y + h).ceil().min(img.height() as f64) as i64;
    for py in y0..y1 {
        for px in x0..x1 {
            let d = round_rect_sdf(px as f64 + 0.5, py as f64 + 0.5, x, y, w, h, r);
            if let (Some((c, a)), _) = (&fill, &stroke) {
                if d <= 0.0 {
                    blend(img, px, py, *c, *a);
                }
            }
            if let Some((c, a, lw)) = &stroke {
                if d.abs() <= lw / 2.0 {
                    blend(img, px, py, *c, *a);
                }
            }
        }
    }
}

/// Clip-fill: fill `rect` but only where `clip` is inside (for the bar).
fn fill_round_rect_clipped(
    img: &mut RgbaImage,
    rect: (f64, f64, f64, f64, f64),
    clip: (f64, f64, f64, f64, f64),
    c: [u8; 3],
    alpha: f32,
) {
    let (x, y, w, h, r) = rect;
    let (cx, cy, cw, ch, cr) = clip;
    for py in (y.floor().max(0.0) as i64)..((y + h).ceil().min(img.height() as f64) as i64) {
        for px in (x.floor().max(0.0) as i64)..((x + w).ceil().min(img.width() as f64) as i64) {
            let fx = px as f64 + 0.5;
            let fy = py as f64 + 0.5;
            if round_rect_sdf(fx, fy, x, y, w, h, r) <= 0.0
                && round_rect_sdf(fx, fy, cx, cy, cw, ch, cr) <= 0.0
            {
                blend(img, px, py, c, alpha);
            }
        }
    }
}

fn fill_rect(img: &mut RgbaImage, x0: i64, y0: i64, w: i64, h: i64, c: [u8; 3], alpha: f32) {
    for y in y0.max(0)..(y0 + h).min(img.height() as i64) {
        for x in x0.max(0)..(x0 + w).min(img.width() as i64) {
            blend(img, x, y, c, alpha);
        }
    }
}

/// Cover-crop `src` to `w×h` (center crop, scale to fill).
fn cover(src: &image::DynamicImage, w: u32, h: u32) -> RgbaImage {
    let (iw, ih) = (src.width() as f64, src.height() as f64);
    let scale = (w as f64 / iw).max(h as f64 / ih);
    let sw = (w as f64 / scale).round() as u32;
    let sh = (h as f64 / scale).round() as u32;
    let sx = ((iw - sw as f64) / 2.0).max(0.0) as u32;
    let sy = ((ih - sh as f64) / 2.0).max(0.0) as u32;
    let sw = sw.min(iw as u32 - sx).max(1);
    let sh = sh.min(ih as u32 - sy).max(1);
    src.crop_imm(sx, sy, sw, sh)
        .resize_exact(w, h, image::imageops::FilterType::Triangle)
        .to_rgba8()
}

/// Blit `src` with rounded-corner clipping (avatar panel).
fn blit_rounded(img: &mut RgbaImage, src: &RgbaImage, x: i64, y: i64, r: f64) {
    let (w, h) = (src.width() as i64, src.height() as i64);
    for row in 0..h {
        for col in 0..w {
            let p = src.get_pixel(col as u32, row as u32);
            let a = p[3] as f32 / 255.0;
            if a <= 0.0 {
                continue;
            }
            let d = round_rect_sdf(
                (x + col) as f64 + 0.5,
                (y + row) as f64 + 0.5,
                x as f64,
                y as f64,
                w as f64,
                h as f64,
                r,
            );
            if d <= 0.0 {
                blend(
                    img,
                    x + col,
                    y + row,
                    [p[0], p[1], p[2]],
                    a,
                );
            }
        }
    }
}

/// Draw text with alpha blending; `x`/`y` = pen origin (left edge / baseline).
/// Returns the total advance width.
fn draw_text(
    img: &mut RgbaImage,
    f: &fontdue::Font,
    text: &str,
    x: i64,
    y_baseline: i64,
    px: f32,
    c: [u8; 3],
    alpha: f32,
) -> f64 {
    let mut cursor = x as f64;
    for ch in text.chars() {
        let (metrics, bitmap) = f.rasterize(ch, px);
        if !bitmap.is_empty() {
            for row in 0..metrics.height {
                for col in 0..metrics.width {
                    let cov = bitmap[row * metrics.width + col];
                    if cov == 0 {
                        continue;
                    }
                    let gx = cursor as i64 + metrics.xmin as i64 + col as i64;
                    let gy = y_baseline - metrics.ymin as i64 + row as i64;
                    blend(img, gx, gy, c, (cov as f32 / 255.0) * alpha);
                }
            }
        }
        cursor += f64::from(metrics.advance_width);
    }
    cursor - x as f64
}

fn measure(f: &fontdue::Font, text: &str, px: f32) -> f64 {
    text.chars()
        .map(|ch| f64::from(f.rasterize(ch, px).0.advance_width))
        .sum()
}

fn draw_text_right(
    img: &mut RgbaImage,
    f: &fontdue::Font,
    text: &str,
    right: i64,
    y_baseline: i64,
    px: f32,
    c: [u8; 3],
    alpha: f32,
) {
    let w = measure(f, text, px);
    draw_text(img, f, text, right - w.round() as i64, y_baseline, px, c, alpha);
}

fn ellipsize(f: &fontdue::Font, value: &str, max_width: f64, px: f32) -> String {
    if measure(f, value, px) <= max_width {
        return value.to_string();
    }
    let mut end = value.chars().count();
    while end > 0 {
        let candidate: String = value.chars().take(end).collect::<String>() + "...";
        if measure(f, &candidate, px) <= max_width {
            return candidate;
        }
        end -= 1;
    }
    "...".into()
}

fn comma(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Card input, mirroring the TypeScript `RankCardInput`.
pub struct CardInput<'a> {
    pub username: &'a str,
    pub avatar: Option<&'a image::DynamicImage>,
    pub rank: Option<i64>,
    pub level: u32,
    pub xp: u64,
    pub current_level_xp: u64,
    pub next_level_xp: u64,
    pub background: Option<&'a image::DynamicImage>,
    /// Accent colour (defaults to vermilion).
    pub accent: [u8; 3],
    /// Ink veil strength over the background (0..=0.95).
    pub overlay: f32,
    /// Avatar corner radius (6 rounded, 94 circle, 0 square).
    pub avatar_radius: f64,
    /// Draw the technical measuring grid.
    pub technical_surface: bool,
    /// Draw the progress halo.
    pub glow: bool,
}

impl<'a> CardInput<'a> {
    /// Defaults matching the original card.
    pub fn new(
        username: &'a str,
        level: u32,
        xp: u64,
        current_level_xp: u64,
        next_level_xp: u64,
    ) -> Self {
        Self {
            username,
            avatar: None,
            rank: None,
            level,
            xp,
            current_level_xp,
            next_level_xp,
            background: None,
            accent: VERMILION,
            overlay: 0.86,
            avatar_radius: 6.0,
            technical_surface: true,
            glow: true,
        }
    }
}

/// Render the rank card and return PNG bytes.
#[must_use]
pub fn render(input: &CardInput) -> Vec<u8> {
    let sans = font(FONT_SANS);
    let mono = font(FONT_MONO);

    let mut img = RgbaImage::new(W, H);
    fill_rect(&mut img, 0, 0, W as i64, H as i64, INK, 1.0);

    // Background image, cover-cropped, veiled with ink.
    if let Some(bg) = input.background {
        let layer = cover(bg, W, H);
        for (x, y, p) in layer.enumerate_pixels() {
            blend(&mut img, x as i64, y as i64, [p[0], p[1], p[2]], p[3] as f32 / 255.0);
        }
        fill_rect(&mut img, 0, 0, W as i64, H as i64, INK, input.overlay.clamp(0.0, 0.95));
    }

    // Technical grid: rules, not decoration.
    if input.technical_surface {
        let mut x = 270;
        while x < W as i64 {
            fill_rect(&mut img, x, 0, 1, H as i64, [255, 255, 255], 0.05);
            x += 34;
        }
        let mut y = 20;
        while y < H as i64 {
            fill_rect(&mut img, 250, y, (W as i64 - 250), 1, [255, 255, 255], 0.05);
            y += 34;
        }
    }

    // Avatar panel.
    round_rect(
        &mut img,
        24.0,
        30.0,
        216.0,
        240.0,
        CARD_RADIUS,
        Some((INK_PANEL, 1.0)),
        Some(([255, 255, 255], 0.12, 2.0)),
    );

    match input.avatar {
        Some(avatar) => {
            let cropped = cover(avatar, 188, 188);
            blit_rounded(&mut img, &cropped, 38, 44, input.avatar_radius);
        }
        None => {
            round_rect(&mut img, 38.0, 44.0, 188.0, 188.0, 6.0, Some(([0x26, 0x22, 0x20], 1.0)), None);
            let initial: String = input.username.trim().chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_else(|| "?".into());
            let w = measure(&sans, &initial, 68.0);
            draw_text(&mut img, &sans, &initial, 132 - (w / 2.0).round() as i64, 162, 68.0, PAPER, 1.0);
        }
    }
    round_rect(&mut img, 78.0, 247.0, 108.0, 5.0, 3.0, Some((input.accent, 1.0)), None);

    // Header + name.
    draw_text(&mut img, &mono, "INOCHI  /  MEMBER", 278, 48, 15.0, MUTED, 1.0);
    let name = ellipsize(&sans, input.username, 370.0, 37.0);
    draw_text(&mut img, &sans, &name, 278, 99, 37.0, PAPER, 1.0);

    // Level + rank.
    draw_text_right(&mut img, &mono, "LEVEL", 764, 45, 14.0, MUTED_DIM, 1.0);
    draw_text_right(&mut img, &sans, &comma(input.level as u64), 764, 96, 50.0, PAPER, 1.0);
    draw_text_right(&mut img, &mono, "RANK", 900, 45, 14.0, MUTED_DIM, 1.0);
    if let Some(rank) = input.rank {
        draw_text_right(&mut img, &sans, &format!("#{}", comma(rank.max(0) as u64)), 900, 88, 31.0, PAPER_DIM, 1.0);
    }

    // XP columns.
    draw_text(&mut img, &mono, "TOTAL XP", 278, 139, 13.0, MUTED_DIM, 1.0);
    draw_text(&mut img, &sans, &comma(input.xp), 278, 169, 23.0, PAPER, 1.0);
    let remaining = input.next_level_xp.saturating_sub(input.xp);
    draw_text(&mut img, &mono, "XP TO NEXT LEVEL", 500, 139, 13.0, MUTED_DIM, 1.0);
    draw_text(&mut img, &sans, &comma(remaining), 500, 169, 23.0, PAPER, 1.0);

    // Progress bar.
    let (bar_x, bar_y, bar_w, bar_h) = (278.0, 202.0, 622.0, 26.0);
    round_rect(&mut img, bar_x, bar_y, bar_w, bar_h, 3.0, Some(([255, 255, 255], 0.08)), None);
    let progress = if input.xp > 0 && input.next_level_xp > 0 {
        ((input.xp - input.current_level_xp) as f64 / (input.next_level_xp - input.current_level_xp).max(1) as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };
    if progress > 0.0 {
        // Tight glow halo (solid style skips it).
        if input.glow {
            round_rect(
                &mut img,
                bar_x - 2.0,
                bar_y - 2.0,
                bar_w * progress + 4.0,
                bar_h + 4.0,
                4.0,
                Some((input.accent, 0.17)),
                None,
            );
        }
        fill_round_rect_clipped(
            &mut img,
            (bar_x, bar_y, bar_w * progress, bar_h, 0.0),
            (bar_x, bar_y, bar_w, bar_h, 3.0),
            input.accent,
            1.0,
        );
    }
    let in_level = input.xp.saturating_sub(input.current_level_xp);
    let need = input.next_level_xp.saturating_sub(input.current_level_xp);
    draw_text(
        &mut img,
        &mono,
        &format!("{} / {} XP", comma(in_level), comma(need)),
        278,
        258,
        14.0,
        MUTED,
        1.0,
    );
    draw_text_right(&mut img, &mono, &format!("{}%", (progress * 100.0).round() as u64), 900, 258, 14.0, MUTED, 1.0);

    // Card border.
    round_rect(
        &mut img,
        4.0,
        4.0,
        W as f64 - 8.0,
        H as f64 - 8.0,
        CARD_RADIUS,
        None,
        Some(([255, 255, 255], 0.12, 2.0)),
    );

    let mut png = Vec::with_capacity(96 * 1024);
    let encoder = image::codecs::png::PngEncoder::new(std::io::Cursor::new(&mut png));
    image::ImageEncoder::write_image(encoder, img.as_raw(), W, H, image::ExtendedColorType::Rgba8)
        .expect("PNG encoding of an in-memory RGBA buffer cannot fail");
    png
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> CardInput<'static> {
        CardInput {
            username: "tester",
            avatar: None,
            rank: Some(7),
            level: 42,
            xp: 1350,
            current_level_xp: 1000,
            next_level_xp: 2000,
            background: None,
            accent: VERMILION,
            overlay: 0.86,
            avatar_radius: 6.0,
            technical_surface: true,
            glow: true,
        }
    }

    #[test]
    fn produces_valid_png() {
        let bytes = render(&sample());
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        assert!(bytes.len() > 4096);
    }

    #[test]
    fn background_and_avatar_layers_render() {
        let bg = image::DynamicImage::new_rgba8(1200, 400);
        let avatar = image::DynamicImage::new_rgba8(256, 256);
        let input = CardInput {
            avatar: Some(&avatar),
            background: Some(&bg),
            ..sample()
        };
        let bytes = render(&input);
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn style_variants_render() {
        // Clean surface, solid bar, circle avatar.
        let input = CardInput {
            technical_surface: false,
            glow: false,
            avatar_radius: 94.0,
            accent: [0x7c, 0xb4, 0xff],
            overlay: 0.5,
            ..sample()
        };
        let bytes = render(&input);
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn no_rank_omits_badge_without_panic() {
        let input = CardInput { rank: None, ..sample() };
        let bytes = render(&input);
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn long_names_ellipsize() {
        let f = font(FONT_SANS);
        let long = "w".repeat(60);
        let cut = ellipsize(&f, &long, 370.0, 37.0);
        assert!(cut.ends_with("..."));
        assert!(measure(&f, &cut, 37.0) <= 370.0);
    }

    #[test]
    fn comma_formats_thousands() {
        assert_eq!(comma(1234567), "1,234,567");
        assert_eq!(comma(100), "100");
    }
}
