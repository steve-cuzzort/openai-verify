"use strict";

// Chrome only provides the chrome.* namespace; Firefox provides both. In
// Manifest V3 the chrome.* calls used here return promises, like browser.*.
globalThis.browser ??= chrome;

const VERIFY_URL = "https://synthid.com/";
const MENU_ID = "verify-synthid";
const LINK_MENU_ID = "verify-synthid-link";
const TITLE = "Verify with SynthID";
// Formats the page accepts (from its file input's accept list), mapped to the
// file extension to use.
const SUPPORTED_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/bmp", "bmp"],
  ["image/avif", "avif"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["image/tiff", "tiff"],
  ["image/gif", "gif"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/webm", "webm"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
]);
// Other names servers use for the same formats.
const TYPE_ALIASES = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/x-ms-bmp", "image/bmp"],
  ["image/x-bmp", "image/bmp"],
  ["audio/mp3", "audio/mpeg"],
  ["audio/x-mp3", "audio/mpeg"],
  ["audio/x-wav", "audio/wav"],
  ["audio/wave", "audio/wav"],
  ["audio/vnd.wave", "audio/wav"],
  ["audio/x-aac", "audio/aac"],
  ["audio/x-flac", "audio/flac"],
  ["audio/x-m4a", "audio/mp4"],
  ["audio/m4a", "audio/mp4"],
]);
// For servers that send no useful type, guess from the URL's file extension.
const EXTENSION_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["bmp", "image/bmp"],
  ["avif", "image/avif"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
  ["tiff", "image/tiff"],
  ["tif", "image/tiff"],
  ["gif", "image/gif"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["m4a", "audio/mp4"],
  ["mp4", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
]);

// Messages to the content script are JSON-serialized in Chrome and capped at
// 64 MiB, and the file travels as base64 (4/3 the size), so stay under that.
const MAX_FILE_BYTES = 45 * 1024 * 1024;

// tabId -> { name, type, buffer } waiting for the verify page to load. Kept in
// IndexedDB rather than in memory because the background script is unloaded
// when idle (a service worker in Chrome, an event page in Firefox), which
// would lose the file during a detour through a sign-in page.
const pending = (() => {
  const STORE = "files";

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("pending-files", 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  return {
    get: (tabId) => run("readonly", (store) => store.get(tabId)),
    set: (tabId, file) => run("readwrite", (store) => store.put(file, tabId)),
    delete: (tabId) => run("readwrite", (store) => store.delete(tabId)),
    clear: () => run("readwrite", (store) => store.clear()),
  };
})();

// Links to media files, e.g. a download link to an .mp3. Only shown when the
// link's URL ends in a supported extension, optionally followed by a query string.
const LINK_EXTENSIONS = ["mp3", "wav", "aac", "flac", "ogg", "oga", "m4a", "mp4", "mov", "webm"];

// Menus persist across restarts of the background script, so create them once.
// Creating them on every wake-up would fail with duplicate-ID errors.
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: MENU_ID,
    title: TITLE,
    contexts: ["image", "audio", "video"],
  });
  browser.contextMenus.create({
    id: LINK_MENU_ID,
    title: "Verify linked audio/video with SynthID",
    contexts: ["link"],
    targetUrlPatterns: LINK_EXTENSIONS.flatMap((ext) =>
      [ext, ext.toUpperCase()].flatMap((e) => ["*://*/*." + e, "*://*/*." + e + "?*"])
    ),
  });
});

// Tab IDs don't carry over between browser sessions, so leftovers are useless.
browser.runtime.onStartup.addListener(() => pending.clear());

function notify(message) {
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icon.png"),
    title: TITLE,
    message,
  });
}

// Work out the file's type: the server's Content-Type, normalised, or failing
// that the URL's extension. Returns "" if neither is known.
function resolveType(contentType, url) {
  let type = (contentType || "").split(";")[0].trim().toLowerCase();
  type = TYPE_ALIASES.get(type) || type;
  if (SUPPORTED_TYPES.has(type)) return type;
  if (type && type !== "application/octet-stream") return type;
  try {
    const ext = new URL(url).pathname.split(".").pop().toLowerCase();
    return EXTENSION_TYPES.get(ext) || type;
  } catch (e) {
    return type;
  }
}

async function loadFile(srcUrl) {
  const response = await fetch(srcUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error("Could not download the file (HTTP " + response.status + ").");
  }
  const blob = await response.blob();
  if (blob.size > MAX_FILE_BYTES) {
    throw new Error("the file is larger than " + MAX_FILE_BYTES / 1024 / 1024 + " MB");
  }
  const type = resolveType(blob.type, response.url || srcUrl);
  return {
    name: "file-to-verify." + (SUPPORTED_TYPES.get(type) || "bin"),
    type,
    buffer: await blob.arrayBuffer(),
  };
}

browser.contextMenus.onClicked.addListener(async (info) => {
  let url = null;
  if (info.menuItemId === MENU_ID) url = info.srcUrl;
  else if (info.menuItemId === LINK_MENU_ID) url = info.linkUrl;
  if (!url) return;

  let file = null;
  try {
    file = await loadFile(url);
  } catch (err) {
    notify(
      "Couldn't fetch that file automatically (" +
        err.message +
        "). The verify page will open so you can upload it yourself."
    );
  }

  // Converting would strip the metadata and watermarks the page checks for, so don't.
  if (file && !SUPPORTED_TYPES.has(file.type)) {
    notify(
      "This file's format (" +
        (file.type || "unknown") +
        ") isn't supported. SynthID accepts JPEG, PNG, WebP, BMP, AVIF, HEIC, TIFF and GIF " +
        "images, MP3, WAV, AAC, FLAC, OGG and M4A audio, and MP4, MOV and WebM video."
    );
    return;
  }

  const tab = await browser.tabs.create({ url: VERIFY_URL });
  if (file) await pending.set(tab.id, file);
});

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  // fromCharCode takes its bytes as arguments, so go in chunks to stay under
  // the engine's argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
  }
  return btoa(chunks.join(""));
}

// The content script on the verify page asks for the file once the upload box
// is ready, and says when it has handed it over. Until then the file stays put,
// so it survives a detour through a sign-in page in the same tab.
// Replies go through sendResponse (returning true keeps the channel open) since
// that works in both browsers. The file is sent as base64 because Chrome
// serializes messages as JSON, which turns an ArrayBuffer into {}.
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender.tab) return;
  if (message.type === "get-pending-file") {
    pending
      .get(sender.tab.id)
      .then((file) =>
        sendResponse(file ? { name: file.name, type: file.type, data: toBase64(file.buffer) } : null)
      )
      .catch((err) => {
        console.error("[Verify Image] couldn't read the pending file:", err);
        sendResponse(null);
      });
    return true;
  }
  if (message.type === "pending-file-used") {
    pending.delete(sender.tab.id);
  }
});

browser.tabs.onRemoved.addListener((tabId) => pending.delete(tabId));
