"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
  Send,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  JarvisAvatar,
  jarvisMoodFromState,
} from "@/components/jarvis/JarvisAvatar";
import { cn } from "@/lib/utils";
import {
  useSpeechToText,
  type SpeechStatus,
} from "@/lib/speech/useSpeechToText";
import { useSpeechSynthesis } from "@/lib/speech/useSpeechSynthesis";
import { warmSpeechServer } from "@/lib/speech/transcribe";

type JarvisStatus = {
  online: boolean;
  enabled?: boolean;
  baseUrl?: string;
  serveHint?: string;
  chatMode?: string;
  hybrid?: {
    mode?: string;
    grokReady?: boolean;
    grokModel?: string | null;
    tavilyReady?: boolean;
    localHint?: string;
  };
  health?: {
    ok: boolean;
    detail: string;
    backend?: string;
    models?: string[];
  };
};

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Which backend answered (lmstudio, grok, …) */
  backend?: string;
  model?: string;
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const GREETING =
  "I'm online and ready. Click the orb, ask clearly, then click again when you're done. You can also type below.";

export default function JarvisPage() {
  const [status, setStatus] = useState<JarvisStatus | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: "sys-0",
      role: "system",
      content: "Voice link with Jarvis — listen · think · speak.",
    },
  ]);
  const [micError, setMicError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const greetedRef = useRef(false);

  const tts = useSpeechSynthesis({ rate: 1.04, lang: "en-US" });

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/jarvis");
      const data = (await res.json()) as JarvisStatus;
      setStatus(data);
      return data;
    } catch {
      const offline: JarvisStatus = {
        online: false,
        health: { ok: false, detail: "Could not reach Cortex Jarvis probe" },
      };
      setStatus(offline);
      return offline;
    }
  }, []);

  useEffect(() => {
    warmSpeechServer();
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, tts.isSpeaking]);

  useEffect(() => {
    if (!status?.online || greetedRef.current) return;
    greetedRef.current = true;
    const hello: ChatMsg = {
      id: uid(),
      role: "assistant",
      content: GREETING,
    };
    setMessages((m) => [...m, hello]);
    if (tts.enabled) void tts.speak(GREETING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.online]);

  const sendTurn = useCallback(
    async (text: string, opts?: { fromVoice?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current) return;

      // Stop TTS so the mic / model turn is not fighting playback
      tts.stop();

      const fromVoice = Boolean(opts?.fromVoice);
      const userMsg: ChatMsg = {
        id: uid(),
        role: "user",
        content: fromVoice ? `🎙 ${trimmed}` : trimmed,
      };
      setMessages((m) => [...m, userMsg]);
      setPrompt("");
      setBusy(true);
      busyRef.current = true;
      setMicError(null);

      // Prior turns only (exclude greeting, errors, tool-noise)
      const history = messagesRef.current
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content.replace(/^🎙\s*/, ""),
        }))
        .filter((m) => {
          if (m.content === GREETING) return false;
          if (
            /^(Chat failed|I couldn't reach|No chat backend|Could not reach|Request failed)/i.test(
              m.content,
            )
          ) {
            return false;
          }
          if (/^\s*\{[\s\S]*"name"\s*:/.test(m.content)) return false;
          return true;
        })
        .slice(-12);

      try {
        const res = await fetch("/api/integrations/jarvis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: trimmed,
            agentId: "agent-jarvis",
            phase: "chat",
            jarvisAgent: "simple",
            // Only true for mic turns — typed chat gets full text-mode limits
            voiceMode: fromVoice,
            history,
          }),
        });
        const data = await res.json().catch(() => ({}));
        let reply: string;
        let backend: string | undefined;
        let model: string | undefined;
        if (!res.ok) {
          reply =
            (typeof data.error === "string" && data.error) ||
            (typeof data.result?.error === "string" && data.result.error) ||
            "I couldn't reach the chat model. Start LM Studio (Hermes) and/or set XAI_API_KEY for Grok.";
        } else {
          reply =
            (data.result?.content as string)?.trim() ||
            "I didn't catch a response.";
          backend =
            typeof data.result?.backend === "string"
              ? data.result.backend
              : undefined;
          model =
            typeof data.result?.model === "string"
              ? data.result.model
              : undefined;
        }

        if (
          /^\s*\{[\s\S]*"name"\s*:/.test(reply) ||
          /Using Tavily for web search/i.test(reply) ||
          (/tavily_search|brave_search/i.test(reply) &&
            /\{[\s\S]*"name"\s*:/.test(reply)) ||
          /\*\*Actionable Steps:\*\*|\[insert president's name\]/i.test(
            reply,
          ) ||
          /I made a mistake.*(tool|parameter)/i.test(reply)
        ) {
          reply =
            "I got a bad tool-call response instead of an answer. Please ask again — the chat proxy should answer in plain language.";
        }

        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content: reply,
            backend,
            model,
          },
        ]);

        if (tts.enabled) {
          await tts.speak(reply).catch(() => undefined);
        }
        await refreshStatus();
      } catch (e) {
        const err =
          e instanceof Error
            ? e.message
            : "Request failed — check LM Studio local server.";
        setMessages((m) => [
          ...m,
          { id: uid(), role: "assistant", content: err },
        ]);
        if (tts.enabled)
          void tts
            .speak("Sorry, I could not reach the language model.")
            .catch(() => undefined);
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    },
    [refreshStatus, tts],
  );

  const onTranscript = useCallback(
    (text: string, meta: { isFinal: boolean }) => {
      if (!meta.isFinal) return;
      const t = text.trim();
      if (!t) {
        setMicError("No speech detected — try again a bit closer.");
        return;
      }
      if (
        /^(thank you for watching|thanks for watching|subscribe|you|the end|bye\.?)$/i.test(
          t,
        )
      ) {
        setMicError(`Ignored noise transcript: “${t}”. Try speaking again.`);
        return;
      }
      setMicError(null);
      setPrompt(t);
      void sendTurn(t, { fromVoice: true });
    },
    [sendTurn],
  );

  const stt = useSpeechToText({
    preferredMode: "builtin",
    onTranscript,
  });

  useEffect(() => {
    if (stt.error) setMicError(stt.error);
  }, [stt.error]);

  const startTalk = () => {
    if (busy || stt.status === "processing") return;
    tts.stop();
    setMicError(null);
    stt.start("builtin");
  };

  const stopTalk = () => {
    stt.stop();
  };

  const toggleTalk = () => {
    if (stt.status === "listening") stopTalk();
    else if (stt.status === "processing" || busy) return;
    else startTalk();
  };

  const clearChat = () => {
    tts.stop();
    setMessages([
      {
        id: uid(),
        role: "system",
        content: "Conversation cleared. Click the orb when you're ready.",
      },
    ]);
    greetedRef.current = false;
  };

  const online = Boolean(status?.online);
  const talkLabel = talkButtonLabel(stt.status, busy, tts.isSpeaking);
  const avatarMood = jarvisMoodFromState({
    online,
    listening: stt.status === "listening",
    processing: stt.status === "processing",
    thinking: busy,
    speaking: tts.isSpeaking,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Compact top bar — orb is the focus */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className={cn(
              "inline-flex h-2 w-2 rounded-full",
              online ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" : "bg-muted",
            )}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-wide">Jarvis</div>
            <div className="truncate text-[11px] text-muted">
              {online
                ? status?.health?.detail ||
                  hybridStatusLine(status) ||
                  "Link open"
                : "Offline — start LM Studio (:1234) or set XAI_API_KEY"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={tts.enabled ? "secondary" : "ghost"}
            onClick={() => {
              if (tts.enabled) tts.stop();
              tts.setEnabled(!tts.enabled);
            }}
          >
            {tts.enabled ? (
              <Volume2 className="h-3.5 w-3.5 text-sky-300" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
            {tts.enabled ? "Voice" : "Muted"}
          </Button>
          {tts.isSpeaking && (
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => tts.stop()}
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={clearChat}>
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void refreshStatus()}
          >
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Hero orb stage */}
        <section
          className={cn(
            "relative flex flex-col items-center justify-center px-4 pb-2 pt-4 sm:px-8 sm:pt-6",
            "bg-[radial-gradient(ellipse_80%_70%_at_50%_45%,rgba(14,165,233,0.12),transparent_70%)]",
          )}
        >
          <JarvisAvatar
            mood={avatarMood}
            size="hero"
            showLabel
            onClick={toggleTalk}
            disabled={
              busy || stt.status === "processing" || !stt.builtinAvailable
            }
            className="w-full"
          />

          <div className="mt-1 flex max-w-xl flex-col items-center gap-2 px-2 text-center">
            <p className="text-sm font-medium text-foreground/90">
              {talkLabel.title}
            </p>
            <p className="text-[12px] text-muted">{talkLabel.hint}</p>
            {micError && (
              <p className="text-[11px] text-amber-300/90">{micError}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={stt.status === "listening" ? "danger" : "primary"}
                disabled={
                  busy || stt.status === "processing" || !stt.builtinAvailable
                }
                onClick={toggleTalk}
              >
                {stt.status === "listening" ? (
                  <>
                    <MicOff className="h-3.5 w-3.5" /> Stop listening
                  </>
                ) : stt.status === "processing" || busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Working…
                  </>
                ) : (
                  <>
                    <Mic className="h-3.5 w-3.5" /> Talk
                  </>
                )}
              </Button>
              {tts.isSpeaking && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => tts.stop()}
                >
                  <Square className="h-3 w-3" />
                  Stop speaking
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Conversation strip under the orb */}
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-6 pt-2 sm:px-6">
          <div className="max-h-[200px] space-y-2 overflow-y-auto rounded-xl border border-border/60 bg-panel/40 p-3 sm:max-h-[240px]">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm leading-relaxed",
                  m.role === "user" &&
                    "ml-10 bg-accent-soft border border-blue-500/15",
                  m.role === "assistant" &&
                    "mr-6 bg-panel-elevated/80 border border-border",
                  m.role === "system" &&
                    "text-[11px] text-muted border border-border-subtle",
                )}
              >
                {m.role === "assistant" ? (
                  <div className="mb-1 flex items-center gap-2">
                    <JarvisAvatar
                      mood={
                        tts.isSpeaking &&
                        m.id === messages[messages.length - 1]?.id
                          ? "speaking"
                          : "idle"
                      }
                      size="sm"
                      showLabel={false}
                    />
                    <span className="text-[10px] uppercase tracking-wider text-muted">
                      Jarvis
                      {m.backend ? (
                        <span className="ml-1.5 font-normal normal-case tracking-normal text-muted/80">
                          · {formatBackendLabel(m.backend)}
                          {m.model ? ` (${shortModel(m.model)})` : ""}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ) : m.role === "user" ? (
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">
                    You
                  </div>
                ) : null}
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Forming a response…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendTurn(prompt);
                }
              }}
              rows={2}
              placeholder="Type a message… Enter to send"
              disabled={busy}
              className="min-h-[52px] flex-1 resize-y rounded-xl border border-border bg-panel-elevated px-3 py-2 text-sm outline-none focus:border-sky-500/40 disabled:opacity-50"
            />
            <Button
              type="button"
              size="sm"
              variant="primary"
              className="self-end"
              disabled={busy || !prompt.trim()}
              onClick={() => void sendTurn(prompt)}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </div>

          {!online && (
            <p className="text-[11px] text-amber-300/90">
              No chat backend online. Load{" "}
              <strong>Hermes 3 Llama 3.1 8B Abliterated</strong> in LM Studio
              (local server port 1234) and/or set{" "}
              <code className="text-foreground/80">XAI_API_KEY</code> for Grok
              hybrid. Live search uses{" "}
              <code className="text-foreground/80">TAVILY_API_KEY</code>
              {status?.hybrid?.tavilyReady ? " (configured)" : ""}.
            </p>
          )}
          {online && status?.hybrid && (
            <p className="text-[11px] text-muted">
              Hybrid chat: LM Studio for private turns
              {status.hybrid.grokReady
                ? `; Grok (${status.hybrid.grokModel || "xAI"}) for live data`
                : "; add XAI_API_KEY for Grok live answers"}
              {status.hybrid.tavilyReady
                ? " · Tavily search on"
                : " · Tavily optional"}
              .
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function hybridStatusLine(status: JarvisStatus | null): string {
  if (!status?.hybrid) return "";
  const bits = [
    status.hybrid.mode || "hybrid",
    status.hybrid.grokReady ? "Grok ready" : null,
    status.hybrid.tavilyReady ? "Tavily on" : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

function formatBackendLabel(backend: string): string {
  const b = backend.toLowerCase();
  if (b === "grok" || b === "xai") return "Grok";
  if (b === "lmstudio") return "LM Studio";
  if (b === "ollama") return "Ollama";
  if (b.includes("jarvis")) return "OpenJarvis";
  if (b === "hybrid") return "Hybrid";
  return backend;
}

function shortModel(model: string): string {
  if (model.length <= 28) return model;
  const parts = model.split(/[\\/]/);
  const last = parts[parts.length - 1] || model;
  return last.length <= 28 ? last : `${last.slice(0, 25)}…`;
}

function talkButtonLabel(
  stt: SpeechStatus,
  busy: boolean,
  speaking: boolean,
): { title: string; hint: string } {
  if (stt === "listening") {
    return {
      title: "Listening…",
      hint: "Speak naturally. Click the orb again when you're finished.",
    };
  }
  if (stt === "processing") {
    return {
      title: "Understanding…",
      hint: "Transcribing with local Whisper.",
    };
  }
  if (busy) {
    return {
      title: "Thinking…",
      hint: "Jarvis is forming a reply.",
    };
  }
  if (speaking) {
    return {
      title: "Speaking with you",
      hint: "Watch the orb — energy follows the voice. Stop to interrupt.",
    };
  }
  if (stt === "denied") {
    return {
      title: "Mic permission needed",
      hint: "Enable Cortex in System Settings → Privacy → Microphone.",
    };
  }
  if (stt === "unsupported") {
    return {
      title: "Mic unavailable",
      hint: "Type below, or check microphone hardware.",
    };
  }
  return {
    title: "Ready",
    hint: "Click the orb to talk, or type a message below.",
  };
}
