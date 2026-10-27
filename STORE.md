# Publishing to the Chrome Web Store

Chrome won't let any extension or embedded browser script the Web Store dashboard, so these steps are by hand.
Files: `dist/page-to-pdf.zip` (run `npm run package` first), `icons/icon128.png`, `store/screenshot-1280x800.png`, `store/promo-440x280.png`.

## 1. New item

Dashboard → **New item** → upload `dist/page-to-pdf.zip`.

This first upload is by hand: the API can update an item but can't create one. After this, GitHub publishes new versions (README, "Automatic releases").

## 2. Store listing tab

**Description:**

```
Save the page you're looking at as a PDF.

- Pages or one long page. Get a normal paged PDF, or the whole page on one tall page with no breaks.
- Any page size. Letter, A4, Legal, 16:9 and 4:3 slides, the size of your window, or a size you type in.
- Your own scale. Anywhere from 10% to 200%.
- Wait for animations. Set a few seconds and the PDF is made after pages that animate in have finished. Good for presentations and slide sites.
- Hide what you don't want. Click "Hide elements…", then click a banner, header, popup or anything else to leave it out of the PDF. Undo any time.
- As on screen, or with the site's own print style.
- Scrolls the page first so images that load late are in the PDF.
- Text stays real text, so you can select and search it.
- Alt+Shift+P saves with your last settings.

No account. No subscription. Nothing leaves your browser.
```

- **Category:** Tools
- **Language:** English
- **Store icon:** `icons/icon128.png`
- **Screenshots:** `store/screenshot-1280x800.png`
- **Small promo tile:** `store/promo-440x280.png`

## 3. Privacy tab

**Single purpose:**

```
Save the current tab as a PDF file.
```

**Permission justifications:**

- **debugger**
  ```
  Used only on the tab the user asks to save, to run Chrome's built-in print-to-PDF (Page.printToPDF) without a print dialog. The extension detaches as soon as the PDF is made.
  ```
- **downloads**
  ```
  Saves the finished PDF to the user's Downloads folder.
  ```
- **storage**
  ```
  Remembers the user's settings (paper size, layout, look).
  ```
- **activeTab**
  ```
  Lets "Hide elements" add its picker to the tab the user is on, only after they click it.
  ```
- **scripting**
  ```
  Adds the "Hide elements" picker to the current tab. It outlines what's under the mouse and hides what the user clicks.
  ```
- **offscreen**
  ```
  Turns the PDF bytes into a blob URL that chrome.downloads can save. The background service worker can't create blob URLs itself.
  ```

- **Remote code:** No, I am not using remote code.
- **Data usage:** tick nothing. Tick all three certification boxes at the bottom.
- **Privacy policy URL:** paste a public link to `PRIVACY.md`, if the form asks for one.

## 4. Distribution tab

- **Visibility:** Public
- **Regions:** All regions

## 5. Submit

**Submit for review**. Items that use `debugger` get a closer review, so expect a few days.
