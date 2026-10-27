// Loads the unpacked extension into Chrome for Testing (branded Chrome ignores
// --load-extension) and drives the real service worker: debugger attach,
// offscreen blob URL, chrome.downloads.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evalValue, launch, pdfPages, serve, waitFor } from '../test/helpers.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN = process.env.CFT_BIN;
if (!BIN) throw new Error('Set CFT_BIN to a Chrome for Testing binary (see README).');

let chrome, server, worker, downloads;
before(async () => {
  server = await serve();
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
after(async () => { await chrome?.close(); server?.close(); });

async function saveViaWorker(opts) {
  const res = await worker.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(`${server.base}/*`)} });
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
  const page = await chrome.openPage(`${server.base}/long`);
  const file = await saveViaWorker({ layout: 'single' });
  assert.equal(basename(file), 'Long test page.pdf');
  assert.equal(dirname(file), downloads);
  const pdf = pdfPages(readFileSync(file));
  assert.equal(pdf.header, '%PDF-');
  assert.equal(pdf.count, 1);
  assert.equal(await evalValue(page.send, 'window.__seen'), true);
  await page.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
});

test('extension saves paged A4 output', async () => {
  await chrome.openPage(`${server.base}/long`);
  const file = await saveViaWorker({ paper: 'a4', loadLazy: false });
  const pdf = pdfPages(readFileSync(file));
  assert.ok(pdf.count > 1);
  for (const box of pdf.boxes) assert.ok(Math.abs(box.width - 595.44) < 1 && Math.abs(box.height - 841.68) < 1, JSON.stringify(box));
});
