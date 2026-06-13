# Local Agent Detection and Free Composition

## Summary

AI Teams should make local agent detection a first-class capability and let users
freely compose up to **3 agent instances** of any type — including duplicates such as
three Kimi, or two Claude Code plus one Codex. Today `agents.json` ships a fixed
codex / claude / kimi trio, and each entry's `id` doubles as both the agent *type* and
the *instance* identifier. That coupling blocks both goals: the renderer cannot show
what is actually installed, and `normalizeAgentConfig` rejects a second Claude because
ids must be unique.

This design extends the existing detection and import machinery rather than introducing
new dependencies. It borrows the probing model from
[cc-switch](https://github.com/farion1231/cc-switch) (`scan_cli_version`): search PATH
plus package-manager directories, run `--version` to confirm runnability, distinguish
"installed but not runnable", and infer the install source.

## Goals

- Detect known agent CLIs on the machine and report install state, version, runnable
  status, resolved path, and inferred source.
- Surface detection in the UI: green (runnable), yellow (installed but not runnable,
  with diagnostic), grey (not installed, with an install-docs link).
- Let users compose up to 3 agent instances, with the same type allowed more than once.
- Keep the limit on the **total number of configured agents** in `agents.json`.
- Preserve the existing PTY / tmux lifecycle, routing, status, and session logs.
- Migrate old configs (no `type` field) transparently.

## Non-Goals

- No new probing engine in Rust or a new dependency — reuse the JS PATH search already
  present in `main.cjs`.
- No marketplace / remote registry.
- No auto-execution of detected CLIs; detection runs `--version` only.
- No change to spawn / tmux / routing internals (they already key off instance `id`).

## Current State (verified)

- PATH-based resolution already exists: `resolveExecutableCommand` (main.cjs:322),
  `commandAvailable` (:543), `discoveredBuiltinAgents` (:547),
  `mergeDiscoveredLocalAgents` (:556).
- `builtinAgentPresets` (:534) already carries a `provider` field
  (openai / anthropic / moonshot / google) and already includes **gemini**. This is the
  natural registry of "known agent types".
- The import path is complete: `AgentImportModal` (App.jsx:1383) →
  `importAgents` (main.cjs:646, with dryRun) → `validateImportedAgentDraft` (:577, which
  already does a PATH check and emits a warning when the command is missing).
- The instancing blocker is the `seen` uniqueness check in `normalizeAgentConfig` (:437),
  which is keyed on `id`.
- Layout already supports 1–3 panes: `terminalLayoutCount = min(max(len,1),3)`
  (App.jsx:1887).
- Spawn keys off the instance id: `config.agents.find(id === agentId)` (:1165) — so
  multiple instances of one type work without touching spawn.
- There is **no `type` field** today; `id` is the sole identifier.

## Part A — Local Agent Detection

### A1. Detection registry (reuse presets)

Use `builtinAgentPresets()` as the source of "known agent types" — no separate registry.
Each preset's `id` is the type key (codex / claude / kimi / gemini) and `command` is the
probe target. Add two optional preset fields:

- `versionArgs` — defaults to `["--version"]`.
- `docUrl` — install-docs link shown when the type is not installed (grey state).

### A2. Detection function (`main.cjs`, near `discoveredBuiltinAgents`)

```js
function detectAgentType(preset) {
  const resolved = resolveExecutableCommand(preset.command); // reuse, no new search
  if (!resolved) {
    return { type: preset.id, name: preset.name, command: preset.command,
             provider: preset.provider, installed: false, runnable: false,
             version: null, path: null, docUrl: preset.docUrl || null };
  }
  let version = null, runnable = false, diagnostic = null;
  try {
    const out = execFileSync(resolved, preset.versionArgs || ["--version"], {
      encoding: "utf8", timeout: 3000,
      env: augmentedEnvWithSearchPath()  // see A3
    });
    version = (out.match(/\d+\.\d+\.\d+[\w.-]*/) || [])[0] || out.trim().slice(0, 40);
    runnable = true;
  } catch (err) {
    diagnostic = String(err?.message || err).slice(0, 200); // installed but not runnable
  }
  return { type: preset.id, name: preset.name, command: preset.command,
           provider: preset.provider, installed: true, runnable, version,
           path: resolved, source: inferSource(resolved), diagnostic,
           docUrl: preset.docUrl || null };
}

function detectAllAgentTypes() {
  return builtinAgentPresets().map(detectAgentType);
}
```

### A3. Fix the child PATH when probing (the key pitfall)

claude / codex and friends are usually Node scripts. If the `--version` child does not
inherit a PATH containing `node`, it fails and the agent is wrongly flagged "installed
but not runnable". Add `augmentedEnvWithSearchPath()` that prepends
`executableSearchDirs()` (:142, already present) onto `process.env.PATH` for the probe.
This mirrors cc-switch's special handling of `.cmd` / `.bat` on Windows.

### A4. `inferSource(resolvedPath)` (small helper, borrowed from cc-switch)

Return a source label from path fragments: `.nvm` → `nvm`,
`/homebrew/` or `/opt/homebrew/` → `homebrew`, `.volta` → `volta`, `.bun` → `bun`,
`.cargo` → `cargo`, else `path`. UI hint only; not load-bearing.

### A5. IPC

- `main.cjs` (~:2585): `ipcMain.handle("agents:detect", () => detectAllAgentTypes());`
- `preload.cjs` (next to `listAgentPresets`): `detectAgents: () => ipcRenderer.invoke("agents:detect"),`

### A6. UI (App.jsx, in `AgentImportModal` Preset tab)

On open, call `api.detectAgents()` and render a status dot per type:

- Green `runnable` → show version + source.
- Yellow `installed && !runnable` → show `diagnostic`.
- Grey `!installed` → **disable that option** and show a `docUrl` install link.

## Part B — Free Composition (instancing, max 3)

### Core: add a `type` field; `id` becomes a pure instance identifier

- New `type` field points at the preset type key. `id` stays unique but may be
  `claude-1` / `claude-2`.
- Same-type instances inherit `command` / `args` / `provider` from the preset; any can be
  overridden.

### B1. Limit constant + check (total configured agents)

Add `const MAX_AGENTS = 3;` near the top of `main.cjs`. Enforce before write in
`importAgents` (:646):

```js
const projected = baseAgents.length + results.length;
if (projected > MAX_AGENTS) {
  throw new Error(`最多配置 ${MAX_AGENTS} 个 agent(当前 ${baseAgents.length}）`);
}
```

The dryRun branch (:670) carries the same message so the UI sees it in preview.

### B2. Multiple instances no longer rejected by type

- `validateImportedAgentDraft` (:577): keep the `id` uniqueness check (instance ids
  should be unique). Add `instanceIdFor(type, takenIds)` that increments `type-1`,
  `type-2`, … until free; the UI uses it after the user picks a type.
- Accept and validate the optional `type` (must match a preset id; mismatch → warning,
  not fatal). When a draft omits `command`, inherit it from the preset for `type`.

### B3. `normalizeAgentConfig` (:428) — `type` + migration

- Inside the map: `next.type = String(agent.type || agent.id).trim();` (old configs with
  no `type` fall back to `id`, so they upgrade smoothly).
- Keep uniqueness on `id` (instancing relies on distinct ids).

### B4. Tame auto-discovery side effects

`mergeDiscoveredLocalAgents` (:556) currently appends every detected CLI to the config,
which would fight the limit of 3 under a "user composes freely" model. Change it to seed
a single default instance **only when the config is empty** (first run / no agents);
when non-empty, stop auto-appending and let the user add via the UI.

### B5. Composition UI (App.jsx `AgentImportModal` Preset tab)

- The preset dropdown becomes a "pick a type" control (not-installed types greyed, from
  A6).
- Picking a type auto-fills `type`, generates an instance `id`, sets a default name
  `${preset.name} #${n}`, and inherits command / args.
- Display name, args, and cwd remain editable. The same type can be added repeatedly;
  once the config hits 3, the Add / Import action is disabled with an "at the limit" hint.
- Reuse the existing dryRun → review → import three-step flow; no rewrite.

### B6. Remove / replace (sidebar)

A limit of 3 is a dead end without a way to make room, so each sidebar agent row carries a
remove (🗑) action, visible on hover in every state (running / stopped / off).

- Main process: `removeAgent(agentId)` — best-effort `stopAgent` first, drop the entry
  from `agents.json`, and repair `routing.default_agent` if it pointed at the removed
  agent. Blocked in the demo workspace, same as import.
- IPC `agents:remove`; preload exposes `removeAgent`.
- Renderer: a confirm dialog, then `api.removeAgent` followed by `refreshAgents`.
- "Replace" is remove-then-add: free a slot, then add the desired type — no separate
  swap flow needed.

## Data Model

`agents.json` stays the source of truth. An instance entry gains one optional field
(`type`); unknown fields are still ignored so old configs round-trip.

```json
{
  "id": "claude-2",
  "type": "claude",
  "name": "Claude Code #2",
  "command": "claude",
  "args": [],
  "cwd": ".",
  "enabled": true,
  "provider": "anthropic",
  "permission_mode": "configure-before-start"
}
```

## Files to Change

| File | Change |
|---|---|
| `src/main/main.cjs` | Add `detectAgentType` / `detectAllAgentTypes` / `inferSource` / `augmentedEnvWithSearchPath` / `instanceIdFor` (now in `agent-detect.cjs`); extend `builtinAgentPresets` with `versionArgs` / `docUrl`; add `type` migration in `normalizeAgentConfig`; add `MAX_AGENTS` check in `importAgents`; accept `type` + inherit `command` in `validateImportedAgentDraft`; narrow `mergeDiscoveredLocalAgents` to "seed only when empty"; add `removeAgent`; add `agents:detect` / `agents:remove` / `shell:openExternal` IPC |
| `src/main/agent-detect.cjs` | Electron-free detection helpers, dependency-injected for unit testing |
| `src/main/preload.cjs` | Expose `detectAgents`, `removeAgent`, `openExternal` |
| `src/renderer/App.jsx` | `AgentImportModal`: detection status display (grey + docs link), pick-type-builds-instance, disable at limit of 3; sidebar agent row gains a remove action |
| `scripts/agent-detect-smoke.cjs` | Unit smoke for the detection module, wired into `npm run smoke` |

## Verification

1. **Detection smoke** — add `scripts/agent-detect-smoke.cjs` in the existing smoke style;
   assert installed CLIs return `runnable: true` with a non-empty version, and missing
   ones return `installed: false`. Wire into `npm run smoke`.
2. **Multi-instance manual** — `npm run dev`, open the modal, add 2 Claude + 1 Codex,
   confirm `agents.json` shows `claude-1` / `claude-2` / `codex-1` with correct `type`,
   and three terminal panes start.
3. **Limit manual** — with 3 configured, adding more disables Import with the
   "最多配置 3 个" hint.
4. **Migration manual** — start with an old `agents.json` (no `type`), confirm `type=id`
   is backfilled, no error, and existing agents still start.
5. **Regression** — `npm run smoke` stays green (tmux / view / input / recovery / runtime
   / wheel unaffected).

## Safety

- Detection runs `--version` only — no agent command is executed beyond version probing.
- Imported configs remain drafts until the user confirms (existing model).
- The limit is enforced in the main process, not just the UI.
