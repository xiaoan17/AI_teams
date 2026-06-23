// Lightweight, zero-dependency i18n for the renderer.
//
// Why hand-rolled (see docs/plans/20260620-UIUX优化与构建计划.md §5):
//   - The string count is small (~120). A dictionary + t() + a Context is
//     enough; pulling in react-i18next would be more weight than value.
//   - Default language is zh (the target audience); en is a toggle.
//   - Missing-key fallback never blanks the UI: t() falls back zh[key], then
//     the key string itself.
//
// Migration is batched (plan §C1): keys are added as strings get migrated to
// t(). The i18n smoke test (scripts/i18n-smoke.cjs) asserts zh and en expose
// the SAME key set, so a half-translated key fails CI rather than shipping a
// blank.

import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

export const DEFAULT_LOCALE = "zh";
export const SUPPORTED_LOCALES = ["zh", "en"];
const LOCALE_STORAGE_KEY = "aiTeams.locale";

// Flat key dictionaries. Keep zh and en key sets identical — the smoke test
// enforces this. Add new keys to BOTH when migrating a batch.
const zh = {
  // common
  "common.cancel": "取消",
  "common.save": "保存",
  "common.delete": "删除",
  "common.close": "关闭",
  "common.live": "实时",

  // workspace view + theme
  "view.terminal": "终端",
  "view.dashboard": "中控台",
  "theme.toggleToLight": "切换到浅色",
  "theme.toggleToDark": "切换到深色",

  // status labels (agent.status -> label)
  "status.stopped": "已停止",
  "status.running": "运行中",
  "status.waiting_input": "等待输入",
  "status.error": "错误",

  // sidebar
  "sidebar.settings": "设置",
  "sidebar.theme": "主题",
  "sidebar.language": "语言",
  "sidebar.effects": "环境光效",
  "sidebar.expandSidebar": "展开侧边栏",
  "sidebar.collapseSidebar": "折叠侧边栏",
  "sidebar.project": "项目",
  "sidebar.chooseProject": "选择项目",
  "sidebar.recent": "最近",
  "sidebar.switchRecent": "切换最近项目…",
  "sidebar.noRecent": "暂无最近项目",
  "sidebar.start": "全部启动",
  "sidebar.stop": "全部停止",
  "sidebar.team": "团队",
  "sidebar.configAgent": "配置 Agent",
  "sidebar.configAgentTooltip": "导入外部 Agent、查看与编辑 Role 配置",
  "sidebar.role": "员工",
  "sidebar.unassignedRole": "未分配角色",
  "sidebar.agentType": "运行时",
  "sidebar.off": "停用",
  "sidebar.startAgent": "启动",
  "sidebar.stopAgent": "停止",
  "sidebar.restorePanel": "还原面板",
  "sidebar.minimizePanel": "最小化面板",
  "sidebar.docs": "文档",
  "sidebar.searchDocs": "搜索文档",
  "sidebar.noMatchingDocs": "没有匹配的文档",
  "sidebar.noDocs": "暂无文档",

  // document filter + state labels
  "docFilter.all": "全部",
  "docFilter.todo": "待办",
  "docFilter.finish": "完成",
  "docState.todo": "待办",
  "docState.finish": "完成",

  // composer
  "composer.targets": "目标：",
  "composer.targetsNone": "无",
  "composer.send": "发送",
  "composer.sending": "发送中…",
  "composer.sendTooltip": "Enter 发送，Shift+Enter 换行",
  "composer.askAgent": "给 {name} 发消息…",
  "composer.mentionAgent": "用 @ 提及一个员工来发送…",
  "composer.attachDoc": "附带文档",
  "composer.changeDoc": "更换附带文档",
  "composer.removeDoc": "移除附带文档",
  "composer.noDoc": "不附带文档",
  "composer.hint": "Enter 发送 · Shift+Enter 换行",

  // dashboard
  "dashboard.members": "成员实时状态",
  "dashboard.realtime": "实时",
  "dashboard.live": "实时",
  "dashboard.memberMeta": "{n} 名成员 · 实时",
  "dashboard.kpi.running": "运行中",
  "dashboard.kpi.runningSub": "{n} 名成员在岗",
  "dashboard.kpi.waiting": "等待输入",
  "dashboard.kpi.waitingSub": "{n} 需决策",
  "dashboard.kpi.errors": "异常",
  "dashboard.kpi.errorsSub": "近 1 小时状态",
  "dashboard.kpi.messages": "今日消息 / 交接",
  "dashboard.kpi.messagesSub": "{n} 次任务交接",
  "dashboard.flow": "任务交接流",
  "dashboard.flow.active": "进行中",
  "dashboard.flow.queued": "排队",
  "dashboard.flow.done": "已完成",
  "dashboard.timeline": "活动时间线",
  "dashboard.doing": "在做",
  "dashboard.noTask": "未绑定任务",
  "dashboard.you": "你",
  "dashboard.emptyFlow": "还没有路由记录",
  "dashboard.emptyTimeline": "等待新的成员事件",

  // time (relative)
  "time.now": "刚刚",
  "time.minutesAgo": "{n} 分钟前",
  "time.hoursAgo": "{n} 小时前",
  "time.daysAgo": "{n} 天前",

  // empty states (workspace)
  "empty.minimized": "{n} 个面板已最小化，点击侧边栏的员工可还原。",
  "empty.noRunning": "从侧边栏启动一个员工，打开它的终端。",
  "empty.noAgents": "还没有配置团队成员。",
  "empty.configureTeam": "配置团队",
  "empty.startAll": "全部启动",

  // toast
  "toast.dismiss": "关闭",

  // confirm dialog
  "confirm.confirm": "确定",
  "confirm.cancel": "取消",
  "confirm.discardTitle": "放弃未保存的修改？",
  "confirm.discardBody": "有未保存的修改，确定关闭吗？",
  "confirm.deleteRoleGlobal": "「{id}」是全局 Role，删除会影响所有项目。确定删除吗？",
  "confirm.deleteRole": "确定删除 Role「{id}」吗？",

  // role config modal notices
  "roleModal.importUnsupported": "当前环境不支持导入。",
  "roleModal.imported": "已导入：{id}",
  "roleModal.saved": "已保存：{id}",
  "roleModal.deleted": "已删除：{id}",
  "roleModal.deletedAffected": "已删除：{id}（{n} 个成员仍引用，需重新分配）",

  // onboarding / health-check
  "onboarding.title": "👋 欢迎使用 AI Teams",
  "onboarding.subtitle": "本地多 Agent 终端工作台 —— 先确认环境就绪",
  "onboarding.aria": "健康检查",
  "onboarding.checking": "正在检测运行环境…",
  "onboarding.envTitle": "运行环境",
  "onboarding.installed": "已安装",
  "onboarding.installedVersion": "已安装 ({version})",
  "onboarding.installedNotRunnable": "已安装但无法运行",
  "onboarding.notFound": "未检测到",
  "onboarding.ready": "环境就绪，可以开始组队。",
  "onboarding.notReady": "至少需要 tmux + 一个可运行的 Agent CLI。",
  "onboarding.dontShowAgain": "下次不再显示",
  "onboarding.recheck": "重新检测",
  "onboarding.rechecking": "检测中…",
  "onboarding.startTeam": "开始组队 →",
  "onboarding.installGuide": "安装指引 ↗"
};

