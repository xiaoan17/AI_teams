import React, { useMemo } from "react";
import { useT } from "./i18n.js";

function statusKind(status) {
  if (status === "running_or_idle" || status === "starting") return "run";
  if (status === "waiting_input") return "wait";
  if (status === "error" || status === "missing_runtime" || status === "pane_missing") return "err";
  return "stop";
}

function statusLabelKey(status) {
  if (status === "running_or_idle" || status === "starting") return "status.running";
  if (status === "waiting_input") return "status.waiting_input";
  if (status === "error" || status === "missing_runtime" || status === "pane_missing") return "status.error";
  return "status.stopped";
}

function runtimeLabel(agent) {
  const type = String(agent?.type || "").trim().toLowerCase();
  const command = String(agent?.command || "").trim().split(/\s+/)[0];
  if (type === "codex") return "Codex";
  if (type === "claude") return "Claude";
  if (type === "kimi") return "Kimi";
  return command || agent?.id || "Agent";
}

function displayName(agent) {
  return String(agent?.name || agent?.id || "").trim();
}

function timeLabel(value, t) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diffMs < minute) return t("time.now");
  if (diffMs < hour) return t("time.minutesAgo", { n: Math.floor(diffMs / minute) });
  if (diffMs < 24 * hour) return t("time.hoursAgo", { n: Math.floor(diffMs / hour) });
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function MiniBars({ hot = false }) {
  const heights = hot ? [35, 55, 42, 70, 92] : [35, 48, 44, 58, 72];
  return (
    <span className="k-spark" aria-hidden="true">
      {heights.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
    </span>
  );
}

function KpiCard({ label, value, sub, tone = "", hot = false }) {
  return (
    <article className={["kpi", tone, hot ? "hot" : ""].filter(Boolean).join(" ")}>
      <div className="k-label">
        <span>{label}</span>
        <span aria-hidden="true">⌁</span>
      </div>
      <div className="k-line">
        <strong className="k-num">{value}</strong>
        <MiniBars hot={hot} />
      </div>
      <div className="k-sub">{sub}</div>
    </article>
  );
}

function AgentCard({ agent, snapshot, onOpenAgent }) {
  const t = useT();
  const kind = statusKind(agent.status);
  const name = displayName(agent);
  const tail = snapshot?.tail || "";
  const doing = snapshot?.doing || t(statusLabelKey(agent.status));
  return (
    <button className={`acard s-${kind}`} type="button" onClick={() => onOpenAgent(agent.id)} title={name}>
      <div className="acard-top">
        <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
        <span className="a-title">
          <strong>{name}</strong>
          <small>{runtimeLabel(agent)}</small>
        </span>
        <span className={`statepill state-${kind}`}>
          <i />
          {t(statusLabelKey(agent.status))}
        </span>
      </div>
      <div className="a-doing">{doing || "—"}</div>
      <div className="a-tail">{tail || "—"}</div>
      <div className="a-foot">
        <span>{agent.taskPath ? agent.taskPath.split("/").pop() : t("dashboard.noTask")}</span>
        <span>{t("dashboard.live")}</span>
      </div>
    </button>
  );
}

function FlowPanel({ events }) {
  const t = useT();
  const flowEvents = events.filter((event) => event.type === "route").slice(0, 12);
  return (
    <section className="panel-card flow-panel">
      <header className="panel-card-head">
        <h2>{t("dashboard.flow")}</h2>
        <span>{flowEvents.length}</span>
      </header>
      <div className="panel-card-body flow-list">
        {flowEvents.length ? flowEvents.map((event) => (
          <div className="flow-item" key={event.id}>
            <span className="flow-dot" />
            <div>
              <strong>{event.from || t("dashboard.you")} <span>→</span> {event.to || "all"}</strong>
              <small>{event.doc || t("dashboard.noTask")}</small>
            </div>
            <em>{t("dashboard.flow.active")}</em>
            <time>{timeLabel(event.time, t)}</time>
          </div>
        )) : (
          <div className="dash-empty">{t("dashboard.emptyFlow")}</div>
        )}
      </div>
    </section>
  );
}

function FeedPanel({ events }) {
  const t = useT();
  return (
    <section className="panel-card feed-panel">
      <header className="panel-card-head">
        <h2>{t("dashboard.timeline")}</h2>
        <span>{t("dashboard.realtime")}</span>
      </header>
      <div className="panel-card-body feed-list">
        {events.length ? events.slice(0, 50).map((event) => (
          <div className={`feed-item feed-${event.kind || "msg"}`} key={event.id}>
            <span className="feed-pin" />
            <div>
              <p>{event.text}</p>
              <time>{timeLabel(event.time, t)}</time>
            </div>
          </div>
        )) : (
          <div className="dash-empty">{t("dashboard.emptyTimeline")}</div>
        )}
      </div>
    </section>
  );
}

export function Dashboard({ agents, events, snapshots, onOpenAgent }) {
  const t = useT();
  const enabledAgents = useMemo(() => agents.filter((agent) => agent.enabled), [agents]);
  const counts = useMemo(() => enabledAgents.reduce((acc, agent) => {
    acc[statusKind(agent.status)] += 1;
    return acc;
  }, { run: 0, wait: 0, err: 0, stop: 0 }), [enabledAgents]);
  const routeCount = events.filter((event) => event.type === "route").length;

  return (
    <section className="dash">
      <div className="kpi-row">
        <KpiCard label={t("dashboard.kpi.running")} value={counts.run} sub={t("dashboard.kpi.runningSub", { n: counts.run })} tone="accent" />
        <KpiCard label={t("dashboard.kpi.waiting")} value={counts.wait} sub={t("dashboard.kpi.waitingSub", { n: counts.wait })} tone="amber" hot={counts.wait > 0} />
        <KpiCard label={t("dashboard.kpi.errors")} value={counts.err} sub={t("dashboard.kpi.errorsSub")} tone="coral" hot={counts.err > 0} />
        <KpiCard label={t("dashboard.kpi.messages")} value={routeCount} sub={t("dashboard.kpi.messagesSub", { n: routeCount })} />
      </div>
      <div className="dash-main">
        <section className="panel-card agents-panel">
          <header className="panel-card-head">
            <h2>{t("dashboard.members")}</h2>
            <span>{t("dashboard.memberMeta", { n: enabledAgents.length })}</span>
          </header>
          <div className="panel-card-body agents-grid">
            {enabledAgents.length ? enabledAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                snapshot={snapshots[agent.id]}
                onOpenAgent={onOpenAgent}
              />
            )) : (
              <div className="dash-empty">{t("empty.noAgents")}</div>
            )}
          </div>
        </section>
        <aside className="dash-col">
          <FlowPanel events={events} />
          <FeedPanel events={events} />
        </aside>
      </div>
    </section>
  );
}
