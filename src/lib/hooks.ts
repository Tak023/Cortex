"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActivityEvent,
  Agent,
  AppSettings,
  AppTemplate,
  Idea,
  Project,
} from "./types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || res.statusText || "Request failed",
    );
  }
  return res.json();
}

/** Poll only when the tab is visible; skip overlapping in-flight requests. */
function useInterval(callback: () => void | Promise<void>, ms: number | null) {
  const saved = useRef(callback);
  const inFlight = useRef(false);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (ms === null || ms <= 0) return;

    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await saved.current();
      } catch {
        // ignore poll errors
      } finally {
        inFlight.current = false;
      }
    };

    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useAgents(pollMs = 5000) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await json<{ agents: Agent[] }>("/api/agents");
    setAgents(data.agents);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  useInterval(refresh, pollMs);

  const action = async (id: string, actionName: string) => {
    await json(`/api/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: actionName }),
    });
    await refresh();
  };

  const update = async (id: string, patch: Record<string, unknown>) => {
    await json(`/api/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await refresh();
  };

  return { agents, loading, refresh, action, update };
}

export function useActivity(limit = 40, pollMs = 4000) {
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  const load = useCallback(async () => {
    const d = await json<{ activity: ActivityEvent[] }>(
      `/api/activity?limit=${limit}`,
    );
    setActivity(d.activity);
  }, [limit]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useInterval(load, pollMs);

  return activity;
}

export function useMetrics(pollMs = 8000) {
  const [metrics, setMetrics] = useState<{
    totalTokens: number;
    costUsd: number;
    avgLatencyMs: number;
    successRate: number;
    agentsOnline: number;
    agentsBusy: number;
    projectsActive: number;
    projectsTotal: number;
    ideasTotal: number;
  } | null>(null);

  const load = useCallback(async () => {
    const d = await json<{ metrics: NonNullable<typeof metrics> }>(
      "/api/metrics",
    );
    setMetrics(d.metrics);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useInterval(load, pollMs);

  return metrics;
}

export function useIdeas() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await json<{ ideas: Idea[] }>("/api/ideas");
    setIdeas(data.ideas);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const generate = async (statement: string, templateId?: string | null) => {
    const data = await json<{
      idea: Idea;
      concepts: Idea["concepts"];
      team: string[];
      mode: string;
    }>("/api/ideas/generate", {
      method: "POST",
      body: JSON.stringify({ statement, templateId }),
    });
    await refresh();
    return data;
  };

  const launchProject = async (ideaId: string, conceptId: string) => {
    const data = await json<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ ideaId, conceptId }),
    });
    await refresh();
    return data.project;
  };

  return { ideas, loading, refresh, generate, launchProject };
}

export function useProjects(pollMs = 4000) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await json<{ projects: Project[] }>("/api/projects");
    setProjects(data.projects);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  useInterval(refresh, pollMs);

  const remove = async (id: string, force = false) => {
    const res = await fetch(
      `/api/projects/${id}${force ? "?force=1" : ""}`,
      { method: "DELETE" },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data as { error?: string }).error || res.statusText || "Delete failed",
      );
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    return true;
  };

  return { projects, loading, refresh, remove };
}

export function useProject(id: string, pollMs = 2500) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!id) return;
    const data = await json<{ project: Project }>(`/api/projects/${id}`);
    setProject(data.project);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  // Adaptive: stop when done, slow down when waiting for approval
  const effectivePoll =
    !project
      ? pollMs
      : project.status === "completed" || project.status === "failed"
        ? null
        : project.status === "awaiting_approval" || project.paused
          ? Math.max(pollMs * 2, 5000)
          : pollMs;

  useInterval(refresh, effectivePoll);

  const action = async (
    actionName: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await fetch(`/api/projects/${id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionName, ...extra }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: Project;
      message?: string;
      openedUrl?: string | null;
      started?: boolean;
      launch?: {
        appPath: string | null;
        appExists: boolean;
        launchUrl: string | null;
        launchCommand: string | null;
        steps: Array<{ n: number; title: string; detail: string }>;
        serverRunning: boolean;
        kind: string;
        workspacePath: string;
      };
      error?: string;
    };
    if (data.project) setProject(data.project);
    // Don't throw on launch remediation payloads — UI shows message/error
    if (!res.ok && !data.message && !data.error) {
      throw new Error(data.error || res.statusText || "Request failed");
    }
    if (!res.ok && data.error && !data.message) {
      data.message = data.error;
    }
    return data;
  };

  return { project, loading, refresh, action };
}

export function useTemplates() {
  const [templates, setTemplates] = useState<AppTemplate[]>([]);
  useEffect(() => {
    json<{ templates: AppTemplate[] }>("/api/templates")
      .then((d) => setTemplates(d.templates))
      .catch(console.error);
  }, []);
  return templates;
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const refresh = useCallback(async () => {
    const data = await json<{ settings: AppSettings }>("/api/settings");
    setSettings(data.settings);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const update = async (patch: Partial<AppSettings>) => {
    const data = await json<{ settings: AppSettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setSettings(data.settings);
  };

  return { settings, refresh, update };
}
