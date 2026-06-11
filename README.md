# AI Teams

Local multi-agent terminal workspace.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/xiaoan17/AI_teams.git
cd AI_teams
npm install

# 2. Start the desktop app
npm run dev

# 3. Use the app
# - Agents are listed in the left sidebar
# - Type messages in the bottom composer
# - Use @codex, @kimi, or @all to route messages
# - Messages go to the focused agent panel if no @mention
```

**Requirements:** Python 3.10+, tmux, Node.js 20+, and agent CLIs (codex, claude, kimi, etc.)

---

## Overview

The repository now has two layers:

- M0 CLI prototype: `aiteam.py` uses tmux as the PTY host.
- M1 desktop app: Electron + React + xterm.js + node-pty for the product UI.

The current build is deliberately focused on validating the workflow from the
PRD:

- configure multiple local CLI agents
- start one tmux session with one pane per agent
- send `@agent` or `@all` messages from one command
- create handoff task documents under `.aiteam/tasks/`
- keep route/session/status records under `.aiteam/`

## Requirements

- Python 3.10+
- tmux
- Node.js 20+
- The actual agent CLIs you choose to enable, such as `codex`, `claude`, or
  `kimi`

## Desktop App

Install dependencies:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

Start the app:

```bash
npm run dev
```

Start a no-side-effect desktop demo with `cat`-backed agents:

```bash
npm run dev:demo
```

The desktop app reads `.aiteam/agents.json` from the workspace root, starts real
PTY processes with `node-pty`, renders them with xterm.js, and routes messages
from the bottom composer. Use `@codex`, `@kimi`, or `@all`; if no mention is
present, the message routes to the focused agent panel.

Use a different workspace root:

```bash
AITEAMS_WORKSPACE_ROOT=/path/to/workspace npm run dev
```

Build the renderer:

```bash
npm run build
```

## Quick Safe Demo

Use a scratch directory first. Demo agents run `cat`, so routed messages are only
echoed back in tmux panes.

```bash
mkdir -p /tmp/aiteam-demo
cd /tmp/aiteam-demo
python /Users/anbc/Desktop/AI_teams/aiteam.py init --demo
python /Users/anbc/Desktop/AI_teams/aiteam.py start
python /Users/anbc/Desktop/AI_teams/aiteam.py send '@all 请评审 PRD，并把意见写到 reviews/'
python /Users/anbc/Desktop/AI_teams/aiteam.py status
tmux attach -t "$(python - <<'PY'
import json
print(json.load(open('.aiteam/agents.json'))['workspace']['tmux_session'])
PY
)"
```

Stop the demo:

```bash
python /Users/anbc/Desktop/AI_teams/aiteam.py stop
```

## Real Workspace Flow

Initialize the workspace:

```bash
python aiteam.py init
```

Edit `.aiteam/agents.json`:

- set each agent's `command`, `args`, and `cwd`
- change `enabled` to `true` for agents you want to start
- keep real agents disabled until their commands are correct

Create a task document:

```bash
python aiteam.py new-task "architecture review" \
  --source PRD.md \
  --source PRODUCT_REQUIREMENTS.md \
  --agent codex \
  --agent claude \
  --goal "Review the M0 tmux prototype plan and identify blocking risks."
```

Start agents:

```bash
python aiteam.py start
```

Send a routed message:

```bash
python aiteam.py send '@codex 请先读任务文档并给出实现计划' \
  --task .aiteam/tasks/20260611-architecture-review.md
```

Broadcast:

```bash
python aiteam.py send '@all 上下文更新：请重新读取任务文档后继续'
```

Inspect:

```bash
python aiteam.py list
python aiteam.py doctor
python aiteam.py status --json
python aiteam.py capture codex --lines 120
```

Manage agents without editing JSON by hand:

```bash
python aiteam.py agent set codex --command codex --cwd /path/to/worktree --enable
python aiteam.py agent add reviewer --name "Review Shell" --command bash --arg -lc --arg 'cat' --cwd . --enable
python aiteam.py agent remove reviewer
```

## Files Written

```text
.aiteam/
  agents.json              # editable workspace + agent config
  runtime.json             # tmux pane ids and active log paths
  tasks/                   # handoff task markdown
  reviews/                 # suggested agent output directory
  sessions/
    timeline-YYYYMMDD.md   # routed messages
    <agent>/*.md           # submitted user messages
    <agent>/*.ansi.log     # raw pane transcript from tmux pipe-pane
  status/<agent>.json      # heuristic status snapshots
```

## Reliability Notes

The router uses tmux `load-buffer` and `paste-buffer -p` instead of simulated
key-by-key typing. By default it performs verify-before-enter: paste the message,
capture the pane, confirm the text is visible, then press Enter. If verification
fails, the message is not submitted to that pane.

This is still a PTY prototype. Full-screen TUIs can redraw or intercept input in
ways that require manual intervention. The intended MVP operating model is to
keep long context in task documents and route short handoff messages.
