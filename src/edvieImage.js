import { HorizontalAlign, Jimp, ResizeStrategy, loadFont, measureText } from 'jimp';
import { SANS_32_WHITE, SANS_64_WHITE } from 'jimp/fonts';
import { RARITIES, STATS } from './edvie.js';

// Renders an Edvie as a trading card: the rarity's colour as a gradient
// background, a light frame, the sprite in the middle and name + specs below.
// Pure JavaScript (jimp), so it runs on any server without native builds.

const W = 512;
const H = 704;
const FRAME = 10;
const ART = { x: 46, y: 80, w: 420, h: 420 };
const PANEL_Y = 520;

const fonts = Promise.all([loadFont(SANS_32_WHITE), loadFont(SANS_64_WHITE)]);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/**
 * Reads an uploaded picture and returns it as a PNG no bigger than 512px,
 * transparency kept. Throws if the file isn't an image jimp understands.
 */
export async function normalizeSprite(buffer) {
  const image = await Jimp.read(buffer);
  if (image.bitmap.width > 512 || image.bitmap.height > 512) image.scaleToFit({ w: 512, h: 512 });
  return image.getBuffer('image/png');
}

/** edvie: { name, rarity, stats }. Returns a JPEG buffer. */
export async function renderCard(edvie, spritePng) {
  const [font32, font64] = await fonts;
  const [top, bottom] = RARITIES[edvie.rarity].colors.map(rgb);
  const frame = mix(top, [255, 255, 255], 0.45);
  const card = new Jimp({ width: W, height: H, color: 0x000000ff });
  const data = card.bitmap.data;

  // Gradient, a soft glow behind the art, a frame, and darker bands for text.
  const glow = { x: W / 2, y: ART.y + ART.h / 2, r: 300 };
  for (let y = 0; y < H; y++) {
    const base = mix(top, bottom, y / H);
    for (let x = 0; x < W; x++) {
      let color = base;
      const inFrame = x < FRAME || y < FRAME || x >= W - FRAME || y >= H - FRAME;
      if (inFrame) {
        color = frame;
      } else {
        const d = Math.hypot(x - glow.x, y - glow.y) / glow.r;
        if (d < 1) color = mix(color, [255, 255, 255], 0.22 * (1 - d) ** 2);
        if (y < 64 || y >= PANEL_Y) color = mix(color, [0, 0, 0], 0.35);
      }
      const i = (y * W + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
    }
  }

  const sprite = await Jimp.read(spritePng);
  // Small pixel-art sprites stay crisp when blown up.
  const small = Math.max(sprite.bitmap.width, sprite.bitmap.height) < 160;
  sprite.scaleToFit({ w: ART.w, h: ART.h, ...(small ? { mode: ResizeStrategy.NEAREST_NEIGHBOR } : {}) });
  card.composite(
    sprite,
    ART.x + Math.round((ART.w - sprite.bitmap.width) / 2),
    ART.y + Math.round((ART.h - sprite.bitmap.height) / 2),
  );

  const center = (font, text, y) =>
    card.print({ font, x: FRAME, y, text: { text, alignmentX: HorizontalAlign.CENTER }, maxWidth: W - 2 * FRAME });

  center(font32, RARITIES[edvie.rarity].label.toUpperCase(), 18);
  const nameFont = measureText(font64, edvie.name) <= W - 60 ? font64 : font32;
  center(nameFont, edvie.name, nameFont === font64 ? 530 : 548);
  center(font32, STATS.map((s) => `${s.short} ${edvie.stats[s.key]}`).join('    '), 618);

  return card.getBuffer('image/jpeg', { quality: 90 });
}
