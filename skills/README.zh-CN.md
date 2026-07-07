[English](README.md) | 简体中文

# Kaitox agent skills

Agent skills 是 [Kaitox](https://kaitox.ai) 个人工具集的产品之一——与 `kaitox` CLI、Obsidian 插件、Chrome 插件并列。一个 skill 教会 coding agent（Claude Code 及兼容宿主）替用户驱动其他 Kaitox 产品：跑哪些命令、输出是什么意思、最后要把什么交还给用户。

每个 skill 是一个目录，内含带 `name` / `description` frontmatter 的 `SKILL.md`：

```
skills/
└── <name>/
    └── SKILL.md
```

## 目录

| Skill | 用途 |
|---|---|
| [`x-article`](x-article/SKILL.md) | 通过 `kaitox x push` 对本地 Markdown 做风格检查并同步为 X (Twitter) Article 草稿到本地 relay；之后由浏览器插件在已登录的 x.com 草稿页完成上传。 |

## 安装

把 skill 目录拷进你 agent 的 skills 目录，以 Claude Code 为例：

```bash
cp -r skills/x-article ~/.claude/skills/        # 全局
# 或
cp -r skills/x-article .claude/skills/          # 单个项目
```

任何能发现 `SKILL.md` 的宿主也可以直接指向本仓库的 `skills/` 目录。

## 新增 skill

1. 创建 `skills/<name>/SKILL.md`，写好 `name` 和 `description` frontmatter。description 要同时说清这个 skill 做什么、agent 什么时候该用它。
2. 在上面的目录表里加一行。

驱动某个功能的 skill 应当依赖该功能的 CLI 命名空间（如 `kaitox x ...`），而不是重新实现逻辑——CLI 才是稳定接口。
