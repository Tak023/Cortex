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
  // Destructured up front, deliberately. Callers pass an object literal
  // (`useSpeechSynthesis({ rate: 1.04, lang: "en-US" })`), so `defaults` is a
  // new reference every render — memoizing `speak` against the object itself
  // would invalidate it on every render and cascade through the effects that
  // depend on it. Reading the primitives here keeps the callback stable *and*
  // lets React Compiler infer the same dependencies the code declares.
  const {
    rate: defaultRate,
    pitch: defaultPitch,
    lang: defaultLang,
    voiceHint: defaultVoiceHint,
  } = defaults ?? {};

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
          rate: defaultRate,
          pitch: defaultPitch,
          lang: defaultLang,
          voiceHint: defaultVoiceHint,
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
    [enabled, defaultRate, defaultPitch, defaultLang, defaultVoiceHint],
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
