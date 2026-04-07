# LBE Platform Proto 7

`LBE-platform-proto-7` is the GitHub Pages-friendly version of the route guide prototype.

## Concept

- No runtime Node server is required for playback.
- Guide narration is generated in advance with Azure Speech on your local machine.
- Generated `.wav` files are committed to the repository and served as static assets.
- GitHub Pages can host the app because the site is fully static at runtime.
- A start announcement plays first, then normal geofence waiting begins.

## Environment

Create `.env.local` in the project root for local audio generation:

```env
AZURE_SPEECH_KEY=your_key
AZURE_SPEECH_REGION=your_region
AZURE_SPEECH_VOICE=ja-JP-NanamiNeural
```

These values are only used when generating guide audio locally. They are not needed on GitHub Pages.

## Install

```bash
npm.cmd install
```

## Generate Guide Audio

This creates fixed guide narration files for the route events.

```bash
npm.cmd run generate:guides
```

Generated files are written to:

```text
assets/audio/guides/
```

## Preview Locally

You can open `index.html` directly for basic checking, but for mobile testing use any static file server or GitHub Pages so the site is served over HTTP or HTTPS as needed.

## Deploy

Push the repository to GitHub and publish with GitHub Pages.

At runtime:

- the app loads static audio from `assets/audio/guides/`
- no Azure key is exposed
- no Node server is required
