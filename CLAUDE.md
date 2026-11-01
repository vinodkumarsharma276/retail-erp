# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

All project knowledge lives in [AGENTS.md](AGENTS.md), which is shared with other coding agents —
update that file, not this one.

@AGENTS.md

## Claude Code specifics

- Shared skills live in `.claude/skills/<name>/SKILL.md` (committed). The rest of `.claude/`
  (`settings.local.json`, `launch.json`) is personal and git-ignored.
- `.claude/launch.json` defines `api` (port 3001) and `web` (port 5180) dev-server launch configs.