const en = {
  // common
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.close": "Close",
  "common.live": "Live",

  // workspace view + theme
  "view.terminal": "Terminal",
  "view.dashboard": "Dashboard",
  "theme.toggleToLight": "Switch to light",
  "theme.toggleToDark": "Switch to dark",

  // status labels
  "status.stopped": "Stopped",
  "status.running": "Running",
  "status.waiting_input": "Needs Input",
  "status.error": "Error",

  // sidebar
  "sidebar.settings": "Settings",
  "sidebar.theme": "Theme",
  "sidebar.language": "Language",
  "sidebar.effects": "Ambient effects",
  "sidebar.expandSidebar": "Expand sidebar",
  "sidebar.collapseSidebar": "Collapse sidebar",
  "sidebar.project": "Project",
  "sidebar.chooseProject": "Choose project",
  "sidebar.recent": "Recent",
  "sidebar.switchRecent": "Switch recent...",
  "sidebar.noRecent": "No recent projects",
  "sidebar.start": "Start",
  "sidebar.stop": "Stop",
  "sidebar.team": "Team",
  "sidebar.configAgent": "Configure Agent",
  "sidebar.configAgentTooltip": "Import external agents, view and edit role configs",
  "sidebar.role": "Role",
  "sidebar.unassignedRole": "No role",
  "sidebar.agentType": "Runtime",
  "sidebar.off": "Off",
  "sidebar.startAgent": "Start agent",
  "sidebar.stopAgent": "Stop agent",
  "sidebar.restorePanel": "Restore panel",
  "sidebar.minimizePanel": "Minimize panel",
  "sidebar.docs": "Docs",
  "sidebar.searchDocs": "Search docs",
  "sidebar.noMatchingDocs": "No matching docs",
  "sidebar.noDocs": "No docs",

  // document filter + state labels
  "docFilter.all": "All",
  "docFilter.todo": "Todo",
  "docFilter.finish": "Finish",
  "docState.todo": "Todo",
  "docState.finish": "Finish",

  // composer
  "composer.targets": "Targets: ",
  "composer.targetsNone": "none",
  "composer.send": "Send",
  "composer.sending": "Sending...",
  "composer.sendTooltip": "Enter to send, Shift+Enter for newline",
  "composer.askAgent": "@{name} Ask an agent...",
  "composer.mentionAgent": "Mention an agent to send...",
  "composer.attachDoc": "Attach doc",
  "composer.changeDoc": "Change attached doc",
  "composer.removeDoc": "Remove attached doc",
  "composer.noDoc": "No doc",
  "composer.hint": "Enter to send · Shift+Enter for newline",

  // dashboard
  "dashboard.members": "Live agent status",
  "dashboard.realtime": "Live",
  "dashboard.live": "Live",
  "dashboard.memberMeta": "{n} members · live",
  "dashboard.kpi.running": "Running",
  "dashboard.kpi.runningSub": "{n} members active",
  "dashboard.kpi.waiting": "Waiting",
  "dashboard.kpi.waitingSub": "{n} need decisions",
  "dashboard.kpi.errors": "Errors",
  "dashboard.kpi.errorsSub": "Last hour status",
  "dashboard.kpi.messages": "Messages · handoffs today",
  "dashboard.kpi.messagesSub": "{n} handoffs",
  "dashboard.flow": "Handoff flow",
  "dashboard.flow.active": "Active",
  "dashboard.flow.queued": "Queued",
  "dashboard.flow.done": "Done",
  "dashboard.timeline": "Activity",
  "dashboard.doing": "Doing",
  "dashboard.noTask": "No task",
  "dashboard.you": "You",
  "dashboard.emptyFlow": "No route records yet",
  "dashboard.emptyTimeline": "Waiting for agent events",

  // time (relative)
  "time.now": "now",
  "time.minutesAgo": "{n}m ago",
  "time.hoursAgo": "{n}h ago",
  "time.daysAgo": "{n}d ago",

  // empty states (workspace)
  "empty.minimized": "{n} agent panel(s) minimized. Click an agent in the sidebar to restore it.",
  "empty.noRunning": "Start an agent from the sidebar to open its terminal.",
  "empty.noAgents": "No team members are configured yet.",
  "empty.configureTeam": "Configure team",
  "empty.startAll": "Start all",

  // toast
  "toast.dismiss": "Dismiss",

  // confirm dialog
  "confirm.confirm": "Confirm",
  "confirm.cancel": "Cancel",
  "confirm.discardTitle": "Discard unsaved changes?",
  "confirm.discardBody": "You have unsaved changes. Close anyway?",
  "confirm.deleteRoleGlobal": "\"{id}\" is a global role; deleting it affects every project. Delete anyway?",
  "confirm.deleteRole": "Delete role \"{id}\"?",

  // role config modal notices
  "roleModal.importUnsupported": "Import is not supported in this environment.",
  "roleModal.imported": "Imported: {id}",
  "roleModal.saved": "Saved: {id}",
  "roleModal.deleted": "Deleted: {id}",
  "roleModal.deletedAffected": "Deleted: {id} ({n} member(s) still reference it and need reassigning)",

  // onboarding / health-check
  "onboarding.title": "👋 Welcome to AI Teams",
  "onboarding.subtitle": "A local multi-agent terminal workspace — let's confirm your environment first",
  "onboarding.aria": "Health check",
  "onboarding.checking": "Checking your environment…",
  "onboarding.envTitle": "Environment",
  "onboarding.installed": "Installed",
  "onboarding.installedVersion": "Installed ({version})",
  "onboarding.installedNotRunnable": "Installed but not runnable",
  "onboarding.notFound": "Not found",
  "onboarding.ready": "Environment is ready — you can start your team.",
  "onboarding.notReady": "You need at least tmux + one runnable agent CLI.",
  "onboarding.dontShowAgain": "Don't show again",
  "onboarding.recheck": "Re-check",
  "onboarding.rechecking": "Checking…",
  "onboarding.startTeam": "Start team →",
  "onboarding.installGuide": "Install guide ↗"
};

