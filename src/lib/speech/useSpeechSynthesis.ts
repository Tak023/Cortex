"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSpeechSynthesisAvailable,
  speakText,
  stopSpeaking,
  warmSpeechVoices,
  type SpeakOptions,
} from "./speak";

export type TtsStatus = "idle" | "speaking" | "unsupported" | "error";

/**
 * Jarvis voice output — speak assistant replies with system TTS.
 */
export function useSpeechSynthesis(defaults?: {
  rate?: number;
  pitch?: number;
  lang?: string;
  voiceHint?: string;
}) {
  const [status, setStatus] = useState<TtsStatus>(() =>
    typeof window === "undefined"
      ? "idle"
      : isSpeechSynthesisAvailable()
        ? "idle"
        : "unsupported",
  );
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const speakingRef = useRef(false);
  const genRef = useRef(0);

  useEffect(() => {
    if (!isSpeechSynthesisAvailable()) {
      setStatus("unsupported");
      return;
    }
    void warmSpeechVoices();
    return () => {
      stopSpeaking();
    };
  }, []);

  const stop = useCallback(() => {
    genRef.current += 1;
    speakingRef.current = false;
    stopSpeaking();
    setStatus((s) => (s === "unsupported" ? s : "idle"));
  }, []);

  const speak = useCallback(
    async (text: string, opts?: SpeakOptions) => {
      if (!enabled) return;
      if (!isSpeechSynthesisAvailable()) {
        setStatus("unsupported");
        setError("Speech synthesis is not available.");
        return;
      }
      const myGen = ++genRef.current;
      setError(null);
      try {
        await speakText(text, {
          rate: defaults?.rate,
          pitch: defaults?.pitch,
          lang: defaults?.lang,
          voiceHint: defaults?.voiceHint,
          ...opts,
          onStart: () => {
            if (genRef.current !== myGen) return;
            speakingRef.current = true;
            setStatus("speaking");
            opts?.onStart?.();
          },
          onEnd: () => {
            if (genRef.current !== myGen) return;
            speakingRef.current = false;
            setStatus("idle");
            opts?.onEnd?.();
          },
          onError: (msg) => {
            if (genRef.current !== myGen) return;
            speakingRef.current = false;
            setStatus("error");
            setError(msg);
            opts?.onError?.(msg);
          },
        });
      } catch {
        if (genRef.current === myGen) {
          speakingRef.current = false;
          setStatus((s) => (s === "unsupported" ? s : "idle"));
        }
      }
    },
    [enabled, defaults?.rate, defaults?.pitch, defaults?.lang, defaults?.voiceHint],
  );

  return {
    status,
    error,
    enabled,
    setEnabled,
    available: status !== "unsupported",
    isSpeaking: status === "speaking",
    speak,
    stop,
  };
}
