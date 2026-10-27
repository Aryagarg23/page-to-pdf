# Publishing to the Chrome Web Store

Chrome won't let any extension or embedded browser script the Web Store dashboard, so these steps are by hand.
Files: `dist/page-to-pdf.zip` (run `npm run package` first), `icons/icon128.png`, `store/screenshot-1280x800.png`, `store/promo-440x280.png`.

## 1. New item

Dashboard → **New item** → upload `dist/page-to-pdf.zip`.

## 2. Store listing tab

**Description:**

```
Save the page you're looking at as a PDF.

- Pages: a normal PDF on Letter, A4 or Legal paper, with or without margins.
- One long page: the whole page on one tall page, no page breaks.
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
