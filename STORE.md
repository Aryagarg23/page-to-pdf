# Chrome Web Store listing

**Name:** Page to PDF

**Summary (132 chars max):** Save any web page as a PDF. Pages, or one long page with no breaks. No account, no subscription.

**Category:** Tools

**Description:**

Save the page you're looking at as a PDF.

- Pages: a normal PDF on Letter, A4 or Legal paper, with or without margins.
- One long page: the whole page on one tall page, no page breaks.
- As on screen, or with the site's own print style.
- Scrolls the page first so images that load late are in the PDF.
- Text stays real text, so you can select and search it.
- Alt+Shift+P saves with your last settings.

No account. No subscription. Nothing leaves your browser.

**Single purpose:** Save the current tab as a PDF file.

**Permission justifications:**

- debugger: Used only on the tab you ask to save, to run Chrome's built-in "print to PDF" (Page.printToPDF) without a print dialog. Detached as soon as the PDF is made.
- downloads: Saves the finished PDF to your Downloads folder.
- storage: Remembers your settings (paper size, layout, look).
- offscreen: Turns the PDF bytes into a file the downloads API can save. The background worker can't do this on its own.

**Remote code:** No.

**Data usage:** Collects nothing. Privacy policy: PRIVACY.md.

**Images:** icons/icon128.png, store/screenshot-1280x800.png, store/promo-440x280.png
