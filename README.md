# LBE Platform Proto 5

`LBE-platform-proto-5` is the Azure TTS-connected version of the route guide prototype.

## What Changed

- `proto-4` remains as a backup.
- `proto-5` adds a local Node.js server.
- Guide narration now prefers Azure Speech TTS through `/api/tts-guide`.
- If the API is unavailable, the browser falls back to `speechSynthesis`.

## Environment

Create `.env.local` in the project root:

```env
AZURE_SPEECH_KEY=your_key
AZURE_SPEECH_REGION=your_region
AZURE_SPEECH_VOICE=ja-JP-NanamiNeural
PORT=3000
HOST=127.0.0.1
```

`AZURE_SPEECH_VOICE` is optional. If omitted, `ja-JP-NanamiNeural` is used.

## Install

```bash
npm.cmd install
```

## Run Proto 5

Start the local server:

```bash
npm.cmd run dev
```

Then open:

```text
http://127.0.0.1:3000
```

Do not open `index.html` directly from the filesystem if you want Azure TTS. The browser app must be served by the local Node server so it can call `/api/tts-guide`.

## Azure TTS Test Script

You can still generate a guide wav directly:

```bash
npm.cmd run speak:guide -- "今日はお台場の日本科学未来館へ向かいます。"
```

This saves:

```text
tmp/tts/guide-output.wav
```
