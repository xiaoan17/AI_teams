---
created: 2026-06-17
status: Implemented
state: finish
tags: [terminal, utf-8, tailfile, replay, glyph-corruption, codepoint-split]
related:
  - docs/issues/20260617-packaged-app-utf8-locale-glyph-corruption-[finish].md
  - docs/features/20260616-true-tui-terminal-rendering.md
  - src/main/main.cjs
---

# 输入区方块乱码：tailFile 字节切片切断 UTF-8 码点

## Summary

终端面板在 **tab 切回 / 重新挂载 / 重放历史** 时，输入区和边框偶发出现 `�`（U+FFFD 替换字符）方块。根因在 `tailFile()`：它从文件**任意字节偏移**截取尾部窗口，几乎必然从一个多字节 UTF-8 码点的**中间**开始，旧代码直接 `buffer.toString("utf8")`，把那个残缺的头（和结尾的半截码点）解码成 `�`，这些替换字符被写进 tmux view，就是用户看到的破框/乱方块。

这是**纯字节层 bug**，和 [GUI 缺 LANG 导致 tmux 非 UTF-8](20260617-packaged-app-utf8-locale-glyph-corruption-[finish].md) 是两个独立的 `�` 来源，dev 和安装版都会中。

## User Visible Symptoms

- 切回某个 agent tab、或窗口重挂载触发重放时，终端顶部/输入区闪出 `�` 方块或破碎边框。
- 多字节内容（box-drawing `─│╭╮`、CJK、emoji）越多越容易触发；纯 ASCII 日志不复现。

## Root Cause

`tailFile()` 只想要文件尾部 `limit` 字节：

```js
const bytesToRead = Math.min(stat.size, limit);
const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
const data = buffer.toString("utf8", 0, bytesRead);   // ← 旧代码
```

`stat.size - bytesToRead` 是个任意字节偏移，落在某个 UTF-8 码点中间的概率极高：

- **头部**：窗口第一个字节可能是某码点的第 2/3/4 个字节（continuation byte `0b10xxxxxx`），`toString` 解不出 → `�`。
- **尾部**：最后一个码点可能只读进来一半，`toString` 同样吐 `�`。

UTF-8 box-drawing 是 3 字节、CJK 3 字节、emoji 4 字节，所以恰恰是这些字形最容易被切断 → 边框和 CJK 输入行最先烂。

## Fix

`src/main/main.cjs` `tailFile()`（main.cjs:1812-1833）：两端都处理。

1. **跳过头部残字节**：只有从文件内部切片（`stat.size > bytesToRead`）时头部才可能是半截。UTF-8 continuation byte 是 `0b10xxxxxx`（`& 0xc0 === 0x80`），从头逐字节前进到第一个 leading byte 为止；上限 4（一个 UTF-8 码点最多 4 字节），防止全 continuation 的退化 buffer 跑飞。
2. **缓冲尾部半截**：用 `StringDecoder("utf8")` 解码，它会**攒住**结尾的不完整序列而不是吐 `�`（残尾被丢弃而非污染）。

```js
let start = 0;
if (stat.size > bytesToRead) {
  const maxSkip = Math.min(bytesRead, 4);
  while (start < maxSkip && (buffer[start] & 0xc0) === 0x80) {
    start += 1;
  }
}
const decoder = new StringDecoder("utf8");
const data = decoder.write(buffer.subarray(start, bytesRead));
```

代价：丢弃头尾各至多 3 字节的残缺码点。这是正确的——残缺码点本就无法显示，丢掉好过渲染成 `�`。

## Verification

1. `node --check src/main/main.cjs` 通过。
2. 终端 wheel/重放 smoke（`npm run smoke:terminal-wheel`）通过。
3. 在含大量 box-drawing/CJK 的会话日志上反复 tab 切换触发重放，输入区/边框不再出现 `�`。

## Notes / 预防

- **根因类别**：任何"从字节流任意偏移截窗口再 `toString('utf8')`"的地方都有这个隐患（log tail、ring buffer、网络分片）。规则：切片边界 = 字节边界 ≠ 码点边界；要么对齐到 leading byte + `StringDecoder`，要么按字符而非字节切。
- 和 [LANG 缺失](20260617-packaged-app-utf8-locale-glyph-corruption-[finish].md) 联合记忆：两个 `�` 源，本条 dev/安装版都中、那条只中安装版。两个都修才彻底干净。
