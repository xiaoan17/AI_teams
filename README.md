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

## Quick Start

AI Teams is meant to run your own agent CLIs locally. The desktop app uses an app-level agent config, so you can switch projects without re-creating the same Codex / Claude Code / Kimi setup each time.

```bash
npm run dev
```

On first launch, the desktop app creates its user-level config at `~/Library/Application Support/ai-teams/agents.json` on macOS. The default desktop config enables Codex, Claude Code, and Kimi; disable or edit any agent you do not use in that user-level config. On later launches, the app also scans your local executable path for known CLI agents such as Codex, Claude Code, Kimi, and Gemini, then appends newly discovered agents that are not already in the app-level config.

Run this when you want to inspect config paths or troubleshoot missing CLIs:

```bash
npm run doctor
```

## Safe Demo

Demo mode is only for no-side-effect UI and routing tests. It uses `/bin/cat` agents, so no Codex, Claude, Kimi, or paid CLI is called.

```bash
npm run dev:demo
```

This creates `.aiteam-demo/` locally and opens the desktop app with echo-only agents.

## Agent Config Ownership

The desktop app and the CLI read different agent configs on purpose:

- **Desktop app** (`npm run dev`): agents are app-level capabilities. The config lives in Electron user data — on macOS `~/Library/Application Support/ai-teams/agents.json` — and is created with defaults on first launch. Override the location with the `AITEAMS_AGENT_CONFIG_PATH` env var. Switching projects keeps the same agent list; relative agent `cwd` values resolve against the selected project. The app expands the macOS desktop `PATH` with your login shell path plus common install locations before scanning, so agents installed under Homebrew, `~/.local/bin`, or `~/.kimi-code/bin` can be found even when launching from Finder.
- **CLI** (`aiteam.py`): the workspace-local `.aiteam/agents.json` is canonical. `init`, `agent set`, `start`, `send`, and `status` all read and write it.
- **Demo mode** (`npm run dev:demo`): the only case where the desktop app reads a workspace `.aiteam/agents.json`, and only when every agent in it has `permission_mode: "demo-echo"`.

The checked-in `.aiteam/agents.json` in this repository is a safe template (all real agents disabled, relative `cwd`). Keep machine-specific edits out of version control; `npm run release:check` rejects absolute local paths and enabled real agents in the template.

Run `python3 aiteam.py doctor` to print both config paths and validate the CLI config.

## CLI Real Agent Mode

For the **CLI / tmux router**, the checked-in `.aiteam/agents.json` is a safe template with all real agents disabled. Enable only the agent CLIs you have installed:

```bash
python3 aiteam.py agent set codex --command codex --cwd . --enable
python3 aiteam.py agent set claude --command claude --cwd . --enable
python3 aiteam.py doctor
```

Keep uninstalled agents disabled:

```bash
python3 aiteam.py agent set kimi --disable
```

Real-agent sessions run in tmux, so closing or refreshing Electron does not kill them. Stop them with the app's `Stop` button or:

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

Runtime data lives under `.aiteam/` and is git-ignored, except `agents.json` (versioned as a safe template; canonical for the CLI, used by the desktop app only in demo mode):

```text
.aiteam/
  agents.json     # workspace + agent config (CLI canonical, safe template in git)
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
- `npm run smoke` (and `release:check:full`) needs real tmux socket access; sandboxed environments that block `/private/tmp/tmux-*` fail with `error connecting to /private/tmp/tmux-.../default (Operation not permitted)`. Run it outside the sandbox.

Before opening an issue, run `npm run release:check` (static checks: config hygiene, build, doctor) and, where tmux is available, `npm run release:check:full` (adds tmux smoke tests).
