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

function matchKnownEscape(input, index) {
  for (const [sequence, key] of CSI_KEY_SEQUENCES) {
    if (input.startsWith(sequence, index)) {
      return { key, length: sequence.length };
    }
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

function tmuxInputActions(data) {
  const input = String(data || "");
  const actions = [];
  let text = "";

  const flushText = () => {
    pushText(actions, text);
    text = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\r" || char === "\n") {
      flushText();
      if (char === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
      pushKey(actions, "C-m");
      continue;
    }

    if (char === "\x1b") {
      const escapeMatch = matchKnownEscape(input, index);
      if (escapeMatch) {
        flushText();
        pushKey(actions, escapeMatch.key);
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

module.exports = {
  tmuxInputActions
};
