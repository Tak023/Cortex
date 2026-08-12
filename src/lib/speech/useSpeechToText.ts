"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  isMicRecordingAvailable,
  pickRecorderMimeType,
  transcribeAudio,
  type TranscribeProgress,
} from "./transcribe";

export type SpeechMode = "builtin" | "external" | "auto";

/**
 * Mic availability is a browser capability, so it cannot be known during SSR.
 * Reading it directly in render made the server say "unavailable" and the
 * client say "available" on the very first paint, which broke hydration
 * wherever the value drives markup (the Jarvis orb switched div → button).
 *
 * useSyncExternalStore hydrates against the server snapshot and then re-renders
 * with the real value, so the first client render matches the HTML. The
 * capability never changes after load, so subscribe is a no-op.
 */
const subscribeNever = () => () => {};
const getMicSnapshot = () => isMicRecordingAvailable();
const getMicServerSnapshot = () => false;

export type SpeechStatus =
  | "idle"
  | "listening"
  | "processing"
  | "external"
  | "unsupported"
  | "denied"
  | "error";

/**
 * Voice → text for any field.
 *
 * - builtin: MediaRecorder + Whisper (server or on-device). Web Speech API is
 *   broken in Electron (always `network` error), so we never rely on it.
 * - external: focus field for Whisperflow / macOS Dictation / system VTT
 * - auto: builtin when mic recording is available, else external
 */
export function useSpeechToText(opts: {
  preferredMode?: SpeechMode;
  lang?: string;
  onTranscript: (text: string, meta: { isFinal: boolean }) => void;
}) {
  const { preferredMode = "auto", onTranscript } = opts;
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const intentionalStop = useRef(false);
  const processingRef = useRef(false);

  const builtinAvailable = useSyncExternalStore(
    subscribeNever,
    getMicSnapshot,
    getMicServerSnapshot,
  );

  const defaultMode = (): "builtin" | "external" => {
    if (preferredMode === "external") return "external";
    if (preferredMode === "builtin") {
      return builtinAvailable ? "builtin" : "external";
    }
    return builtinAvailable ? "builtin" : "external";
  };

  const cleanupMic = useCallback(() => {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      /* ignore */
    }
    recorderRef.current = null;
    if (mediaStreamRef.current) {
      for (const t of mediaStreamRef.current.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
      mediaStreamRef.current = null;
    }
    chunksRef.current = [];
  }, []);

  const stop = useCallback(() => {
    intentionalStop.current = true;
    // If actively recording, stop triggers onstop → transcribe
    if (recorderRef.current && recorderRef.current.state === "recording") {
      try {
        recorderRef.current.stop();
      } catch {
        cleanupMic();
        setStatus("idle");
        setInterim("");
        setProgress(null);
      }
      return;
    }
    cleanupMic();
    setInterim("");
    setProgress(null);
    setError(null);
    if (!processingRef.current) {
      setStatus("idle");
    }
  }, [cleanupMic]);

  const runTranscribe = useCallback(async (blob: Blob) => {
    // ~0.3s of compressed audio is still small; 256B was rejecting valid clips
    if (blob.size < 128) {
      setStatus("idle");
      setProgress(null);
      setError("Recording too short — hold Talk a moment longer, then stop.");
      return;
    }
    processingRef.current = true;
    setStatus("processing");
    setInterim("");
    setError(null);
    try {
      const text = await transcribeAudio(blob, (p) => setProgress(p));
      const cleaned = (text || "").trim();
      if (cleaned) {
        onTranscriptRef.current(cleaned, { isFinal: true });
        setStatus("idle");
        setProgress(null);
      } else {
        setStatus("idle");
        setProgress(null);
        setError("No speech detected. Try again a bit closer to the mic.");
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not transcribe audio";
      setStatus("error");
      setError(
        msg.includes("fetch") || msg.includes("network")
          ? `${msg} — first Whisper download needs network; then retry Talk.`
          : msg,
      );
      setProgress(null);
    } finally {
      processingRef.current = false;
    }
  }, []);

  const startBuiltin = useCallback(async () => {
    if (!isMicRecordingAvailable()) {
      setStatus("unsupported");
      setError(
        "Microphone recording is not available. Use Dictation app / Whisperflow.",
      );
      return;
    }

    intentionalStop.current = false;
    setError(null);
    setProgress(null);
    setInterim("");
    cleanupMic();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      mediaStreamRef.current = stream;

      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onerror = () => {
        setStatus("error");
        setError("Microphone recording failed.");
        cleanupMic();
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        // Release mic ASAP
        if (mediaStreamRef.current) {
          for (const t of mediaStreamRef.current.getTracks()) t.stop();
          mediaStreamRef.current = null;
        }
        recorderRef.current = null;
        chunksRef.current = [];
        void runTranscribe(blob);
      };

      recorderRef.current = recorder;
      // timeslice keeps data flowing; final blob assembled on stop
      recorder.start(250);
      setStatus("listening");
    } catch (e) {
      cleanupMic();
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setStatus("denied");
        setError(
          "Microphone access denied. Enable Cortex in System Settings → Privacy → Microphone, or use Dictation app / Whisperflow.",
        );
      } else if (name === "NotFoundError") {
        setStatus("error");
        setError("No microphone found.");
      } else {
        setStatus("error");
        setError(
          e instanceof Error ? e.message : "Could not open the microphone",
        );
      }
    }
  }, [cleanupMic, runTranscribe]);

  const startExternal = useCallback(() => {
    intentionalStop.current = true;
    cleanupMic();
    setInterim("");
    setError(null);
    setProgress(null);
    setStatus("external");
  }, [cleanupMic]);

  const start = useCallback(
    (mode?: "builtin" | "external") => {
      const m = mode ?? defaultMode();
      if (m === "external") startExternal();
      else void startBuiltin();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startBuiltin, startExternal, preferredMode, builtinAvailable],
  );

  const toggle = useCallback(
    (mode?: "builtin" | "external") => {
      if (
        status === "listening" ||
        status === "external" ||
        status === "processing"
      ) {
        if (status === "processing") return; // wait for transcription
        stop();
      } else {
        start(mode);
      }
    },
    [status, start, stop],
  );

  useEffect(() => {
    return () => {
      intentionalStop.current = true;
      cleanupMic();
    };
  }, [cleanupMic]);

  return {
    status,
    interim,
    error,
    progress,
    preferredMode,
    builtinAvailable,
    isActive:
      status === "listening" ||
      status === "external" ||
      status === "processing",
    start,
    stop,
    toggle,
  };
}
