---
"@kaitox/relay-protocol": patch
"@kaitox/x-article": patch
"@kaitox/relay": patch
"@kaitox/cli": patch
---

Upload GIFs and videos in Markdown as real X Article media. The media kind now follows the MIME type: GIFs upload as `tweet_gif` / `DraftTweetGif`, and videos (mp4 / mov) as `tweet_video` / `DraftTweetVideo`, with `video_duration_ms`, `allow_async=true`, and async processing that waits until the media slot expires. The relay converts videos X can't take (WebM, MKV, AVI, HEVC MOV, …) to H.264/AAC MP4 at ingest with the system ffmpeg (`KAITOX_FFMPEG`), passing them through unchanged when ffmpeg is missing. The CLI recognizes `.mp4` / `.mov` / `.webm` / `.mkv` / `.avi` and other common video extensions, and the style check uses X's 15MB GIF limit and warns about `<video>` tags, which are not uploaded.
