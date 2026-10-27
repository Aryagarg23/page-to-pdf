// Renders the toolbar icons and the Chrome Web Store images with headless Chrome.
//   node tools/render-assets.mjs            → icons/icon{16,32,48,128}.png
//   CFT_BIN=… node tools/render-assets.mjs  → also store/*.png (needs the extension loaded)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME, launch, waitFor } from '../test/helpers.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(join(ROOT, 'icons/icon.svg'), 'utf8');
const dataUrl = (html) => `data:text/html;base64,${Buffer.from(html).toString('base64')}`;
const fontUrl = `data:font/woff2;base64,${readFileSync(join(ROOT, 'src/fonts/space-grotesk-v22-latin.woff2')).toString('base64')}`;

async function shoot(page, width, height, { scale = 1, dark = false } = {}) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  // Wait out the popup's 150ms color transitions that the scheme switch just started.
  await page.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => new Promise(r => setTimeout(r, 400)))', awaitPromise: true });
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  return Buffer.from(data, 'base64');
}

async function icons() {
  const chrome = await launch({ bin: CHROME });
  try {
    for (const size of [16, 32, 48, 128]) {
      const page = await chrome.openPage(dataUrl(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`));
      writeFileSync(join(ROOT, `icons/icon${size}.png`), await shoot(page, size, size));
    }
  } finally {
    await chrome.close();
  }
}

const FRAME = (popupPng, popupW) => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:SG;src:url(${fontUrl});font-weight:300 700}
html,body{margin:0;width:1280px;height:800px;background:#eae4d6;color:#282215;font-family:SG,sans-serif}
.wrap{display:grid;grid-template-columns:1fr ${popupW}px;gap:72px;align-items:center;height:100%;padding:0 96px;box-sizing:border-box}
p{margin:0;font-size:15px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;opacity:.55}
h1{margin:18px 0 22px;font-size:76px;font-weight:500;line-height:.95;letter-spacing:-.05em}
li{font-size:22px;line-height:1.6}
ul{margin:0;padding:0;list-style:none;border-top:2px solid #282215;padding-top:18px}
img{width:${popupW}px;border:1px solid #c6b99f;display:block}
</style><div class="wrap"><div><p>Page → PDF</p><h1>Save any page<br>as a PDF.</h1>
<ul><li>Pages, or one long page with no breaks</li><li>Looks like the screen, or the site's print style</li><li>No account. Nothing leaves your browser.</li></ul></div>
<img src="data:image/png;base64,${popupPng.toString('base64')}"></div>`;

const PROMO = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:SG;src:url(${fontUrl});font-weight:300 700}
html,body{margin:0;width:440px;height:280px;background:#eae4d6;color:#282215;font-family:SG,sans-serif}
.wrap{display:flex;gap:28px;align-items:center;height:100%;padding:0 36px;box-sizing:border-box}
svg{width:104px;height:104px;flex:none;outline:1px solid #c6b99f}
p{margin:0;font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;opacity:.55}
h1{margin:8px 0 0;font-size:36px;font-weight:500;line-height:.95;letter-spacing:-.05em}
</style><div class="wrap">${svg}<div><p>Page → PDF</p><h1>Save any page as a PDF.</h1></div></div>`;

async function store(bin) {
  mkdirSync(join(ROOT, 'store'), { recursive: true });
  const chrome = await launch({ bin, args: [`--load-extension=${ROOT}`, `--disable-extensions-except=${ROOT}`] });
  try {
    const sw = await waitFor(async () => {
      const { targetInfos } = await chrome.send('Target.getTargets');
      return targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/src/background.js'));
    });
    const popupUrl = sw.url.replace('/src/background.js', '/src/popup.html');
    for (const dark of [false, true]) {
      const popup = await chrome.openPage(popupUrl);
      const scale = 1.6;
      await popup.send('Emulation.setDeviceMetricsOverride', { width: 296, height: 400, deviceScaleFactor: scale, mobile: false });
      const height = (await popup.send('Runtime.evaluate', { expression: 'document.body.scrollHeight', returnByValue: true })).result.value;
      const png = await shoot(popup, 296, height, { scale, dark });
      writeFileSync(join(ROOT, `store/popup-${dark ? 'dark' : 'light'}.png`), png);
      if (!dark) {
        const frame = await chrome.openPage(dataUrl(FRAME(png, 380)));
        writeFileSync(join(ROOT, 'store/screenshot-1280x800.png'), await shoot(frame, 1280, 800));
      }
    }
    const promo = await chrome.openPage(dataUrl(PROMO));
    writeFileSync(join(ROOT, 'store/promo-440x280.png'), await shoot(promo, 440, 280));
  } finally {
    await chrome.close();
  }
}

await icons();
if (process.env.CFT_BIN) await store(process.env.CFT_BIN);
