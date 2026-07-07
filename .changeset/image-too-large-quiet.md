---
"@kaitox/x-article": minor
---

`checkMarkdownStyle` no longer reports `image-too-large` for oversized PNG/JPEG/WebP — the relay compresses those transparently at ingest, so the warning was a false alarm that blocked `kaitox x push` with a prompt. The rule now fires only for formats the relay passes through untouched (GIF, SVG, …), with the message and suggestion updated accordingly.
