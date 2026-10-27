// Page → PDF over the Chrome DevTools Protocol. No `chrome.*` here, so the
// same code runs in the extension and in node tests against real Chrome.
// `send(method, params)` is any CDP command sender bound to one page.

export const DEFAULTS = {
  layout: 'pages', // 'pages' | 'single' (one tall page, no breaks)
  paper: 'letter', // key of PAPER | 'window' (one screen per page) | 'custom'
  customWidth: 8.5, // inches, paper: 'custom'
  customHeight: 11,
  landscape: false,
  scale: 100, // percent, 10–200
  delay: 0, // seconds to wait after loading, so animations can finish
  media: 'screen', // 'screen' (what you see) | 'print' (site's print stylesheet)
  backgrounds: true,
  margins: 'none', // 'none' | 'normal'
  loadLazy: true,
  saveAs: false,
};

export const PAPER = {
  letter: [8.5, 11],
  a4: [8.27, 11.69],
  legal: [8.5, 14],
  slide169: [13.333, 7.5],
  slide43: [10, 7.5],
};

const PX_PER_IN = 96;
// Acrobat and most viewers refuse pages taller than 200in (14400pt).
export const MAX_PAGE_IN = 200;
// Page.printToPDF rejects scale outside 0.1–2.
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const MAX_DELAY_S = 30;
const NORMAL_MARGIN_IN = 0.4;

