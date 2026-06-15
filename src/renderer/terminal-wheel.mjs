export const TERMINAL_SCROLLBACK_LINES = 20000;

export const TERMINAL_MOUSE_MODE_PARAMS = new Set([
  "9",
  "1000",
  "1001",
  "1002",
  "1003",
  "1004",
  "1005",
  "1006",
  "1015"
]);

export const TERMINAL_KEYBOARD_MODE_PARAMS = new Set([
  "u"
]);

export const TERMINAL_ALT_SCREEN_MODE_PARAMS = new Set([
  "47",
  "1047",
  "1048",
  "1049"
]);

export const TERMINAL_MOUSE_MODE_RESET = `\x1b[?${[...TERMINAL_MOUSE_MODE_PARAMS].join(";")}l`;
export const TERMINAL_KEYBOARD_MODE_RESET = "\x1b[?ul";
export const TERMINAL_ALT_SCREEN_RESET = `\x1b[?${[...TERMINAL_ALT_SCREEN_MODE_PARAMS].join(";")}l`;
export const TERMINAL_PENDING_OUTPUT_CHARS = 1000000;
export const TERMINAL_PENDING_WRITE_CHARS = 2000000;

export function trimPendingOutputQueue(queue, currentChars, maxChars = TERMINAL_PENDING_OUTPUT_CHARS) {
  const items = Array.isArray(queue) ? queue : [];
  let chars = Math.max(0, Number(currentChars) || 0);
  const limit = Math.max(0, Number(maxChars) || 0);
  while (chars > limit && items.length > 1) {
    const dropped = items.shift();
    chars -= String(dropped?.data || "").length;
  }
  return Math.max(0, chars);
}

export function appendBoundedTerminalWrite(current, data, maxChars = TERMINAL_PENDING_WRITE_CHARS) {
  const limit = Math.max(0, Number(maxChars) || 0);
  if (!limit) {
    return "";
  }
  const next = `${current || ""}${data || ""}`;
  if (next.length <= limit) {
    return next;
  }
  // Truncating from the left with slice can cut through the middle of an ANSI
  // escape, leaving an orphaned tail (e.g. "[38;5;2m…" with the ESC byte gone)
  // that xterm would render as literal garbage. Realign the left edge to the
  // first ESC so the kept buffer begins at a clean sequence boundary. Plain
  // text before that ESC is safe to drop (xterm renders it identically with or
  // without it); only escapes must not be split.
  const truncated = next.slice(-limit);
  const firstEscape = truncated.indexOf("\x1b");
  return firstEscape > 0 ? truncated.slice(firstEscape) : truncated;
}

export function wheelEventToScrollLines(event, rowHeight = 16) {
  const deltaY = Number(event?.deltaY || 0);
  const deltaX = Number(event?.deltaX || 0);
  const dominantDelta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
  if (!dominantDelta) {
    return 0;
  }

  const pageLines = Math.max(1, Number(event?.pageLines || 24));
  const lineHeight = Math.max(1, Number(rowHeight) || 16);
  let lines;
  if (event?.deltaMode === 1) {
    lines = dominantDelta;
  } else if (event?.deltaMode === 2) {
    lines = dominantDelta * pageLines;
  } else {
    lines = dominantDelta / lineHeight;
  }
  return Math.trunc(lines) || Math.sign(dominantDelta);
}

export function handleTerminalWheel(event, terminal) {
  const lines = wheelEventToScrollLines(event, terminal?._core?._renderService?.dimensions?.css?.cell?.height);
  if (lines) {
    terminal?.scrollLines?.(lines);
  }
  // Embedded wheel scrolling is local xterm scrollback. Do not forward it to tmux or agent stdin.
  event?.preventDefault?.();
  event?.stopPropagation?.();
  return false;
}

