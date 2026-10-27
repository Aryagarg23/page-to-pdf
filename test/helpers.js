import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Minimal CDP client over Chrome's browser websocket (flat sessions).
export async function launch({ bin = CHROME, args = [], prepareProfile } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'p2p-'));
  prepareProfile?.(dir);
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check',
    // Keep test browsers out of the macOS login keychain (no "Safe Storage" password prompt).
    '--use-mock-keychain', '--password-store=basic',
    // GitHub's Ubuntu runners block Chrome's user-namespace sandbox.
    ...(process.env.CI ? ['--no-sandbox'] : []),
    ...args, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${log}`)), 20000);
    proc.stderr.on('data', (d) => {
      log += d;
      const m = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`Chrome exited (${code}):\n${log}`)));
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  async function attach(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    return {
      sessionId,
      send: (method, params) => send(method, params, sessionId),
      detach: () => send('Target.detachFromTarget', { sessionId }),
    };
  }

  async function openPage(url) {
    const { targetId } = await send('Target.createTarget', { url });
    const session = await attach(targetId);
    await waitFor(async () => {
      const r = await session.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`,
        returnByValue: true,
      });
      return r.result.value;
    });
    return { targetId, ...session };
  }

  async function close() {
    ws.close();
    proc.kill();
    if (proc.exitCode === null) await once(proc, 'exit');
    rmSync(dir, { recursive: true, force: true });
  }

  return { send, attach, openPage, close };
}

export async function waitFor(fn, { timeout = 15000, every = 100 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, every));
  }
}

export const evalValue = async (send, expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

export const LONG = `<!doctype html><title>Long test page</title>
<style>body{margin:0;font:16px sans-serif} p{height:100px;margin:0;border-bottom:1px solid #ccc}</style>
${Array.from({ length: 80 }, (_, i) => `<p>Paragraph ${i + 1}</p>`).join('')}
<div id="end" style="height:40px;background:#c00">end</div>
<script>
  window.__seen = false;
  window.__clicks = 0;
  document.addEventListener('click', () => { window.__clicks++; });
  new IntersectionObserver(([e]) => { if (e.isIntersecting) window.__seen = true; }).observe(document.getElementById('end'));
</script>`;

// Site that asks for Letter via @page.
const AT_PAGE = LONG.replace('<style>', '<style>@page { size: letter; }');

// A block that grows from 0 to 3000px over 600ms after load, like a reveal animation.
const GROW = `<!doctype html><title>Grow</title>
<style>body{margin:0} #g{height:0;background:#36c;animation:grow 600ms 100ms ease forwards}
@keyframes grow{to{height:3000px}}</style><div id="g"></div>`;

const PAGES = { '/long': LONG, '/atpage': AT_PAGE, '/grow': GROW };

export async function serve() {
  const server = createServer((req, res) => {
    if (PAGES[req.url]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGES[req.url]);
    } else {
      res.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// Chrome's PDFs keep page dictionaries uncompressed, so plain text matching works.
export function pdfPages(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const boxes = [...s.matchAll(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g)]
    .map((m) => ({ width: +m[3] - +m[1], height: +m[4] - +m[2] }));
  return { header: s.slice(0, 5), count: (s.match(/\/Type\s*\/Page\b/g) ?? []).length, boxes };
}
