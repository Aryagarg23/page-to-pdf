import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { capturePdf, decodeChunks } from '../src/core.js';
import { evalValue, launch, pdfPages, serve } from './helpers.js';

let chrome, server;
before(async () => { [chrome, server] = await Promise.all([launch(), serve()]); });
after(async () => { await chrome?.close(); server?.close(); });

test('paged mode: real Chrome yields a multi-page Letter PDF', async () => {
  const page = await chrome.openPage(`${server.base}/long`);
  const pdf = pdfPages(decodeChunks((await capturePdf(page.send, { loadLazy: false })).chunks));
  assert.equal(pdf.header, '%PDF-');
  assert.ok(pdf.count > 1, `expected several pages, got ${pdf.count}`);
  for (const box of pdf.boxes) assert.deepEqual(box, { width: 612, height: 792 });
});

test('single mode: the whole page lands on exactly one page of matching height', async () => {
  const page = await chrome.openPage(`${server.base}/long`);
  const height = await evalValue(page.send, 'document.documentElement.scrollHeight');
  const pdf = pdfPages(decodeChunks((await capturePdf(page.send, { layout: 'single' })).chunks));
  assert.equal(pdf.count, 1);
  assert.equal(pdf.boxes.length, 1);
  assert.ok(Math.abs(pdf.boxes[0].height - (height + 2) * 0.75) < 1, `box ${pdf.boxes[0].height}pt vs page ${height}px`);
});

test('lazy loading scrolls to the bottom and puts the reader back where they were', async () => {
  const page = await chrome.openPage(`${server.base}/long`);
  await evalValue(page.send, 'scrollTo(0, 300)');
  assert.equal(await evalValue(page.send, 'window.__seen'), false);
  await capturePdf(page.send, { loadLazy: true });
  assert.equal(await evalValue(page.send, 'window.__seen'), true);
  assert.equal(await evalValue(page.send, 'scrollY'), 300);
});

test('emulated media dies with the debugger session, which is why capturePdf never restores it', async () => {
  const page = await chrome.openPage(`${server.base}/long`);
  await page.send('Emulation.setEmulatedMedia', { media: 'print' });
  assert.equal(await evalValue(page.send, "matchMedia('print').matches"), true);
  await page.detach();
  const again = await chrome.attach(page.targetId);
  assert.equal(await evalValue(again.send, "matchMedia('print').matches"), false);
});
