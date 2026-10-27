import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOAD_LAZY, MAX_PAGE_IN, MEASURE, capturePdf, decodeChunks, pdfFilename, printParams } from '../src/core.js';

test('single page is sized to the content at viewport width, with no margins', () => {
  const p = printParams({ layout: 'single', landscape: true, margins: 'normal' }, { width: 1200, height: 5000 });
  assert.equal(p.scale, 1);
  assert.equal(p.paperWidth, 1200 / 96);
  assert.equal(p.paperHeight, 5002 / 96);
  assert.equal(p.landscape, false);
  assert.deepEqual([p.marginTop, p.marginBottom, p.marginLeft, p.marginRight], [0, 0, 0, 0]);
});

test('single page taller than 200in is scaled down to stay openable in PDF viewers', () => {
  const p = printParams({ layout: 'single' }, { width: 960, height: 96 * 1000 - 2 });
  assert.ok(Math.abs(p.scale - 0.2) < 1e-9);
  assert.ok(Math.abs(p.paperHeight - MAX_PAGE_IN) < 1e-9);
  assert.ok(Math.abs(p.paperWidth - 2) < 1e-9);
});

test('single page scale never drops below the 0.1 printToPDF floor', () => {
  const p = printParams({ layout: 'single' }, { width: 960, height: 96 * 5000 });
  assert.equal(p.scale, 0.1);
  assert.equal(p.paperHeight, MAX_PAGE_IN);
});

test('paged mode uses chosen paper, orientation and margins and honours @page', () => {
  const p = printParams({ paper: 'a4', landscape: true, margins: 'normal', backgrounds: false }, null);
  assert.equal(p.paperWidth, 8.27);
  assert.equal(p.paperHeight, 11.69);
  assert.equal(p.landscape, true);
  assert.equal(p.marginLeft, 0.4);
  assert.equal(p.printBackground, false);
  assert.equal(p.preferCSSPageSize, true);
  assert.equal(p.transferMode, 'ReturnAsStream');
});

function fakeSend({ failRead = false } = {}) {
  const calls = [];
  const send = async (method, params) => {
    calls.push({ method, params });
    if (method === 'Runtime.evaluate') {
      if (params.expression === MEASURE) return { result: { value: { width: 800, height: 3000 } } };
      if (params.expression.includes('document.title')) return { result: { value: { title: 'T', url: 'https://x.test/' } } };
      return { result: { value: undefined } };
    }
    if (method === 'Page.printToPDF') return { stream: 'h1' };
    if (method === 'IO.read') {
      if (failRead) throw new Error('boom');
      const n = calls.filter((c) => c.method === 'IO.read').length;
      return { data: btoa(`part${n}`), base64Encoded: true, eof: n === 2 };
    }
    return {};
  };
  return { send, calls };
}

test('media is emulated before measuring, so the measured height matches what prints', async () => {
  const { send, calls } = fakeSend();
  await capturePdf(send, { layout: 'single', media: 'print' });
  const order = calls.map((c) => c.params?.expression === MEASURE ? 'measure' : c.params?.expression === LOAD_LAZY ? 'lazy' : c.method);
  assert.deepEqual(order.slice(0, 5), ['Emulation.setEmulatedMedia', 'lazy', 'measure', 'Runtime.evaluate', 'Page.printToPDF']);
  assert.equal(calls[0].params.media, 'print');
  assert.equal(calls[4].params.paperHeight, 3002 / 96);
});

test('stream is read to eof and returned as decodable chunks', async () => {
  const { send, calls } = fakeSend();
  const { chunks, title, url } = await capturePdf(send, { loadLazy: false });
  assert.equal(new TextDecoder().decode(decodeChunks(chunks)), 'part1part2');
  assert.deepEqual([title, url], ['T', 'https://x.test/']);
  assert.ok(!calls.some((c) => c.params?.expression === LOAD_LAZY));
  assert.equal(calls.at(-1).method, 'IO.close');
});

test('stream handle is closed even when reading fails, so Chrome does not leak it', async () => {
  const { send, calls } = fakeSend({ failRead: true });
  await assert.rejects(capturePdf(send), /boom/);
  assert.deepEqual(calls.at(-1), { method: 'IO.close', params: { handle: 'h1' } });
});

test('a throwing page script surfaces as an error instead of a silent bad PDF', async () => {
  const send = async (method) =>
    method === 'Runtime.evaluate' ? { exceptionDetails: { text: 'x', exception: { description: 'TypeError: nope' } } } : {};
  await assert.rejects(capturePdf(send), /page script failed: TypeError: nope/);
});

test('decodeChunks joins independently encoded chunks byte-exactly', () => {
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
  const chunks = [bytes.slice(0, 333), bytes.slice(333, 700), bytes.slice(700)]
    .map((b) => Buffer.from(b).toString('base64'));
  assert.deepEqual(decodeChunks(chunks), bytes);
});

test('filenames are safe for chrome.downloads', () => {
  assert.equal(pdfFilename('My Design | Canva', 'https://canva.com'), 'My Design Canva.pdf');
  assert.equal(pdfFilename('a/b\\c:d*e?"f<g>h', ''), 'a b c d e f g h.pdf');
  assert.equal(pdfFilename('  ..hidden.. ', ''), 'hidden.pdf');
  assert.equal(pdfFilename('', 'https://example.org/x'), 'example.org.pdf');
  assert.equal(pdfFilename('', 'not a url'), 'page.pdf');
  assert.equal(pdfFilename('x'.repeat(300), '').length, 124);
});
