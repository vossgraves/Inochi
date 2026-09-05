//! Small, deterministic game cards. Keeping these separate from the rank-card
//! renderer makes the hot path cheaper: game cards have no network image
//! fetches, avatars, or configurable background processing.

use image::{Rgba, RgbaImage};

const W: u32 = 900;
const H: u32 = 460;
const BG: [u8; 3] = [0x12, 0x15, 0x1d];
const PANEL: [u8; 3] = [0x1d, 0x22, 0x2d];
const TEXT: [u8; 3] = [0xf4, 0xf6, 0xfa];
const MUTED: [u8; 3] = [0x9e, 0xa8, 0xb8];
const ACCENT: [u8; 3] = [0x63, 0xd7, 0xb0];

const FONT_SANS: &[u8] = include_bytes!("../assets/DejaVuSans-Bold.ttf");
const FONT_MONO: &[u8] = include_bytes!("../assets/DejaVuSansMono.ttf");

fn font(bytes: &[u8]) -> fontdue::Font {
    fontdue::Font::from_bytes(bytes, fontdue::FontSettings::default())
        .expect("embedded game font is valid")
}

fn blend(img: &mut RgbaImage, x: i32, y: i32, color: [u8; 3], alpha: f32) {
    if x < 0 || y < 0 || x >= W as i32 || y >= H as i32 {
        return;
    }
    let p = img.get_pixel(x as u32, y as u32);
    let a = alpha.clamp(0.0, 1.0);
    img.put_pixel(
        x as u32,
        y as u32,
        Rgba([
            (p[0] as f32 * (1.0 - a) + color[0] as f32 * a) as u8,
            (p[1] as f32 * (1.0 - a) + color[1] as f32 * a) as u8,
            (p[2] as f32 * (1.0 - a) + color[2] as f32 * a) as u8,
            255,
        ]),
    );
}

fn fill(img: &mut RgbaImage, color: [u8; 3]) {
    for p in img.pixels_mut() {
        *p = Rgba([color[0], color[1], color[2], 255]);
    }
}

fn text(img: &mut RgbaImage, face: &fontdue::Font, value: &str, x: i32, baseline: i32, size: f32, color: [u8; 3]) -> f32 {
    let mut pen = x as f32;
    for ch in value.chars() {
        let (metrics, bitmap) = face.rasterize(ch, size);
        for row in 0..metrics.height {
            for col in 0..metrics.width {
                let coverage = bitmap[row * metrics.width + col];
                if coverage != 0 {
                    blend(img, pen as i32 + metrics.xmin + col as i32, baseline - metrics.ymin + row as i32, color, coverage as f32 / 255.0);
                }
            }
        }
        pen += metrics.advance_width;
    }
    pen - x as f32
}

fn centered(img: &mut RgbaImage, face: &fontdue::Font, value: &str, baseline: i32, size: f32, color: [u8; 3]) {
    let width: f32 = value.chars().map(|c| face.rasterize(c, size).0.advance_width).sum();
    text(img, face, value, ((W as f32 - width) / 2.0) as i32, baseline, size, color);
}

fn rect(img: &mut RgbaImage, x: i32, y: i32, width: i32, height: i32, color: [u8; 3]) {
    for yy in y.max(0)..(y + height).min(H as i32) {
        for xx in x.max(0)..(x + width).min(W as i32) {
            blend(img, xx, yy, color, 1.0);
        }
    }
}

fn circle(img: &mut RgbaImage, cx: i32, cy: i32, radius: i32, color: [u8; 3]) {
    let r2 = radius * radius;
    for y in (cy - radius).max(0)..=(cy + radius).min(H as i32 - 1) {
        for x in (cx - radius).max(0)..=(cx + radius).min(W as i32 - 1) {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= r2 {
                blend(img, x, y, color, 1.0);
            }
        }
    }
}

