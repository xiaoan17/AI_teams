import assert from "assert";
import {
  TERMINAL_ALT_SCREEN_RESET,
  TERMINAL_MOUSE_MODE_RESET,
  TERMINAL_KEYBOARD_MODE_RESET,
  TERMINAL_PENDING_OUTPUT_CHARS,
  TERMINAL_PENDING_WRITE_CHARS,
  TERMINAL_SCROLLBACK_LINES,
  appendBoundedTerminalWrite,
  createTerminalInputBatcher,
  filterTerminalInput,
  filterTerminalOutput,
  handleTerminalWheel,
  incompleteEscapeStart,
  trimPendingOutputQueue,
  wheelEventToScrollLines
} from "../src/renderer/terminal-wheel.mjs";

assert.strictEqual(TERMINAL_SCROLLBACK_LINES, 20000);
assert.strictEqual(TERMINAL_PENDING_OUTPUT_CHARS, 1000000);
assert.strictEqual(TERMINAL_PENDING_WRITE_CHARS, 2000000);
assert.ok(TERMINAL_MOUSE_MODE_RESET.startsWith("\x1b[?"));
assert.ok(TERMINAL_MOUSE_MODE_RESET.includes("1000"));
assert.ok(TERMINAL_MOUSE_MODE_RESET.endsWith("l"));
assert.strictEqual(TERMINAL_KEYBOARD_MODE_RESET, "\x1b[?ul");
assert.ok(TERMINAL_ALT_SCREEN_RESET.includes("1049"));
assert.ok(TERMINAL_ALT_SCREEN_RESET.endsWith("l"));
assert.strictEqual(wheelEventToScrollLines({ deltaY: 32, deltaMode: 0 }, 16), 2);
assert.strictEqual(wheelEventToScrollLines({ deltaY: -8, deltaMode: 1 }, 16), -8);
assert.strictEqual(wheelEventToScrollLines({ deltaY: 1, deltaMode: 2, pageLines: 30 }, 16), 30);
assert.strictEqual(wheelEventToScrollLines({ deltaX: 24, deltaY: 0, deltaMode: 0 }, 12), 2);
assert.strictEqual(wheelEventToScrollLines({ deltaX: 4, deltaY: 24, deltaMode: 0 }, 12), 2);
assert.strictEqual(wheelEventToScrollLines({ deltaX: 0, deltaY: 0, deltaMode: 0 }, 12), 0);

const calls = [];
const event = {
  deltaY: 48,
  deltaMode: 0,
  preventDefault: () => calls.push("preventDefault"),
  stopPropagation: () => calls.push("stopPropagation")
};
const terminal = {
  _core: {
    _renderService: {
      dimensions: {
        css: {
          cell: {
            height: 16
          }
        }
      }
    }
  },
  scrollLines: (lines) => calls.push(["scrollLines", lines])
};

assert.strictEqual(handleTerminalWheel(event, terminal), false);
assert.deepStrictEqual(calls, [["scrollLines", 3], "preventDefault", "stopPropagation"]);

const batches = [];
const scheduled = [];
const batcher = createTerminalInputBatcher({
  send: async (data) => batches.push(data),
  scheduleFrame: (callback) => {
    scheduled.push(callback);
    return scheduled.length;
  },
  cancelFrame: () => {}
});
batcher.push("a");
batcher.push("1");
batcher.push("\r");
assert.strictEqual(scheduled.length, 1, "input should be coalesced onto one animation frame");
scheduled.shift()();
await Promise.resolve();
assert.deepStrictEqual(batches, ["a1\r"], "same-frame terminal input should send as one batch");

const disposeBatches = [];
const disposeBatcher = createTerminalInputBatcher({
  send: async (data) => disposeBatches.push(data),
  scheduleFrame: () => 1,
  cancelFrame: () => {}
});
disposeBatcher.push("tail");
disposeBatcher.dispose({ flush: true });
await Promise.resolve();
assert.deepStrictEqual(disposeBatches, ["tail"], "dispose should flush pending terminal input");

