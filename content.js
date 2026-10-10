"use strict";

// Runs on the OpenAI verify page. Asks the background script for a file the
// user right-clicked, then places it in the page's upload box. The user still
// reviews the page and confirms the upload themselves.

const FILE_INPUT_SELECTOR = 'input[type="file"]';
const WAIT_MS = 15000;

function log(...args) {
  console.log("[Verify Image]", ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// The page is server-rendered React: the input exists before React attaches its
// handlers, and events fired before then are lost. React stores props on the
// element under a "__reactProps$..." key, which content scripts can only see
// through wrappedJSObject.
function isHydrated(el) {
  const raw = el.wrappedJSObject || el;
  try {
    return Object.keys(raw).some((k) => k.startsWith("__reactProps$"));
  } catch (e) {
    return false;
  }
}

async function waitForHydratedInput() {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    // Re-query each time: hydration can replace the element.
    const input = document.querySelector(FILE_INPUT_SELECTOR);
    if (input && isHydrated(input)) return input;
    await sleep(100);
  }
  // Fall back to whatever input exists and hope for the best.
  return document.querySelector(FILE_INPUT_SELECTOR);
}

function setInputFile(input, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  // React listens for these events rather than reading .files directly.
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// The page runs Cloudflare's invisible Turnstile check and needs its token to
// upload. It loads after the page does, so handing the file over too early
// makes the upload fail with "Something went wrong". Wait until it has loaded,
// as a person would; this never interacts with the check itself.
const TURNSTILE_SELECTOR = 'iframe[src*="challenges.cloudflare.com"]';
const TURNSTILE_SETTLE_MS = 2000;

async function waitForTurnstile() {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const page = window.wrappedJSObject || window;
    if (document.querySelector(TURNSTILE_SELECTOR) || page.turnstile) {
      // The iframe appearing doesn't mean it has finished; give it a moment.
      await sleep(TURNSTILE_SETTLE_MS);
      return true;
    }
    await sleep(200);
  }
  return false;
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
  const pending = await browser.runtime.sendMessage({ type: "get-pending-image" });
  log("pending file from background:", pending ? pending.name + " (" + pending.type + ", " + pending.buffer.byteLength + " bytes)" : "none");
  if (!pending) return;

  if (!(await waitForFileInput())) {
    showBanner("Verify Image: couldn't find the upload box. Please upload the file manually.");
    return;
  }

  log("bot check loaded:", await waitForTurnstile());
  // Re-query after waiting: the page may have re-rendered the input meanwhile.
  const input = await waitForHydratedInput();
  log("file input found, React attached:", isHydrated(input));
  const file = new File([pending.buffer], pending.name, { type: pending.type });
  // Hand the file over exactly once, the way the native file picker does.
  // Don't also simulate a drop: the page would process the file twice and fail.
  setInputFile(input, file);
  // The page can re-render the input as soon as it handles the change, so
  // input.files may be null here. That means the page picked the file up.
  log("file set; input now:", input.type, input.files ? input.files.length + " file(s)" : "no file list (page re-rendered it)");

  showBanner("Verify Image: file loaded. Review the page and confirm the upload.");
})();
