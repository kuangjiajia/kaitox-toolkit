/**
 * 示例：把一份 Markdown 发成 X Article 草稿。
 *
 * 运行前你需要从「已登录 x.com 的浏览器」里拿到会话凭证：
 *   - ct0        ：cookie 里的 ct0，就是 csrfToken
 *   - cookie     ：整串 cookie（服务端调用必须；浏览器同源 content script 里可省略）
 *   - bearer     ：可选，默认用内置的公开 web bearer
 *
 * 拿法：DevTools → Application → Cookies → https://x.com，复制 ct0 和整串 cookie；
 * 或在 x.com 控制台执行 `document.cookie`（注意 HttpOnly 的 auth_token 拿不到，需从
 * Application 面板取）。
 */

import { publishXArticle } from '../src/index';

const markdown = `# 一篇示例文章

这是第一段，包含 **加粗** 和 [一个链接](https://example.com)。

## 小标题

> 这是一段引用。

- 列表项一
- 列表项二

\`\`\`plaintext
这是一段代码 / ASCII 图
A -> B -> C
\`\`\`

---

![示意图](https://example.com/diagram.png)

本文由参考实现自动从 Markdown 转换。
`;

async function main() {
  const result = await publishXArticle({
    markdown,
    // title 不传会自动取第一个标题「一篇示例文章」
    credentials: {
      bearerToken: '', // 留空则用内置默认公开 bearer
      csrfToken: process.env.X_CT0 ?? '<你的 ct0>',
      cookie: process.env.X_COOKIE ?? '<你的完整 cookie 串>',
    },
    clientOptions: {
      // 服务端调用：不靠浏览器自动带 cookie，改用 omit + 显式 cookie 头
      credentialsMode: 'omit',
    },
  });

  console.log('草稿创建完成：');
  console.log('  restId       :', result.restId);
  console.log('  title        :', result.title);
  console.log('  blocks       :', result.contentState.blocks.length);
  console.log('  entities     :', result.contentState.entity_map.length);
  console.log('  uploaded imgs:', Object.keys(result.mediaMap).length);
  console.log('  skipped imgs :', result.skippedImages);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
