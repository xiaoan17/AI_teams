// Terminal view: the redesigned agent terminal cards (1–3 across, current cap).
// Presentational — receives agents + active id + callbacks from App.

function TermLine({ kind, text }) {
  if (kind === "cursor") {
    return <span className="term-cursor" />;
  }
  const cls = {
    dim: "tl-dim", accent: "tl-accent", amber: "tl-amber",
    coral: "tl-coral", user: "tl-user"
  }[kind] || "";
  return <div className={cls}>{text}</div>;
}

function TermCard({ agent, active, onFocus, onStop, onMinimize }) {
  return (
    <section
      className={["term-card", active ? "active" : ""].filter(Boolean).join(" ")}
      onClick={onFocus}
    >
      <header className="term-head">
        <span className={`dot ${agent.status}`} />
        <div className="t-id">
          <div className="t-name">{agent.name}</div>
          <div className="t-meta">{agent.runtime} · pane %{agent.id}</div>
        </div>
        <div className="term-win-actions">
          <span className={`statepill ${agent.status}`}>
            {window.STATUS_LABEL[agent.status]}
          </span>
          <button className="win-btn" title="最小化" onClick={(e) => { e.stopPropagation(); onMinimize(); }}>
            <IconMinus size={13} />
          </button>
          <button className="win-btn danger" title="停止" onClick={(e) => { e.stopPropagation(); onStop(); }}>
            <IconClose size={13} />
          </button>
        </div>
      </header>
      <pre className="term-body">
        {agent.term.map((line, i) => (
          <TermLine key={i} kind={line[0]} text={line[1]} />
        ))}
      </pre>
    </section>
  );
}

function TerminalView({ agents, activeId, onFocus, onStop, onMinimize, onConfigure }) {
  const visible = agents.filter((a) => a.status !== "stop");
  const n = Math.min(Math.max(visible.length, 1), 3);

  if (!visible.length) {
    return (
      <div className="view-scroll">
        <div className="empty">
          <IconGrid size={40} className="e-icon" />
          <div className="e-text">还没有在运行的成员。配置团队并启动，终端会出现在这里。</div>
          <button className="e-cta" onClick={onConfigure}>配置团队</button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-scroll">
      <div className={`term-grid n${n}`}>
        {visible.map((agent) => (
          <TermCard
            key={agent.id}
            agent={agent}
            active={activeId === agent.id}
            onFocus={() => onFocus(agent.id)}
            onStop={() => onStop(agent.id)}
            onMinimize={() => onMinimize(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { TerminalView });
