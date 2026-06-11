# AI Teams

Local-first multi-agent terminal workspace.

Two entry points:

- Desktop app: Electron + React + xterm.js, one terminal panel per agent.
- CLI: `aiteam.py`, drives durable agent sessions in tmux panes.

## Install

Prerequisites: macOS or Linux, Node.js 20+, Python 3.10+, tmux, npm.

```bash
# install tmux if missing
brew install tmux              # macOS
sudo apt-get install tmux      # Debian/Ubuntu

git clone https://github.com/xiaoan17/AI_teams.git
cd AI_teams
npm install
```

Verify the install:

```bash
npm run doctor   # checks tmux, config, agent commands
npm run smoke    # checks tmux panes, capture, paste, cleanup
```

## Quick Start (safe demo)

Demo mode uses `/bin/cat` agents — no Codex, Claude, Kimi, or any paid CLI is called.

```bash
npm run dev:demo
```

This creates `.aiteam-demo/` locally and opens the desktop app with echo-only agents.

## Real Agent Mode

The checked-in `.aiteam/agents.json` is a safe template: all real agents are disabled. Enable only the agent CLIs you have installed:

```bash
python3 aiteam.py agent set codex --command codex --cwd . --enable
python3 aiteam.py agent set claude --command claude --cwd . --enable
python3 aiteam.py doctor
npm run dev
```

Keep uninstalled agents disabled:

```bash
python3 aiteam.py agent set kimi --disable
```

Real-agent sessions run in tmux, so closing or refreshing Electron does not kill them. Stop them with the app's `End` button or:

```bash
python3 aiteam.py stop
```

## CLI Only

The tmux router works without Electron:

```bash
mkdir -p /tmp/aiteam-demo && cd /tmp/aiteam-demo
python3 /path/to/AI_teams/aiteam.py init --demo
python3 /path/to/AI_teams/aiteam.py start
python3 /path/to/AI_teams/aiteam.py send '@all hello from AI Teams'
python3 /path/to/AI_teams/aiteam.py status
python3 /path/to/AI_teams/aiteam.py stop
```

## Workspace Files

Runtime data lives under `.aiteam/` and is git-ignored, except `agents.json` (versioned as a safe template):

```text
.aiteam/
  agents.json     # workspace + agent config
  runtime.json    # tmux pane ids, log paths
  tasks/          # handoff task markdown
  sessions/       # timelines and per-agent logs
  status/         # per-agent status json
```

## Troubleshooting

- `npm install` fails on Electron download:
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install`
- App opens but agents do not start: run `python3 aiteam.py doctor` and fix any `fail` rows (install the missing command, correct `cwd`, or disable the agent).
- `node-pty` build failures can be ignored: direct PTY is an optional fallback (`npm run smoke:pty`), the default flow is tmux-backed.

Before opening an issue, run `npm run build && npm run doctor && npm run smoke`.
