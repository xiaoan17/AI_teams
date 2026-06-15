"use strict";

const CSI_KEY_SEQUENCES = new Map([
  ["\x1b[A", "Up"],
  ["\x1b[B", "Down"],
  ["\x1b[C", "Right"],
  ["\x1b[D", "Left"],
  ["\x1b[H", "Home"],
  ["\x1b[F", "End"],
  ["\x1b[1~", "Home"],
  ["\x1b[4~", "End"],
  ["\x1b[3~", "Delete"],
  ["\x1b[5~", "PageUp"],
  ["\x1b[6~", "PageDown"]
]);
const SS3_KEY_SEQUENCES = new Map([
  ["\x1bOA", "Up"],
  ["\x1bOB", "Down"],
  ["\x1bOC", "Right"],
  ["\x1bOD", "Left"],
  ["\x1bOH", "Home"],
  ["\x1bOF", "End"]
]);
const IGNORED_ESCAPE_SEQUENCES = new Set([
  "\x1b[I", // focus in
  "\x1b[O"  // focus out
]);
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const TMUX_SUBMIT_KEY = "Enter";

const CSI_U_KEYS = new Map([
  [9, "Tab"],
  [10, TMUX_SUBMIT_KEY],
  [13, TMUX_SUBMIT_KEY],
  [27, "Escape"],
  [127, "BSpace"]
]);

const CSI_U_CTRL_KEYS = new Map([
  [65, "C-a"],
  [66, "C-b"],
  [67, "C-c"],
  [68, "C-d"],
  [69, "C-e"],
  [70, "C-f"],
  [75, "C-k"],
  [76, "C-l"],
  [77, TMUX_SUBMIT_KEY],
  [78, "C-n"],
  [80, "C-p"],
  [85, "C-u"],
  [87, "C-w"],
  [90, "C-z"],
  [97, "C-a"],
  [98, "C-b"],
  [99, "C-c"],
  [100, "C-d"],
  [101, "C-e"],
  [102, "C-f"],
  [107, "C-k"],
  [108, "C-l"],
  [109, TMUX_SUBMIT_KEY],
  [110, "C-n"],
  [112, "C-p"],
  [117, "C-u"],
  [119, "C-w"],
  [122, "C-z"]
]);

const IGNORED_CSI_FINALS = new Set([
  "c", // device attributes / responses
  "m", // SGR / xterm modifyOtherKeys mode set
  "n", // status reports
  "R", // cursor position reports
  "S", // scroll up
  "T", // scroll down
  "h", // mode set
  "l"  // mode reset
]);

const CONTROL_KEYS = new Map([
  ["\x01", "C-a"],
  ["\x02", "C-b"],
  ["\x03", "C-c"],
  ["\x04", "C-d"],
  ["\x05", "C-e"],
  ["\x06", "C-f"],
  ["\x08", "BSpace"],
  ["\x09", "Tab"],
  ["\x0b", "C-k"],
  ["\x0c", "C-l"],
  ["\x0e", "C-n"],
  ["\x10", "C-p"],
  ["\x15", "C-u"],
  ["\x17", "C-w"],
  ["\x1a", "C-z"],
  ["\x1b", "Escape"],
  ["\x7f", "BSpace"]
]);

function pushText(actions, value) {
  if (!value) {
    return;
  }
  const last = actions[actions.length - 1];
  if (last?.type === "text") {
    last.value += value;
    return;
  }
  actions.push({ type: "text", value });
}

function pushKey(actions, key) {
  actions.push({ type: "key", key });
}

function pushPaste(actions, value) {
  if (!value) {
    return;
  }
  actions.push({
    type: "paste",
    value: String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  });
}

function csiUKey(codepoint, modifier) {
  if (CSI_U_KEYS.has(codepoint)) {
    return CSI_U_KEYS.get(codepoint);
  }
  // xterm modifyOtherKeys encodes Ctrl as modifier bit 5. Several TUIs enable
  // this mode, so Enter can arrive as ESC [ 109 ; 5 u instead of \r.
  if (modifier === 5 && CSI_U_CTRL_KEYS.has(codepoint)) {
    return CSI_U_CTRL_KEYS.get(codepoint);
  }
  return null;
}

function csiUText(codepoint, modifier) {
  if (modifier !== 0 && modifier !== 1 && modifier !== 2) {
    return null;
  }
  if (codepoint < 0x20 || codepoint === 0x7f || codepoint > 0x10ffff) {
    return null;
  }
  try {
    return String.fromCodePoint(codepoint);
  } catch (_error) {
    return null;
  }
}

