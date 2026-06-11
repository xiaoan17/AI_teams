# AI Teams

Local-first multi-agent terminal workspace.

AI Teams provides two entry points:

- Desktop app: Electron + React + xterm.js UI for multiple agent terminals.
- CLI prototype: `aiteam.py` uses tmux panes as durable agent sessions.

For a first run, use the safe demo. It uses `/bin/cat` agents, so it does not call Codex, Claude, Kimi, or any paid/external agent CLI.

## Requirements

- macOS or Linux with a POSIX shell
- Node.js 20 or 22 LTS recommended
- Python 3.10+
- tmux
- npm

For real agent mode you also need the agent CLIs you enable, for example `codex`, `claude`, or `kimi`.

Install tmux if needed:

```bash
# macOS
brew install tmux

# Debian/Ubuntu
sudo apt-get install tmux
```

## Quick Start

```bash
git clone https://github.com/xiaoan17/AI_teams.git
cd AI_teams
npm install
npm run doctor
npm run smoke
npm run dev:demo
```

`npm run dev:demo` creates `.aiteam-demo/` locally and starts the desktop app with echo-only demo agents. Demo mode uses tmux when tmux is installed and only falls back to direct PTY mode when tmux is missing.

## Real Agent Mode

The checked-in `.aiteam/agents.json` is a safe template: real agents are disabled by default. Configure the agents you actually have installed, then enable them.

```bash
python3 aiteam.py agent set codex --command codex --cwd . --enable
python3 aiteam.py agent set kimi --command kimi --cwd . --enable
python3 aiteam.py doctor
npm run dev
```

If an agent CLI is not installed, keep that agent disabled:

```bash
python3 aiteam.py agent set claude --disable
```

The desktop app uses tmux for real-agent sessions by default. Closing or refreshing Electron does not kill the tmux session. Use the app's `End` button or:

```bash
python3 aiteam.py stop
```

Attach to the same tmux session manually:

```bash
tmux attach -t "$(python3 - <<'PY'
import json
print(json.load(open('.aiteam/agents.json'))['workspace']['tmux_session'])
PY
)"
```

## CLI Demo

You can also test the tmux router without Electron:

```bash
mkdir -p /tmp/aiteam-demo
cd /tmp/aiteam-demo
python3 /path/to/AI_teams/aiteam.py init --demo
python3 /path/to/AI_teams/aiteam.py start
python3 /path/to/AI_teams/aiteam.py send '@all hello from AI Teams'
python3 /path/to/AI_teams/aiteam.py status
python3 /path/to/AI_teams/aiteam.py stop
```

Replace `/path/to/AI_teams` with the clone path on your machine.

## Verification

Run these before opening an issue:

```bash
npm run build
npm run doctor
npm run smoke
```

What they check:

- `build`: renderer build succeeds.
- `doctor`: tmux, workspace config, enabled agent commands, and cwd values are valid.
- `smoke`: tmux panes, pane capture, buffer paste, and cleanup work.

Optional direct PTY fallback check:

```bash
npm run smoke:pty
```

Direct PTY mode depends on the optional native `node-pty` package. It is not required for the default tmux-backed desktop flow.

## Workspace Files

AI Teams writes local runtime data under `.aiteam/`:

```text
.aiteam/
  agents.json              # editable workspace + agent config
  runtime.json             # tmux pane ids and active log paths
  tasks/                   # handoff task markdown
  reviews/                 # suggested agent output directory
  sessions/
    timeline-YYYYMMDD.md
    <agent>/*.md
    <agent>/*.ansi.log
  status/<agent>.json
```

Runtime files are ignored by Git. Only `.aiteam/agents.json` is intended to be versioned as a safe template.

## Troubleshooting

If `npm install` fails on Electron download, try:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

If the app opens but agents do not start:

```bash
python3 aiteam.py doctor
```

Fix any `fail` rows by installing the missing command, correcting `cwd`, or disabling the agent.

If optional `node-pty` fails to build or `npm run smoke:pty` fails, the default tmux-backed app can still run because direct PTY support is loaded only when needed. Re-run `npm install` after installing native build tools for your platform if you specifically need direct PTY fallback.
