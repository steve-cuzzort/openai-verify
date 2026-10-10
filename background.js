"use strict";

const VERIFY_URL = "https://openai.com/research/verify";
const MENU_ID = "verify-openai";
// Formats the verify page accepts for images.
const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// tabId -> { name, type, buffer } waiting for the verify page to load.
const pending = new Map();

browser.contextMenus.create({
  id: MENU_ID,
  title: "Verify with OpenAI",
  contexts: ["image"],
});

function notify(message) {
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icon.svg"),
    title: "Verify with OpenAI",
    message,
  });
}

function extensionFor(type) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  return "png";
}

// Re-encode formats the verify page does not accept (AVIF, GIF, BMP...) as PNG.
// Note: this drops any metadata, so C2PA credentials will not survive it.
async function toPng(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG conversion failed"))),
      "image/png"
    );
  });
}

async function loadImage(srcUrl) {
  const response = await fetch(srcUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error("Could not download the image (HTTP " + response.status + ").");
  }
  let blob = await response.blob();
  let converted = false;
  if (!SUPPORTED_TYPES.has(blob.type)) {
    blob = await toPng(blob);
    converted = true;
  }
  return {
    name: "image-to-verify." + extensionFor(blob.type),
    type: blob.type,
    buffer: await blob.arrayBuffer(),
    converted,
  };
}

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;

  let file = null;
  try {
    file = await loadImage(info.srcUrl);
  } catch (err) {
    notify(
      "Couldn't fetch that image automatically (" +
        err.message +
        "). The verify page will open so you can upload it yourself."
    );
  }

  const tab = await browser.tabs.create({ url: VERIFY_URL });
  if (file) {
    pending.set(tab.id, file);
    if (file.converted) {
      notify(
        "The image was converted to PNG so the verify page accepts it. " +
          "Converting removes metadata, so only a watermark could still be detected."
      );
    }
  }
});

// The content script on the verify page asks for the file once it has loaded.
browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "get-pending-image" || !sender.tab) return;
  const file = pending.get(sender.tab.id);
  pending.delete(sender.tab.id);
  return Promise.resolve(file || null);
});

browser.tabs.onRemoved.addListener((tabId) => pending.delete(tabId));
