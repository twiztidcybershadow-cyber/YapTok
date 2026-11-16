/**
 * The YapTok mark, in one place so the app shell, the favicon and the sign in
 * card all draw the same thing.
 *
 * The mark is an orange eighth note, drawn three times: a light copy nudged
 * up and left, a dark copy nudged down and right, and the note itself on top,
 * so it reads as a solid shape with a lit edge. Orange is the family color it
 * shares with Yapin'. The accent is a golden yellow, used sparingly (a liked
 * heart, a saved bookmark, the unread dot). It is our own drawing, with
 * nothing borrowed from another app.
 *
 * No imports on purpose, so `node --test` and scripts/favicon.mjs can load it.
 */

/** The mark is drawn on a 24 by 24 grid. */
export const MARK_VIEWBOX = "0 0 24 24";

/** The note's head: a tilted oval at the bottom left. */
export const MARK_HEAD = "M5.06 17.82a4.7 3.6-15 1 0 9.08-2.43a4.7 3.6-15 1 0-9.08 2.43z";

/** The note's stem and its flag, which sweeps out to the right. */
export const MARK_STEM =
  "M11.9 5.5a2 2 0 0 1 2-2h.5c.9 0 1.6.5 2.1 1.2c.9 1.3 2.2 2.1 3.6 2.3c.6.1.9.6.8 1.2c-.3 1.5-1.6 2.4-3.3 2.2c-1.2-.1-2.3-.6-3.4-1.3v7.4h-2.3z";

/** How far the light and dark copies sit from the note, in grid units. */
export const MARK_LAYERS = [
  { tone: "light", dx: -0.4, dy: -0.35 },
  { tone: "dark", dx: 0.3, dy: 0.5 },
  { tone: "main", dx: 0, dy: 0 },
] as const;

/** Brand colors, also set as --mark, --brand, --brand-strong and --accent in app/globals.css. */
export const BRAND = {
  /** Yapin's own orange, from its app icon. The mark and highlights. */
  orange: "#fc6a39",
  /** The lit edge of the mark. */
  markLight: "#fda773",
  /** The shaded edge of the mark. */
  markDark: "#b8431a",
  /** Links and the wordmark on a dark page. */
  orangeLight: "#fd8a63",
  /** Buttons: the same hue, dark enough for white text to read on it (4.5 to 1). */
  orangeDeep: "#c4522c",
  /** A liked heart, a saved bookmark, the unread dot. */
  gold: "#fbbf24",
  /** The app's dark page color. */
  ink: "#0f0d0c",
} as const;

export const SITE_NAME = "YapTok";

/** The three copies of the note as SVG markup, back to front. */
function markLayers(color: string): string {
  const fills = { light: BRAND.markLight, dark: BRAND.markDark, main: color };
  return MARK_LAYERS.map(
    (l) =>
      `<g transform="translate(${l.dx} ${l.dy})" fill="${fills[l.tone]}">` +
      `<path d="${MARK_HEAD}"/><path d="${MARK_STEM}"/></g>`,
  ).join("");
}

/** The mark as a standalone SVG string (favicon, press use). */
export function markSvg(size = 24, color: string = BRAND.orange): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MARK_VIEWBOX}">` +
    markLayers(color) +
    `</svg>`
  );
}

/** The mark and the two tone wordmark ("Yap" in orange, "Tok" in near black). */
export function logoSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120" viewBox="0 0 140 30">` +
    `<g transform="translate(1 2) scale(1.08)">${markLayers(BRAND.orange)}</g>` +
    `<text x="30" y="21" font-family="Roboto, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="-0.6">` +
    `<tspan fill="${BRAND.orangeDeep}">Yap</tspan><tspan fill="#1c1410">Tok</tspan></text>` +
    `</svg>`
  );
}
