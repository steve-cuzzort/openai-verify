"use strict";

const VERIFY_URL = "https://openai.com/research/verify";
const MENU_ID = "verify-openai";
const LINK_MENU_ID = "verify-openai-link";
// Formats the verify page accepts (from its file input's accept list),
// mapped to the file extension to use.
const SUPPORTED_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/ogg", "ogg"],
  ["audio/opus", "opus"],
  ["audio/pcm", "pcm"],
]);
// Other names servers use for the same formats.
const TYPE_ALIASES = new Map([
  ["image/jpg", "image/jpeg"],
  ["audio/mp3", "audio/mpeg"],
  ["audio/x-mp3", "audio/mpeg"],
  ["audio/x-wav", "audio/wav"],
  ["audio/wave", "audio/wav"],
  ["audio/vnd.wave", "audio/wav"],
  ["audio/x-aac", "audio/aac"],
  ["audio/x-flac", "audio/flac"],
]);
// For servers that send no useful type, guess from the URL's file extension.
const EXTENSION_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["opus", "audio/opus"],
  ["pcm", "audio/pcm"],
]);

// tabId -> { name, type, buffer } waiting for the verify page to load.
const pending = new Map();

browser.contextMenus.create({
  id: MENU_ID,
  title: "Verify with OpenAI",
  contexts: ["image", "audio"],
});

// Links to audio files, e.g. a download link to an .mp3. Only shown when the
// link's URL ends in an audio extension, optionally followed by a query string.
const AUDIO_LINK_EXTENSIONS = ["mp3", "wav", "aac", "flac", "ogg", "oga", "opus", "pcm"];
browser.contextMenus.create({
  id: LINK_MENU_ID,
  title: "Verify linked audio with OpenAI",
  contexts: ["link"],
  targetUrlPatterns: AUDIO_LINK_EXTENSIONS.flatMap((ext) =>
    [ext, ext.toUpperCase()].flatMap((e) => ["*://*/*." + e, "*://*/*." + e + "?*"])
  ),
});

function notify(message) {
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icon.svg"),
    title: "Verify with OpenAI",
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

  // Converting would strip the C2PA metadata the page checks for, so don't.
  if (file && !SUPPORTED_TYPES.has(file.type)) {
    notify(
      "This file's format (" +
        (file.type || "unknown") +
        ") isn't supported. The verify page accepts PNG, JPEG and WebP images, " +
        "and MP3, WAV, AAC, FLAC, OGG, Opus and PCM audio."
    );
    return;
  }

  const tab = await browser.tabs.create({ url: VERIFY_URL });
  if (file) pending.set(tab.id, file);
});

// The content script on the verify page asks for the file once it has loaded.
browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "get-pending-image" || !sender.tab) return;
  const file = pending.get(sender.tab.id);
  pending.delete(sender.tab.id);
  return Promise.resolve(file || null);
});

browser.tabs.onRemoved.addListener((tabId) => pending.delete(tabId));
