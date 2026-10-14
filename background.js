"use strict";

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

// tabId -> { name, type, buffer } waiting for the verify page to load.
const pending = new Map();

browser.contextMenus.create({
  id: MENU_ID,
  title: TITLE,
  contexts: ["image", "audio", "video"],
});

// Links to media files, e.g. a download link to an .mp3. Only shown when the
// link's URL ends in a supported extension, optionally followed by a query string.
const LINK_EXTENSIONS = ["mp3", "wav", "aac", "flac", "ogg", "oga", "m4a", "mp4", "mov", "webm"];
browser.contextMenus.create({
  id: LINK_MENU_ID,
  title: "Verify linked audio/video with SynthID",
  contexts: ["link"],
  targetUrlPatterns: LINK_EXTENSIONS.flatMap((ext) =>
    [ext, ext.toUpperCase()].flatMap((e) => ["*://*/*." + e, "*://*/*." + e + "?*"])
  ),
});

function notify(message) {
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icon.svg"),
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
  if (file) pending.set(tab.id, file);
});

// The content script on the verify page asks for the file once the upload box
// is ready, and says when it has handed it over. Until then the file stays put,
// so it survives a detour through a sign-in page in the same tab.
browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || !sender.tab) return;
  if (message.type === "get-pending-file") {
    return Promise.resolve(pending.get(sender.tab.id) || null);
  }
  if (message.type === "pending-file-used") {
    pending.delete(sender.tab.id);
  }
});

browser.tabs.onRemoved.addListener((tabId) => pending.delete(tabId));
