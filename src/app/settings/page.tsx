"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { VoiceTextArea } from "@/components/ui/VoiceTextArea";
import { useAgents, useSettings } from "@/lib/hooks";
import type { VoiceInputMode } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

type JarvisStatus = {
  online: boolean;
  health?: { ok: boolean; detail: string; backend?: string; models?: string[] };
  baseUrl?: string;
  serveHint?: string;
  install?: string;
  docs?: string;
  chatMode?: string;
  hybrid?: {
    mode?: string;
    grokReady?: boolean;
    grokModel?: string | null;
    tavilyReady?: boolean;
    localHint?: string;
  };
};

export default function SettingsPage() {
  const { settings, update } = useSettings();
  const { agents, update: updateAgent } = useAgents(5000);
  const [saved, setSaved] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [jarvis, setJarvis] = useState<JarvisStatus | null>(null);
  const [vault, setVault] = useState<{
    enabled: boolean;
    dir: string;
    available: boolean;
    noteCount: number;
  } | null>(null);
  const [jarvisBusy, setJarvisBusy] = useState(false);
  const [testReply, setTestReply] = useState<string | null>(null);

  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(null), 2000);
  };

  const voiceMode = (settings?.voiceInputMode ?? "auto") as VoiceInputMode;

  const refreshJarvis = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/jarvis");
      const data = (await res.json()) as JarvisStatus;
      setJarvis(data);
    } catch {
      setJarvis({
        online: false,
        health: { ok: false, detail: "Could not reach Cortex Jarvis probe" },
      });
    }
  }, []);

  const refreshVault = useCallback(async () => {
    try {
      const res = await fetch("/api/vault");
      const data = (await res.json()) as { vault: typeof vault };
      setVault(data.vault);
    } catch {
      setVault(null);
    }
  }, []);

  useEffect(() => {
    void refreshJarvis();
    void refreshVault();
  }, [refreshJarvis, refreshVault]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Agent configuration, voice input, API keys (via env), models, and orchestration prefs"
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <span className="text-sm font-medium">Voice to text</span>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-xs text-muted leading-relaxed">
              Cortex supports <strong className="text-foreground/90">built-in</strong>{" "}
              voice-to-text (mic record → Whisper transcription) and{" "}
              <strong className="text-foreground/90">third-party dictation</strong>{" "}
              apps such as <strong className="text-foreground/90">Whisperflow</strong>,
              macOS Dictation, and any tool that types into the focused field.
            </p>
            <label className="block">
              <div className="mb-1 text-sm">Default voice mode</div>
              <select
                value={voiceMode}
                onChange={async (e) => {
                  await update({
                    voiceInputMode: e.target.value as VoiceInputMode,
                  });
                  flash("Voice mode saved");
                }}
                className="w-full rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none focus:border-blue-500/50"
              >
                <option value="auto">
                  Auto — built-in mic when available, else external
                </option>
                <option value="builtin">
                  Built-in mic (record → Whisper)
                </option>
                <option value="external">
                  External only (Whisperflow / system dictation)
                </option>
              </select>
            </label>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
              <li>
                <strong className="text-foreground/80">Voice</strong> records
                from your mic, then transcribes with local Node Whisper (model
                is cached under Cortex data; first load may take a minute).
                Optional cloud path:{" "}
                <code className="text-foreground/70">OPENAI_API_KEY</code>.
              </li>
              <li>
                <strong className="text-foreground/80">Dictation app</strong>{" "}
                arms the field for Whisperflow / system dictation. If text does
                not appear, use Whisperflow copy mode +{" "}
                <strong className="text-foreground/80">Paste</strong> in the
                field.
              </li>
              <li>
                On macOS you can also use Dictation (e.g. press{" "}
                <kbd className="rounded border border-border px-1">Fn</kbd>{" "}
                twice) while any Cortex text field is focused.
              </li>
            </ul>
            {saved && (
              <p className="text-xs text-emerald-400">{saved}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Second brain (Obsidian)</span>
              <span
                className={`text-[11px] ${
                  vault?.available ? "text-emerald-400" : "text-muted"
                }`}
              >
                {vault
                  ? vault.available
                    ? `Connected — ${vault.noteCount} notes`
                    : "Vault not found"
                  : "…"}
              </span>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-xs text-muted leading-relaxed">
              Jarvis grounds answers in your local Obsidian vault and the
              pipeline reads it during research, then writes project outcomes
              back to <code className="text-foreground/80">projects/</code> and{" "}
              <code className="text-foreground/80">log.md</code> as long-term
              memory. <code className="text-foreground/80">raw/</code> is never
              modified. Vault-grounded answers prefer the local model.
            </p>

            <label className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm">Enable second brain</div>
                <div className="text-xs text-muted">
                  Search notes for chat + research; write project memory back
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings?.vaultEnabled ?? true}
                onChange={async (e) => {
                  await update({ vaultEnabled: e.target.checked });
                  flash("Saved");
                  void refreshVault();
                }}
                className="h-4 w-4 accent-blue-500"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-sm">Vault path</div>
              <input
                type="text"
                defaultValue={settings?.vaultDir ?? ""}
                onBlur={async (e) => {
                  if (e.target.value !== settings?.vaultDir) {
                    await update({ vaultDir: e.target.value });
                    flash("Saved");
                    void refreshVault();
                  }
                }}
                placeholder="~/Documents/hermes-second-brain"
                className="w-full rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none focus:border-blue-500/50"
              />
              <p className="mt-1 text-[11px] text-muted">
                Override with{" "}
                <code className="text-foreground/70">CORTEX_VAULT_DIR</code>.
                The folder must contain the vault&apos;s{" "}
                <code className="text-foreground/70">CLAUDE.md</code> or{" "}
                <code className="text-foreground/70">.obsidian</code>.
              </p>
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">OpenJarvis</span>
              <span
                className={`text-[11px] ${
                  jarvis?.online ? "text-emerald-400" : "text-muted"
                }`}
              >
                {jarvis?.online ? "Online" : "Offline / not detected"}
              </span>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-xs text-muted leading-relaxed">
              Interactive chat is{" "}
              <strong className="text-foreground/90">hybrid by default</strong>
              : LM Studio for private/offline turns, Grok + Tavily for live
              questions (news, weather, prices, “today”). Pipeline phases can
              still use OpenJarvis{" "}
              <code className="text-foreground/80">jarvis serve</code> / CLI.
            </p>

            {jarvis?.hybrid && (
              <div className="rounded-lg border border-border-subtle bg-panel-elevated/50 px-3 py-2 text-[11px] text-muted space-y-1">
                <div>
                  Mode:{" "}
                  <span className="text-foreground/85">
                    {jarvis.hybrid.mode || "hybrid"}
                  </span>
                </div>
                <div>
                  Grok:{" "}
                  <span
                    className={
                      jarvis.hybrid.grokReady
                        ? "text-emerald-400"
                        : "text-amber-300/90"
                    }
                  >
                    {jarvis.hybrid.grokReady
                      ? `ready (${jarvis.hybrid.grokModel || "grok"})`
                      : "set XAI_API_KEY in .env.local"}
                  </span>
                </div>
                <div>
                  Tavily:{" "}
                  <span
                    className={
                      jarvis.hybrid.tavilyReady
                        ? "text-emerald-400"
                        : "text-amber-300/90"
                    }
                  >
                    {jarvis.hybrid.tavilyReady
                      ? "live search configured"
                      : "optional — improves current facts"}
                  </span>
                </div>
                <div>
                  Local:{" "}
                  <span className="text-foreground/80">
                    {jarvis.hybrid.localHint || "LM Studio :1234"}
                  </span>
                </div>
              </div>
            )}

            <label className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm">Enable OpenJarvis adapter</div>
                <div className="text-xs text-muted">
                  Registers OpenJarvis / Research / Code agents
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings?.jarvisEnabled ?? true}
                onChange={async (e) => {
                  await update({ jarvisEnabled: e.target.checked });
                  flash("Saved");
                  void refreshJarvis();
                }}
                className="h-4 w-4 accent-blue-500"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-sm">Chat routing mode</div>
              <select
                value={settings?.jarvisChatMode ?? "hybrid"}
                onChange={async (e) => {
                  const v = e.target.value as "hybrid" | "local" | "grok";
                  await update({ jarvisChatMode: v });
                  flash("Saved");
                  void refreshJarvis();
                }}
                className="w-full rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none focus:border-blue-500/50"
              >
                <option value="hybrid">
                  hybrid — LM Studio + Grok for live data
                </option>
                <option value="local">local — LM Studio / Ollama only</option>
                <option value="grok">grok — always use xAI Grok</option>
              </select>
              <p className="mt-1 text-[11px] text-muted">
                Override with <code className="text-foreground/70">JARVIS_CHAT_MODE</code>{" "}
                in <code className="text-foreground/70">.env.local</code>.
              </p>
            </label>

            <label className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm">Use in pipeline</div>
                <div className="text-xs text-muted">
                  Live invoke when a Jarvis agent is assigned to a phase
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings?.jarvisUseInPipeline ?? true}
                onChange={async (e) => {
                  await update({ jarvisUseInPipeline: e.target.checked });
                  flash("Saved");
                }}
                className="h-4 w-4 accent-blue-500"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-sm">API base URL</div>
              <input
                type="text"
                value={settings?.jarvisBaseUrl ?? "http://127.0.0.1:8000"}
                onChange={async (e) => {
                  await update({ jarvisBaseUrl: e.target.value });
                  flash("Saved");
                }}
                placeholder="http://127.0.0.1:8000"
                className="w-full rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none focus:border-blue-500/50"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-sm">Default Jarvis agent</div>
              <select
                value={settings?.jarvisDefaultAgent ?? "orchestrator"}
                onChange={async (e) => {
                  await update({ jarvisDefaultAgent: e.target.value });
                  flash("Saved");
                }}
                className="w-full rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none focus:border-blue-500/50"
              >
                <option value="orchestrator">orchestrator</option>
                <option value="simple">simple</option>
                <option value="deep_research">deep_research</option>
                <option value="operative">operative</option>
                <option value="native_react">native_react</option>
                <option value="native_openhands">native_openhands</option>
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-sm">CLI path</div>
              <input
                type="text"
                value={settings?.jarvisCliPath ?? "jarvis"}
                onChange={async (e) => {
                  await update({ jarvisCliPath: e.target.value });
                  flash("Saved");
                }}
                placeholder="jarvis"
                className="w-full rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none focus:border-blue-500/50"
              />
            </label>

            <label className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm">Prefer CLI over HTTP</div>
                <div className="text-xs text-muted">
                  Try <code className="text-foreground/70">jarvis ask</code>{" "}
                  first
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings?.jarvisPreferCli ?? false}
                onChange={async (e) => {
                  await update({ jarvisPreferCli: e.target.checked });
                  flash("Saved");
                }}
                className="h-4 w-4 accent-blue-500"
              />
            </label>

            <div className="rounded-lg border border-border-subtle bg-panel-elevated/40 px-3 py-2 text-xs text-muted">
              <div className="mb-1 font-medium text-foreground/80">Status</div>
              <p>{jarvis?.health?.detail || "Not checked yet"}</p>
              {jarvis?.health?.models && jarvis.health.models.length > 0 && (
                <p className="mt-1">
                  Models: {jarvis.health.models.slice(0, 6).join(", ")}
                </p>
              )}
              <p className="mt-2">
                Install:{" "}
                <code className="text-foreground/70">
                  {jarvis?.install ||
                    "curl -fsSL https://open-jarvis.github.io/OpenJarvis/install.sh | bash"}
                </code>
              </p>
              <p className="mt-1">
                Serve:{" "}
                <code className="text-foreground/70">
                  {jarvis?.serveHint || "jarvis serve --port 8000"}
                </code>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={jarvisBusy}
                onClick={async () => {
                  setJarvisBusy(true);
                  await refreshJarvis();
                  setJarvisBusy(false);
                  flash("Probed OpenJarvis");
                }}
              >
                Probe connection
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={jarvisBusy || !(settings?.jarvisEnabled ?? true)}
                onClick={async () => {
                  setJarvisBusy(true);
                  setTestReply(null);
                  try {
                    const res = await fetch("/api/integrations/jarvis", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        prompt:
                          "Reply in one short sentence: confirm you are OpenJarvis connected to Cortex.",
                        agentId: "agent-jarvis",
                        phase: "chat",
                      }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      setTestReply(data.error || "Test failed");
                    } else {
                      setTestReply(
                        data.result?.content || JSON.stringify(data),
                      );
                    }
                    await refreshJarvis();
                  } catch (e) {
                    setTestReply(
                      e instanceof Error ? e.message : "Test failed",
                    );
                  } finally {
                    setJarvisBusy(false);
                  }
                }}
              >
                Test ask
              </Button>
            </div>
            {testReply && (
              <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-panel-elevated p-3 text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                {testReply}
              </pre>
            )}
            {saved && (
              <p className="text-xs text-emerald-400">{saved}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-medium">Orchestration</span>
          </CardHeader>
          <CardBody className="space-y-4">
            <label className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm">Auto-approve gates</div>
                <div className="text-xs text-muted">
                  Skip human approval (useful for demos)
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings?.autoApprove ?? false}
                onChange={async (e) => {
                  await update({ autoApprove: e.target.checked });
                  flash("Saved");
                }}
                className="h-4 w-4 accent-blue-500"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-sm">Simulation tick (ms)</div>
              <input
                type="number"
                min={400}
                max={10000}
                step={100}
                value={settings?.simulationSpeedMs ?? 1800}
                onChange={async (e) => {
                  await update({
                    simulationSpeedMs: Number(e.target.value) || 1800,
                  });
                  flash("Saved");
                }}
                className="w-full rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none focus:border-blue-500/50"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-sm">Default LM Studio model</div>
              <input
                type="text"
                value={settings?.defaultLocalModel ?? ""}
                onChange={async (e) => {
                  await update({ defaultLocalModel: e.target.value });
                  flash("Saved");
                }}
                className="w-full rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none focus:border-blue-500/50"
              />
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-medium">API keys</span>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <p className="text-xs text-muted leading-relaxed">
              Keys are read from environment variables on the server (local-first,
              never bundled to the client). Set them in{" "}
              <code className="text-accent">.env.local</code> and restart{" "}
              <code className="text-accent">npm run dev</code>.
            </p>
            <div className="space-y-2">
              {[
                {
                  env: "XAI_API_KEY",
                  label: "SpaceXAI / Grok (Jarvis hybrid live)",
                  set: settings?.xaiApiKeySet,
                },
                {
                  env: "TAVILY_API_KEY",
                  label: "Tavily (Jarvis live web search)",
                  set: jarvis?.hybrid?.tavilyReady,
                },
                {
                  env: "ANTHROPIC_API_KEY",
                  label: "Claude Code",
                  set: false,
                },
                { env: "OPENAI_API_KEY", label: "Codex", set: false },
              ].map((row) => (
                <div
                  key={row.env}
                  className="flex items-center justify-between rounded-lg border border-border-subtle px-3 py-2"
                >
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <code className="text-[11px] text-muted">{row.env}</code>
                  </div>
                  <span
                    className={`text-xs ${row.set ? "text-emerald-400" : "text-muted"}`}
                  >
                    {row.set ? "Configured" : "Not set (mock OK)"}
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-medium">Agent configuration</span>
          </CardHeader>
          <CardBody className="space-y-4">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-xl border border-border-subtle p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{agent.name}</span>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Enabled
                    <input
                      type="checkbox"
                      checked={agent.config.enabled}
                      onChange={async (e) => {
                        await updateAgent(agent.id, {
                          config: {
                            ...agent.config,
                            enabled: e.target.checked,
                          },
                        });
                        flash("Agent updated");
                      }}
                      className="accent-blue-500"
                    />
                  </label>
                </div>
                <label className="block text-xs text-muted">
                  Model
                  <input
                    type="text"
                    defaultValue={agent.model || ""}
                    onBlur={async (e) => {
                      if (e.target.value !== agent.model) {
                        await updateAgent(agent.id, {
                          model: e.target.value,
                        });
                        flash("Model updated");
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-border bg-panel-elevated px-2.5 py-1.5 text-sm text-foreground outline-none"
                  />
                </label>
                <div className="pt-1">
                  <VoiceTextArea
                    label="System prompt"
                    speechMode={voiceMode}
                    rows={3}
                    value={
                      promptDrafts[agent.id] ?? agent.config.systemPrompt
                    }
                    onChange={(v) =>
                      setPromptDrafts((d) => ({ ...d, [agent.id]: v }))
                    }
                    onBlur={async () => {
                      const v =
                        promptDrafts[agent.id] ?? agent.config.systemPrompt;
                      if (v !== agent.config.systemPrompt) {
                        await updateAgent(agent.id, {
                          config: {
                            ...agent.config,
                            systemPrompt: v,
                          },
                        });
                        flash("Prompt updated");
                      }
                    }}
                    hint="Dictate system prompts with Voice or Whisperflow."
                  />
                </div>
                <div className="text-[11px] text-muted">
                  Tools: {agent.config.toolAccess.join(", ") || "none"}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-medium">Data</span>
          </CardHeader>
          <CardBody className="text-xs text-muted space-y-2">
            <p>
              State is stored locally in <code className="text-accent">data/state.json</code>.
              Export any project history from its detail page.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                window.open("/api/metrics", "_blank");
              }}
            >
              View usage metrics JSON
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
