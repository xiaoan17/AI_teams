#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
AITEAM = REPO_ROOT / "aiteam.py"


def assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}\nexpected: {expected!r}\nactual:   {actual!r}")


def assert_in(member: object, container: object, message: str) -> None:
    if member not in container:
        raise AssertionError(f"{message}\nmissing: {member!r}\ncontainer: {container!r}")


def assert_true(value: object, message: str) -> None:
    if not value:
        raise AssertionError(message)


def run_cli(root: Path, env: dict[str, str], *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        [sys.executable, str(AITEAM), "--root", str(root), *args],
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )
    if check and proc.returncode != 0:
        raise AssertionError(
            f"command failed: {' '.join(args)}\nexit: {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )
    return proc


def write_role(
    library: Path,
    role_id: str,
    title: str,
    emoji: str,
    skill: str,
    *,
    model: str | None = None,
    collab: dict[str, object] | None = None,
) -> None:
    role_root = library / role_id
    (role_root / ".claude" / "skills" / skill).mkdir(parents=True)
    role = {
        "id": role_id,
        "name": title,
        "role": {
            "title": title,
            "summary": f"{title} summary",
            "emoji": emoji,
            "track": "spec",
        },
        "command": "claude",
        "args": ["--dangerously-skip-permissions"],
        "skills": [skill],
        "persona_file": "CLAUDE.md",
        "permission_mode": "configure-before-start",
        "version": "0.1.0",
    }
    if model is not None:
        role["model"] = model
    if collab is not None:
        role["collab"] = collab
    (role_root / "role.json").write_text(json.dumps(role, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (role_root / "CLAUDE.md").write_text(f"# {title}\n", encoding="utf-8")
    (role_root / ".claude" / "skills" / skill / "SKILL.md").write_text(f"# {skill}\n", encoding="utf-8")


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_root = Path(tmp)
        home = tmp_root / "home"
        library = tmp_root / "roles"
        project = tmp_root / "project"
        home.mkdir()
        library.mkdir()
        project.mkdir()

        write_role(library, "designer", "产品设计师", "🎨", "design-spec")
        write_role(library, "manager", "总经理", "🧭", "writing-plans")
        write_role(library, "prd", "PRD", "📋", "prd-writing")
        write_role(
            library,
            "frontend",
            "前端工程师",
            "F",
            "frontend",
            model="opus",
            collab={"upstream": ["prd", "manager"], "downstream": ["qa"], "handoff_via": ".aiteam/tasks/"},
        )

        env = os.environ.copy()
        env["HOME"] = str(home)
        env["AITEAM_ROLES_DIR"] = str(library)

        listed = run_cli(project, env, "role", "list").stdout
        for role_id, title in [("designer", "产品设计师"), ("manager", "总经理"), ("prd", "PRD")]:
            assert_in(role_id, listed, "role list should include role id")
            assert_in(title, listed, "role list should include role title")

        run_cli(project, env, "init", "--demo", "--force")
        hired = run_cli(project, env, "role", "hire", "designer")
        assert_in("Hired role: designer", hired.stdout, "hire should report the hired role")

        crew = project / ".aiteam" / "crew" / "designer"
        assert_true((crew / "CLAUDE.md").is_file(), "hire should copy CLAUDE.md")
        assert_true((crew / "RTK.md").is_file(), "hire should create Codex RTK.md")
        assert_equal(
            (crew / "RTK.md").read_text(encoding="utf-8"),
            (crew / "CLAUDE.md").read_text(encoding="utf-8"),
            "legacy role templates should seed RTK.md from CLAUDE.md",
        )
        assert_true(
            (crew / ".claude" / "skills" / "design-spec" / "SKILL.md").is_file(),
            "hire should copy role skills",
        )
        source = load_json(crew / ".source")
        assert_equal(source["source_path"], str((library / "designer").resolve()), ".source should record source path")
        assert_equal(source["role_version"], "0.1.0", ".source should record role version")
        assert_true(source["hired_at"], ".source should record hired timestamp")

        agents_json = load_json(project / ".aiteam" / "agents.json")
        designer = next(agent for agent in agents_json["agents"] if agent.get("id") == "designer")
        assert_equal(designer["persona_dir"], ".aiteam/crew/designer", "agent should point at hired crew")
        assert_equal(designer["persona_file"], "CLAUDE.md", "agent should include persona file")
        assert_equal(designer["codex_instructions_file"], "RTK.md", "agent should include Codex instructions file")
        assert_equal(designer["role"]["title"], "产品设计师", "agent should include role metadata")
        assert_equal(designer["skills"], ["design-spec"], "agent should include skills")
        assert_equal(designer["enabled"], False, "hire without --enable should leave agent disabled")
        assert_true("model" not in designer, "legacy role hire should not add empty model")
        assert_true("collab" not in designer, "legacy role hire should not add empty collab")

        run_cli(project, env, "role", "hire", "frontend", "--enable")
        agents_json = load_json(project / ".aiteam" / "agents.json")
        frontend = next(agent for agent in agents_json["agents"] if agent.get("id") == "frontend")
        assert_equal(frontend["model"], "opus", "hire should pass model into agents.json")
        assert_equal(
            frontend["collab"],
            {"upstream": ["prd", "manager"], "downstream": ["qa"], "handoff_via": ".aiteam/tasks/"},
            "hire should pass collab into agents.json",
        )
        assert_equal(frontend["enabled"], True, "hire --enable should enable the hired agent")

        (crew / "CLAUDE.md").write_text("# local edits must survive\n", encoding="utf-8")
        duplicate = run_cli(project, env, "role", "hire", "designer", check=False)
        assert_true(duplicate.returncode != 0, "duplicate hire without --force should fail")
        assert_in("--force", duplicate.stderr, "duplicate hire should tell the user how to replace")
        assert_equal(
            (crew / "CLAUDE.md").read_text(encoding="utf-8"),
            "# local edits must survive\n",
            "duplicate hire should not overwrite local crew edits",
        )

        cfg = load_json(project / ".aiteam" / "agents.json")
        cfg["agents"].append(
            {
                "id": "always-enabled",
                "name": "Should Not Start",
                "command": "/bin/cat",
                "args": [],
                "cwd": ".",
                "enabled": True,
            }
        )
        (project / ".aiteam" / "agents.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        chosen = run_cli(project, env, "start", "--role", "designer", "--role", "manager")
        assert_in("Started tmux session:", chosen.stdout, "start --role should start a tmux session")
        session = load_json(project / ".aiteam" / "runtime.json")["session"]
        windows = subprocess.run(
            ["tmux", "list-windows", "-t", session, "-F", "#{window_name}"],
            text=True,
            capture_output=True,
            check=True,
        ).stdout.splitlines()
        assert_equal(windows, ["designer", "manager"], "start --role should only start selected roles")
        run_cli(project, env, "stop")

    print("role hire smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
