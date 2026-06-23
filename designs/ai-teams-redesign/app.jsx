// App: orchestrator. Holds all state — view, active agent, composer, toasts.
// Renders rail + topbar (segmented switcher) + active view + composer.

const { useState, useRef, useEffect, useCallback } = React;

/* ---------------------------------------------------------------- Rail ---- */
function Rail({ collapsed, onToggle, activeId, onSelect, onConfigure, docQuery, setDocQuery }) {
  const docs = window.DOCS;
  const filtered = docs.filter((d) =>
    !docQuery || d.name.toLowerCase().includes(docQuery.toLowerCase()) || d.folder.includes(docQuery)
  );
  // group docs by folder
  const folders = {};
  for (const d of filtered) (folders[d.folder] ||= []).push(d);

  return (
    <aside className="rail">
      <div className="rail-brand">
        <div className="brand-mark">AT</div>
        <div className="brand-name">
          <h1>AI Teams</h1>
          <div className="brand-sub">ai-teams · feature/loop</div>
        </div>
        <button className="rail-iconbtn" onClick={onToggle} title={collapsed ? "展开" : "收起"}>
          {collapsed ? <IconChevR size={16} /> : <IconChevL size={16} />}
        </button>
      </div>

      <div className="rail-project">
        <span className="eyebrow">当前项目</span>
        <button className="project-btn">
          <span className="pdot" />
          <span className="pname">ai-teams</span>
          <IconChevDown size={14} className="pchev" />
        </button>
      </div>

      <div className="rail-section">
        <div className="section-head">
          <span className="eyebrow">团队</span>
          <button className="ghost-btn" onClick={onConfigure}>
            <IconSettings size={12} /> 配置
          </button>
        </div>
        <div className="member-list">
          {window.AGENTS.map((a) => (
            <button
              key={a.id}
              className={["member", activeId === a.id ? "active" : ""].filter(Boolean).join(" ")}
              onClick={() => onSelect(a.id)}
            >
              <span className={`dot ${a.status}`} />
              <span className="m-id">
                <span className="m-name">{a.name}</span>
                <span className="m-runtime">{a.runtime}</span>
              </span>
              <span className="m-actions">
                <span className="win-btn-like" title={window.STATUS_LABEL[a.status]} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="docs">
        <div className="section-head">
          <span className="eyebrow">项目文档</span>
          <span className="count">{filtered.length}</span>
        </div>
        <div className="docs-search">
          <input className="field" placeholder="搜索文档…" value={docQuery}
            onChange={(e) => setDocQuery(e.target.value)} />
          <select className="field" style={{ width: 70 }}>
            <option>全部</option>
            <option>待办</option>
            <option>完成</option>
          </select>
        </div>
        <div className="doc-tree">
          {Object.entries(folders).map(([folder, items]) => (
            <React.Fragment key={folder}>
              <button className="doc-folder">
                <IconFolder size={14} className="fchev" />
                <span className="fname">{folder}</span>
                <span className="fcount">{items.length}</span>
              </button>
              {items.map((d) => (
                <button key={d.name} className="doc-file">
                  <span className="dfmeta">
                    <span className="dfname">{d.name}</span>
                    <span className="dfsub">
                      {d.tag && <span className={`tag ${d.tag}`}>{d.tag === "finish" ? "完成" : "待办"}</span>}
                      {"  "}{d.sub}
                    </span>
                  </span>
                  <IconStar size={14} className={`pin ${d.pinned ? "pinned" : ""}`} filled={d.pinned} />
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------ Composer ---- */
function Composer({ activeAgent, attachedDoc, onAttach, onSend, pushToast }) {
  const [value, setValue] = useState("");
  const [docOpen, setDocOpen] = useState(false);
  const taRef = useRef(null);
  const docRef = useRef(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 52), 168)}px`;
  }, [value]);

  useEffect(() => {
    if (!docOpen) return;
    const onDown = (e) => { if (docRef.current && !docRef.current.contains(e.target)) setDocOpen(false); };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [docOpen]);

  const target = activeAgent ? activeAgent.name : null;
  const canSend = Boolean(value.trim()) && Boolean(target);

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    pushToast({ level: "ok", text: `已发送给 @${target}` });
    setValue("");
  };

  return (
    <footer className="composer">
      <div className="composer-shell">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={target ? `向 ${target} 提问，或 @全体 广播…` : "@某个成员 开始对话…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-tools">
          <div className="tool-left" ref={docRef} style={{ position: "relative" }}>
            <button
              className={["tool-btn", attachedDoc ? "on" : ""].filter(Boolean).join(" ")}
              onClick={() => setDocOpen((o) => !o)}
              title="附加文档"
            >
              <IconPaperclip size={15} />
              {attachedDoc ? attachedDoc.name : "附件"}
            </button>
            {target && (
              <span className="target-chip">
                <span className="tg-dot" />
                @{target}
              </span>
            )}
            {docOpen && (
              <div className="popover">
                <div className="pop-list">
                  {attachedDoc && (
                    <button className="pop-item" onClick={() => { onAttach(null); setDocOpen(false); }}>
                      <span className="pi-name" style={{ color: "var(--ink-mute)" }}>不附加文档</span>
                    </button>
                  )}
                  {window.DOCS.map((d) => (
                    <button
                      key={d.name}
                      className={["pop-item", attachedDoc?.name === d.name ? "on" : ""].filter(Boolean).join(" ")}
                      onClick={() => { onAttach(d); setDocOpen(false); }}
                    >
                      <span className="pi-name">{d.pinned ? "★ " : ""}{d.name}</span>
                      <span className="pi-folder">docs/{d.folder}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
          <button className="send-btn" disabled={!canSend} onClick={submit}>
            <IconSend size={15} /> 发送
          </button>
        </div>
      </div>
    </footer>
  );
}

/* --------------------------------------------------------------- Toasts --- */
function Toasts({ toasts, onClose }) {
  const glyph = { ok: <IconCheck size={15} />, err: <IconAlert size={15} />, info: <IconBolt size={15} /> };
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          <span className="tglyph">{glyph[t.level] || glyph.info}</span>
          <span>{t.text}</span>
          <button className="tclose" onClick={() => onClose(t.id)}><IconClose size={13} /></button>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- App ---- */
function App() {
  const [view, setView] = useState("terminal"); // terminal | dashboard
  const [theme, setTheme] = useState("dark");    // dark | light
  const [collapsed, setCollapsed] = useState(false);
  const [activeId, setActiveId] = useState("designer");
  const [attachedDoc, setAttachedDoc] = useState(null);
  const [docQuery, setDocQuery] = useState("");
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const pushToast = useCallback(({ level = "info", text }) => {
    const id = ++seq.current;
    setToasts((cur) => [...cur, { id, level, text }]);
    if (level !== "err") setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 3200);
  }, []);
  const closeToast = useCallback((id) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);

  const agents = window.AGENTS;
  const activeAgent = agents.find((a) => a.id === activeId) || null;
  const runningCount = agents.filter((a) => a.status !== "stop").length;

  const openAgentInTerminal = (id) => { setActiveId(id); setView("terminal"); };

  // theme flips the [data-theme] attribute on <html>; everything is token-driven.
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // mini stats for the topbar
  const waiting = agents.filter((a) => a.status === "wait").length;

  return (
    <div className={["shell", collapsed ? "rail-collapsed" : ""].filter(Boolean).join(" ")}>
      <Rail
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        activeId={activeId}
        onSelect={openAgentInTerminal}
        onConfigure={() => pushToast({ level: "info", text: "配置面板（原型占位）" })}
        docQuery={docQuery}
        setDocQuery={setDocQuery}
      />

      <main className="workspace">
        <div className="topbar">
          <div className="segmented">
            <button className={`seg ${view === "terminal" ? "on" : ""}`} onClick={() => setView("terminal")}>
              <IconTerminal size={16} /> 终端
              <span className="seg-badge">{runningCount}</span>
            </button>
            <button className={`seg ${view === "dashboard" ? "on" : ""}`} onClick={() => setView("dashboard")}>
              <IconGauge size={16} /> 中控台
            </button>
          </div>

          <div className="topbar-meta">
            <span className="mini-stat"><span className="dot run" style={{ boxShadow: "none" }} />
              <span className="ms-num">{runningCount}</span><span className="ms-lbl">运行</span></span>
            {waiting > 0 && (
              <span className="mini-stat"><span className="dot wait" style={{ boxShadow: "none" }} />
                <span className="ms-num">{waiting}</span><span className="ms-lbl">待输入</span></span>
            )}
          </div>

          <div className="topbar-actions">
            <button
              className="ghost-btn icon-only"
              title={theme === "dark" ? "切换到浅色" : "切换到深色"}
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
            </button>
            <span className="topbar-sep" />
            <button className="ghost-btn"><IconPlay size={12} /> 全部启动</button>
            <button className="ghost-btn"><IconStopAll size={13} /> 全部停止</button>
          </div>
        </div>

        {view === "terminal" ? (
          <TerminalView
            agents={agents}
            activeId={activeId}
            onFocus={setActiveId}
            onStop={(id) => pushToast({ level: "info", text: `停止 ${agents.find(a=>a.id===id)?.name}（原型）` })}
            onMinimize={(id) => pushToast({ level: "info", text: `最小化（原型）` })}
            onConfigure={() => pushToast({ level: "info", text: "配置团队（原型占位）" })}
          />
        ) : (
          <Dashboard
            agents={agents}
            stats={window.STATS}
            flow={window.FLOW}
            feed={window.FEED}
            onOpenAgent={openAgentInTerminal}
          />
        )}

        <Composer
          activeAgent={activeAgent}
          attachedDoc={attachedDoc}
          onAttach={setAttachedDoc}
          onSend={() => {}}
          pushToast={pushToast}
        />
      </main>

      <Toasts toasts={toasts} onClose={closeToast} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