export function createTerminalInputBatcher({
  send,
  onError,
  scheduleFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (frame) => cancelAnimationFrame(frame)
} = {}) {
  let pending = "";
  let frame = 0;
  let disposed = false;

  const deliver = (data) => {
    if (!data || typeof send !== "function") {
      return;
    }
    Promise.resolve(send(data)).catch((error) => {
      onError?.(error);
    });
  };

  const flush = () => {
    frame = 0;
    if (disposed) {
      return;
    }
    const data = pending;
    pending = "";
    deliver(data);
  };

  return {
    push(data) {
      if (disposed) {
        return;
      }
      const value = String(data || "");
      if (!value) {
        return;
      }
      pending += value;
      if (!frame) {
        frame = scheduleFrame(flush);
      }
    },
    flush() {
      if (frame) {
        cancelFrame(frame);
        frame = 0;
      }
      flush();
    },
    dispose({ flush: shouldFlush = true } = {}) {
      if (disposed) {
        return;
      }
      if (frame) {
        cancelFrame(frame);
        frame = 0;
      }
      const data = pending;
      pending = "";
      disposed = true;
      if (shouldFlush) {
        deliver(data);
      }
    },
    pending() {
      return pending;
    }
  };
}

export function filterTerminalInput(data) {
  return String(data || "")
    .replace(/\x1b\[(?:I|O)/g, "")
    .replace(/\x1b\[M[\s\S]{0,3}/g, "")
    .replace(/\x1b\[<[\d;]*[mM]/g, "")
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1bP[\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[=>?0-9;]*c/g, "")
    .replace(/\x1b=[>?0-9;]*c/g, "")
    .replace(/\x1b\[\??[0-9;]*[Rc]/g, "");
}

export function incompleteEscapeStart(value) {
  const escapeIndex = value.lastIndexOf("\x1b");
  if (escapeIndex === -1) return -1;
  const tail = value.slice(escapeIndex);
  if (tail === "\x1b") return escapeIndex;
  if (tail.startsWith("\x1b[")) {
    for (let index = 2; index < tail.length; index += 1) {
      const code = tail.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return -1;
    }
    return escapeIndex;
  }
  if ((tail.startsWith("\x1b]") || tail.startsWith("\x1bP")) && !tail.includes("\x07") && !tail.includes("\x1b\\")) {
    return escapeIndex;
  }
  return -1;
}

export function completeTerminalOutput(data, pendingRef) {
  const value = `${pendingRef.current || ""}${data || ""}`;
  const pendingStart = incompleteEscapeStart(value);
  if (pendingStart === -1) {
    pendingRef.current = "";
    return value;
  }
  pendingRef.current = value.slice(pendingStart);
  return value.slice(0, pendingStart);
}

export function filterTerminalOutput(data, pendingRef) {
  return completeTerminalOutput(String(data || ""), pendingRef)
    .replace(/\x1b\[\?u[hl]/g, "")
    .replace(/\x1b\[>4;[0-9]+m/g, "")
    .replace(/\x1b\[\?([0-9;]*)([hl])/g, (match, params, action) => {
    if (!params) return match;
    const blockedParams = new Set([
      ...TERMINAL_MOUSE_MODE_PARAMS,
      ...TERMINAL_ALT_SCREEN_MODE_PARAMS
    ]);
    const keptParams = params.split(";").filter((param) => param && !blockedParams.has(param));
    return keptParams.length ? `\x1b[?${keptParams.join(";")}${action}` : "";
  });
}

export function resetTerminalMouseModes(terminal) {
  try {
    // Keep embedded panes in xterm's main buffer so local scrollback can collect
    // agent output, even when the agent TUI tries to use mouse/keyboard/alt modes.
    terminal.write(TERMINAL_MOUSE_MODE_RESET);
    terminal.write(TERMINAL_KEYBOARD_MODE_RESET);
    terminal.write(TERMINAL_ALT_SCREEN_RESET);
  } catch {
    // Selection should stay best-effort if the terminal is already disposed.
  }
}
