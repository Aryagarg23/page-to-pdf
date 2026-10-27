import { DEFAULTS } from './core.js';

const form = document.getElementById('f');
const status = document.getElementById('status');
const button = form.querySelector('button');

function read() {
  const o = {};
  for (const key of Object.keys(DEFAULTS)) {
    const el = form.elements[key];
    if (el.type === 'checkbox') o[key] = el.checked;
    else if (el.type === 'number') o[key] = Number.isNaN(el.valueAsNumber) ? DEFAULTS[key] : el.valueAsNumber;
    else o[key] = el.value;
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

// Slides and window size already fix the orientation.
const FIXED_ORIENTATION = new Set(['slide169', 'slide43', 'window']);

function syncDisabled() {
  const single = form.elements.layout.value === 'single';
  const paper = form.elements.paper.value;
  for (const el of form.querySelectorAll('.paged')) el.classList.toggle('off', single);
  form.querySelector('.custom').hidden = paper !== 'custom';
  form.querySelector('.orient').classList.toggle('off', FIXED_ORIENTATION.has(paper));
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

document.getElementById('pick').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/picker.js'] });
    window.close();
  } catch (e) {
    say(`Can't pick on this page (${e.message})`, true);
  }
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
