// Upload a packaged zip to the existing Chrome Web Store item and submit it
// for review, via the Chrome Web Store API v2.
//   node tools/publish.mjs dist/page-to-pdf.zip
// Needs CWS_PUBLISHER_ID, CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET,
// CWS_REFRESH_TOKEN (see README, "Automatic releases").
import { readFileSync } from 'node:fs';

const env = (k) => process.env[k] || (() => { throw new Error(`${k} is not set`); })();
const zip = process.argv[2] ?? 'dist/page-to-pdf.zip';
const BASE = 'https://chromewebstore.googleapis.com';
const item = `publishers/${env('CWS_PUBLISHER_ID')}/items/${env('CWS_EXTENSION_ID')}`;

async function call(url, init) {
  const res = await fetch(url, init);
  const body = await res.text();
  console.log(`${init?.method ?? 'GET'} ${url.replace(BASE, '')} → ${res.status} ${body}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body ? JSON.parse(body) : {};
}

const { access_token: token } = await call('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    client_id: env('CWS_CLIENT_ID'),
    client_secret: env('CWS_CLIENT_SECRET'),
    refresh_token: env('CWS_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  }),
});
const auth = { Authorization: `Bearer ${token}` };

let upload = await call(`${BASE}/upload/v2/${item}:upload`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/zip' },
  body: readFileSync(zip),
});
let state = upload.uploadState;
for (let i = 0; state === 'UPLOAD_IN_PROGRESS' && i < 30; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  state = (await call(`${BASE}/v2/${item}:fetchStatus`, { headers: auth })).lastAsyncUploadState;
}
if (state !== 'SUCCEEDED') throw new Error(`upload ended in state ${state}`);

await call(`${BASE}/v2/${item}:publish`, { method: 'POST', headers: auth });
console.log('Submitted for review.');