/// A tiny, dependency-free illustration vocabulary. It keeps word rounds
/// meaningful without downloading or generating an image per round.
fn draw_word_icon(img: &mut RgbaImage, word: &str) {
    let center = (W as i32 / 2, 225);
    match word {
        "orange" => {
            circle(img, center.0, center.1, 95, [0xf5, 0x96, 0x32]);
            rect(img, center.0 + 10, center.1 - 100, 18, 30, [0x58, 0xc7, 0x72]);
            circle(img, center.0 + 35, center.1 - 100, 22, [0x58, 0xc7, 0x72]);
        }
        "coffee" => {
            rect(img, center.0 - 75, center.1 - 55, 150, 125, [0xa9, 0x6b, 0x45]);
            circle(img, center.0 + 82, center.1 + 5, 42, [0xa9, 0x6b, 0x45]);
            rect(img, center.0 - 90, center.1 + 65, 180, 18, [0xf4, 0xf6, 0xfa]);
        }
        "planet" => {
            circle(img, center.0, center.1, 88, [0x75, 0x9d, 0xe8]);
            for x in -150..150 { blend(img, center.0 + x, center.1 + x / 3, ACCENT, 0.9); }
        }
        "castle" | "garden" | "forest" => {
            rect(img, center.0 - 120, center.1 - 35, 240, 125, [0xc0, 0x8a, 0x62]);
            rect(img, center.0 - 145, center.1 - 100, 55, 190, [0xc0, 0x8a, 0x62]);
            rect(img, center.0 + 90, center.1 - 100, 55, 190, [0xc0, 0x8a, 0x62]);
            circle(img, center.0 - 110, center.1 - 112, 28, ACCENT);
            circle(img, center.0 + 120, center.1 - 112, 28, ACCENT);
        }
        _ => {
            // Abstract word art is still a visual clue and works for every
            // vocabulary item without embedding the answer in the filename.
            circle(img, center.0, center.1, 92, ACCENT);
            circle(img, center.0 - 32, center.1 - 12, 12, BG);
            circle(img, center.0 + 32, center.1 - 12, 12, BG);
            rect(img, center.0 - 42, center.1 + 25, 84, 12, BG);
        }
    }
}

fn base(label: &str) -> (RgbaImage, fontdue::Font, fontdue::Font) {
    let mut img = RgbaImage::new(W, H);
    fill(&mut img, BG);
    for x in (30..W - 30).step_by(30) {
        for y in 90..H - 25 {
            blend(&mut img, x as i32, y as i32, [0x3a, 0x45, 0x55], 0.18);
        }
    }
    for y in 0..H {
        blend(&mut img, 30, y as i32, ACCENT, 0.8);
        blend(&mut img, W as i32 - 31, y as i32, ACCENT, 0.8);
    }
    let sans = font(FONT_SANS);
    let mono = font(FONT_MONO);
    text(&mut img, &sans, "INOCHI / CHAT GAME", 62, 62, 24.0, ACCENT);
    text(&mut img, &mono, label, 650, 61, 18.0, MUTED);
    (img, sans, mono)
}

/// Render a readable math challenge card. The answer is not included in the image.
#[must_use]
pub fn math(expression: &str) -> Vec<u8> {
    let (mut img, sans, mono) = base("MATH RUSH");
    centered(&mut img, &sans, expression, 270, 74.0, TEXT);
    centered(&mut img, &mono, "TYPE THE ANSWER IN CHAT", 355, 22.0, MUTED);
    encode(img)
}

/// Render a word image. Callers should upload the resulting file as a Discord
/// spoiler (`SPOILER_...png`) so players choose to reveal it.
#[must_use]
pub fn word(word: &str) -> Vec<u8> {
    let (mut img, _sans, mono) = base("WORD REVEAL");
    draw_word_icon(&mut img, word);
    centered(&mut img, &mono, "OPEN THE SPOILER • GUESS THE WORD", 355, 22.0, MUTED);
    encode(img)
}

fn encode(img: RgbaImage) -> Vec<u8> {
    let mut out = Vec::with_capacity(32 * 1024);
    let encoder = image::codecs::png::PngEncoder::new(std::io::Cursor::new(&mut out));
    image::ImageEncoder::write_image(encoder, img.as_raw(), W, H, image::ExtendedColorType::Rgba8)
        .expect("in-memory game PNG encoding cannot fail");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cards_are_non_empty_pngs() {
        assert!(math("12 + 34").starts_with(b"\x89PNG"));
        assert!(word("orchid").starts_with(b"\x89PNG"));
    }
}
