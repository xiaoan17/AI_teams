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

  // composer
  "composer.targets": "目标：",
  "composer.targetsNone": "无",
  "composer.send": "发送",
  "composer.sending": "发送中…",
  "composer.sendTooltip": "Enter 发送，Ctrl/Cmd+Enter 换行",
  "composer.askAgent": "给 {name} 发消息…",
  "composer.mentionAgent": "用 @ 提及一个员工来发送…",
  "composer.attachDoc": "附带文档",
  "composer.changeDoc": "更换附带文档",
  "composer.removeDoc": "移除附带文档",
  "composer.noDoc": "不附带文档",

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
  "toast.dismiss": "关闭"
};

const en = {
  // common
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.close": "Close",

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

  // composer
  "composer.targets": "Targets: ",
  "composer.targetsNone": "none",
  "composer.send": "Send",
  "composer.sending": "Sending...",
  "composer.sendTooltip": "Enter to send, Ctrl/Cmd+Enter for a new line",
  "composer.askAgent": "@{name} Ask an agent...",
  "composer.mentionAgent": "Mention an agent to send...",
  "composer.attachDoc": "Attach doc",
  "composer.changeDoc": "Change attached doc",
  "composer.removeDoc": "Remove attached doc",
  "composer.noDoc": "No doc",

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
  "toast.dismiss": "Dismiss"
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
