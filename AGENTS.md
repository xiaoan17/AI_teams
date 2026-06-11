# AI Teams Agent Notes

## Startup Convention

When the user says "启动测试 app", use the desktop app commands below.

### Formal App

Use this when testing against the real project agent configuration:

```bash
npm run dev
```

Current real-agent setup:

- `codex`: enabled
- `kimi`: enabled
- `claude`: disabled

### No-Side-Effect Demo

Use this when testing UI/PTY routing without calling real agent CLIs:

```bash
npm run dev:demo
```

This starts a demo workspace backed by `cat` agents.

### Verification

Before or after UI changes, run:

```bash
npm run build
npm run doctor
npm run smoke:pty
```

### Cleanup

Do not leave app processes running after verification unless the user asks to keep the app open.

Stop background dev processes with:

```bash
pkill -f '/Users/anbc/Desktop/AI_teams/node_modules/.bin/concurrently' 2>/dev/null || true
pkill -f '/Users/anbc/Desktop/AI_teams/node_modules/.bin/vite' 2>/dev/null || true
pkill -f '/Users/anbc/Desktop/AI_teams/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' 2>/dev/null || true
python3 aiteam.py stop 2>/dev/null || true
```
