// Inspect mode: hover to outline, click to hide. Hidden elements get
// display:none through an attribute, so the page and the PDF agree on what's
// left. Injected with chrome.scripting (classic script, isolated world);
// injecting again just turns the picker back on.
(() => {
  if (window.__p2pPicker) {
    window.__p2pPicker.start();
    return;
  }

  const HIDDEN = 'data-p2p-hidden';
  const hideRule = document.createElement('style');
  hideRule.textContent = `[${HIDDEN}] { display: none !important; }`;
  (document.head || document.documentElement).append(hideRule);

  const host = document.createElement('p2p-picker');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; border-radius: 0; }
      .ui {
        --paper: hsl(40, 33%, 88%); --ink: hsl(40, 30%, 12%); --rule: hsl(40, 25%, 70%); --emphasis: #3b42db;
        font: 400 12px/1.4 'Space Grotesk', system-ui, sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        .ui { --paper: hsl(279, 0%, 11%); --ink: hsl(40, 30%, 92%); --rule: hsl(0, 0%, 25%); --emphasis: #6f76ec; }
      }
      .box {
        position: fixed; z-index: 2147483646; pointer-events: none;
        outline: 2px solid var(--emphasis); background: color-mix(in srgb, var(--emphasis) 12%, transparent);
        transition: all 120ms ease;
      }
      .tag {
        position: absolute; left: -2px; bottom: 100%; padding: 1px 5px; white-space: nowrap;
        background: var(--emphasis); color: #fff; font-size: 11px;
      }
      .box.below .tag { bottom: auto; top: 100%; }
      .bar {
        position: fixed; z-index: 2147483647; left: 50%; bottom: 16px; transform: translateX(-50%);
        display: flex; align-items: center; gap: 6px; padding: 8px;
        background: var(--paper); color: var(--ink); border: 1px solid var(--ink);
      }
      .eyebrow { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; opacity: 0.55; padding: 0 4px; }
      .count { font-variant-numeric: tabular-nums; padding-right: 6px; border-right: 1px solid var(--rule); margin-right: 2px; }
      button {
        font: inherit; color: var(--ink); background: transparent; border: 1px solid var(--rule);
        padding: 5px 9px; cursor: pointer; transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
      }
      button:hover:not(:disabled) { background: var(--ink); color: var(--paper); border-color: var(--ink); }
      button:disabled { opacity: 0.4; cursor: default; }
      button.solid { background: var(--ink); color: var(--paper); border-color: var(--ink); font-weight: 500; }
      button.solid:hover { background: var(--emphasis); border-color: var(--emphasis); }
      .tip { opacity: 0.55; padding: 0 4px; }
      @media (prefers-reduced-motion: reduce) { .box, button { transition: none; } }
    </style>
    <div class="ui">
      <div class="box" hidden><span class="tag"></span></div>
      <div class="bar" role="toolbar" aria-label="Hide elements">
        <span class="eyebrow">Hide</span>
        <span class="count">0 hidden</span>
        <button data-act="undo">Undo</button>
        <button data-act="clear">Show all</button>
        <button data-act="save" class="solid">Save PDF</button>
        <button data-act="done">Done</button>
        <span class="tip">Click to hide · ↑↓ bigger/smaller · Esc</span>
      </div>
    </div>`;

  const box = root.querySelector('.box');
  const tag = root.querySelector('.tag');
  const count = root.querySelector('.count');
  const undoBtn = root.querySelector('[data-act=undo]');
  const clearBtn = root.querySelector('[data-act=clear]');

  const hidden = [];
  let current = null;
  let trail = []; // children walked up from, so ↓ can come back down
  let active = false;

  const pickable = (el) => el instanceof Element && el !== host && el !== document.documentElement && el !== document.body;

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    else if (typeof el.className === 'string' && el.className.trim()) s += `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
    const r = el.getBoundingClientRect();
    return `${s}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  function highlight(el) {
    current = el;
    if (!el) { box.hidden = true; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    box.classList.toggle('below', r.top < 20);
    tag.textContent = describe(el);
    box.hidden = false;
  }

  function refresh() {
    count.textContent = `${hidden.length} hidden`;
    undoBtn.disabled = clearBtn.disabled = hidden.length === 0;
  }

  function hide(el) {
    el.setAttribute(HIDDEN, '');
    hidden.push(el);
    trail = [];
    highlight(null);
    refresh();
  }

  function undo() {
    hidden.pop()?.removeAttribute(HIDDEN);
    refresh();
  }

  function clear() {
    while (hidden.length) undo();
  }

  const fromPage = (e) => !e.composedPath().includes(host);

  function onMove(e) {
    if (!fromPage(e)) return;
    trail = [];
    highlight(pickable(e.target) ? e.target : null);
  }

  // Swallow the whole press so links, buttons and the page's own handlers don't fire.
  function onPress(e) {
    if (!fromPage(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') {
      const el = current ?? (pickable(e.target) ? e.target : null);
      if (el) hide(el);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowUp' && current && pickable(current.parentElement)) {
      trail.push(current);
      highlight(current.parentElement);
    } else if (e.key === 'ArrowDown' && trail.length) highlight(trail.pop());
    else if (e.key === 'Enter' && current) hide(current);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  const onScroll = () => highlight(current);

  root.querySelector('.bar').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'undo') undo();
    else if (act === 'clear') clear();
    else if (act === 'done') stop();
    else if (act === 'save') {
      stop();
      chrome.runtime.sendMessage({ target: 'background', type: 'save' });
    }
  });

  const PRESS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];

  function start() {
    if (active) return;
    active = true;
    document.documentElement.append(host);
    document.addEventListener('mousemove', onMove, true);
    for (const t of PRESS) document.addEventListener(t, onPress, true);
    document.addEventListener('keydown', onKey, true);
    addEventListener('scroll', onScroll, true);
    refresh();
  }

  function stop() {
    if (!active) return;
    active = false;
    highlight(null);
    host.remove();
    document.removeEventListener('mousemove', onMove, true);
    for (const t of PRESS) document.removeEventListener(t, onPress, true);
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', onScroll, true);
  }

  window.__p2pPicker = { start, stop, undo, clear, get hidden() { return hidden.length; }, get active() { return active; } };
  start();
})();