export const DICTIONARIES = { zh, en };

// Interpolate {var} placeholders from a vars object. Unknown placeholders are
// left intact so a missing var is visible rather than silently blank.
function interpolate(template, vars) {
  if (!vars || typeof template !== "string") return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

// Core translator. locale -> dict; missing key falls back to zh, then the key.
export function translate(locale, key, vars) {
  const dict = DICTIONARIES[locale] || DICTIONARIES[DEFAULT_LOCALE];
  const value = (key in dict) ? dict[key] : (key in DICTIONARIES[DEFAULT_LOCALE] ? DICTIONARIES[DEFAULT_LOCALE][key] : key);
  return interpolate(value, vars);
}

function readStoredLocale() {
  try {
    const stored = window.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;
  } catch { /* ignore */ }
  return DEFAULT_LOCALE;
}

const LocaleContext = createContext({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars)
});

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(readStoredLocale);

  const setLocale = useCallback((next) => {
    if (!SUPPORTED_LOCALES.includes(next)) return;
    setLocaleState(next);
    try { window.localStorage?.setItem(LOCALE_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({
    locale,
    setLocale,
    t: (key, vars) => translate(locale, key, vars)
  }), [locale, setLocale]);

  return React.createElement(LocaleContext.Provider, { value }, children);
}

export function useLocale() {
  return useContext(LocaleContext);
}

// Convenience hook returning just the translator (most call sites only need t).
export function useT() {
  return useContext(LocaleContext).t;
}
