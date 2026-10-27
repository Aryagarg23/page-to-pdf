import { DEFAULTS, capturePdf, pdfFilename } from './core.js';

const OFFSCREEN = 'src/offscreen.html';

async function loadOptions() {
  const { opts } = await chrome.storage.sync.get('opts');
  return { ...DEFAULTS, ...opts };
}

// Service workers have no URL.createObjectURL; the offscreen page makes the blob URL.
async function blobUrl(chunks) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN,
      reasons: ['BLOBS'],
      justification: 'Turn the captured PDF bytes into a blob URL for chrome.downloads',
    });
  }
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'blob-url', chunks });
  if (!res?.url) throw new Error('offscreen document did not return a blob URL');
  return res.url;
}

function revokeWhenDone(downloadId, url) {
  const onChanged = (delta) => {
    if (delta.id !== downloadId || !delta.state) return;
    if (delta.state.current === 'in_progress') return;
    chrome.downloads.onChanged.removeListener(onChanged);
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
  };
  chrome.downloads.onChanged.addListener(onChanged);
}

export async function savePdf(tabId, opts) {
  const o = { ...DEFAULTS, ...opts };
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    throw new Error(`Can't capture this tab (${e.message}). Chrome blocks extensions on chrome:// pages, the Web Store, and tabs with DevTools open.`);
  }
  let capture;
  try {
    capture = await capturePdf((method, params) => chrome.debugger.sendCommand(target, method, params), o);
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
  const url = await blobUrl(capture.chunks);
  const filename = pdfFilename(capture.title, capture.url);
  const downloadId = await chrome.downloads.download({ url, filename, saveAs: o.saveAs, conflictAction: 'uniquify' });
  revokeWhenDone(downloadId, url);
  return downloadId;
}
// Reachable from the extension's service-worker console and the e2e test.
globalThis.savePdf = savePdf;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background' || msg.type !== 'save') return;
  savePdf(msg.tabId, msg.opts).then(
    (downloadId) => sendResponse({ ok: true, downloadId }),
    (e) => sendResponse({ ok: false, error: e.message }),
  );
  return true;
});

async function flashBadge(tabId, text, color) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  if (text !== '…') setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 4000);
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'save-pdf' || !tab?.id) return;
  await flashBadge(tab.id, '…', '#666');
  try {
    await savePdf(tab.id, await loadOptions());
    await flashBadge(tab.id, '✓', '#1a7f37');
  } catch (e) {
    console.error(e);
    await flashBadge(tab.id, '!', '#c62828');
  }
});
