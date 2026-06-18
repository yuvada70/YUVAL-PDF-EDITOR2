// Loads a Unicode font that covers Hebrew (and Latin) for PDF export, plus a
// lightweight right-to-left reordering helper so Hebrew text exports correctly.
//
// pdf-lib's StandardFonts (Helvetica, …) only support WinAnsi and cannot encode
// Hebrew, so we embed a real Unicode TrueType font via fontkit at export time.

// TrueType builds that include the Hebrew block, served from the Google Fonts
// GitHub mirror via jsDelivr. Tried in order; the first that downloads
// successfully is cached for the rest of the session. Several candidates are
// listed so a single moved/renamed path doesn't disable Hebrew export.
const FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/google/fonts/ofl/heebo/static/Heebo-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts/ofl/assistant/static/Assistant-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts/ofl/rubik/static/Rubik-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts/ofl/notosanshebrew/static/NotoSansHebrew-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts/ofl/notosanshebrew/NotoSansHebrew%5Bwdth,wght%5D.ttf',
];

let fontPromise: Promise<ArrayBuffer | null> | null = null;

/** Fetch (and cache) the Hebrew-capable font bytes, or null if none could load. */
export function loadUnicodeFontBytes(): Promise<ArrayBuffer | null> {
  if (!fontPromise) {
    fontPromise = (async () => {
      for (const url of FONT_URLS) {
        try {
          const res = await fetch(url);
          if (res.ok) return await res.arrayBuffer();
        } catch {
          // try the next candidate
        }
      }
      return null;
    })();
  }
  return fontPromise;
}

const RTL_RE = /[֐-׿יִ-ﭏ]/;

function charClass(ch: string): 'R' | 'L' | 'N' {
  if (/[֐-׿יִ-ﭏ]/.test(ch)) return 'R';
  if (/[A-Za-z0-9À-ɏ]/.test(ch)) return 'L';
  return 'N'; // whitespace / punctuation — resolves to the base direction
}

/**
 * Reorder a single line from logical order into the visual (left-to-right)
 * order pdf-lib draws in. A simplified bidi: good for Hebrew text, Hebrew mixed
 * with numbers/Latin, and pure Latin (returned untouched).
 */
function reorderLine(line: string): string {
  if (!RTL_RE.test(line)) return line;

  let base: 'R' | 'L' = 'L';
  for (const ch of line) {
    const c = charClass(ch);
    if (c === 'R') { base = 'R'; break; }
    if (c === 'L') { base = 'L'; break; }
  }

  const chars = [...line];
  const classes = chars.map((ch) => {
    const c = charClass(ch);
    return c === 'N' ? base : c;
  });

  // group consecutive same-direction characters into runs
  const runs: Array<{ dir: 'R' | 'L'; text: string }> = [];
  let i = 0;
  while (i < chars.length) {
    const dir = classes[i];
    let j = i;
    while (j < chars.length && classes[j] === dir) j++;
    runs.push({ dir, text: chars.slice(i, j).join('') });
    i = j;
  }

  const visual = (r: { dir: 'R' | 'L'; text: string }) =>
    r.dir === 'R' ? [...r.text].reverse().join('') : r.text;

  if (base === 'R') {
    // RTL paragraph: emit runs right-to-left
    const out: string[] = [];
    for (let k = runs.length - 1; k >= 0; k--) out.push(visual(runs[k]));
    return out.join('');
  }
  return runs.map(visual).join('');
}

/** Reorder every line of a (possibly multi-line) string for PDF drawing. */
export function toVisualOrder(text: string): string {
  if (!RTL_RE.test(text)) return text;
  return text.split('\n').map(reorderLine).join('\n');
}
