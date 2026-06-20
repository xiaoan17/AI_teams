#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import io
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


def flag_value(parts: list[str], flag: str) -> str:
    index = parts.index(flag)
    return parts[index + 1]


def command_parts(agent: dict[str, object], *, root: Path | None = None) -> list[str]:
    return shlex.split(aiteam.shell_command(agent, root=root))


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        crew = root / ".aiteam" / "crew" / "frontend"
        crew.mkdir(parents=True)
        (crew / "CLAUDE.md").write_text("frontend persona", encoding="utf-8")
        (crew / "RTK.md").write_text("codex instructions", encoding="utf-8")

        claude = {
            "id": "frontend",
            "command": "claude",
            "args": ["--dangerously-skip-permissions"],
            "persona_dir": ".aiteam/crew/frontend",
            "persona_file": "CLAUDE.md",
            "model": "opus",
        }
        claude_parts = command_parts(claude, root=root)
        assert_equal(flag_value(claude_parts, "--model"), "opus", "claude should receive --model")
        assert_equal(
            claude_parts.index("--model") < claude_parts.index("--add-dir"),
            True,
            "model should be injected before persona args",
        )

        codex = {
            "id": "codex",
            "type": "codex",
            "command": "codex",
            "args": ["--no-alt-screen"],
            "persona_dir": ".aiteam/crew/frontend",
            "persona_file": "CLAUDE.md",
            "codex_instructions_file": "RTK.md",
            "model": "opus",
        }
        codex_parts = command_parts(codex, root=root)
        assert_in("-c", codex_parts, "codex should receive config args")
        model_index = codex_parts.index("-c")
        assert_equal(codex_parts[model_index + 1], "model=opus", "codex should receive model config")

        no_model = dict(claude)
        no_model.pop("model")
        no_model_parts = command_parts(no_model, root=root)
        assert_not_in("--model", no_model_parts, "agents without model should not receive --model")
        if any(str(part).startswith("model=") for part in no_model_parts):
            raise AssertionError(f"agents without model should not receive model config: {no_model_parts!r}")

        unknown = {
            "id": "foo",
            "command": "foo",
            "args": ["--flag"],
            "model": "opus",
        }
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            unknown_parts = command_parts(unknown, root=root)
        assert_equal(unknown_parts, ["foo", "--flag"], "unknown runtimes should not receive model args")
        assert_in("does not support model injection", stderr.getvalue(), "unknown runtime should warn")

        no_persona = {
            "id": "claude-no-persona",
            "command": "claude",
            "args": [],
            "model": "opus",
        }
        no_persona_parts = command_parts(no_persona, root=root)
        assert_equal(no_persona_parts, ["claude", "--model", "opus"], "model injection should not require persona_dir")

        spaced = {
            "id": "special-model",
            "command": "claude",
            "model": "opus model 'x'",
        }
        spaced_parts = command_parts(spaced, root=root)
        assert_equal(flag_value(spaced_parts, "--model"), "opus model 'x'", "model should round-trip through shell quoting")

    print("model inject smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
