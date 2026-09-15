Test-only media. Not product assets, not demo/example content, not bundled user content.

- user-video.mp4 (H.264 ~5s)
- user-audio.mp3
- tone.wav (PCM ~5s; user-named)
- tone-250ms.wav, not-media.txt (generated tiny helpers)

Provenance (user-video.mp4 / user-audio.mp3): Owner-provided development/test fixture supplied specifically for internal Grok VM testing during remote development. Not intended for product distribution.

This note records why the files are present. It is not a copyright-ownership or commercial-clearance claim.

PRODUCT DISTRIBUTION: NOT DISTRIBUTED / TEST-ONLY. Do not copy these into `public/` (Vite would ship them in `dist` / the Tauri bundle). Original 8MB source was not committed.
