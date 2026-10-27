# Page to PDF

Chrome extension that saves the current tab as a PDF. No account, no server, nothing leaves the browser.

It drives Chrome's own PDF renderer (`Page.printToPDF` over the DevTools protocol via `chrome.debugger`), so text stays selectable and vector, and there is no print dialog.

## Install

1. `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → pick this folder.
3. Pin it. Click it on any page, or press **Alt+Shift+P** to save with your last settings.

Chrome shows a "Page to PDF started debugging this browser" bar while it captures. That is the `debugger` permission at work and goes away when the capture ends.

## Options

| Option | What it does |
|---|---|
| Pages / One long page | Normal paged PDF, or the whole page on one tall page with no breaks (sized to the page at your current window width) |
| Paper, margins, landscape | Paged mode only. A site's own `@page` size wins if it sets one |
| As on screen / Site's print style | Screen look, or whatever the site's print stylesheet does |
| Backgrounds & colors | Print background colors and images |
| Scroll first | Scrolls to the bottom and waits for images so lazy content is in the PDF, then scrolls you back |
| Ask where to save | Save dialog instead of straight to Downloads |

## Tests

```bash
npm test
```

Unit tests plus real-Chrome tests (uses your installed Google Chrome, headless; override with `CHROME_BIN`).

```bash
CFT_BIN="/path/to/Google Chrome for Testing" npm run e2e
```

Loads the unpacked extension and saves real PDFs through the service worker. Needs Chrome for Testing, because branded Chrome ignores `--load-extension`. It is in `.cft/` (gitignored) if you've run it before.

## Limits

- Chrome won't let extensions touch `chrome://` pages, the Chrome Web Store, or a tab that already has DevTools open.
- One long page measures the *document's* height. Apps that scroll inside a fixed-height box (Gmail, Figma, many editors) only capture the visible part.
- In one-long-page mode, elements sized with `vh` are sized against the page height, so a full-screen hero can come out very tall.
- Pages over 200in tall get scaled down to fit the 200in limit PDF viewers have, down to 10%. Past that they spill onto more pages.
- No icons yet; Chrome shows the default letter icon.
