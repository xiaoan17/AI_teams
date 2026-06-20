# Role Schema and Global Role Library

This document is the M1 source of truth for role metadata, project agent extensions, and the global role template library.

## Project Agent Schema

Project agents continue to live in `.aiteam/agents.json`. Existing fields keep their current meaning. M1 adds optional fields, so old agent entries remain valid.

```jsonc
{
  "id": "designer",
  "name": "设计师",
  "command": "claude",
  "args": ["--dangerously-skip-permissions"],
  "enabled": true,
  "permission_mode": "configure-before-start",

  "role": {
    "title": "产品设计师",
    "summary": "把需求转成界面设计、交互流程与示意图",
    "emoji": "🎨",
    "track": "spec"
  },
  "skills": ["design-spec"],
  "persona_dir": ".aiteam/crew/designer",
  "persona_file": "CLAUDE.md"
}
```

## Existing Fields

- `id`: stable agent id. It is also used as the tmux window name and matching key. It must not contain dots or colons.
- `name`: display name.
- `command`: executable used to start the agent.
- `args`: command arguments.
- `enabled`: whether the agent should be available to start.
- `permission_mode`: permission/startup policy used by the current app.

## M1 Extension Fields

All new fields are optional.

- `role`: employee identity metadata.
- `role.title`: panel title and primary role label.
- `role.summary`: concise description of the employee's responsibility.
- `role.emoji`: visual marker for the role.
- `role.track`: coarse workflow lane. M1 reserves `spec`, `impl`, and `verify`.
- `skills`: skill ids declared by the employee. M1 uses these for display and validation only.
- `persona_dir`: project-relative crew instance directory.
- `persona_file`: persona file name inside `persona_dir`.

## Runtime Rules

- If `persona_dir` exists and is non-empty, startup injects that persona context.
- If `persona_dir` is missing or empty, startup follows the old behavior.
- `persona_dir` is resolved relative to the project root.
- `persona_dir` should contain `persona_file` and `.claude/skills/`.
- Skill folders should use `.claude/skills/<skill>/SKILL.md`.

## Global Role Library

Global templates live under:

```text
~/.aiteam/roles/<id>/
  role.json
  CLAUDE.md
  .claude/
    skills/
      <skill>/
        SKILL.md
```

Each `<id>` should match the role template id and be usable as the future project agent id.

## Template `role.json`

`role.json` is the hiring template used to generate a project agent entry. It contains the project agent startup fields plus role metadata:

```jsonc
{
  "id": "designer",
  "name": "设计师",
  "role": {
    "title": "产品设计师",
    "summary": "把需求转成界面设计、交互流程与示意图",
    "emoji": "🎨",
    "track": "spec"
  },
  "command": "claude",
  "args": ["--dangerously-skip-permissions"],
  "skills": ["design-spec"],
  "persona_file": "CLAUDE.md",
  "permission_mode": "configure-before-start",
  "version": "0.1.0"
}
```

Required for M1 template validation:

- `role.json` must be valid JSON.
- `role.title` must be present and non-empty.
- `CLAUDE.md` must exist.
- At least one `.claude/skills/<skill>/SKILL.md` must exist.

## Current Seed Templates

The M1 global library includes:

- `designer`: 产品设计师 / 视觉与交互.
- `manager`: 总经理 / 项目负责人.
- `prd`: PRD / 产品需求文档.
