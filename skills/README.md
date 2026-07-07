English | [简体中文](README.zh-CN.md)

# Kaitox agent skills

Agent skills are one of the products of the [Kaitox](https://kaitox.ai) personal toolkit — alongside the `kaitox` CLI, the Obsidian plugin, and the Chrome extension. A skill teaches a coding agent (Claude Code and compatible hosts) how to drive the other Kaitox products on the user's behalf: which commands to run, what the output means, and what to hand back to the user.

Each skill is a directory containing a `SKILL.md` with `name` / `description` frontmatter:

```
skills/
└── <name>/
    └── SKILL.md
```

## Catalog

| Skill | What it does |
|---|---|
| [`x-article`](x-article/SKILL.md) | Style-check a local Markdown file and sync it to the local relay as an X (Twitter) Article draft via `kaitox x push`; the browser extension then uploads it from the logged-in x.com drafts page. |

## Install

Copy the skill directory into your agent's skills directory, e.g. for Claude Code:

```bash
cp -r skills/x-article ~/.claude/skills/        # user-wide
# or
cp -r skills/x-article .claude/skills/          # per project
```

Any host that discovers `SKILL.md` files can also be pointed directly at this repo's `skills/` directory.

## Add a skill

1. Create `skills/<name>/SKILL.md` with `name` and `description` frontmatter. The description should say both what the skill does and when the agent should reach for it.
2. Add a row to the catalog above.

Skills that drive a feature should lean on the feature's CLI namespace (e.g. `kaitox x ...`) rather than reimplementing logic — the CLI is the stable surface.
