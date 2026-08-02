"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type PortMapping = {
  protocol: string;
  containerPort: string;
  hostIp: string;
  hostPort: string;
  display: string;
};

type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
  ips: string[];
  networks: Array<{ name: string; ip: string; gateway: string }>;
  portMappings: PortMapping[];
  launchUrl: string | null;
  launchUrls: string[];
  connectionHints: string[];
};

type DockerInfo = {
  available: boolean;
  error?: string;
  hint?: string;
  version?: string;
  containers: DockerContainer[];
};

export default function HomePage() {
  const [info, setInfo] = useState<DockerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/docker", { cache: "no-store" });
      const data = (await res.json()) as DockerInfo;
      setInfo(data);
    } catch (e) {
      setInfo({
        available: false,
        error: e instanceof Error ? e.message : String(e),
        hint: "Could not reach the app API.",
        containers: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (action: string, id?: string) => {
    setBusyId(id || action);
    setMsg(null);
    try {
      const res = await fetch("/api/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setMsg(data.message || `${action} ok`);
      await new Promise((r) => setTimeout(r, 700));
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  /** Start container if needed, then open web UI or copy connection string */
  const launchApp = async (c: DockerContainer) => {
    setBusyId(c.id);
    setMsg(null);
    try {
      if (c.state !== "running") {
        const res = await fetch("/api/docker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", id: c.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to start container");
        setMsg(`Started ${c.name}…`);
        await new Promise((r) => setTimeout(r, 1200));
      }

      const res2 = await fetch("/api/docker", { cache: "no-store" });
      const fresh = (await res2.json()) as DockerInfo;
      const updated = fresh.containers.find(
        (x) => x.id === c.id || x.name === c.name,
      );
      setInfo(fresh);

      const url =
        updated?.launchUrl ||
        updated?.launchUrls?.[0] ||
        c.launchUrl ||
        c.launchUrls?.[0];

      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        setMsg(`Opened app: ${url}`);
        return;
      }

      // Databases / services without a web UI
      const hint =
        updated?.connectionHints?.[0] ||
        c.connectionHints?.[0] ||
        null;
      if (hint) {
        try {
          await navigator.clipboard.writeText(hint);
          setMsg(
            `${c.name} has no web UI. Connection string copied: ${hint}`,
          );
        } catch {
          setMsg(
            `${c.name} has no web UI. Connect with: ${hint}`,
          );
        }
        return;
      }

      const published = (updated?.portMappings || c.portMappings || []).filter(
        (p) => p.hostPort,
      );
      if (published[0]) {
        const p = published[0];
        const host =
          !p.hostIp || p.hostIp === "0.0.0.0" ? "127.0.0.1" : p.hostIp;
        setMsg(
          `${c.name} is reachable at ${host}:${p.hostPort} (no HTTP app URL detected).`,
        );
        return;
      }

      setMsg(
        `${c.name} has no published ports. Use -p host:container when creating it.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid">
      <div className="card">
        <div className="row">
          <div>
            <div className="name">Local Docker containers</div>
            <div className="meta">
              {loading && !info
                ? "Checking Docker…"
                : info?.available
                  ? `Docker ${info.version ?? ""} · ${info.containers.length} container(s)`
                  : "Docker daemon not reachable"}
            </div>
          </div>
          <div className="actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn secondary"
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {info && !info.available && (
        <div className="card error">
          <strong>Cannot talk to Docker</strong>
          <p className="meta" style={{ color: "inherit" }}>
            {info.error}
          </p>
          {info.hint && (
            <p className="meta" style={{ color: "inherit" }}>
              {info.hint}
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={busyId === "open_desktop"}
              onClick={() => void act("open_desktop")}
            >
              {busyId === "open_desktop" ? "Opening…" : "Open Docker Desktop"}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {msg && <div className="card">{msg}</div>}

      {info?.available && info.containers.length === 0 && (
        <div className="card">
          <div className="name">No containers found</div>
          <div className="meta">
            Run something with <span className="mono">docker run -p …</span> and
            refresh.
          </div>
        </div>
      )}

      {info?.containers.map((c) => {
        const published = (c.portMappings || []).filter((p) => p.hostPort);
        const canLaunch = Boolean(
          c.launchUrl || c.launchUrls?.length || published.length,
        );

        return (
          <div key={c.id} className="card">
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div className="name">{c.name || c.id.slice(0, 12)}</div>
                <div className="meta mono">
                  {c.image} · {c.id.slice(0, 12)}
                </div>
                <div className="meta">{c.status}</div>

                {/* IPs */}
                <div className="meta" style={{ marginTop: 10 }}>
                  <strong style={{ color: "var(--text)" }}>IP addresses</strong>
                  <div className="mono" style={{ marginTop: 4 }}>
                    {c.ips?.length
                      ? c.ips.map((ip) => (
                          <div key={ip}>Container: {ip}</div>
                        ))
                      : "Container IP: — (start the container to assign)"}
                    {(c.networks || []).map((n) => (
                      <div key={n.name}>
                        {n.name}: {n.ip}
                        {n.gateway && n.gateway !== "—"
                          ? ` (gw ${n.gateway})`
                          : ""}
                      </div>
                    ))}
                    <div>Host (localhost): 127.0.0.1</div>
                  </div>
                </div>

                {/* Ports */}
                <div className="meta" style={{ marginTop: 10 }}>
                  <strong style={{ color: "var(--text)" }}>
                    Ports (host → container)
                  </strong>
                  <div className="mono" style={{ marginTop: 4 }}>
                    {published.length === 0 ? (
                      <div>No published ports</div>
                    ) : (
                      published.map((p) => (
                        <div key={p.display}>
                          {p.display}
                          {p.hostPort ? (
                            <>
                              {" "}
                              ·{" "}
                              <a
                                href={`http://${
                                  !p.hostIp ||
                                  p.hostIp === "0.0.0.0" ||
                                  p.hostIp === "::"
                                    ? "127.0.0.1"
                                    : p.hostIp
                                }:${p.hostPort}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                open
                              </a>
                            </>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {c.connectionHints?.length > 0 && (
                  <div className="meta" style={{ marginTop: 10 }}>
                    <strong style={{ color: "var(--text)" }}>
                      Connection
                    </strong>
                    <div className="mono" style={{ marginTop: 4 }}>
                      {c.connectionHints.map((h) => (
                        <div key={h}>{h}</div>
                      ))}
                    </div>
                  </div>
                )}

                {c.launchUrl && (
                  <div className="meta mono" style={{ marginTop: 8 }}>
                    App URL:{" "}
                    <a href={c.launchUrl} target="_blank" rel="noreferrer">
                      {c.launchUrl}
                    </a>
                  </div>
                )}
              </div>

              <div style={{ textAlign: "right" }}>
                <span className={`badge ${c.state}`}>{c.state}</span>
                <div
                  className="actions"
                  style={{ justifyContent: "flex-end", flexDirection: "column" }}
                >
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === c.id || !canLaunch}
                    title={
                      c.launchUrl
                        ? `Start if needed, then open ${c.launchUrl}`
                        : c.connectionHints?.[0]
                          ? `Start if needed, then copy connection: ${c.connectionHints[0]}`
                          : canLaunch
                            ? "Start if needed and show host ports"
                            : "No published ports"
                    }
                    onClick={() => void launchApp(c)}
                  >
                    {busyId === c.id
                      ? "Working…"
                      : c.launchUrl
                        ? "Launch app"
                        : c.connectionHints?.length
                          ? "Start & copy URL"
                          : "Launch"}
                  </button>
                  {c.state === "running" ? (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busyId === c.id}
                      onClick={() => void act("stop", c.id)}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busyId === c.id}
                      onClick={() => void act("start", c.id)}
                    >
                      Start
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busyId === c.id}
                    onClick={() => void act("restart", c.id)}
                  >
                    Restart
                  </button>
                  <Link className="btn secondary" href={`/containers/${c.id}`}>
                    Details
                  </Link>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
