#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import io
import json
import shlex
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import aiteam  # noqa: E402


def assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}\nexpected: {expected!r}\nactual:   {actual!r}")


def assert_in(member: object, container: object, message: str) -> None:
    if member not in container:
        raise AssertionError(f"{message}\nmissing: {member!r}\ncontainer: {container!r}")


def assert_not_in(member: object, container: object, message: str) -> None:
    if member in container:
        raise AssertionError(f"{message}\nunexpected: {member!r}\ncontainer: {container!r}")


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        crew = root / ".aiteam" / "crew" / "designer"
        crew.mkdir(parents=True)
        persona = '你是 "设计师" with spaces'
        codex_instructions = "Codex role instructions\nUse RTK without initial prompt."
        (crew / "CLAUDE.md").write_text(persona, encoding="utf-8")
        (crew / "RTK.md").write_text(codex_instructions, encoding="utf-8")

        injected_agent = {
            "id": "designer",
            "command": "claude",
            "args": ["--dangerously-skip-permissions"],
            "persona_dir": ".aiteam/crew/designer",
            "persona_file": "CLAUDE.md",
            "cwd": ".",
        }
        injected_command = aiteam.shell_command(injected_agent, root=root)
        injected_parts = shlex.split(injected_command)

        assert_equal(injected_parts[0], "claude", "command should keep the configured binary")
        assert_in("--dangerously-skip-permissions", injected_parts, "existing args should be preserved")
        assert_in("--add-dir", injected_parts, "persona_dir should inject --add-dir")
        add_dir_index = injected_parts.index("--add-dir")
        assert_equal(injected_parts[add_dir_index + 1], str(crew.resolve()), "--add-dir should use the absolute crew path")
        assert_in("--append-system-prompt", injected_parts, "persona_file should inject --append-system-prompt")
        prompt_index = injected_parts.index("--append-system-prompt")
        assert_equal(injected_parts[prompt_index + 1], persona, "system prompt should round-trip through shell quoting")
        assert_not_in("--cwd", injected_parts, "persona injection should not rewrite cwd")

        codex_agent = {
            "id": "codex",
            "type": "codex",
            "command": "codex",
            "args": ["--no-alt-screen"],
            "role_id": "designer",
            "role": {"title": "产品设计师 / 视觉与交互"},
            "persona_dir": ".aiteam/crew/designer",
            "persona_file": "CLAUDE.md",
            "codex_instructions_file": "RTK.md",
            "cwd": ".",
        }
        codex_command = aiteam.shell_command(codex_agent, root=root)
        codex_parts = shlex.split(codex_command)
        assert_equal(codex_parts[0], "codex", "codex command should keep the configured binary")
        assert_in("--no-alt-screen", codex_parts, "codex args should be preserved")
        assert_in("--add-dir", codex_parts, "codex role should inject --add-dir")
        codex_add_dir_index = codex_parts.index("--add-dir")
        assert_equal(codex_parts[codex_add_dir_index + 1], str(crew.resolve()), "codex --add-dir should use the absolute crew path")
        assert_in("-c", codex_parts, "codex role should inject developer instructions through config")
        codex_config_index = codex_parts.index("-c")
        assert_equal(
            codex_parts[codex_config_index + 1],
            f"developer_instructions={json.dumps(codex_instructions, ensure_ascii=False)}",
            "codex should load RTK.md into developer_instructions",
        )
        assert_not_in("--append-system-prompt", codex_parts, "codex must not receive Claude-only --append-system-prompt")
        if any("You are acting as:" in part for part in codex_parts):
            raise AssertionError("codex must not receive role prompt as an initial user prompt")
        if any(persona in part for part in codex_parts):
            raise AssertionError("codex must not receive persona text as an initial user prompt")

        (crew / "RTK.md").unlink()
        legacy_codex_agent = dict(codex_agent)
        legacy_codex_agent.pop("codex_instructions_file", None)
        legacy_codex_parts = shlex.split(aiteam.shell_command(legacy_codex_agent, root=root))
        assert_in("-c", legacy_codex_parts, "legacy codex crew should fall back to persona_file")
        legacy_codex_config_index = legacy_codex_parts.index("-c")
        assert_equal(
            legacy_codex_parts[legacy_codex_config_index + 1],
            f"developer_instructions={json.dumps(persona, ensure_ascii=False)}",
            "legacy codex crew should load CLAUDE.md as developer_instructions fallback",
        )
        assert_not_in("--append-system-prompt", legacy_codex_parts, "legacy codex fallback must not use Claude-only prompt injection")

        legacy_agent = {
            "id": "legacy",
            "command": "claude",
            "args": ["--foo"],
        }
        legacy_command = aiteam.shell_command(legacy_agent)
        assert_equal(legacy_command, "claude --foo", "agents without persona_dir must keep legacy shell_command output")
        assert_not_in("--add-dir", legacy_command, "legacy command should not inject --add-dir")
        assert_not_in("--append-system-prompt", legacy_command, "legacy command should not inject --append-system-prompt")

        missing_agent = {
            "id": "missing",
            "command": "claude",
            "persona_dir": ".aiteam/crew/missing",
            "persona_file": "CLAUDE.md",
        }
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            missing_command = aiteam.shell_command(missing_agent, root=root)
        missing_parts = shlex.split(missing_command)
        assert_equal(missing_parts, ["claude"], "missing persona assets should be skipped without failing")
        assert_in("warning: persona_dir not found", stderr.getvalue(), "missing persona_dir should warn")
        assert_in("warning: persona_file not found", stderr.getvalue(), "missing persona_file should warn")

    print("role inject smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
