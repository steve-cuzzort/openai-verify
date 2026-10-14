"use strict";

// Runs on the SynthID Detector page. Asks the background script for a file the
// user right-clicked, then places it in the page's upload box. The user still
// reviews the page and confirms the upload themselves.

globalThis.browser ??= chrome;

const FILE_INPUT_SELECTOR = 'input[type="file"]';
const WAIT_MS = 15000;

function log(...args) {
  console.log("[Verify Image]", ...args);
}

function waitForFileInput() {
  return new Promise((resolve) => {
    const existing = document.querySelector(FILE_INPUT_SELECTOR);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const input = document.querySelector(FILE_INPUT_SELECTOR);
      if (input) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(input);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, WAIT_MS);
  });
}

// The background script sends the file as base64; see its onMessage listener.
function fromBase64(data) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function setInputFile(input, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  // Fire the same events the native file picker does.
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function showBanner(text) {
  const banner = document.createElement("div");
  banner.textContent = text;
  banner.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "background:#10223f;color:#fff;padding:10px 16px;border-radius:8px;" +
    "font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);";
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 8000);
}

(async () => {
  const pending = await browser.runtime.sendMessage({ type: "get-pending-file" });
  if (!pending) {
    log("pending file from background: none");
    return;
  }
  const bytes = fromBase64(pending.data);
  log("pending file from background:", pending.name + " (" + pending.type + ", " + bytes.byteLength + " bytes)");

  // The page is rendered in the browser by Angular, which attaches the input's
  // listeners as it creates the element, so once the input exists it's ready.
  const input = await waitForFileInput();
  if (!input) {
    // Leave the file with the background script: if this was a sign-in
    // screen, the page will ask again when the user comes back signed in.
    showBanner("Verify Image: couldn't find the upload box. If you need to sign in, do that and the file will load after. Otherwise, upload it manually.");
    return;
  }

  const file = new File([bytes], pending.name, { type: pending.type });
  // Hand the file over exactly once, the way the native file picker does.
  // Don't also simulate a drop: the page could process the file twice.
  setInputFile(input, file);
  browser.runtime.sendMessage({ type: "pending-file-used" });
  // The page can re-render the input as soon as it handles the change, so
  // input.files may be null here. That means the page picked the file up.
  log("file set; input now:", input.type, input.files ? input.files.length + " file(s)" : "no file list (page re-rendered it)");

  showBanner("Verify Image: file loaded. Review the page and confirm the upload.");
})();
