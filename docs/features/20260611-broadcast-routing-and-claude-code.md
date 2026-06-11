# Feature Spec: Broadcast Routing and Claude Code Integration

Date: 2026-06-11
Status: Draft for implementation
Owner: AI Teams

## Summary

This feature formalizes two related pieces of routing behavior:

1. When the user enters `@all` or `@ all`, AI Teams broadcasts the same message to every active agent target.
2. Claude Code remains a first-class agent preset and can be enabled later without changing the routing model.

The current repository already contains partial support for `@all` in both layers:

- Desktop app: `src/main/main.cjs` parses mentions and writes to `node-pty` sessions.
- M0 CLI: `aiteam.py send` parses mentions and writes to tmux panes.
- Config: `.aiteam/agents.json` already has `codex`, `kimi`, and disabled `claude` entries.

This spec turns that behavior into a clear contract and highlights the implementation gaps before the next code change.

## Goals

- Support both `@all` and `@ all` as broadcast syntax.
- Send one identical final message body to each resolved target.
- Keep disabled agents out of `@all` broadcasts.
- Fail safely before delivery when any selected target is invalid or not ready.
- Preserve one timeline entry and one per-agent session entry for broadcast messages.
- Keep Claude Code integration config-driven so enabling `claude` later does not require new routing logic.

## Non-Goals

- Do not implement agent-to-agent autonomous conversation.
- Do not make disabled agents auto-start on `@all` in the first implementation.
- Do not depend on Claude Code-specific APIs for basic message delivery.
- Do not interpret agent output semantically beyond the existing status heuristics.

## User-Facing Behavior

### Supported Input Forms

The composer and CLI should accept these equivalent broadcast forms:

```text
@all 请评审当前项目
@ all 请评审当前项目
@All 请评审当前项目
@ ALL 请评审当前项目
```

All examples route the same final message:

```text
请评审当前项目
```

### Explicit Targets Still Work

These forms remain supported:

```text
@codex 请实现功能
@codex @kimi 请分别给出看法
@ codex @ kimi 请分别给出看法
```

Whitespace after `@` is optional for all agent ids, not only `all`.

### Default Target

If the message has no mention:

- Desktop app sends to the focused agent panel.
- CLI sends to `routing.default_agent`.

This keeps the current behavior.

### Broadcast Target Set

`@all` means all agents that are:

- present in `.aiteam/agents.json`
- `enabled !== false`
- valid for the current runtime

Disabled agents are not part of the broadcast. In the current real-agent setup, this means:

- included: `codex`, `kimi`
- excluded: `claude`

When Claude Code is enabled later, it automatically becomes part of `@all`.

### Message Body

The message body sent to each agent is identical after route mentions are removed.

Example:

```text
@ all 你们对当前项目有什么看法吗
```

Final message sent to every target:

```text
你们对当前项目有什么看法吗
```

When a task document is selected, each target receives the same handoff prefix plus the same user supplement:

```text
请先阅读任务文档：/abs/path/to/task.md；按文档中的目标、约束和产出路径工作，长上下文以文件内容为准。 用户补充：你们对当前项目有什么看法吗
```

## Failure Semantics

Broadcast delivery must avoid preventable partial sends.

### Preflight Failures

Before writing to any PTY, the router should validate every target:

- target exists
- target is enabled
- target has a running desktop PTY or tmux pane
- target is not in a terminal error/exited state

If any preflight check fails, no target receives the message. The user sees a concrete error such as:

```text
Cannot send broadcast. Not running: claude. Start the agent or disable it.
```

### Delivery Failures

Some failures can only happen during delivery, for example PTY write errors or tmux injection verification failure.

For those, return and log per-target results:

- `sent`
- `failed`
- `reason`

The UI notice should make partial delivery explicit:

```text
Sent to @codex @kimi; failed for @claude: Agent is not running
```

The CLI should exit non-zero when any target fails.

## Logging Requirements

For one broadcast action:

- Append one timeline entry under `.aiteam/sessions/timeline-YYYYMMDD.md`.
- Append the same final message to each target session markdown log.
- Include all target ids in the timeline entry.
- If partial delivery occurs, record failed target ids and reasons in the timeline entry.

The timeline should record the normalized target set, not the raw mention spelling. For example `@ all`, `@all`, and `@ALL` all log as `codex, kimi`.

## Implementation Plan

### 1. Normalize Mention Parsing

Update both routing implementations:

- `src/main/main.cjs`
- `aiteam.py`

Use equivalent parsing rules:

- match `@` followed by optional whitespace
- capture `[A-Za-z0-9_-]+`
- compare ids case-sensitively except `all`, which is case-insensitive
- deduplicate targets while preserving config order
- strip route mentions from the submitted message

Expected examples:

| Raw input | Targets | Routed message |
|---|---|---|
| `@all hello` | all enabled agents | `hello` |
| `@ all hello` | all enabled agents | `hello` |
| `@codex @ kimi hello` | `codex`, `kimi` | `hello` |
| `@all @codex hello` | all enabled agents | `hello` |
| `hello` | default/focused target | `hello` |

### 2. Desktop Main Process Changes

In `src/main/main.cjs`:

- Replace `mentionPattern` with a parser that accepts optional whitespace.
- Resolve `@all` from enabled agents in config order, not alphabetical order.
- Add a preflight step before `writeToAgent`.
- Make `routeMessage` return structured delivery results:

```js
{
  targets: ["codex", "kimi"],
  message: "你们对当前项目有什么看法吗",
  results: [
    { id: "codex", status: "sent" },
    { id: "kimi", status: "sent" }
  ]
}
```