// Scroll the whole page so lazy images / infinite-ish sections render,
// wait for images, then put the scroll position back.
export const LOAD_LAZY = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const start = [scrollX, scrollY];
  document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]').forEach(el => { el.loading = 'eager'; });
  const deadline = Date.now() + 15000;
  let y = 0;
  while (Date.now() < deadline) {
    const bottom = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) - innerHeight;
    if (y >= bottom) break;
    y = Math.min(y + innerHeight, bottom);
    scrollTo(start[0], y);
    await sleep(120);
  }
  const pending = [...document.images].filter(img => !img.complete);
  const loaded = img => new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });
  await Promise.race([Promise.all(pending.map(loaded)), sleep(3000)]);
  scrollTo(start[0], start[1]);
  await sleep(50);
})()`;

export const MEASURE = `({
  vw: innerWidth,
  vh: innerHeight,
  width: document.documentElement.clientWidth,
  height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
})`;

const PLAIN_PAPER = new Set(['letter', 'a4', 'legal']);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : fallback);

export const waitMs = (opts) => Math.round(clamp(num(opts.delay, 0), 0, MAX_DELAY_S) * 1000);

// Inches, before margins. Landscape puts the long side across.
export function paperSize(opts, metrics) {
  const o = { ...DEFAULTS, ...opts };
  let w, h;
  if (o.paper === 'window') [w, h] = [metrics.vw / PX_PER_IN, metrics.vh / PX_PER_IN];
  else if (o.paper === 'custom') {
    w = clamp(num(o.customWidth, DEFAULTS.customWidth), 1, MAX_PAGE_IN);
    h = clamp(num(o.customHeight, DEFAULTS.customHeight), 1, MAX_PAGE_IN);
  } else [w, h] = PAPER[o.paper] ?? PAPER.letter;
  if (o.landscape && h > w) [w, h] = [h, w];
  return [w, h];
}

export function printParams(opts, metrics) {
  const o = { ...DEFAULTS, ...opts };
  const base = { printBackground: o.backgrounds, transferMode: 'ReturnAsStream' };
  const userScale = clamp(num(o.scale, 100) / 100, MIN_SCALE, MAX_SCALE);

  if (o.layout === 'single') {
    const wIn = metrics.width / PX_PER_IN;
    // +2px absorbs px→pt rounding that otherwise spills a blank second page.
    const hIn = (metrics.height + 2) / PX_PER_IN;
    const scale = clamp(Math.min(userScale, MAX_PAGE_IN / hIn), MIN_SCALE, MAX_SCALE);
    return {
      ...base,
      landscape: false,
      preferCSSPageSize: false,
      scale,
      paperWidth: wIn * scale,
      paperHeight: Math.min(hIn * scale, MAX_PAGE_IN),
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    };
  }

  const [w, h] = paperSize(o, metrics);
  const m = o.margins === 'normal' ? NORMAL_MARGIN_IN : 0;
  return {
    ...base,
    // Hand CDP portrait dimensions plus the flag. Wide dimensions with landscape:false
    // get rotated back to portrait when the site's @page says portrait.
    landscape: w > h,
    // Plain paper: the site's @page wins. Other sizes: our injected @page (forcedPageRule) wins.
    preferCSSPageSize: true,
    scale: userScale,
    paperWidth: Math.min(w, h),
    paperHeight: Math.max(w, h),
    marginTop: m, marginBottom: m, marginLeft: m, marginRight: m,
  };
}

async function evaluate(send, expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(`page script failed: ${d.exception?.description ?? d.text}`);
  }
  return res.result.value;
}

// Returns { chunks, title, url }. chunks are base64 strings, each independently
// decodable. title/url come from the page itself, so naming needs no "tabs" permission.
// Emulated media is not restored: CDP overrides die with the debugger session.
export async function capturePdf(send, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  await send('Emulation.setEmulatedMedia', { media: o.media });
  if (o.loadLazy) await evaluate(send, LOAD_LAZY);
  const ms = waitMs(o);
  // Waits in the page's own clock, after scrolling has triggered reveal animations.
  if (ms) await evaluate(send, `new Promise(r => setTimeout(r, ${ms}))`);
  const metrics = await evaluate(send, MEASURE);
  const { title, url } = await evaluate(send, '({ title: document.title, url: location.href })');
  const rule = forcedPageRule(o, metrics);
  if (rule) await evaluate(send, INJECT_PAGE_RULE(rule));
  let stream;
  try {
    ({ stream } = await send('Page.printToPDF', printParams(o, metrics)));
  } finally {
    // The rule is page DOM, not CDP state, so detaching would leave it behind.
    if (rule) await evaluate(send, REMOVE_PAGE_RULE).catch(() => {});
  }
  return { chunks: await readStream(send, stream), title, url };
}

const PAGE_RULE_ID = 'p2p-page-size';
const INJECT_PAGE_RULE = (css) => `(() => {
  const s = document.createElement('style');
  s.id = '${PAGE_RULE_ID}';
  s.textContent = ${JSON.stringify(css)};
  document.documentElement.append(s);
})()`;
const REMOVE_PAGE_RULE = `document.getElementById('${PAGE_RULE_ID}')?.remove()`;

// Slide, window and custom sizes are deliberate choices, but a site's own
// @page (size and orientation) beats printToPDF's paper settings. A later
// @page rule of ours beats the site's. Plain paper leaves the site in charge.
export function forcedPageRule(opts, metrics) {
  const o = { ...DEFAULTS, ...opts };
  if (o.layout === 'single' || PLAIN_PAPER.has(o.paper)) return null;
  const [w, h] = paperSize(o, metrics);
  const m = o.margins === 'normal' ? NORMAL_MARGIN_IN : 0;
  return `@page { size: ${w}in ${h}in; margin: ${m}in; }`;
}

async function readStream(send, handle) {
  const chunks = [];
  try {
    for (;;) {
      const { data, base64Encoded, eof } = await send('IO.read', { handle, size: 1 << 20 });
      if (data) {
        if (!base64Encoded) throw new Error('PDF stream came back as text, expected base64');
        chunks.push(data);
      }
      if (eof) return chunks;
    }
  } finally {
    await send('IO.close', { handle }).catch(() => {});
  }
}

export function decodeChunks(chunks) {
  const parts = chunks.map((c) => Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function pdfFilename(title, url) {
  let base = (title ?? '').trim();
  if (!base) {
    try { base = new URL(url).hostname; } catch { base = ''; }
  }
  base = base
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return `${base || 'page'}.pdf`;
}
