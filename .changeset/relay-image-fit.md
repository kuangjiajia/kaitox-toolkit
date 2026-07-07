---
"@kaitox/relay": minor
---

Transparently re-encode oversized images at ingest. X's media upload rejects images over 5MB (`maxFileSizeExceeded`); the relay now fits them silently when drafts are saved (`POST /drafts`) or covers are set (`PUT /drafts/:id/cover`): opaque images become JPEG (white background, quality 90), images with transparency become WebP, stepping the dimensions down until the result fits. GIF/SVG and in-limit images pass through untouched, and any processing failure falls back to the original bytes. Bundle asset metadata (`mime`, `bytesLen`) reflects the stored bytes. Adds `sharp` as a dependency — the relay is no longer zero-dep.