- Keep the existing plain `targets` and `message` fields so the renderer change stays small.

Current gap to fix: `routeMessage` writes targets sequentially. If a later `writeToAgent` throws, earlier targets may already have received the message.

### 3. Renderer Changes

In `src/renderer/App.jsx`:

- Update the composer preview regex to support `@ all`.
- Prefer server-side route preview in a future iteration so renderer and main process cannot drift.
- Show disabled agents as excluded from `@all`.
- Show a clear notice when broadcast is blocked by a stopped target.

Minimal first implementation can keep preview local, as long as it mirrors the main-process parser.

### 4. CLI Changes

In `aiteam.py`:

- Update `MENTION_RE` to support optional whitespace and case-insensitive `all`.
- Preserve config order for broadcast targets.
- Preflight all runtime panes before calling `paste_and_enter`.
- Keep verify-before-enter behavior.
- If injection verification fails for one target, continue attempting remaining targets but exit non-zero and report all failures.

Current CLI behavior already verifies before pressing Enter, which is safer than the desktop path. The missing piece is whitespace parsing and all-target preflight.

### 5. Claude Code Preset

Claude Code should remain a normal agent config entry:

```json
{
  "id": "claude",
  "name": "Claude Code",
  "command": "claude",
  "args": [],
  "cwd": "/Users/anbc/Desktop/AI_teams",
  "enabled": false,
  "permission_mode": "configure-before-start"
}
```

MVP integration requirements:

- `doctor` validates the `claude` binary only when `enabled: true`.
- Desktop app shows Claude Code in the agent list even while disabled.
- Enabling Claude Code makes it eligible for `@all`.
- Routing uses the same PTY write path as Codex and Kimi.

Future Claude-specific enhancements:

- Add a Claude Code template in the UI agent manager.
- Add status hooks if Claude Code exposes stable process-external events.
- Add safer permission presets after the user confirms their preferred Claude Code operating mode.

### 6. Project Document File Tree

The left sidebar document browser should scale beyond a single `docs` folder with a flat file list. Replace the `DOCS` folder picker with a `FILES` tree that behaves like a compact macOS Finder or VS Code outline:

- `src/main/main.cjs` recursively indexes `docs` and returns both a structured tree and the existing flat `documents` array.
- The flat `documents` array remains the source for the Handoff select, so handoff behavior does not need a second document index.
- Tree folders can be expanded and collapsed independently.
- Search filters by file name, relative path, folder path, and absolute path; matching searches temporarily expand the visible result paths.
- Pinned files stay visually marked and sort ahead of unpinned sibling files.
- The sidebar keeps the existing file actions: open file, insert relative path into the composer, and pin/unpin.
- Hidden folders and noisy build/dependency folders such as `.git`, `node_modules`, `dist`, `build`, `coverage`, and `out` are excluded from indexing.

Returned tree nodes use this shape:

```js
{
  type: "folder",
  name: "features",
  key: "features",
  relativePath: "docs/features",
  documentCount: 1,
  children: [
    {
      type: "document",
      name: "20260611-broadcast-routing-and-claude-code.md",
      relativePath: "docs/features/20260611-broadcast-routing-and-claude-code.md",
      folder: "features",
      pinned: true
    }
  ]
}
```

Initial expansion should include `docs` and the ancestor folders for pinned or recently visible documents. Empty search results should show a quiet `No matching files` state.

## Acceptance Criteria

### Desktop Demo

Use the no-side-effect demo:

```bash
npm run dev:demo
```

Expected:

- Enabled demo agents include `codex`, `claude`, and `kimi`.
- Sending `@ all hello team` writes `hello team` to all enabled demo terminals.
- Sending `@all hello team` behaves the same.
- Sending `@codex @ kimi hello` writes `hello` only to Codex and Kimi.
- Session logs contain the final routed message without mention tokens.

### Real App

Use:

```bash
npm run dev
```

With the current real setup:

- `@all hello` routes only to enabled agents: `codex` and `kimi`.
- Disabled `claude` is not included.
- If one enabled target is stopped, the broadcast is blocked before writing to any running target.

### Document File Tree

Expected:

- The left sidebar shows `FILES`, not `DOCS`.
- `docs/features/20260611-broadcast-routing-and-claude-code.md` appears under an expandable `docs > features` tree.
- Searching for `broadcast`, `features`, or part of the relative path keeps the matching file visible.
- Collapsing and expanding folders does not change the Handoff document list.
- Pin/unpin and insert-path actions still work from the file row.

### CLI

Use a demo workspace:

```bash
python3 aiteam.py --root .aiteam-demo init --demo --force
python3 aiteam.py --root .aiteam-demo start
python3 aiteam.py --root .aiteam-demo send '@ all hello team'
python3 aiteam.py --root .aiteam-demo capture codex --lines 20
python3 aiteam.py --root .aiteam-demo capture claude --lines 20
python3 aiteam.py --root .aiteam-demo capture kimi --lines 20
```

Expected:

- Each capture includes `hello team`.
- Timeline includes all three targets.

### Verification Commands

Run before finishing implementation:

```bash
npm run build
npm run doctor
npm run smoke:pty
```

Stop background app processes after verification unless explicitly asked to keep them open.

## Open Questions

- Should desktop `@all` auto-start stopped enabled agents, or should it keep the safer preflight-blocking behavior?
- Should `@all` include enabled agents that are not visible due to a future UI filter?
- Should mention matching be limited to the beginning of the message, or should inline mentions continue to route?
- Should duplicate explicit mentions be reported to the user or silently deduplicated?

Recommended first answer: keep current inline mention behavior, silently deduplicate, and require agents to be running before broadcast delivery.
