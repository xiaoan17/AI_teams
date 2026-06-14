# AI Teams Agent Notes

## Startup Convention

When the user says "启动测试 app", use the desktop app commands below.

### Formal App

Use this when testing against the real project agent configuration:

```bash
npm run dev
```

Current real-agent setup (desktop app-level config in Electron userData, not the versioned `.aiteam/agents.json` template — see README "Agent Config Ownership"):

- `codex`: enabled
- `kimi`: enabled
- `claude`: enabled

### No-Side-Effect Demo

Use this when testing UI/PTY routing without calling real agent CLIs:

```bash
npm run dev:demo
```

This starts a demo workspace backed by `cat` agents.

## Terminal / Workspace Regression Guards

Before changing tmux terminal input, composer routing, workspace switching, tmux view cleanup, or runtime recovery, read:

- `docs/issues/20260614-terminal-input-and-workspace-switch-regressions.md`

High-risk invariants:

- Do not send the entire xterm input stream through `paste-buffer`. Text may be pasted, but Enter, Backspace, arrows, Tab, Escape, and other control keys must go through tmux `send-keys` via `src/main/tmux-input.cjs`.
- Workspace switch is not Stop All. Switching projects may destroy embedded view sessions and clear UI/status caches, but must not kill the old workspace base tmux session or agent processes.
- Async tmux reconcile work must be workspace-epoch guarded so old workspace state cannot emit into the new workspace UI.

Focused verification for these areas:

```bash
npm run smoke:tmux-input
npm run smoke:tmux-view
npm run smoke:tmux-recovery
npm run smoke:tmux-zombie-recovery
```

### Verification

Before or after UI changes, run:

```bash
npm run build
npm run doctor
npm run smoke:pty
```

### Cleanup

Do not leave app processes running after verification unless the user asks to keep the app open.

Stop background dev processes from the repository root with:

```bash
pkill -f "$PWD/node_modules/.bin/concurrently" 2>/dev/null || true
pkill -f "$PWD/node_modules/.bin/vite" 2>/dev/null || true
pkill -f "$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" 2>/dev/null || true
python3 aiteam.py stop 2>/dev/null || true
```
