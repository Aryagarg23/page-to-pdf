import { decodeChunks } from './core.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'blob-url') {
    const blob = new Blob([decodeChunks(msg.chunks)], { type: 'application/pdf' });
    sendResponse({ url: URL.createObjectURL(blob) });
  } else if (msg.type === 'revoke') {
    URL.revokeObjectURL(msg.url);
    sendResponse({});
  }
});
