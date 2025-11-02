
# BetSoundTer

BetSoundTer is a lightweight Chrome extension that adds a per-page audio equalizer and master controls for media (audio/video) playing in your browser. Use the popup to adjust frequency bands, master gain, and compressor settings, save and share presets, and apply EQ to media elements on the page.


### ✨ Features

- Multi-band equalizer (switchable 10-band and 31-band modes)
- Master gain and dynamics compressor controls
- Per-page / per-element attachment so the EQ affects media playing on the current tab
- Save, load and delete presets
- Export/import presets as JSON and share presets via encoded links (custom scheme: `betsoundter://`)
- Debounced storage to reduce quota usage and smooth UI updates

### 🖼️ Screenshots



### 💻 Installation (If need)

1. Open Chrome and go to chrome://extensions
2. Enable "Developer mode" in the top-right
3. Click "Load unpacked" and select this extension folder (`betsoundter`)
4. The BetSoundTer icon will appear in the toolbar; click it to open the popup

### 🚀 Usage

1. Open a tab with audio or video.
2. Click the BetSoundTer extension icon to open the popup.
3. Select the media element (or choose "All elements") and adjust the frequency bands by dragging the sliders.
4. Use Master Gain to increase/decrease overall level. Tweak compressor settings to tame peaks.
5. Save presets via the Settings tab. Export or share presets using the provided buttons.
6. To load a shared preset link, paste it into the Import-from-URL field in the Settings tab.

### 📜 License

This project is provided under the MIT License. See LICENSE for details.
