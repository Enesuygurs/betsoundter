# Simple Audio Equalizer (Chrome Extension)

This is a minimal Chrome extension that attaches a WebAudio equalizer to media elements (audio/video) on web pages. It provides a popup UI with sliders for several frequency bands and uses chrome.storage.sync to persist settings.

Installation (developer mode):

1. Open Chrome and go to chrome://extensions/
2. Enable "Developer mode" (top-right).
3. Click "Load unpacked" and select this folder (`betsoundter`).
4. Open a tab with audio or video and click the extension icon.

Notes and limitations:
- This is a simple proof-of-concept. It attaches an AudioContext per page and creates BiquadFilterNodes for each media element.
- Some pages or elements may not allow creation of MediaElementSource (e.g., if an element is already connected to a different AudioContext). In that case the element is skipped.
- The extension injects a content script on all pages. It only modifies audio in pages where the content script runs.

Next steps (suggested):
- Add per-element labeling and persistent per-element presets.
- Improve UI (presets, visualizer) and add icons.
- Add permissions or host restrictions if needed.