const zeroCalls = [];
assert.strictEqual(handleTerminalWheel({
  deltaY: 0,
  deltaMode: 0,
  preventDefault: () => zeroCalls.push("preventDefault"),
  stopPropagation: () => zeroCalls.push("stopPropagation")
}, terminal), false);
assert.deepStrictEqual(zeroCalls, ["preventDefault", "stopPropagation"]);

const pendingOutput = { current: "" };
assert.strictEqual(filterTerminalOutput("a\x1b[?1000hbc", pendingOutput), "abc");
assert.strictEqual(pendingOutput.current, "");
assert.strictEqual(filterTerminalOutput("a\x1b[?25;1006hbc", pendingOutput), "a\x1b[?25hbc");
assert.strictEqual(filterTerminalOutput("a\x1b[?1006;25hbc", pendingOutput), "a\x1b[?25hbc");
assert.strictEqual(filterTerminalOutput("a\x1b[?1000lbc", pendingOutput), "abc");
assert.strictEqual(filterTerminalOutput("a\x1b[?uhbc", pendingOutput), "abc");
assert.strictEqual(filterTerminalOutput("a\x1b[?ulbc", pendingOutput), "abc");
assert.strictEqual(filterTerminalOutput("a\x1b[>4;2mbc", pendingOutput), "abc");
assert.strictEqual(filterTerminalOutput("a\x1b[?1049hbc", pendingOutput), "abc");
assert.strictEqual(filterTerminalOutput("a\x1b[?1049lbc", pendingOutput), "abc");
assert.strictEqual(filterTerminalOutput("a\x1b[?25;1049hbc", pendingOutput), "a\x1b[?25hbc");
assert.strictEqual(filterTerminalOutput("a\x1b[?1049;25lbc", pendingOutput), "a\x1b[?25lbc");

const splitPending = { current: "" };
assert.strictEqual(filterTerminalOutput("hello\x1b[?100", splitPending), "hello");
assert.strictEqual(splitPending.current, "\x1b[?100");
assert.strictEqual(filterTerminalOutput("0h world", splitPending), " world");
assert.strictEqual(splitPending.current, "");
assert.strictEqual(incompleteEscapeStart("abc\x1b["), 3);
assert.strictEqual(incompleteEscapeStart("abc\x1b[?1000h"), -1);

assert.strictEqual(filterTerminalInput("ok\x1b[Mabcdone"), "okdone");
assert.strictEqual(filterTerminalInput("ok\x1b[<64;12;4Mdone"), "okdone");
assert.strictEqual(filterTerminalInput("ok\x1b]0;title\x07done"), "okdone");
assert.strictEqual(filterTerminalInput("ok\x1b[12;34Rdone"), "okdone");
assert.strictEqual(filterTerminalInput("ok\x1b[?1;2cdone"), "okdone");
assert.strictEqual(filterTerminalInput("ok\x1b[>0;276;0cdone"), "okdone");
assert.strictEqual(filterTerminalInput("ok\x1b[=0;276;0cdone"), "okdone");

const pendingQueue = [
  { data: "old" },
  { data: "middle" },
  { data: "new" }
];
const pendingChars = trimPendingOutputQueue(pendingQueue, "oldmiddlenew".length, 6);
assert.deepStrictEqual(pendingQueue, [{ data: "new" }]);
assert.strictEqual(pendingChars, 3);

const oneItemQueue = [{ data: "oversized" }];
assert.strictEqual(trimPendingOutputQueue(oneItemQueue, "oversized".length, 3), "oversized".length);
assert.deepStrictEqual(oneItemQueue, [{ data: "oversized" }]);

assert.strictEqual(appendBoundedTerminalWrite("abc", "def", 4), "cdef");
assert.strictEqual(appendBoundedTerminalWrite("", "abcdef", 3), "def");
assert.strictEqual(appendBoundedTerminalWrite("abc", "def", 0), "");

console.log("terminal wheel smoke passed");
