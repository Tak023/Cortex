/**
 * Text prep + Web Speech TTS helpers for Jarvis voice replies.
 * Electron/Chromium SpeechSynthesis works offline with system voices on macOS.
 */

/** Strip markdown / noise so TTS sounds natural. */
export function textForSpeech(raw: string): string {
  let t = raw.trim();
  if (!t) return "";

  // Fenced code → short placeholder
  t = t.replace(/```[\s\S]*?```/g, " (code snippet) ");
  // Inline code
  t = t.replace(/`([^`]+)`/g, "$1");
  // Links [label](url) → label
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Images
  t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  // Headings / bold / italic
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/_([^_]+)_/g, "$1");
  // Bullets
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  // Collapse whitespace
  t = t.replace(/\n{2,}/g, ". ");
  t = t.replace(/\n/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();

  // Cap length so replies stay conversational
  const max = 1200;
  if (t.length > max) {
    const cut = t.slice(0, max);
    const lastStop = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("! "),
      cut.lastIndexOf("? "),
    );
    t = (lastStop > 200 ? cut.slice(0, lastStop + 1) : cut) + " …";
  }
  return t;
}

export function isSpeechSynthesisAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export type SpeakOptions = {
  rate?: number;
  pitch?: number;
  volume?: number;
  /** BCP-47, e.g. en-US */
  lang?: string;
  /** Preferred voice name substring match (case-insensitive) */
  voiceHint?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

function pickVoice(lang: string, voiceHint?: string): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisAvailable()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const hint = voiceHint?.toLowerCase().trim();
  if (hint) {
    const byHint = voices.find((v) => v.name.toLowerCase().includes(hint));
    if (byHint) return byHint;
  }

  const langBase = lang.split("-")[0] || "en";
  const prefer = [
    // Natural macOS voices first
    (v: SpeechSynthesisVoice) =>
      /samantha|karen|moira|daniel|alex|aaron|nicky|zoe|ava/i.test(v.name) &&
      v.lang.toLowerCase().startsWith(langBase),
    (v: SpeechSynthesisVoice) =>
      v.lang.toLowerCase().startsWith(lang.toLowerCase()) && !/compact/i.test(v.name),
    (v: SpeechSynthesisVoice) => v.lang.toLowerCase().startsWith(langBase),
    (v: SpeechSynthesisVoice) => v.default,
  ];
  for (const pred of prefer) {
    const found = voices.find(pred);
    if (found) return found;
  }
  return voices[0] ?? null;
}

/** Cancel any in-flight utterance. */
export function stopSpeaking(): void {
  if (!isSpeechSynthesisAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

/**
 * Speak text. Cancels any current utterance first.
 * Returns a promise that resolves when speech ends (or rejects on error).
 */
export function speakText(
  text: string,
  opts: SpeakOptions = {},
): Promise<void> {
  const spoken = textForSpeech(text);
  if (!spoken) return Promise.resolve();

  if (!isSpeechSynthesisAvailable()) {
    opts.onError?.("Speech synthesis is not available in this environment.");
    return Promise.reject(new Error("Speech synthesis unavailable"));
  }

  stopSpeaking();

  // Chrome/Electron sometimes needs getVoices() primed
  void window.speechSynthesis.getVoices();

  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(spoken);
    u.lang = opts.lang || "en-US";
    u.rate = opts.rate ?? 1.02;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;

    const voice = pickVoice(u.lang, opts.voiceHint);
    if (voice) u.voice = voice;

    u.onstart = () => opts.onStart?.();
    u.onend = () => {
      opts.onEnd?.();
      resolve();
    };
    u.onerror = (ev) => {
      // "interrupted" / "canceled" are expected when user stops speech
      const err = ev.error || "speech error";
      if (err === "interrupted" || err === "canceled") {
        opts.onEnd?.();
        resolve();
        return;
      }
      const msg = `Speech error: ${err}`;
      opts.onError?.(msg);
      reject(new Error(msg));
    };

    // Small delay helps Electron pick up voices after cancel()
    window.setTimeout(() => {
      try {
        window.speechSynthesis.speak(u);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "speak() failed";
        opts.onError?.(msg);
        reject(new Error(msg));
      }
    }, 40);
  });
}

/** Ensure voices are loaded (async on some platforms). */
export function warmSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!isSpeechSynthesisAvailable()) return Promise.resolve([]);
  const existing = window.speechSynthesis.getVoices();
  if (existing.length) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    // Fallback if event never fires
    window.setTimeout(done, 800);
  });
}
