//! Rank card renderer: draws a member's level card as a PNG.
//!
//! Pure software rasterization with `image` + `fontdue` — no GPU, no
//! headless browser. DejaVu Sans ships in `assets/` so the binary is
//! self-contained.

use image::{Rgba, RgbaImage};

const FONT_REGULAR: &[u8] = include_bytes!("../assets/DejaVuSans.ttf");
const FONT_BOLD: &[u8] = include_bytes!("../assets/DejaVuSans-Bold.ttf");

const W: u32 = 860;
const H: u32 = 240;
const PAD: i64 = 28;
const BAR_H: i64 = 22;

const BG: [u8; 3] = [0x16, 0x18, 0x1F];
const FG: [u8; 3] = [0xEE, 0xEE, 0xEE];
const MUTED: [u8; 3] = [0x9A, 0xA0, 0xAE];
const ACCENT: [u8; 3] = [0x7C, 0xB4, 0xFF];

fn font(data: &[u8]) -> fontdue::Font {
    fontdue::Font::from_bytes(
        data,
        fontdue::FontSettings { scale: 40., ..Default::default() },
    )
    .expect("embedded font is valid")
}

/// Draw a filled axis-aligned rectangle.
fn fill_rect(img: &mut RgbaImage, x0: i64, y0: i64, w: i64, h: i64, c: [u8; 3]) {
    for y in y0.max(0)..(y0 + h).min(img.height() as i64) {
        for x in x0.max(0)..(x0 + w).min(img.width() as i64) {
            img.put_pixel(x as u32, y as u32, Rgba([c[0], c[1], c[2], 255]));
        }
    }
}

/// Blit anti-aliased text with alpha blending onto the image.
///
/// `x`/`y` are the pen origin (left edge / baseline).
fn draw_text(
    img: &mut RgbaImage,
    f: &fontdue::Font,
    text: &str,
    mut x: i64,
    y_baseline: i64,
    px: f32,
    c: [u8; 3],
) {
    for ch in text.chars() {
        let (metrics, bitmap) = f.rasterize(ch, px);
        if !bitmap.is_empty() {
            for row in 0..metrics.height {
                for col in 0..metrics.width {
                    let cov = bitmap[row * metrics.width + col];
                    if cov == 0 {
                        continue;
                    }
                    let gx = x + metrics.xmin as i64 + col as i64;
                    let gy = y_baseline - metrics.ymin as i64 + row as i64;
                    if gx < 0 || gy < 0 || gx >= img.width() as i64 || gy >= img.height() as i64 {
                        continue;
                    }
                    let bg = img.get_pixel(gx as u32, gy as u32);
                    let a = cov as f32 / 255.;
                    let out = Rgba([
                        ((bg[0] as f32) * (1. - a) + c[0] as f32 * a).round() as u8,
                        ((bg[1] as f32) * (1. - a) + c[1] as f32 * a).round() as u8,
                        ((bg[2] as f32) * (1. - a) + c[2] as f32 * a).round() as u8,
                        255,
                    ]);
                    img.put_pixel(gx as u32, gy as u32, out);
                }
            }
        }
        x += metrics.advance_width.round() as i64;
    }
}

/// Blend a dark veil over the image for text legibility.
fn veil(img: &mut RgbaImage, alpha: f32) {
    for px in img.pixels_mut() {
        for ch in 0..3 {
            px[ch] = ((px[ch] as f32) * (1.0 - alpha) + 12.0 * alpha).round() as u8;
        }
    }
}

/// Render the rank card and return PNG bytes.
///
/// `background`, when provided, is scaled to fill the card and veiled so
/// text stays readable.
#[must_use]
pub fn render(
    name: &str,
    level: u32,
    rank: Option<i64>,
    current: u64,
    needed: u64,
    background: Option<&image::DynamicImage>,
) -> Vec<u8> {
    let regular = font(FONT_REGULAR);
    let bold = font(FONT_BOLD);

    let mut img = match background {
        Some(bg) => {
            let mut base = bg.resize_exact(W, H, image::imageops::FilterType::Triangle).to_rgba8();
            veil(&mut base, 0.55);
            base
        }
        None => {
            let mut base = RgbaImage::new(W, H);
            fill_rect(&mut base, 0, 0, W as i64, H as i64, BG);
            base
        }
    };
    fill_rect(&mut img, 0, 0, 6, H as i64, ACCENT);

    // Name + rank badge.
    draw_text(&mut img, &bold, name, PAD, PAD + 34, 34., FG);
    if let Some(rank) = rank {
        let label = format!("#{rank}");
        draw_text(&mut img, &bold, &label, W as i64 - PAD - 70, PAD + 34, 30., ACCENT);
    }

    // Level line.
    let level_label = format!("Level {level}");
    draw_text(&mut img, &regular, &level_label, PAD, PAD + 84, 26., MUTED);

    // Progress bar.
    let bar_w = (W as i64 - 2 * PAD) as f32;
    let pct = if needed == 0 { 1. } else { current as f32 / needed as f32 };
    fill_rect(&mut img, PAD, H as i64 - PAD - BAR_H, bar_w as i64, BAR_H, [0x2A, 0x2E, 0x39]);
    fill_rect(&mut img, PAD, H as i64 - PAD - BAR_H, (bar_w * pct.clamp(0., 1.)) as i64, BAR_H, ACCENT);

    // XP caption under/above the bar.
    let caption = format!("{current} / {needed} XP");
    draw_text(&mut img, &regular, &caption, PAD, H as i64 - PAD - BAR_H - 12, 22., MUTED);

    let mut png = Vec::with_capacity(64 * 1024);
    let encoder =
        image::codecs::png::PngEncoder::new(std::io::Cursor::new(&mut png));
    image::ImageEncoder::write_image(
        encoder,
        img.as_raw(),
        W,
        H,
        image::ExtendedColorType::Rgba8,
    )
    .expect("PNG encoding of an in-memory RGBA buffer cannot fail");
    png
}

#[cfg(test)]
mod tests {
    #[test]
    fn produces_valid_png() {
        let bytes = super::render("tester", 42, Some(7), 350, 1000, None);
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        assert!(bytes.len() > 1024);
    }

    #[test]
    fn zero_needed_does_not_panic() {
        let bytes = super::render("x", 0, None, 0, 0, None);
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn background_layer_renders() {
        let bg = image::DynamicImage::new_rgba8(400, 200);
        let bytes = super::render("bg", 3, Some(1), 10, 20, Some(&bg));
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }
}
