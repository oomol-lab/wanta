# Branding Source Assets

This directory stores editable/source branding assets that are not loaded directly by the app at runtime.

- `app-icon-source.png`: source raster for the main app icon artwork.
- `app-icon-rounded.png`: rounded PNG variant that matches the packaged app icon export.
- `tray-icon-source.png`: source raster for the macOS tray/menu bar icon.

Runtime and package assets live one level up:

- `../icon.png`
- `../icon.icns`
- `../icon.ico`
- `../tray-icon@2x.png`

Renderer UI imports the same main app icon artwork from `src/assets/app-icon.png`.
