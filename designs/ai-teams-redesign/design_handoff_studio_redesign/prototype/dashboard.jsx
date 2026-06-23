// Dashboard (中控台): global oversight view.
// KPI strip · agent status cards · handoff flow · activity timeline.

const KPI_ICON = { bolt: IconBolt, clock: IconClock, alert: IconAlert, msg: IconMsg };

function Kpi({ stat }) {
  const Icon = KPI_ICON[stat.icon] || IconBolt;
  const max = Math.max(...stat.spark, 1);
  return (
    <div className={["kpi", stat.hot ? "hot" : ""].filter(Boolean).join(" ")}>
      <div className="k-top">
        <span className="k-label">{stat.label}</span>
        <span className="k-icon"><Icon size={15} /></span>
      </div>
      <div className={`k-num ${stat.kind}`}>{stat.num}</div>
      <div className="k-spark">
        {stat.spark.map((v, i) => (
          <i key={i} style={{ height: `${Math.max(12, (v / max) * 100)}%` }} />
        ))}
      </div>
      <div className="k-sub">{stat.sub}</div>
    </div>
  );
}

function AgentCard({ agent, onOpen }) {
  return (
    <div className={`acard s-${agent.status}`} onClick={() => onOpen(agent.id)}>
      <div className="acard-top">
        <span className="avatar">{agent.avatar}</span>
        <div className="a-id">
          <div className="a-name">{agent.name}</div>
          <div className="a-runtime">{agent.runtime}</div>
        </div>
        <span className={`statepill ${agent.status}`}>
          <span className={`dot ${agent.status}`} style={{ width: 6, height: 6, boxShadow: "none" }} />
          {window.STATUS_LABEL[agent.status]}
        </span>
      </div>
      <div className="a-doing">{agent.doing}</div>
      <div className="a-tail">{agent.tail}</div>
      <div className="bar"><i style={{ width: `${Math.round(agent.progress * 100)}%` }} /></div>
      <div className="a-foot">
        <span className="a-task">
          <IconFile size={13} />
          <span className="tname">{agent.task}</span>
        </span>
        <span>{Math.round(agent.progress * 100)}%</span>
      </div>
    </div>
  );
}

function FlowItem({ item }) {
  const badge = { active: "进行中", queued: "排队", done: "已完成" }[item.state];
  return (
    <div className="flow-item">
      <span className={`dot ${item.state === "done" ? "run" : item.state === "active" ? "run" : "stop"}`}
        style={{ marginTop: 4 }} />
      <div style={{ minWidth: 0 }}>
        <div className="flow-route">
          <span className="who">{item.from}</span>
          <IconArrowRight size={13} className="arrow" />
          <span className="who">{item.to}</span>
        </div>
        <div className="f-doc">{item.doc}</div>
        <div className="f-meta">
          <span className={`flow-badge ${item.state}`}>{badge}</span>
          <span className="flow-time">{item.time}</span>
        </div>
      </div>
    </div>
  );
}

function FeedItem({ item }) {
  return (
    <div className="feed-item">
      <div className="feed-rail">
        <span className={`fdot ${item.kind}`} />
        <span className="fline" />
      </div>
      <div className="feed-body">
        <div className="feed-text" dangerouslySetInnerHTML={{ __html: item.text }} />
        <div className="feed-time">{item.time}</div>
      </div>
    </div>
  );
}

function Dashboard({ agents, stats, flow, feed, onOpenAgent }) {
  return (
    <div className="dash">
      <div className="kpi-row">
        {stats.map((s) => <Kpi key={s.id} stat={s} />)}
      </div>

      <div className="dash-main">
        {/* left: agent status cards */}
        <div className="dash-col">
          <div className="panel-card" style={{ flex: 1 }}>
            <div className="panel-card-head">
              <span className="pch-title">成员实时状态</span>
              <span className="pch-meta">{agents.length} 名成员 · 实时</span>
            </div>
            <div className="panel-card-body">
              <div className="agents-grid">
                {agents.map((a) => <AgentCard key={a.id} agent={a} onOpen={onOpenAgent} />)}
              </div>
            </div>
          </div>
        </div>

        {/* right: handoff flow + timeline */}
        <div className="dash-col">
          <div className="panel-card flow-panel">
            <div className="panel-card-head">
              <span className="pch-title">任务交接流</span>
              <span className="pch-meta">{flow.length} 项</span>
            </div>
            <div className="panel-card-body">
              <div className="flow">
                {flow.map((f) => <FlowItem key={f.id} item={f} />)}
              </div>
            </div>
          </div>

          <div className="panel-card feed-panel">
            <div className="panel-card-head">
              <span className="pch-title">活动时间线</span>
              <span className="pch-meta">最近</span>
            </div>
            <div className="panel-card-body">
              <div className="feed">
                {feed.map((f) => <FeedItem key={f.id} item={f} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard });
