# Feature Spec: App-Level Agent Configuration

Date: 2026-06-11
Status: Implemented
Owner: AI Teams

## Summary

AI Teams now treats executable agent definitions as app-level configuration instead of project-level configuration.

Switching projects changes the workspace context:

- current working directory for relative agent commands
- docs tree
- runtime state
- tmux session name
- logs, status, task files, and document pins

Switching projects does not require each project to define its own `.aiteam/agents.json` before agents can be started.

## Problem Statement

The previous desktop app model coupled agent availability to the selected project:

```text
<project>/.aiteam/agents.json
```

That caused a bad project-switching experience. When the user switched from the AI Teams repo to another project, the app created or read that project's local `.aiteam/agents.json`. If that file had all agents disabled, the UI showed every agent as `Off` and displayed an empty-state message telling the user to enable agents inside the project.

That is the wrong ownership boundary. Codex, Claude Code, and Kimi are capabilities of the AI Teams app, not capabilities that every target project must configure independently.

## Goals

- Let users switch projects without losing the configured agent list.
- Keep app-level agent enablement stable across projects.
- Resolve relative agent `cwd` values against the currently selected project.
- Keep project-local runtime state, session logs, document pins, and docs scanning.
- Preserve demo mode, where a demo workspace can still provide `cat` agents for no-side-effect testing.
- Avoid changing the renderer contract: `api.listAgents()` still returns the same public agent state shape.

## Non-Goals

- Do not remove project-local `.aiteam` state directories.
- Do not build an agent marketplace or import UI in this feature.
- Do not change tmux routing, broadcast semantics, or handoff templates beyond where they are loaded from.
- Do not make every project write an agent config file.

## User-Facing Behavior

### Normal Project Switching

When the user switches to a normal project:

- The sidebar still shows the app's configured agents.
- Agents keep their app-level enabled/disabled state.
- Starting an agent runs it in the selected project directory when its configured `cwd` is relative.
- The docs tree changes to the selected project's `docs` folder.
- Runtime files remain project-specific under that project's `.aiteam` directory.

### Empty or Unconfigured Projects

A project no longer needs `.aiteam/agents.json` to use AI Teams agents.

The app may still create `.aiteam` as a workspace state directory, but agent definitions are not read from there unless the workspace is an explicit demo workspace.

### Demo Workspaces

`npm run dev:demo` still uses the workspace-local demo config generated under:

```text
.aiteam-demo/.aiteam/agents.json
```

That file is recognized only when every configured agent has `permission_mode: "demo-echo"`. This keeps smoke tests and UI/PTY routing tests backed by harmless `cat` agents.

## Configuration Model

### App-Level Config

The desktop app reads agent definitions from an app-owned config path:

```text
app.getPath("userData")/agents.json
```

For tests or advanced usage, the path can be overridden with:

```bash
AITEAMS_AGENT_CONFIG_PATH=/path/to/agents.json
```

The config contains:

- `routing`
- `handoff_template`
- `agents`

It does not own workspace identity or tmux session naming.

### Workspace Context

The app injects workspace context at runtime:

```js
workspace: {
  name: workspaceName(WORKSPACE_ROOT),
  root: WORKSPACE_ROOT,
  tmux_session: workspaceSessionName(WORKSPACE_ROOT)
}
```

This keeps tmux sessions separated per project while using the same app-level agent definitions.

### Migration

On first run, if the app-level config does not exist, the desktop app attempts to migrate agent definitions from the AI Teams repo's existing `.aiteam/agents.json`.

During migration:

- absolute `cwd` equal to the AI Teams app root becomes `.`
- relative or empty `cwd` becomes `.`
- other absolute `cwd` values are preserved for specialized agents

If no useful existing config is found, the app creates a default app-level config with Codex and Kimi enabled and Claude Code disabled.

## Implementation

### Main Process

Implemented in `src/main/main.cjs`:

- `appAgentConfigPath()` returns the app-owned config path.
- `defaultAppAgentConfig()` defines built-in agent defaults.
- `normalizeAgentConfig()` validates and normalizes app-level agent config.
- `loadAppAgentConfig()` loads, migrates, or creates app-level config.
- `loadWorkspaceDemoConfig()` preserves explicit demo workspaces.
- `loadConfig()` now returns app-level agent config plus injected workspace context.
- `prepareWorkspaceRoot()` creates workspace state directories without creating a project agent config.
- recent workspace filtering no longer requires `.aiteam/agents.json`.

### Renderer

The renderer empty state no longer tells users to edit project-local `.aiteam/agents.json`.

If no app-level agents are configured, it says:

```text
No agents are configured in AI Teams.
```

## Acceptance Criteria

- Switching to a project without `.aiteam/agents.json` still shows the app's configured agents.
- Starting an enabled app-level agent in a switched project uses the selected project as `cwd` when the agent config uses `cwd: "."`.
- Recent projects can include ordinary directories without `.aiteam/agents.json`.
- Demo mode continues to use demo `cat` agents.
- Build and PTY smoke tests still pass.

## Verification

Run:

```bash
npm run build
npm run doctor
npm run smoke:pty
```

Manual check after restarting the Electron app:

1. Switch from `AI_teams` to another project.
2. Confirm Codex/Kimi/Claude visibility follows the app-level config instead of the target project's `.aiteam/agents.json`.
3. Start an enabled agent.
4. Confirm its terminal starts in the selected project directory.

## Future Options

- Add an in-app settings surface for editing app-level agents.
- Add an import/export workflow for agent plugins.
- Add a visible "Agent config" action that opens the app-level `agents.json`.
