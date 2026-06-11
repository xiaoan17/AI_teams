# Agent Plugin and Import Design

## Summary

AI Teams should keep the current terminal-first workspace while reserving a clear path for importing agents, attaching provider-specific plugins, and adding richer per-agent controls later. The first UI change should stay small: compact rows in the sidebar, with room for a future "manage agents" entry point near the Agents heading.

## Goals

- Let users add agents without editing `.aiteam/agents.json` by hand.
- Keep imported agents compatible with the existing PTY lifecycle, routing, status, and session logs.
- Support future plugins that can add provider setup, metadata, validation, or optional UI panels.
- Avoid executing imported commands until the user explicitly starts the agent.

## Non-Goals

- No autonomous agent-to-agent orchestration in the import flow.
- No marketplace or remote plugin registry in the first iteration.
- No plugin runtime inside the renderer process for arbitrary third-party code.

## Proposed UI Slots

The current sidebar can stay compact:

- Agents heading: reserve an action button for `Import` or `Manage`.
- Agent row: show name, status dot, and start/stop action only.
- Agent details: use a future drawer or modal for command, cwd, args, environment, capabilities, and plugin settings.
- Empty/disabled state: provide an "Import agent" action when no enabled agents exist.

This keeps routine routing fast while moving infrequent setup details out of the always-visible sidebar.

## Import Sources

1. Built-in presets: Codex, Kimi, Claude Code, and future local CLIs.
2. Local JSON: a single-agent or multi-agent config file.
3. Command discovery: detect known CLIs on `PATH` and prefill command/args.
4. Plugin bundle: a signed or local plugin folder that contributes presets, validation, and setup instructions.

## Data Model

Keep `agents.json` as the source of truth for executable agents. Extend entries only with optional fields:

```json
{
  "id": "codex",
  "name": "Codex",
  "command": "codex",
  "args": ["--no-alt-screen"],
  "cwd": "/Users/anbc/Desktop/AI_teams",
  "enabled": true,
  "provider": "openai",
  "capabilities": ["terminal", "handoff"],
  "plugins": ["openai-codex-default"],
  "ui": {
    "accent": "#52b788"
  }
}
```

Future plugin metadata can live beside the config:

```json
{
  "plugins": [
    {
      "id": "openai-codex-default",
      "type": "agent-provider",
      "version": "0.1.0",
      "source": "builtin",
      "enabled": true
    }
  ]
}
```

The app should ignore unknown fields so old configs keep working.

## Import Flow

1. Select import source.
2. Parse into a draft agent config.
3. Validate id uniqueness, executable command, cwd, args shape, and enabled state.
4. Show a review screen with command details and any warnings.
5. Save to `.aiteam/agents.json`.
6. Refresh the agent list without auto-starting the imported agent.

## Plugin Responsibilities

Plugins should provide metadata and helpers, not direct renderer execution:

- Presets: default command, args, display name, provider id.
- Validators: command availability, minimum version, auth hints.
- Setup guidance: docs or commands the user can run manually.
- Optional capabilities: supported routing modes, handoff support, file context support.

Any command execution should go through the main process, with the same explicit user action model used for starting agents.

## Safety

- Imported configs are drafts until the user confirms.
- Environment variables should be stored separately from the visible agent row.
- Remote plugin installation should require checksum or signature verification before it is considered.
- Plugin UI extensions should be declarative where possible, not arbitrary renderer code.

## First Implementation Slice

- Add a Manage/Import button near the Agents heading.
- Build an import modal for built-in presets and local JSON.
- Add schema validation in the main process.
- Keep the compact sidebar row unchanged after import.
- Document unsupported fields as ignored rather than fatal.