function incompleteInputEscapeStart(value) {
  const escapeIndex = value.lastIndexOf("\x1b");
  if (escapeIndex === -1) {
    return -1;
  }
  const tail = value.slice(escapeIndex);
  if (tail === "\x1b") {
    return escapeIndex;
  }
  if (tail.startsWith("\x1b[")) {
    for (let index = 2; index < tail.length; index += 1) {
      const code = tail.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) {
        return -1;
      }
    }
    return escapeIndex;
  }
  if (tail.startsWith("\x1bO")) {
    return tail.length < 3 ? escapeIndex : -1;
  }
  if (tail.startsWith("\x1b]") || tail.startsWith("\x1bP")) {
    return tail.includes("\x07") || tail.includes("\x1b\\") ? -1 : escapeIndex;
  }
  if (tail.startsWith("\x1b=") && /^\x1b=[>?0-9;]*$/.test(tail)) {
    return escapeIndex;
  }
  return -1;
}

function matchKnownEscape(input, index) {
  for (const sequence of IGNORED_ESCAPE_SEQUENCES) {
    if (input.startsWith(sequence, index)) {
      return { key: null, length: sequence.length };
    }
  }

  const deviceResponse = input.slice(index).match(/^(?:\x1b\[[=>?0-9;]*c|\x1b=[>?0-9;]*c)/);
  if (deviceResponse) {
    return { key: null, length: deviceResponse[0].length };
  }

  const csiU = input.slice(index).match(/^\x1b\[([0-9]+)(?:;([0-9]+))?u/);
  if (csiU) {
    const codepoint = Number(csiU[1]);
    const modifier = Number(csiU[2] || 0);
    return {
      key: csiUKey(codepoint, modifier),
      text: csiUText(codepoint, modifier),
      length: csiU[0].length
    };
  }

  const modifiedOtherKey = input.slice(index).match(/^\x1b\[27;([0-9]+);([0-9]+)~/);
  if (modifiedOtherKey) {
    const modifier = Number(modifiedOtherKey[1]);
    const codepoint = Number(modifiedOtherKey[2]);
    return {
      key: csiUKey(codepoint, modifier),
      text: csiUText(codepoint, modifier),
      length: modifiedOtherKey[0].length
    };
  }

  for (const [sequence, key] of SS3_KEY_SEQUENCES) {
    if (input.startsWith(sequence, index)) {
      return { key, length: sequence.length };
    }
  }

  for (const [sequence, key] of CSI_KEY_SEQUENCES) {
    if (input.startsWith(sequence, index)) {
      return { key, length: sequence.length };
    }
  }

  const ignoredCsi = input.slice(index).match(/^\x1b\[[=>?0-9;]*([A-Za-z])/);
  if (ignoredCsi && IGNORED_CSI_FINALS.has(ignoredCsi[1])) {
    return { key: null, length: ignoredCsi[0].length };
  }

  // Modified cursor keys, for example ESC [ 1 ; 5 C. tmux accepts the base
  // cursor key; preserving the modifier is less important than keeping the
  // terminal usable when xterm emits a variant.
  const modified = input.slice(index).match(/^\x1b\[1;[0-9]+([ABCD])/);
  if (modified) {
    return {
      key: { A: "Up", B: "Down", C: "Right", D: "Left" }[modified[1]],
      length: modified[0].length
    };
  }

  return null;
}

function tmuxInputActions(data, inputState = null) {
  const state = inputState && typeof inputState === "object" ? inputState : null;
  let input = `${state?.pendingInput || ""}${String(data || "")}`;
  if (state) {
    state.pendingInput = "";
    const pendingStart = incompleteInputEscapeStart(input);
    if (pendingStart !== -1) {
      state.pendingInput = input.slice(pendingStart);
      input = input.slice(0, pendingStart);
    }
  }
  const actions = [];
  let text = "";

  const flushText = () => {
    pushText(actions, text);
    text = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (input.startsWith(BRACKETED_PASTE_START, index)) {
      flushText();
      const pasteStart = index + BRACKETED_PASTE_START.length;
      const pasteEnd = input.indexOf(BRACKETED_PASTE_END, pasteStart);
      if (pasteEnd === -1) {
        pushPaste(actions, input.slice(pasteStart));
        break;
      }
      pushPaste(actions, input.slice(pasteStart, pasteEnd));
      index = pasteEnd + BRACKETED_PASTE_END.length - 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      flushText();
      if (char === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
      pushKey(actions, TMUX_SUBMIT_KEY);
      continue;
    }

    if (char === "\x1b") {
      const escapeMatch = matchKnownEscape(input, index);
      if (escapeMatch) {
        flushText();
        if (escapeMatch.key) {
          pushKey(actions, escapeMatch.key);
        } else if (escapeMatch.text) {
          pushText(actions, escapeMatch.text);
        }
        index += escapeMatch.length - 1;
        continue;
      }
    }

    const controlKey = CONTROL_KEYS.get(char);
    if (controlKey) {
      flushText();
      pushKey(actions, controlKey);
      continue;
    }

    text += char;
  }

  flushText();
  return actions;
}

// Drive a parsed action batch onto a tmux pane through injected primitives.
// Pane resolution and liveness are checked ONCE per batch (not per keystroke):
// renderer input can arrive in small batches, so a per-action
// disk read (readRuntime) + per-action `tmux display-message` probe used to add
// multiple synchronous spawns per batch, freezing the Electron main thread. The caller
// passes a memory-backed `resolvePane` and a single-shot `isPaneDead` so the
// hot path no longer touches disk or spawns a probe per action.
//
// Submit timing: ordinary text goes through `send-keys -l`, explicit bracketed
// paste goes through a tmux buffer paste, and Enter must submit via
// `send-keys Enter` (an attached-view PTY raw `\r` is
// not treated as a real keypress by some TUI CLIs — see the 2026-06-14 attached
// view submit regression). But a submit fired immediately after a bracketed
// paste races the paste state machine: the terminal can swallow the Enter (and
// sometimes the pasted text too). Only the submit key waits, and only after
// explicit paste content — ordinary typing and
// bare arrow/backspace keys are not delayed.
//
// `deps`:
//   resolvePane(agentId) -> pane string | null   (memory first, no disk read)
//   isPaneDead(pane) -> Promise<boolean|null>|boolean|null
//                                                 (true = dead, called once,
//                                                  awaited so the probe spawn
//                                                  does not block the main thread)
//   sendKey(pane, key) -> Promise|void            (one tmux send-keys)
//   sendText(pane, text) -> Promise|void          (tmux send-keys -l text)
//   pasteText(pane, text) -> Promise|void         (load/paste/delete buffer)
//   inputState -> object                          (optional, per-agent state)
//   submitDelayMs -> number                       (pre-Enter settle, default 80)
//   sleep(ms) -> Promise                          (delay primitive)
async function writeInputActions(agentId, data, deps) {
  const pane = deps.resolvePane(agentId);
  // Liveness probe happens here, once, before any action — not inside the loop.
  // Awaited so the underlying `tmux display-message` spawn runs off the main
  // thread (a synchronous probe here would re-introduce one blocking spawn per
  // keystroke batch, the very freeze this rewrite removes).
  if (!pane || (await deps.isPaneDead(pane)) !== false) {
    throw new Error(`Agent is not running: ${agentId}`);
  }
  const submitDelayMs = Math.max(0, Number(deps.submitDelayMs) || 0);
  // Tracks whether text was pasted since the last submit. Only an Enter that
  // follows fresh paste content needs the settle delay. When inputState is
  // provided this intentionally spans multiple renderer IPC calls.
  const inputState = deps.inputState && typeof deps.inputState === "object" ? deps.inputState : {};
  let pastedSinceSubmit = inputState.pastedSinceSubmit === true;
  for (const action of tmuxInputActions(data, inputState)) {
    if (action.type === "key") {
      // Enter is the submit key. Let a preceding bracketed paste settle first so
      // the terminal does not swallow the Enter mid-paste.
      if (action.key === TMUX_SUBMIT_KEY && pastedSinceSubmit && submitDelayMs > 0) {
        await deps.sleep(submitDelayMs);
      }
      await deps.sendKey(pane, action.key);
      if (action.key === TMUX_SUBMIT_KEY) {
        pastedSinceSubmit = false;
        inputState.pastedSinceSubmit = false;
      }
      continue;
    }
    const text = String(action.value || "");
    if (!text) {
      continue;
    }
    if (action.type === "paste") {
      await deps.pasteText(pane, text);
      pastedSinceSubmit = true;
      inputState.pastedSinceSubmit = true;
      continue;
    }
    await deps.sendText(pane, text);
  }
}

module.exports = {
  TMUX_SUBMIT_KEY,
  tmuxInputActions,
  writeInputActions
};
