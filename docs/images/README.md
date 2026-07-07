# Tutorial images / 教程图片

Screenshots referenced by the main [README](../../README.md) / [README.zh-CN](../../README.zh-CN.md).

They are wired in as **commented-out** image tags so the READMEs render cleanly before the screenshots exist. To publish one: drop the PNG here under the exact file name below, then uncomment the matching `<!-- ![…](docs/images/…) -->` line in the README (and remove the `> 🖼️ …` placeholder caption above it).

主 [README](../../README.md) / [README.zh-CN](../../README.zh-CN.md) 引用的截图。它们以**注释掉的**图片标签形式预留，截图存在前 README 也能干净渲染。补图方式：按下表文件名把 PNG 放到本目录，然后在 README 里取消对应 `<!-- ![…] -->` 行的注释（并删掉它上面的 `> 🖼️ …` 占位说明）。

| File | What it should show |
|---|---|
| `01-load-extension.png` | `chrome://extensions` with Developer mode on, **Load unpacked** selecting `apps/extension/dist/`. |
| `02-panel.png` | The Kaitox panel in the corner of `x.com/compose/articles`. |
| `03-push.png` | A terminal running `kaitox x push post.md` — the X-friendliness report and the printed draft id. |
| `04-upload-result.png` | Clicking **上传草稿** in the panel and the resulting Article draft open in the X editor. |

Suggested: PNG, ~1600px wide, light background. Keep the file names stable so the README links don't drift.
