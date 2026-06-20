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


def assert_false(value: object, message: str) -> None:
    if value:
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
    source: Path,
    role_id: str,
    *,
    title: str = "前端工程师",
    persona: str = "# frontend\n",
    model: object | None = None,
    collab: object | None = None,
) -> None:
    (source / ".claude" / "skills" / "frontend").mkdir(parents=True)
    role: dict[str, object] = {
        "id": role_id,
        "name": title,
        "role": {
            "title": title,
            "summary": "Build UI",
            "emoji": "F",
            "track": "impl",
        },
        "command": "claude",
        "args": ["--dangerously-skip-permissions"],
        "skills": ["frontend"],
        "persona_file": "CLAUDE.md",
        "version": "0.1.0",
    }
    if model is not None:
        role["model"] = model
    if collab is not None:
        role["collab"] = collab
    (source / "role.json").write_text(json.dumps(role, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (source / "CLAUDE.md").write_text(persona, encoding="utf-8")
    (source / ".claude" / "skills" / "frontend" / "SKILL.md").write_text("# frontend skill\n", encoding="utf-8")


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def tree_snapshot(path: Path) -> dict[str, tuple[int, str]]:
    snapshot: dict[str, tuple[int, str]] = {}
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        stat = file_path.stat()
        snapshot[str(file_path.relative_to(path))] = (stat.st_mtime_ns, file_path.read_text(encoding="utf-8"))
    return snapshot


def assert_no_tmp(library: Path) -> None:
    leftovers = [path.name for path in library.iterdir() if path.name.startswith(".import-tmp-")]
    assert_equal(leftovers, [], "import should not leave temporary directories")


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_root = Path(tmp)
        home = tmp_root / "home"
        library = tmp_root / "roles"
        project = tmp_root / "project"
        source = tmp_root / "agent_teams_libs" / "frontend"
        home.mkdir()
        library.mkdir()
        project.mkdir()
        write_role(
            source,
            "frontend",
            model="opus",
            collab={"upstream": ["prd", "manager"], "downstream": ["qa"], "handoff_via": ".aiteam/tasks/"},
        )

        env = os.environ.copy()
        env["HOME"] = str(home)
        env["AITEAM_ROLES_DIR"] = str(library)

        before = tree_snapshot(source)
        imported = run_cli(project, env, "role", "import", str(source))
        assert_in("Imported role: frontend", imported.stdout, "import should report role id")
        target = library / "frontend"
        assert_true(target.is_dir(), "import should create library role directory")
        assert_true((target / "CLAUDE.md").is_file(), "import should copy persona file")
        imported_meta = load_json(target / ".imported")
        assert_equal(imported_meta["source_path"], str(source.resolve()), ".imported should record source path")
        assert_equal(imported_meta["role_version"], "0.1.0", ".imported should record role version")
        assert_true(imported_meta["imported_at"], ".imported should record import timestamp")
        assert_equal(tree_snapshot(source), before, "import must not modify the source directory")
        assert_no_tmp(library)

        duplicate = run_cli(project, env, "role", "import", str(source), check=False)
        assert_true(duplicate.returncode != 0, "duplicate import without --force should fail")
        assert_in("--force", duplicate.stderr, "duplicate import should suggest --force")
        assert_equal((target / "CLAUDE.md").read_text(encoding="utf-8"), "# frontend\n", "duplicate import should not overwrite target")

        (source / "CLAUDE.md").write_text("# frontend v2\n", encoding="utf-8")
        forced = run_cli(project, env, "role", "import", str(source), "--force")
        assert_in("Imported role: frontend", forced.stdout, "force import should report role id")
        assert_equal((target / "CLAUDE.md").read_text(encoding="utf-8"), "# frontend v2\n", "force import should replace target")
        assert_no_tmp(library)

        custom_source = tmp_root / "agent_teams_libs" / "backend"
        write_role(custom_source, "backend")
        run_cli(project, env, "role", "import", str(custom_source), "--id", "custom")
        assert_true((library / "custom").is_dir(), "--id should choose library directory")
        assert_equal(load_json(library / "custom" / "role.json")["id"], "custom", "--id should rewrite copied role id")
        assert_false((custom_source / ".imported").exists(), "import must not write source metadata")
        assert_equal(load_json(custom_source / "role.json")["id"], "backend", "--id must not rewrite the source role.json")

        missing_persona = tmp_root / "agent_teams_libs" / "missing-persona"
        write_role(missing_persona, "missing-persona")
        (missing_persona / "CLAUDE.md").unlink()
        failed = run_cli(project, env, "role", "import", str(missing_persona), check=False)
        assert_true(failed.returncode != 0, "missing CLAUDE.md should fail")
        assert_false((library / "missing-persona").exists(), "failed import must not create target")
        assert_no_tmp(library)

        missing_skill = tmp_root / "agent_teams_libs" / "missing-skill"
        write_role(missing_skill, "missing-skill")
        (missing_skill / ".claude" / "skills" / "frontend" / "SKILL.md").unlink()
        failed = run_cli(project, env, "role", "import", str(missing_skill), check=False)
        assert_true(failed.returncode != 0, "missing SKILL.md should fail")
        assert_false((library / "missing-skill").exists(), "failed import must not create target")
        assert_no_tmp(library)

        bad_json = tmp_root / "agent_teams_libs" / "bad-json"
        bad_json.mkdir(parents=True)
        (bad_json / "role.json").write_text("{", encoding="utf-8")
        failed = run_cli(project, env, "role", "import", str(bad_json), check=False)
        assert_true(failed.returncode != 0, "invalid role.json should fail")
        assert_false((library / "bad-json").exists(), "failed import must not create target")
        assert_no_tmp(library)

        bad_model = tmp_root / "agent_teams_libs" / "bad-model"
        write_role(bad_model, "bad-model", model=123)
        failed = run_cli(project, env, "role", "import", str(bad_model), check=False)
        assert_true(failed.returncode != 0, "non-string model should fail")
        assert_in("model", failed.stderr, "model validation error should mention model")
        assert_false((library / "bad-model").exists(), "failed import must not create target")

        bad_collab = tmp_root / "agent_teams_libs" / "bad-collab"
        write_role(bad_collab, "bad-collab", collab={"upstream": ["prd", 1]})
        failed = run_cli(project, env, "role", "import", str(bad_collab), check=False)
        assert_true(failed.returncode != 0, "non-string collab entries should fail")
        assert_in("collab.upstream", failed.stderr, "collab validation error should mention field")
        assert_false((library / "bad-collab").exists(), "failed import must not create target")

        # --dest workspace must land the role under <root>/.aiteam/roles, not the global library.
        ws_source = tmp_root / "agent_teams_libs" / "ws-role"
        write_role(ws_source, "ws-role")
        ws_import = run_cli(project, env, "role", "import", str(ws_source), "--dest", "workspace")
        assert_in("Imported role: ws-role", ws_import.stdout, "workspace import should report role id")
        ws_target = project / ".aiteam" / "roles" / "ws-role"
        assert_true(ws_target.is_dir(), "--dest workspace should create role under project .aiteam/roles")
        assert_true((ws_target / "CLAUDE.md").is_file(), "workspace import should copy persona file")
        assert_true((ws_target / ".imported").is_file(), "workspace import should record .imported metadata")
        assert_false((library / "ws-role").exists(), "--dest workspace must not touch the global library")

        # Default dest stays global (back-compat): no workspace copy is created.
        global_source = tmp_root / "agent_teams_libs" / "global-default"
        write_role(global_source, "global-default")
        run_cli(project, env, "role", "import", str(global_source))
        assert_true((library / "global-default").is_dir(), "default import should use the global library")
        assert_false((project / ".aiteam" / "roles" / "global-default").exists(), "default import must not write to workspace")

    print("role import smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
