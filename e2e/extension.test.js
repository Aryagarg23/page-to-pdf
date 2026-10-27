// Loads the unpacked extension into Chrome for Testing (branded Chrome ignores
// --load-extension) and drives the real service worker: debugger attach,
// offscreen blob URL, chrome.downloads. The page is a data: URL so the test
// needs no network.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LONG, evalValue, launch, pdfPages, waitFor } from '../test/helpers.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN = process.env.CFT_BIN;
if (!BIN) throw new Error('Set CFT_BIN to a Chrome for Testing binary (see README).');
const PAGE = `data:text/html;base64,${Buffer.from(LONG).toString('base64')}`;

let chrome, worker, downloads;
before(async () => {
  chrome = await launch({
    bin: BIN,
    args: [`--load-extension=${ROOT}`, `--disable-extensions-except=${ROOT}`],
    prepareProfile(dir) {
      downloads = join(dir, 'downloads');
      mkdirSync(join(dir, 'Default'), { recursive: true });
      mkdirSync(downloads);
      writeFileSync(join(dir, 'Default', 'Preferences'), JSON.stringify({
        download: { default_directory: downloads, prompt_for_download: false },
      }));
    },
  });
  const sw = await waitFor(async () => {
    const { targetInfos } = await chrome.send('Target.getTargets');
    return targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/src/background.js'));
  });
  worker = await chrome.attach(sw.targetId);
});
after(async () => { await chrome?.close(); });

async function saveViaWorker(opts) {
  const res = await worker.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      // No "tabs" permission, so titles are hidden; the newest tab is the test page.
      const tab = (await chrome.tabs.query({})).sort((a, b) => b.id - a.id)[0];
      const id = await savePdf(tab.id, ${JSON.stringify(opts)});
      for (;;) {
        const [d] = await chrome.downloads.search({ id });
        if (d.state === 'complete') return d.filename;
        if (d.state === 'interrupted') throw new Error('download interrupted: ' + d.error);
        await new Promise(r => setTimeout(r, 100));
      }
    })()`,
  });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return res.result.value;
}

test('extension saves the tab as one long page into Downloads, named after the title', async () => {
  const page = await chrome.openPage(PAGE);
  const file = await saveViaWorker({ layout: 'single' });
  assert.equal(basename(file), 'Long test page.pdf');
  assert.equal(dirname(file), downloads);
  const pdf = pdfPages(readFileSync(file));
  assert.equal(pdf.header, '%PDF-');
  assert.equal(pdf.count, 1);
  assert.equal(await evalValue(page.send, 'window.__seen'), true);
  await chrome.send('Target.closeTarget', { targetId: page.targetId });
});

test('extension saves paged A4 output, and a second save of the same title gets its own file', async () => {
  await chrome.openPage(PAGE);
  const file = await saveViaWorker({ paper: 'a4', loadLazy: false });
  assert.notEqual(basename(file), 'Long test page.pdf');
  const pdf = pdfPages(readFileSync(file));
  assert.ok(pdf.count > 1);
  for (const box of pdf.boxes) assert.ok(Math.abs(box.width - 595.44) < 1 && Math.abs(box.height - 841.68) < 1, JSON.stringify(box));
});

test('popup renders in Space Grotesk with saved defaults and the bound shortcut', async () => {
  const { targetInfos } = await chrome.send('Target.getTargets');
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/src/background.js'));
  const popup = await chrome.openPage(sw.url.replace('/src/background.js', '/src/popup.html'));
  const look = async (scheme) => {
    await popup.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    return evalValue(popup.send, `({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color })`);
  };
  // Site tokens: cream/ink on light, stone/bone on dark.
  assert.deepEqual(await look('light'), { bg: 'rgb(234, 228, 214)', ink: 'rgb(40, 34, 21)' });
  assert.deepEqual(await look('dark'), { bg: 'rgb(28, 28, 28)', ink: 'rgb(241, 237, 228)' });
  const state = await evalValue(popup.send, `document.fonts.ready.then(() => ({
    font: document.fonts.check("13px 'Space Grotesk'") && [...document.fonts].some(f => f.family === 'Space Grotesk' && f.status === 'loaded'),
    layout: document.querySelector('[name=layout]:checked').value,
    media: document.querySelector('[name=media]:checked').value,
    keys: [...document.querySelectorAll('.foot kbd')].map(k => k.textContent),
    foot: document.querySelector('.foot').textContent,
    radius: getComputedStyle(document.querySelector('button')).borderRadius,
  }))`);
  const mac = process.platform === 'darwin';
  assert.deepEqual(state, {
    font: true,
    layout: 'pages',
    media: 'screen',
    keys: mac ? ['⌥', '⇧', 'P'] : ['Alt', 'Shift', 'P'],
    foot: mac ? '⌥⇧P saves with these settings' : 'Alt+Shift+P saves with these settings',
    radius: '0px',
  });
});
