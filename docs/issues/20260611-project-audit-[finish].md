# Project Audit: Bugs and Open Issues

Date: 2026-06-11

This note summarizes the current project health check. The core tmux and PTY paths are passing smoke tests, but the repository has configuration and release-readiness issues that should be fixed before publishing or using the checked-in defaults as a clean template.

## Verification Summary

Commands run:

- `npm run build`: passed. Vite reported a chunk-size warning for the renderer bundle.
- `npm run doctor`: passed for the current local machine.
- `npm run smoke`: failed inside the sandbox because tmux socket access under `/private/tmp` was blocked, then passed when run outside the sandbox.
- `npm run smoke:pty`: passed.
- `npm run release:check`: failed because the checked-in `.aiteam/agents.json` contains local machine paths and enabled real agents.

## Issue 1: Checked-In Agent Config Is Not Release-Safe

Severity: High

`release:check` rejects the current `.aiteam/agents.json` because it contains:

- Local absolute paths under the developer's home directory.
- Real agents enabled by default: `codex`, `claude`, and `kimi`.

Evidence:

- `.aiteam/agents.json` currently sets each agent `cwd` to the repository's absolute local path.
- `.aiteam/agents.json` currently sets all three agents to `"enabled": true`.
- `scripts/release-check.cjs` explicitly forbids known local home-directory paths, absolute default cwd values, and enabled real agents in the default config.

Impact:

- The project cannot pass `npm run release:check`.
- A clone of the repository may inherit machine-specific paths.
- A first run may call real agent CLIs unexpectedly if the template is used directly.

Recommended fix:

- Restore the checked-in `.aiteam/agents.json` to a safe template:
  - Use `"cwd": "."`.
  - Set real agents to `"enabled": false`.
  - Keep user-specific enabled-agent state out of the versioned template.
- Store real local agent preferences in Electron userData, an ignored local file, or an explicit `AITEAMS_AGENT_CONFIG_PATH`.

## Issue 2: Config Ownership Is Ambiguous

Severity: High

The desktop app and CLI now appear to treat agent configuration differently:

- The desktop app loads a user-level agent config via `app.getPath("userData")`, with workspace state layered around it.
- Demo mode can still load a workspace `.aiteam/agents.json`.
- The CLI still treats `.aiteam/agents.json` as the canonical workspace config.
- README says `.aiteam/agents.json` is versioned as a safe template and tells users to edit it for real agent mode.

Impact:

- Users may edit `.aiteam/agents.json` and not understand whether the desktop app will use it.
- CLI behavior and desktop behavior can drift.
- Documentation can become misleading, especially around real-agent setup.

Recommended fix:

- Choose one explicit model:
  - Option A: workspace-local `.aiteam/agents.json` remains canonical for both CLI and desktop.
  - Option B: desktop uses user-level agent config, while `.aiteam/agents.json` is only a safe project template or CLI config.
- Update README and `doctor` output to describe the chosen model.
- If Option B is kept, add a visible command or UI path for showing and editing the active desktop agent config path.

## Issue 3: `aiteam.py init` Writes Absolute `cwd` Values

Severity: Medium

`aiteam.py default_config()` writes `cwd` as `str(root)` for both demo and non-demo agents.

Impact:

- Fresh generated configs contain machine-specific paths.
- This conflicts with the release check expectation that default agent cwd values are relative.
- Configs become less portable between machines and directories.

Recommended fix:

- For non-demo config, write `"cwd": "."`.
- For demo config, consider writing `"cwd": "."` as well unless `/bin/cat` or another command genuinely requires a resolved root.
- Keep runtime-resolved absolute paths as derived values, not persisted template values.

## Issue 4: Local Paths Remain in Docs and Agent Notes

Severity: Medium

Local paths appear outside `.aiteam/agents.json`, including:

- Cleanup commands in `AGENTS.md`.
- Historical examples in `docs/features/*`.

Impact:

- Release scanning currently checks only a small fixed file list, so these paths can slip through.
- Public docs may expose local usernames or machine layout.
- New contributors may copy commands that only work on one machine.

Recommended fix:

- Replace local absolute paths with repository-relative commands where possible.
- Expand `release-check.cjs` to scan all relevant tracked Markdown and source files, excluding generated/runtime directories.
- Keep intentionally local operational notes out of release-facing docs, or mark them clearly as local-only.

## Issue 5: Release Check Depends on tmux Socket Permissions

Severity: Medium

`npm run release:check` calls `npm run smoke`, and `smoke` requires tmux socket access. This works outside the sandbox but fails in restricted environments with:

```text
error connecting to /private/tmp/tmux-501/default (Operation not permitted)
```

Impact:

- Automated checks may fail in sandboxes even when project functionality is healthy.
- The failure can obscure the real release issues reported earlier in the same command.

Recommended fix:

- Split release checks into tiers:
  - Static release checks: config hygiene, forbidden paths, syntax checks, build.
  - Runtime smoke checks: tmux-dependent integration tests.
- Document that tmux smoke checks require unsandboxed tmux socket access on macOS.
- Consider allowing `release:check` to print a clear environment-specific message for tmux permission failures.

## Issue 6: Renderer Bundle Size Warning

Severity: Low

`npm run build` passes but Vite reports a chunk larger than 500 kB after minification.

Impact:

- Not currently a functional bug.
- Startup and reload performance may degrade as the app grows.

Recommended fix:

- Defer unless app startup becomes noticeably slow.
- If needed, split rarely used UI areas or xterm-related code with dynamic imports.

## Priority Order

1. Restore `.aiteam/agents.json` to a safe, portable template.
2. Decide and document the canonical agent config ownership model.
3. Change `aiteam.py init` so generated non-demo configs use relative `cwd` values.
4. Remove or generalize local paths in docs and expand release scanning.
5. Split static release checks from tmux runtime checks.
6. Revisit bundle splitting only when performance requires it.

## Resolution (2026-06-11)

- Issue 1 — fixed. `.aiteam/agents.json` restored to the safe template: `"cwd": "."` and `"enabled": false` for all real agents. Local preferences live in the desktop user-level config (or `AITEAMS_AGENT_CONFIG_PATH`); CLI users re-enable locally with `aiteam agent set <id> --enable` without committing.
- Issue 2 — fixed (Option B documented). Desktop uses the Electron userData `agents.json`; the workspace `.aiteam/agents.json` is canonical for the CLI and read by the desktop app only in demo mode. README gained an "Agent Config Ownership" section, and `aiteam.py doctor` now prints both config paths (`cli_config` / `desktop_config` info rows).
- Issue 3 — fixed. `aiteam.py default_config()` writes `"cwd": "."` for demo and non-demo agents; absolute paths stay runtime-resolved via `resolve_agent_cwd`.
- Issue 4 — fixed. Local absolute paths removed from `AGENTS.md` (now `$PWD`-relative pkill commands) and `docs/features/*` examples; `release-check.cjs` now scans all git-tracked text files instead of a fixed list.
- Issue 5 — fixed. `npm run release:check` runs the static tier only (config hygiene, forbidden-path scan, syntax checks, build, doctor); `npm run release:check:full` adds the tmux smoke tier and prints a clear hint when the tmux socket is blocked by a sandbox.
- Issue 6 — deferred by design; revisit if startup slows down.
