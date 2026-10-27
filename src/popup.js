import { DEFAULTS } from './core.js';

const form = document.getElementById('f');
const status = document.getElementById('status');
const button = form.querySelector('button');

function read() {
  const o = {};
  for (const key of Object.keys(DEFAULTS)) {
    const el = form.elements[key];
    o[key] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}

function write(o) {
  for (const [key, value] of Object.entries(o)) {
    const el = form.elements[key];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
  }
}

function syncDisabled() {
  const single = form.elements.layout.value === 'single';
  for (const el of form.querySelectorAll('.paged')) el.classList.toggle('off', single);
}

function say(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('err', isError);
}

const { opts } = await chrome.storage.sync.get('opts');
write({ ...DEFAULTS, ...opts });
syncDisabled();

form.addEventListener('change', () => {
  syncDisabled();
  chrome.storage.sync.set({ opts: read() });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  button.disabled = true;
  say('Capturing…');
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'save', tabId: tab.id, opts: read() });
  button.disabled = false;
  if (res?.ok) say('Saved to Downloads.');
  else say(res?.error ?? 'Failed.', true);
});
