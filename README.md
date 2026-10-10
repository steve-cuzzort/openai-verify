# Verify Image with OpenAI (Firefox)

Right-click an image, an audio player, or a link to an audio file, choose **Verify with OpenAI**, and a new
tab opens `openai.com/research/verify` with the file already placed in the upload box.
You review the page and confirm the upload yourself.

## Install (temporary, for testing)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` in this folder.

Temporary add-ons are removed when Firefox closes. For permanent installs the
add-on must be signed through addons.mozilla.org (self-distribution is fine).

## How it works

- `background.js` adds the context-menu item, downloads the file you clicked,
  opens the verify page, and holds the file until that tab asks for it.
- `content.js` runs only on the verify page. It waits for React to attach to the
  page's file input and for Cloudflare's invisible bot check to load (the upload
  fails with "Something went wrong" without it), then assigns the file to the
  input once and fires `input` and `change` events. Console lines prefixed
  `[Verify Image]` show each step.
- Supported formats: PNG, JPEG and WebP images; MP3, WAV, AAC, FLAC, OGG, Opus
  and PCM audio. The type comes from the server, or from the URL's extension if
  the server doesn't say. Anything else (AVIF, GIF, M4A...) gets a notification
  instead. Files aren't converted, because converting would strip the metadata
  the page checks for.
- Audio works when the page uses a native `<audio>` element. Custom players
  that hide it won't show the menu item.
- Links to audio files (URLs ending in `.mp3`, `.wav`, `.flac`, etc.) get a
  **Verify linked audio with OpenAI** item. If the link turns out to be a web
  page rather than the file itself, you get the unsupported-format message.

## Limits worth knowing

- The page only detects content made with OpenAI tools. "Not detected" does not
  mean an image is human-made.
- Screenshots, re-uploads, and CDN re-encoding often strip C2PA metadata.
- If OpenAI changes the verify page's markup, `content.js` may need an update.
  If the upload box isn't found, you'll see a banner and can upload manually.
- Uploading is subject to OpenAI's Terms of Use and Privacy Policy, as the page states.
