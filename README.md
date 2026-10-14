# Verify with SynthID (Firefox)

Right-click an image, an audio or video player, or a link to a media file,
choose **Verify with SynthID**, and a new tab opens Google DeepMind's
[SynthID Detector](https://synthid.com/) with the file already placed in the
upload box. You review the page and confirm the upload yourself.

The detector checks for SynthID watermarks from Google, OpenAI, NVIDIA and
Kakao. It requires signing in with a Google, Apple or OpenAI account and allows
roughly 10 checks a day.

## Install (temporary, for testing)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` in this folder.

Temporary add-ons are removed when Firefox closes. For permanent installs the
add-on must be signed through addons.mozilla.org (self-distribution is fine).

## How it works

- `background.js` adds the context-menu items, downloads the file you clicked,
  opens the SynthID Detector, and holds the file until that tab has taken it.
- `content.js` runs only on `synthid.com`. It waits for the page's upload box
  to appear (the page is rendered by Angular in the browser, so the input is
  ready as soon as it exists), assigns the file to it once, and fires `input`
  and `change` events. Console lines prefixed `[Verify Image]` show each step.
- If the site sends you to sign in first, the file is kept and loads when you
  come back to the page in the same tab.
- Supported formats: JPEG, PNG, WebP, BMP, AVIF, HEIC/HEIF, TIFF and GIF images;
  MP3, WAV, AAC, FLAC, OGG and M4A audio; MP4, MOV and WebM video. The type
  comes from the server, or from the URL's extension if the server doesn't say.
  Anything else gets a notification instead. Files aren't converted, because
  converting can strip the watermark the page checks for.
- Audio and video work when the page uses a native `<audio>` or `<video>`
  element. Custom players that hide it won't show the menu item.
- Links to media files (URLs ending in `.mp3`, `.wav`, `.mp4`, etc.) get a
  **Verify linked audio/video with SynthID** item. If the link turns out to be
  a web page rather than the file itself, you get the unsupported-format
  message.

## Limits worth knowing

- The detector only finds SynthID watermarks from the providers it covers.
  "Not detected" does not mean something is human-made.
- Heavy editing, screenshots and re-encoding can weaken or remove watermarks.
- If the site changes its page's markup, `content.js` may need an update. If
  the upload box isn't found, you'll see a banner and can upload manually.
- Uploading is subject to the site's terms and privacy policy, as the page
  states.

## License

This project is licensed under the [Mozilla Public License 2.0](LICENSE).
