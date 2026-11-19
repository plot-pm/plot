import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE THEME CONTRAST GATE. Every text pair the Delivery and Plans tabs draw
// from the tokens in `index.css` reads at least 4.5:1 (WCAG AA body text) in
// both themes. A value with an alpha is composited over `--card-surface`, the
// background every card has, before it is compared.

const CSS = readFileSync(fileURLToPath(new URL('../../src/app/index.css', import.meta.url)), 'utf8');
const AA = 4.5;

type Rgba = { r: number; g: number; b: number; a: number };

/** The custom properties declared in the first block that `opener` starts. */
const tokensAfter = (opener: RegExp): Map<string, string> => {
  const at = CSS.search(opener);
  if (at < 0) throw new Error(`no token block matches ${opener}`);
  const open = CSS.indexOf('{', CSS.indexOf(':root', at));
  const close = CSS.indexOf('}', open);
  const tokens = new Map<string, string>();
  for (const m of CSS.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
  return tokens;
};

const LIGHT = tokensAfter(/:root\s*{\s*--card-surface/);
const DARK = tokensAfter(/@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{\s*--card-surface/);

const gammaOf = (linear: number): number =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
const linearOf = (gamma: number): number =>
  gamma <= 0.04045 ? gamma / 12.92 : ((gamma + 0.055) / 1.055) ** 2.4;
const clamp = (v: number): number => Math.min(1, Math.max(0, v));

/** `oklch(L% C H)` to gamma-encoded sRGB in 0..1, clamped to the gamut. */
const fromOklch = (l: number, c: number, h: number): Rgba => {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: clamp(gammaOf(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)),
    g: clamp(gammaOf(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)),
    b: clamp(gammaOf(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)),
    a: 1,
  };
};

/** One colour value as `index.css` writes it: `oklch()`, `rgb()` with an optional alpha, or hex. */
const parse = (value: string): Rgba => {
  const ok = value.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (ok) return fromOklch(Number(ok[1]) / 100, Number(ok[2]), Number(ok[3]));
  const rgb = value.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)\s*)?\)$/);
  if (rgb) return { r: Number(rgb[1]) / 255, g: Number(rgb[2]) / 255, b: Number(rgb[3]) / 255, a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d) : hex[1].match(/../g)!;
    const [r, g, b] = digits.map((d) => parseInt(d, 16) / 255);
    return { r, g, b, a: 1 };
  }
  throw new Error(`unparsed colour value: ${value}`);
};

/** A colour composited over an opaque background, in gamma-encoded sRGB as a browser blends it. */
const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

const luminance = ({ r, g, b }: Rgba): number =>
  0.2126 * linearOf(r) + 0.7152 * linearOf(g) + 0.0722 * linearOf(b);

const ratio = (x: Rgba, y: Rgba): number => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const HUES = ['slate', 'sky', 'blue', 'green', 'teal', 'violet', 'orange', 'amber', 'red', 'rose'] as const;
const TEXT = ['--card-title', '--card-body', '--card-meta', ...HUES.map((h) => `--hue-${h}`)];
const CARD_BACKGROUNDS = ['--card-surface', '--card-band', '--card-band-strong', '--card-panel', '--card-panel-strong'];

/** The text and background pairs the gate covers. */
const PAIRS: ReadonlyArray<readonly [text: string, background: string]> = [
  ...TEXT.map((t) => [t, '--card-surface'] as const),
  ...HUES.map((h) => [`--hue-${h}`, `--hue-${h}-soft`] as const),
  ['--card-primary-text', '--card-primary'],
  ...CARD_BACKGROUNDS.slice(1).map((b) => ['--card-meta', b] as const),
  ['--hue-green', '--card-panel-strong'],
];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
] as const)('the %s theme', (_theme, tokens) => {
  const colour = (name: string): Rgba => {
    const value = tokens.get(name);
    if (value === undefined) throw new Error(`${name} is not declared`);
    return parse(value);
  };
  const surface = colour('--card-surface');
  const solid = (name: string): Rgba => over(colour(name), surface);

  it('declares an opaque card surface', () => {
    expect(surface.a).toBe(1);
  });

  it.each(PAIRS)('reads %s on %s at 4.5:1 or more', (text, background) => {
    const bg = solid(background);
    expect(ratio(over(colour(text), bg), bg)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the colour parser', () => {
  it('reads white as white in each notation', () => {
    for (const v of ['#fff', '#ffffff', 'rgb(255 255 255)', 'oklch(100% 0 0)']) {
      const c = parse(v);
      expect([c.r, c.g, c.b].map((x) => Math.round(x * 255))).toEqual([255, 255, 255]);
    }
  });

  it('composites an alpha value over its background', () => {
    const half = over(parse('rgb(0 0 0 / 0.5)'), parse('#fff'));
    expect(half.r).toBeCloseTo(0.5, 5);
    expect(ratio(parse('#000'), parse('#fff'))).toBeCloseTo(21, 5);
  });
});
