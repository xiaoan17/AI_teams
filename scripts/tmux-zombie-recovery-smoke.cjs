const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { TMUX_SUBMIT_KEY } = require("../src/main/tmux-input.cjs");

// Zombie-session recovery smoke.
//
// Reproduces the hang reported in v0.2.1: tmux can keep a session shell alive
// in `tmux ls` after the process inside its only pane has exited. The desktop
// app used to treat "has-session succeeds" as "session is usable" and waited
// forever on a pane that no longer existed. This smoke asserts the predicate
// the fix relies on (a session with no live pane is detectable) and that
// killing + recreating the session yields a live pane that accepts input.

const session = `aiteams-zombie-recovery-${process.pid}-${Date.now()}`;

function runTmux(args, options = {}) {
  const check = options.check !== false;
  try {
    return execFileSync("tmux", args, {
      encoding: "utf8",
      input: options.input,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    if (!check) {
      return "";
    }
    const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8").trim() : "";
    const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString("utf8").trim() : "";
    throw new Error(`tmux ${args.join(" ")} failed: ${stderr || stdout || error.message}`);
  }
}

function hasSession(name) {
  try {
    runTmux(["has-session", "-t", name]);
    return true;
  } catch (_error) {
    return false;
  }
}

// Mirror of main.cjs `tmuxSessionHasLivePane`: a session is only usable when at
// least one pane reports pane_dead=0. A missing session or all-dead panes both
// count as "no live pane".
function sessionHasLivePane(name) {
  const out = runTmux(["list-panes", "-s", "-t", name, "-F", "#{pane_dead}"], { check: false });
  return out.split("\n").some((line) => line.trim() === "0");
}

function capturePane(pane) {
  return runTmux(["capture-pane", "-p", "-e", "-J", "-S", "-80", "-t", pane]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

(async () => {
  try {
    // Create a session whose pane keeps the process alive (remain-on-exit so
    // the shell lingers after the process dies, which is exactly the zombie
    // state we are guarding against).
    runTmux(["new-session", "-d", "-s", session, "-n", "codex", "-c", os.tmpdir(), "/bin/cat"]);
    runTmux(["set-option", "-t", session, "remain-on-exit", "on"], { check: false });

    if (!sessionHasLivePane(session)) {
      throw new Error("Expected freshly created session to report a live pane.");
    }

    // Kill the process inside the pane (not the pane itself) to manufacture a
    // zombie shell: with remain-on-exit the session and pane linger but the
    // pane reports pane_dead=1, so there is no live pane left.
    const pane = runTmux(["display-message", "-p", "-t", `${session}:0.0`, "#{pane_id}"]).trim();
    const panePid = runTmux(["display-message", "-p", "-t", pane, "#{pane_pid}"]).trim();
    if (panePid && Number(panePid) > 1) {
      try {
        process.kill(Number(panePid), "SIGKILL");
      } catch (_error) {
        // already gone
      }
    }

    const becameZombie = await waitFor(
      () => hasSession(session) && !sessionHasLivePane(session),
      5000
    );
    if (!becameZombie) {
      throw new Error("Expected session to survive as a zombie shell with no live pane.");
    }

    // Recovery: discard the zombie shell and rebuild, the same sequence the app
    // performs in reconcileTmuxBackend / startTmuxAgent.
    runTmux(["kill-session", "-t", session], { check: false });
    if (hasSession(session)) {
      throw new Error("Expected zombie session to be removed after kill-session.");
    }

    runTmux(["new-session", "-d", "-s", session, "-n", "codex", "-c", os.tmpdir(), "/bin/cat"]);
    if (!sessionHasLivePane(session)) {
      throw new Error("Expected rebuilt session to report a live pane.");
    }

    const rebuiltPane = runTmux(["display-message", "-p", "-t", `${session}:0.0`, "#{pane_id}"]).trim();
    const marker = `ZOMBIE_RECOVERY_${Date.now()}`;
    runTmux(["send-keys", "-t", rebuiltPane, marker, TMUX_SUBMIT_KEY]);
    const echoed = await waitFor(() => capturePane(rebuiltPane).includes(marker), 5000);
    if (!echoed) {
      console.error(capturePane(rebuiltPane));
      throw new Error("Timed out waiting for the rebuilt pane to receive input.");
    }

    console.log("tmux zombie recovery smoke passed");
  } finally {
    runTmux(["kill-session", "-t", session], { check: false });
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
