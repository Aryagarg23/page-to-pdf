// Page → PDF over the Chrome DevTools Protocol. No `chrome.*` here, so the
// same code runs in the extension and in node tests against real Chrome.
// `send(method, params)` is any CDP command sender bound to one page.

export const DEFAULTS = {
  layout: 'pages', // 'pages' | 'single' (one tall page, no breaks)
  paper: 'letter', // key of PAPER
  landscape: false,
  media: 'screen', // 'screen' (what you see) | 'print' (site's print stylesheet)
  backgrounds: true,
  margins: 'none', // 'none' | 'normal'
  loadLazy: true,
  saveAs: false,
};

export const PAPER = { letter: [8.5, 11], a4: [8.27, 11.69], legal: [8.5, 14] };

const PX_PER_IN = 96;
// Acrobat and most viewers refuse pages taller than 200in (14400pt).
export const MAX_PAGE_IN = 200;
// Page.printToPDF rejects scale below 0.1.
const MIN_SCALE = 0.1;
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
  width: document.documentElement.clientWidth,
  height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
})`;

export function printParams(opts, metrics) {
  const o = { ...DEFAULTS, ...opts };
  const base = { printBackground: o.backgrounds, transferMode: 'ReturnAsStream' };

  if (o.layout === 'single') {
    const wIn = metrics.width / PX_PER_IN;
    // +2px absorbs px→pt rounding that otherwise spills a blank second page.
    const hIn = (metrics.height + 2) / PX_PER_IN;
    const scale = Math.max(MIN_SCALE, Math.min(1, MAX_PAGE_IN / hIn));
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

  const [w, h] = PAPER[o.paper] ?? PAPER.letter;
  const m = o.margins === 'normal' ? NORMAL_MARGIN_IN : 0;
  return {
    ...base,
    landscape: o.landscape,
    preferCSSPageSize: true,
    paperWidth: w,
    paperHeight: h,
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

// Returns { chunks } — base64 strings, each independently decodable.
// Emulated media is not restored: CDP overrides die with the debugger session.
export async function capturePdf(send, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  await send('Emulation.setEmulatedMedia', { media: o.media });
  if (o.loadLazy) await evaluate(send, LOAD_LAZY);
  const metrics = o.layout === 'single' ? await evaluate(send, MEASURE) : null;
  const { stream } = await send('Page.printToPDF', printParams(o, metrics));
  return { chunks: await readStream(send, stream) };
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
