const assert = require("assert");
const { writeInputActions } = require("../src/main/tmux-input.cjs");

function createQueue() {
  const queues = new Map();
  return function enqueue(agentId, operation) {
    const id = String(agentId || "");
    const previous = queues.get(id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(operation);
    queues.set(id, next.finally(() => {
      if (queues.get(id) === next) {
        queues.delete(id);
      }
    }));
    return next;
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const enqueue = createQueue();
  const events = [];

  const first = enqueue("codex-2", async () => {
    await sleep(40);
    events.push("text");
  });
  const second = enqueue("codex-2", async () => {
    events.push("enter");
  });
  const otherAgent = enqueue("claude-1", async () => {
    events.push("other");
  });

  await Promise.all([first, second, otherAgent]);
  assert.deepStrictEqual(
    events.filter((item) => item !== "other"),
    ["text", "enter"],
    "same-agent input must stay ordered even when the first write is slower"
  );
  assert(events.includes("other"), "different agents should still be able to run independently");

  const failures = [];
  await enqueue("codex-2", async () => {
    failures.push("failed");
    throw new Error("intentional");
  }).catch(() => {});
  await enqueue("codex-2", async () => {
    failures.push("recovered");
  });
  assert.deepStrictEqual(failures, ["failed", "recovered"], "queue should continue after a failed write");

  // Hot-path regression guard: a multi-action keystroke batch must resolve the
  // pane and probe liveness ONCE for the whole batch, never per action. This is
  // the fix for the v0.2.3 input freeze, where every key triggered a disk read
  // (readRuntime) + a `tmux display-message` probe, stacking 3-5 synchronous
  // spawns per keystroke on the Electron main thread.
  const order = [];
  const counts = { resolvePane: 0, isPaneDead: 0, sendKey: 0, sendText: 0, pasteText: 0, sleep: 0 };
  // "ab\x7fcd\r\x1b[A" -> text, key(BSpace), text, key(Enter), key(Up): 5 actions.
  await writeInputActions("codex-2", "ab\x7fcd\r\x1b[A", {
    submitDelayMs: 80,
    sleep: async (ms) => {
      counts.sleep += 1;
      order.push(`sleep:${ms}`);
    },
    resolvePane: (id) => {
      counts.resolvePane += 1;
      assert.strictEqual(id, "codex-2", "resolvePane should receive the agent id");
      return "%7";
    },
    isPaneDead: async (pane) => {
      counts.isPaneDead += 1;
      assert.strictEqual(pane, "%7", "isPaneDead should receive the resolved pane");
      return false;
    },
    sendKey: async (_pane, key) => {
      counts.sendKey += 1;
      order.push(`key:${key}`);
    },
    sendText: async (_pane, text) => {
      counts.sendText += 1;
      order.push(`text:${text}`);
    },
    pasteText: async () => {
      counts.pasteText += 1;
      order.push("paste");
    }
  });
  assert.strictEqual(counts.resolvePane, 1, "pane must be resolved once per batch, not per action");
  assert.strictEqual(counts.isPaneDead, 1, "liveness must be probed once per batch, not per action");
  assert.strictEqual(counts.sendKey, 3, "three key actions (BSpace, Enter, Up) should each send once");
  assert.strictEqual(counts.sendText, 2, "two ordinary text runs should each use literal send-keys");
  assert.strictEqual(counts.pasteText, 0, "ordinary typing should not use tmux paste-buffer");
  assert.strictEqual(counts.sleep, 1, "Enter after ordinary text should incur the submit settle delay");
  const cmIndex = order.indexOf("key:Enter");
  assert.strictEqual(order[cmIndex - 1], "sleep:80", "submit settle delay should be immediately before Enter");
  assert.strictEqual(order[cmIndex - 2], "text:cd", "ordinary text should precede the submit settle delay");
  // The trailing Up arrow is a bare key with no preceding fresh paste, so it
  // must NOT incur a delay.
  assert.strictEqual(order[order.length - 1], "key:Up", "bare arrow key after submit must not be delayed");

  // Real xterm input commonly arrives as separate IPC calls: one batch for
  // printable text and a later batch for Enter. Ordinary text uses literal
  // send-keys, but real agent TUIs still need a short settle before submit so
  // Enter is not swallowed while the input line is updating.
  const splitState = {};
  const splitOrder = [];
  const splitDeps = {
    inputState: splitState,
    submitDelayMs: 80,
    sleep: async (ms) => {
      splitOrder.push(`sleep:${ms}`);
    },
    resolvePane: () => "%7",
    isPaneDead: async () => false,
    sendKey: async (_pane, key) => {
      splitOrder.push(`key:${key}`);
    },
    sendText: async (_pane, text) => {
      splitOrder.push(`text:${text}`);
    },
    pasteText: async (_pane, text) => {
      splitOrder.push(`paste:${text}`);
    }
  };
  await writeInputActions("codex-2", "hello", splitDeps);
  assert.strictEqual(splitState.contentSinceSubmit, true, "text-only batch should mark pending editable content");
  assert.notStrictEqual(splitState.pastedSinceSubmit, true, "text-only batch should not mark pending pasted content");
  await writeInputActions("codex-2", "\x1b", splitDeps);
  assert.strictEqual(splitState.pendingInput, "\x1b", "split escape start should be held until the next batch");
  await writeInputActions("codex-2", "[109;5u", splitDeps);
  assert.deepStrictEqual(
    splitOrder,
    ["text:hello", "sleep:80", "key:Enter"],
    "split text and split CSI-u Enter batches should settle immediately before submit"
  );
  assert.strictEqual(splitState.contentSinceSubmit, false, "submit should clear pending editable content");
  assert.strictEqual(splitState.pastedSinceSubmit, false, "submit should clear pending pasted content");

  const pasteState = {};
  const pasteOrder = [];
  const pasteDeps = {
    inputState: pasteState,
    submitDelayMs: 80,
    sleep: async (ms) => {
      pasteOrder.push(`sleep:${ms}`);
    },
    resolvePane: () => "%7",
    isPaneDead: async () => false,
    sendKey: async (_pane, key) => {
      pasteOrder.push(`key:${key}`);
    },
    sendText: async (_pane, text) => {
      pasteOrder.push(`text:${text}`);
    },
    pasteText: async (_pane, text) => {
      pasteOrder.push(`paste:${text}`);
    }
  };
  await writeInputActions("codex-2", "\x1b[200~pasted\nbody\x1b[201~", pasteDeps);
  assert.strictEqual(pasteState.contentSinceSubmit, true, "explicit bracketed paste should mark pending editable content");
  assert.strictEqual(pasteState.pastedSinceSubmit, true, "explicit bracketed paste should mark pending pasted content");
  await writeInputActions("codex-2", "\r", pasteDeps);
  assert.deepStrictEqual(
    pasteOrder,
    ["paste:pasted\nbody", "sleep:80", "key:Enter"],
    "explicit bracketed paste should delay immediately before submit"
  );

  const splitCursorState = {};
  const splitCursorKeys = [];
  await writeInputActions("codex-2", "\x1bO", {
    inputState: splitCursorState,
    submitDelayMs: 80,
    sleep: async () => assert.fail("split cursor key should not delay"),
    resolvePane: () => "%7",
    isPaneDead: async () => false,
    sendKey: async (_pane, key) => splitCursorKeys.push(key),
    sendText: async (_pane, text) => assert.fail(`split cursor leaked text: ${text}`),
    pasteText: async (_pane, text) => assert.fail(`split cursor leaked text: ${text}`)
  });
  await writeInputActions("codex-2", "C", {
    inputState: splitCursorState,
    submitDelayMs: 80,
    sleep: async () => assert.fail("split cursor key should not delay"),
    resolvePane: () => "%7",
    isPaneDead: async () => false,
    sendKey: async (_pane, key) => splitCursorKeys.push(key),
    sendText: async (_pane, text) => assert.fail(`split cursor leaked text: ${text}`),
    pasteText: async (_pane, text) => assert.fail(`split cursor leaked text: ${text}`)
  });
  assert.deepStrictEqual(splitCursorKeys, ["Right"], "split SS3 cursor key should be reconstructed");

  // A keystroke batch with no editable content (pure arrow navigation) must not
  // delay; the trailing Enter has no fresh text/paste to settle.
  let bareSleeps = 0;
  await writeInputActions("codex-2", "\x1b[A\x1b[B\r", {
    submitDelayMs: 80,
    sleep: async () => { bareSleeps += 1; },
    resolvePane: () => "%7",
    isPaneDead: () => false,
    sendKey: async () => {},
    sendText: async (_pane, text) => assert.fail(`no text expected: ${text}`),
    pasteText: async () => { assert.fail("no paste expected"); }
  });
  assert.strictEqual(bareSleeps, 0, "an Enter with no preceding paste must not wait for the submit delay");

  // A dead/missing pane must still fail fast, before any action runs. The
  // liveness probe is async on the real hot path (runTmuxAsync), so the stub is
  // async too — writeInputActions must await it, not treat the pending promise
  // as truthy-and-alive.
  await assert.rejects(
    () => writeInputActions("codex-2", "x", {
      submitDelayMs: 80,
      sleep: async () => {},
      resolvePane: () => "%7",
      isPaneDead: async () => true,
      sendKey: async () => assert.fail("must not send to a dead pane"),
      sendText: async () => assert.fail("must not send text to a dead pane"),
      pasteText: async () => assert.fail("must not paste to a dead pane")
    }),
    /not running/,
    "a pane reported dead by the async probe must reject before driving actions"
  );

  // A missing pane (resolvePane returns null) must also reject before any work.
  await assert.rejects(
    () => writeInputActions("codex-2", "x", {
      submitDelayMs: 80,
      sleep: async () => {},
      resolvePane: () => null,
      isPaneDead: async () => null,
      sendKey: async () => assert.fail("must not send to a missing pane"),
      sendText: async () => assert.fail("must not send text to a missing pane"),
      pasteText: async () => assert.fail("must not paste to a missing pane")
    }),
    /not running/,
    "missing pane must reject before driving actions"
  );

  console.log("agent input queue smoke passed");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
