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
| Page size | Letter, A4, Legal: a site's own `@page` size wins if it sets one. Slide 16:9, Slide 4:3, Window size, Custom: always used, even over the site's `@page` |
| Margins, landscape | Paged mode only. Slides and window size already fix the orientation |
| Scale | 10–200%. In one-long-page mode the 200in limit can shrink it further |
| Wait | 0–30 seconds after scrolling, before measuring, so animations finish |
| As on screen / Print style | Screen look, or whatever the site's print stylesheet does |
| Backgrounds & colors | Print background colors and images |
| Scroll first | Scrolls to the bottom and waits for images so lazy content is in the PDF, then scrolls you back |
| Ask where to save | Save dialog instead of straight to Downloads |
| Hide elements… | Outlines what's under the mouse; click to hide it. ↑/↓ picks the parent or goes back, Enter hides, Esc finishes. Hidden things stay hidden on the page until you reload, and are left out of every PDF until then |

## Tests

```bash
npm test
```

Unit tests plus real-Chrome tests (uses your installed Google Chrome, headless; override with `CHROME_BIN`).

```bash
CFT_BIN="/path/to/Google Chrome for Testing" npm run e2e
```

Loads the unpacked extension and saves real PDFs through the service worker. Needs Chrome for Testing, because branded Chrome ignores `--load-extension`. It is in `.cft/` (gitignored) if you've run it before.

## Automatic releases

Every push to `main` runs the tests on GitHub Actions. When `manifest.json` has a version with no `v<version>` tag yet, the workflow builds the zip, uploads it to the Web Store, submits it for review and tags the commit. Chrome then updates everyone's copy by itself once the review passes.

To release: bump `version` in `manifest.json`, commit, push.

The workflow needs these repository secrets (Settings → Secrets and variables → Actions). Until they're set it skips the publish step with a warning:

| Secret | Where it comes from |
|---|---|
| `CWS_PUBLISHER_ID` | Web Store dashboard → Publisher → Settings |
| `CWS_EXTENSION_ID` | The item's ID in the dashboard, after the first manual upload |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | Google Cloud console: enable the Chrome Web Store API, create an OAuth client (type "Web application", redirect URI `https://developers.google.com/oauthplayground`) |
| `CWS_REFRESH_TOKEN` | OAuth 2.0 Playground with your own client ID/secret, scope `https://www.googleapis.com/auth/chromewebstore` |

## Limits

- Chrome won't let extensions touch `chrome://` pages, the Chrome Web Store, or a tab that already has DevTools open.
- One long page measures the *document's* height. Apps that scroll inside a fixed-height box (Gmail, Figma, many editors) only capture the visible part.
- In one-long-page mode, elements sized with `vh` are sized against the page height, so a full-screen hero can come out very tall.
- Pages over 200in tall get scaled down to fit the 200in limit PDF viewers have, down to 10%. Past that they spill onto more pages.
- Hide elements works only on the tab you open the popup on, and can't reach inside cross-origin iframes.
- The picker's toolbar uses Space Grotesk only if the page already has it; otherwise it falls back to the system font.
