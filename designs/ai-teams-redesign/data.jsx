// Mock data for the AI Teams redesign prototype. Realistic enough that the
// dashboard and terminals feel like a live orchestration session.

const AGENTS = [
  {
    id: "designer", name: "产品设计师", runtime: "Claude · opus", avatar: "✦",
    status: "run", progress: 0.62,
    doing: "正在把 PRD 的中控台需求拆成交互流程，输出仪表盘的信息架构草图",
    task: "20260623-dashboard-ia.md",
    tail: "› Writing docs/design/dashboard-ia.md … 节点 3/5",
    term: [
      ["dim", "$ claude --dangerously-skip-permissions"],
      ["", "● 读取 PRD：中控台 / 多视图切换 需求"],
      ["accent", "✓ 已生成交互流程：终端视图 ⇄ 中控台 分段切换"],
      ["", "● 正在草拟仪表盘信息架构…"],
      ["dim", "  - KPI 概览条（在跑 / 等待 / 出错 / 今日消息）"],
      ["dim", "  - 每个 Agent 实时状态卡"],
      ["dim", "  - 任务交接流 + 活动时间线"],
      ["", "› Writing docs/design/dashboard-ia.md"],
      ["cursor"]
    ]
  },
  {
    id: "techlead", name: "技术负责人", runtime: "Claude · opus", avatar: "◆",
    status: "wait", progress: 0.4,
    doing: "需要确认：中控台的实时数据走 IPC 推送还是轮询？等待你的决策",
    task: "20260623-arch-review.md",
    tail: "? 等待输入：是否允许写入 src/main/ipc.cjs ?",
    term: [
      ["dim", "$ claude --dangerously-skip-permissions"],
      ["", "● 评审中控台数据通道方案"],
      ["accent", "✓ 方案 A：复用 onAgentStatus 事件流（增量推送）"],
      ["accent", "✓ 方案 B：每 2s 轮询 listAgents（实现简单）"],
      ["amber", "? 倾向方案 A，但需要改动 src/main/ipc.cjs"],
      ["amber", "  是否允许修改主进程 IPC？(y/n)"],
      ["cursor"]
    ]
  },
  {
    id: "frontend", name: "前端工程师", runtime: "Codex · gpt-5.2", avatar: "▲",
    status: "run", progress: 0.78,
    doing: "实现分段视图切换组件与中控台骨架，已接好状态卡，正在写时间线",
    task: "20260623-dashboard-ui.md",
    tail: "› vite: hmr update /src/renderer/Dashboard.jsx (3 modules)",
    term: [
      ["dim", "$ codex --dangerously-bypass-approvals-and-sandbox"],
      ["", "● 实现 <Segmented> 视图切换"],
      ["accent", "✓ 终端 ⇄ 中控台 切换正常，状态持久化到 localStorage"],
      ["", "● 实现中控台 Agent 状态卡网格"],
      ["accent", "✓ 状态卡 + 进度条 + 输出尾巴"],
      ["", "● 实现活动时间线…"],
      ["user", "› vite: hmr update /src/renderer/Dashboard.jsx (3 modules)"],
      ["cursor"]
    ]
  }
];

const STATS = [
  { id: "running", label: "运行中", num: 2, kind: "accent", sub: "3 名成员在岗", spark: [3,4,3,5,4,6,5], hot: true, icon: "bolt" },
  { id: "waiting", label: "等待输入", num: 1, kind: "amber",  sub: "技术负责人 需决策", spark: [0,1,0,1,1,0,1], hot: true, icon: "clock" },
  { id: "errors",  label: "异常",   num: 0, kind: "",       sub: "近 1 小时无异常", spark: [1,0,0,0,0,0,0], icon: "alert" },
  { id: "msgs",    label: "今日消息 / 交接", num: 47, kind: "", sub: "12 次任务交接", spark: [4,7,5,9,8,11,12], icon: "msg" }
];

const FLOW = [
  { id: 1, from: "产品设计师", to: "前端工程师", doc: "docs/design/dashboard-ia.md", state: "active", time: "刚刚" },
  { id: 2, from: "技术负责人", to: "前端工程师", doc: "docs/arch/data-channel.md", state: "queued", time: "2 分钟前" },
  { id: 3, from: "PRD", to: "产品设计师", doc: "docs/prd/multi-view.md", state: "done", time: "18 分钟前" },
  { id: 4, from: "前端工程师", to: "QA", doc: "docs/tasks/dashboard-ui.md", state: "queued", time: "刚刚" }
];

const FEED = [
  { id: 1, kind: "wait", time: "10:51", text: "<b>技术负责人</b> 进入等待：确认数据通道方案 A / B" },
  { id: 2, kind: "msg",  time: "10:50", text: "你 → <b>前端工程师</b>：把时间线接到真实事件流" },
  { id: 3, kind: "done", time: "10:47", text: "<b>产品设计师</b> 完成 仪表盘信息架构 草图" },
  { id: 4, kind: "run",  time: "10:45", text: "<b>前端工程师</b> 开始实现 中控台状态卡网格" },
  { id: 5, kind: "msg",  time: "10:42", text: "<b>PRD</b> → <b>产品设计师</b>：交接 多视图切换需求" },
  { id: 6, kind: "done", time: "10:38", text: "<b>产品设计师</b> 完成 终端 ⇄ 中控台 交互流程" },
  { id: 7, kind: "run",  time: "10:31", text: "<b>前端工程师</b> 启动，HMR 已就绪" },
  { id: 8, kind: "run",  time: "10:30", text: "团队启动：3 名成员在岗" }
];

const DOCS = [
  { folder: "design", name: "dashboard-ia.md", sub: "docs/design · 刚刚", tag: "todo", pinned: true },
  { folder: "prd", name: "multi-view.md", sub: "docs/prd · 18 分钟前", tag: "finish", pinned: true },
  { folder: "arch", name: "data-channel.md", sub: "docs/arch · 2 分钟前", tag: "todo", pinned: false },
  { folder: "tasks", name: "dashboard-ui.md", sub: "docs/tasks · 刚刚", tag: "todo", pinned: false },
  { folder: "features", name: "broadcast-routing.md", sub: "docs/features · 昨天", tag: "finish", pinned: false }
];

const STATUS_LABEL = { run: "运行中", wait: "等待输入", err: "异常", stop: "已停止" };

Object.assign(window, { AGENTS, STATS, FLOW, FEED, DOCS, STATUS_LABEL });
