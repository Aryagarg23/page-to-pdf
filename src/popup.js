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

// Show the shortcut the user actually has bound, not the suggested default.
const foot = document.querySelector('.foot');
const save = (await chrome.commands.getAll()).find((c) => c.name === 'save-pdf');
if (save?.shortcut) {
  foot.textContent = '';
  // Windows/Linux report "Alt+Shift+P"; macOS reports "⌥⇧P" with no separators.
  const sep = save.shortcut.includes('+') ? '+' : '';
  const keys = sep ? save.shortcut.split('+') : [...save.shortcut];
  keys.forEach((key, i) => {
    if (i) foot.append(sep);
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    foot.append(kbd);
  });
  foot.append(' saves with these settings');
} else {
  foot.hidden = true;
}

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
