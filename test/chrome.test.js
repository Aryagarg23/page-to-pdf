import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { capturePdf, decodeChunks } from '../src/core.js';
import { readFileSync } from 'node:fs';
import { evalValue, launch, pdfPages, serve } from './helpers.js';

const PICKER = readFileSync(new URL('../src/picker.js', import.meta.url), 'utf8');
const pdfOf = async (page, opts) => pdfPages(decodeChunks((await capturePdf(page.send, { loadLazy: false, ...opts })).chunks));
const near = (a, b) => Math.abs(a - b) < 1;

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

test('landscape A4 comes out landscape', async () => {
  const page = await chrome.openPage(`${server.base}/long`);
  const pdf = await pdfOf(page, { paper: 'a4', landscape: true });
  for (const box of pdf.boxes) assert.ok(near(box.width, 841.68) && near(box.height, 595.44), JSON.stringify(box));
});

test('scale 50% fits more on each page', async () => {
  const page = await chrome.openPage(`${server.base}/long`);
  const full = (await pdfOf(page, {})).count;
  const half = (await pdfOf(page, { scale: 50 })).count;
  assert.ok(half < full, `50%: ${half} pages, 100%: ${full}`);
});

test('window size gives one screen per page', async () => {
  const page = await chrome.openPage(`${server.base}/long`);
  const [vw, vh] = await evalValue(page.send, '[innerWidth, innerHeight]');
  const pdf = await pdfOf(page, { paper: 'window' });
  assert.ok(near(pdf.boxes[0].width, vw * 0.75) && near(pdf.boxes[0].height, vh * 0.75), JSON.stringify([pdf.boxes[0], vw, vh]));
});

test("a site's @page wins over plain paper but not over a slide preset", async () => {
  const page = await chrome.openPage(`${server.base}/atpage`);
  const a4 = await pdfOf(page, { paper: 'a4' });
  assert.ok(near(a4.boxes[0].width, 612) && near(a4.boxes[0].height, 792), JSON.stringify(a4.boxes[0]));
  const slide = await pdfOf(page, { paper: 'slide169' });
  assert.ok(near(slide.boxes[0].width, 960) && near(slide.boxes[0].height, 540), JSON.stringify(slide.boxes[0]));
  assert.equal(await evalValue(page.send, "document.getElementById('p2p-page-size')"), null);
});

test('waiting lets an animation finish before the page is measured', async () => {
  const quick = await chrome.openPage(`${server.base}/grow`);
  const early = await pdfOf(quick, { layout: 'single' });
  const slow = await chrome.openPage(`${server.base}/grow`);
  const late = await pdfOf(slow, { layout: 'single', delay: 1 });
  assert.ok(near(late.boxes[0].height, 3002 * 0.75), `waited: ${late.boxes[0].height}pt`);
  assert.ok(early.boxes[0].height < 3000 * 0.75 - 10, `no wait: ${early.boxes[0].height}pt`);
});

async function click(page, x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function key(page, k) {
  const code = { Escape: 27, ArrowUp: 38, ArrowDown: 40, Enter: 13 }[k];
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
}

test('inspect mode: a clicked element is gone from the PDF, and the page never sees the click', async () => {
  const page = await chrome.openPage(`${server.base}/long`);
  const before = (await pdfOf(page, { layout: 'single' })).boxes[0].height;
  await evalValue(page.send, PICKER);
  await click(page, 40, 150); // Paragraph 2 (each is 101px tall)
  assert.equal(await evalValue(page.send, "document.querySelector('[data-p2p-hidden]')?.textContent"), 'Paragraph 2');
  assert.equal(await evalValue(page.send, 'window.__clicks'), 0);
  await key(page, 'Escape');
  assert.equal(await evalValue(page.send, "document.querySelector('p2p-picker')"), null);
  const after = (await pdfOf(page, { layout: 'single' })).boxes[0].height;
  assert.ok(near(before - after, 101 * 0.75), `before ${before}pt, after ${after}pt`);
});

test('inspect mode: ↑ widens, ↓ comes back, undo restores, and stopping hands clicks back to the page', async () => {
  const page = await chrome.openPage(`${server.base}/long`);
  await evalValue(page.send, PICKER);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 40, y: 150 });
  await key(page, 'ArrowUp'); // body is never pickable, so it stays on the paragraph
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  assert.equal(await evalValue(page.send, 'window.__p2pPicker.hidden'), 1);
  await evalValue(page.send, 'window.__p2pPicker.undo()');
  assert.equal(await evalValue(page.send, "document.querySelectorAll('[data-p2p-hidden]').length"), 0);
  await evalValue(page.send, 'window.__p2pPicker.stop()');
  await click(page, 40, 150);
  assert.equal(await evalValue(page.send, 'window.__clicks'), 1);
});
