"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from "react";
import {
  ClipboardPaste,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
} from "lucide-react";
import {
  useSpeechToText,
  type SpeechMode,
} from "@/lib/speech/useSpeechToText";
import { warmSpeechServer } from "@/lib/speech/transcribe";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
  /** Preferred speech mode when using the default Voice control */
  speechMode?: SpeechMode;
  lang?: string;
  label?: string;
  hint?: string;
  showLabel?: boolean;
};

/**
 * Text area with:
 * - Built-in voice-to-text (mic record → fast server Whisper)
 * - External dictation (Whisperflow / macOS Dictation) with DOM sync for
 *   accessibility-based text injection that React controlled inputs miss
 */
export function VoiceTextArea({
  value,
  onChange,
  speechMode = "auto",
  lang: _lang = "en-US",
  label,
  hint,
  showLabel = true,
  className,
  rows = 4,
  id: idProp,
  ...rest
}: Props) {
  const autoId = useId();
  const id = idProp || autoId;
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Not a plain mirror: `valueRef` is also written imperatively when dictation
  // appends text and when the DOM value drifts from React's (external
  // dictation apps type straight into the textarea). The render-time
  // assignment is what re-syncs it to the controlled prop. Deferring that to
  // an effect would let a dictation write win over a newer prop value.
  const valueRef = useRef(value);
  // eslint-disable-next-line react-hooks/refs -- mirror doubles as an imperative buffer; see above
  valueRef.current = value;
  const [externalKey, setExternalKey] = useState(0);
  const [pasteHint, setPasteHint] = useState<string | null>(null);

  // Warm Node Whisper so first "Stop mic" is faster
  useEffect(() => {
    warmSpeechServer();
  }, []);

  const appendFinal = useCallback(
    (chunk: string) => {
      const piece = chunk.trim();
      if (!piece) return;
      const current = valueRef.current;
      const next = current
        ? /[\s\n]$/.test(current)
          ? current + piece
          : current + " " + piece
        : piece;
      valueRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const speech = useSpeechToText({
    preferredMode: speechMode,
    onTranscript: (text, { isFinal }) => {
      if (isFinal) appendFinal(text);
    },
  });

  const isExternal = speech.status === "external";

  // Entering external mode: remount as uncontrolled so React won't clobber
  // Whisperflow / AX-injected text, and focus the field hard.
  useEffect(() => {
    if (speech.status === "external") {
      setExternalKey((k) => k + 1);
      const focus = () => {
        const el = taRef.current;
        if (!el) return;
        el.focus();
        // Place caret at end so injected text appends naturally
        const len = el.value.length;
        try {
          el.setSelectionRange(len, len);
        } catch {
          /* ignore */
        }
      };
      requestAnimationFrame(focus);
      const t = window.setTimeout(focus, 50);
      return () => clearTimeout(t);
    }
  }, [speech.status]);

  // Whisperflow / system dictation often sets text via Accessibility (AXValue)
  // without firing React onChange. Poll + listen to every input-like event.
  useEffect(() => {
    if (!isExternal) return;
    const el = taRef.current;
    if (!el) return;

    const sync = () => {
      if (el.value !== valueRef.current) {
        valueRef.current = el.value;
        onChange(el.value);
      }
    };

    const events: Array<keyof HTMLElementEventMap> = [
      "input",
      "change",
      "keyup",
      "keydown",
      "keypress",
      "paste",
      "cut",
      "compositionend",
      "blur",
    ];
    for (const name of events) {
      el.addEventListener(name, sync);
    }
    // Accessibility injection may not emit DOM events — poll while armed
    const poll = window.setInterval(sync, 120);

    return () => {
      for (const name of events) {
        el.removeEventListener(name, sync);
      }
      clearInterval(poll);
      // Final sync when leaving external mode
      sync();
    };
  }, [isExternal, externalKey, onChange]);

  const insertClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setPasteHint("Clipboard is empty — copy from Whisperflow first.");
        window.setTimeout(() => setPasteHint(null), 2500);
        return;
      }
      appendFinal(text);
      setPasteHint("Inserted clipboard text.");
      window.setTimeout(() => setPasteHint(null), 2000);
      taRef.current?.focus();
    } catch {
      setPasteHint(
        "Clipboard blocked — allow paste, or select the field and ⌘V.",
      );
      window.setTimeout(() => setPasteHint(null), 3000);
    }
  };

  const progressLabel = (() => {
    if (speech.status !== "processing" || !speech.progress) {
      return "Transcribing…";
    }
    if (speech.progress.phase === "loading-model") {
      const pct =
        typeof speech.progress.progress === "number"
          ? ` ${speech.progress.progress}%`
          : "";
      return `Loading speech model (first time only)…${pct}`;
    }
    if (speech.progress.phase === "uploading") return "Preparing audio…";
    return "Transcribing…";
  })();

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showLabel && label ? (
          <label
            htmlFor={id}
            className="block text-xs font-medium uppercase tracking-wider text-muted"
          >
            {label}
          </label>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={speech.status === "listening" ? "danger" : "secondary"}
            title="Built-in voice to text (record → fast local Whisper)"
            disabled={
              !speech.builtinAvailable || speech.status === "processing"
            }
            onClick={() => {
              if (speech.status === "listening") speech.stop();
              else if (speech.status === "processing") return;
              else speech.start("builtin");
            }}
            className={cn(
              speech.status === "listening" &&
                "animate-pulse ring-1 ring-rose-400/40",
            )}
          >
            {speech.status === "listening" ? (
              <>
                <MicOff className="h-3.5 w-3.5" /> Stop mic
              </>
            ) : speech.status === "processing" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
              </>
            ) : (
              <>
                <Mic className="h-3.5 w-3.5" /> Voice
              </>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={isExternal ? "primary" : "ghost"}
            title="Arm field for Whisperflow / macOS Dictation"
            disabled={speech.status === "processing"}
            onClick={() => {
              if (isExternal) speech.stop();
              else speech.start("external");
            }}
          >
            <Keyboard className="h-3.5 w-3.5" />
            {isExternal ? "Dictation ready" : "Dictation app"}
          </Button>
          {isExternal && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title="Insert text from clipboard (Whisperflow copy mode)"
              onClick={() => void insertClipboard()}
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> Paste
            </Button>
          )}
        </div>
      </div>

      <div className="relative">
        {/*
          External mode uses uncontrolled textarea (key remount) so React
          value=… cannot wipe text injected by Whisperflow via Accessibility.
        */}
        {isExternal ? (
          <textarea
            {...rest}
            key={`external-${externalKey}`}
            id={id}
            ref={taRef}
            rows={rows}
            defaultValue={value}
            data-cortex-voice-target="true"
            data-cortex-speech-status={speech.status}
            autoComplete="off"
            autoCorrect="off"
            spellCheck
            onInput={(e) => {
              const v = e.currentTarget.value;
              valueRef.current = v;
              onChange(v);
            }}
            onChange={(e) => {
              const v = e.currentTarget.value;
              valueRef.current = v;
              onChange(v);
            }}
            className={cn(
              "w-full resize-y rounded-xl border border-border bg-panel-elevated px-4 py-3 pr-12 text-sm leading-relaxed outline-none focus:border-blue-500/50 placeholder:text-muted/60",
              "border-sky-400/40 ring-1 ring-sky-400/20",
              className,
            )}
          />
        ) : (
          <textarea
            {...rest}
            key="controlled"
            id={id}
            ref={taRef}
            rows={rows}
            value={value}
            data-cortex-voice-target="true"
            data-cortex-speech-status={speech.status}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            className={cn(
              "w-full resize-y rounded-xl border border-border bg-panel-elevated px-4 py-3 pr-12 text-sm leading-relaxed outline-none focus:border-blue-500/50 placeholder:text-muted/60",
              speech.status === "listening" && "border-rose-400/40",
              speech.status === "processing" && "border-amber-400/40",
              className,
            )}
          />
        )}
        {speech.isActive && (
          <span
            className={cn(
              "pointer-events-none absolute bottom-3 right-3 flex h-2.5 w-2.5 rounded-full",
              speech.status === "listening" && "bg-rose-400 animate-pulse",
              speech.status === "processing" && "bg-amber-400 animate-pulse",
              speech.status === "external" && "bg-sky-400 animate-pulse",
            )}
          />
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        {speech.status === "listening" && (
          <>
            <Sparkles className="mr-1 inline h-3 w-3 text-rose-300" />
            Recording… speak, then <strong>Stop mic</strong> (local Whisper is
            pre-warmed for speed).
          </>
        )}
        {speech.status === "processing" && (
          <>
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin text-amber-300" />
            {progressLabel}
          </>
        )}
        {isExternal && (
          <>
            Field is armed for <strong>Whisperflow</strong> or macOS Dictation.
            Keep this window focused, start Whisperflow, and speak — text should
            appear here. If not, use Whisperflow&apos;s copy mode then{" "}
            <strong>Paste</strong>, or press{" "}
            <kbd className="rounded border border-border px-1">⌘V</kbd>.
          </>
        )}
        {speech.status === "idle" &&
          (hint ||
            "Voice = fast local Whisper · Dictation app = Whisperflow / system dictation")}
        {pasteHint && (
          <span className="ml-1 text-sky-300">{pasteHint}</span>
        )}
        {speech.status === "denied" && (
          <span className="text-rose-300">
            {speech.error ||
              "Mic blocked. Enable microphone for Cortex, or use Dictation app."}
          </span>
        )}
        {(speech.status === "unsupported" || speech.status === "error") && (
          <span className="text-amber-300">
            {speech.error ||
              "Built-in speech unavailable — use Dictation app / Whisperflow."}
          </span>
        )}
      </p>
    </div>
  );
}
