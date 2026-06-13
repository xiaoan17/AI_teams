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

export const TERMINAL_MOUSE_MODE_RESET = `\x1b[?${[...TERMINAL_MOUSE_MODE_PARAMS].join(";")}l`;

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

export function filterTerminalInput(data) {
  return String(data || "")
    .replace(/\x1b\[(?:I|O)/g, "")
    .replace(/\x1b\[M[\s\S]{0,3}/g, "")
    .replace(/\x1b\[<[\d;]*[mM]/g, "")
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1bP[\s\S]*?(?:\x07|\x1b\\)/g, "")
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
  return completeTerminalOutput(String(data || ""), pendingRef).replace(/\x1b\[\?([0-9;]*)([hl])/g, (match, params, action) => {
    if (action !== "h") return match;
    if (!params) return match;
    const keptParams = params.split(";").filter((param) => param && !TERMINAL_MOUSE_MODE_PARAMS.has(param));
    return keptParams.length ? `\x1b[?${keptParams.join(";")}${action}` : "";
  });
}

export function resetTerminalMouseModes(terminal) {
  try {
    terminal.write(TERMINAL_MOUSE_MODE_RESET);
  } catch {
    // Selection should stay best-effort if the terminal is already disposed.
  }
}
