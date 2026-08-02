/**
 * Built-in speech-to-text for Cortex (renderer).
 *
 * Records with MediaRecorder → decode to mono 16 kHz f32 →
 * POST raw PCM to /api/speech/transcribe (Node Whisper — fast).
 *
 * Browser WASM Whisper is avoided for the happy path (slow + q8 broken in Electron).
 * Optional client fallback remains if the server is unreachable.
 */

export type TranscribeProgress =
  | { phase: "uploading" }
  | { phase: "loading-model"; progress?: number }
  | { phase: "transcribing" };

/** Decode a recorded Blob into 16 kHz mono Float32 samples for Whisper. */
export async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  if (!blob || blob.size < 64) {
    throw new Error("Recording empty — hold Talk a moment longer, then stop.");
  }
  const buffer = await blob.arrayBuffer();
  if (buffer.byteLength < 64) {
    throw new Error("Recording empty — hold Talk a moment longer, then stop.");
  }

  // Electron / Chrome often start AudioContext suspended until resumed.
  const AC =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (
          window as unknown as {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
  if (!AC) {
    throw new Error("Web Audio is unavailable in this window.");
  }
  const ctx = new AC();
  try {
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => undefined);
    }
    // decodeAudioData detaches some ArrayBuffers — copy first
    const copy = buffer.slice(0);
    const decoded = await ctx.decodeAudioData(copy);
    const channel =
      decoded.numberOfChannels > 1
        ? mixToMono(decoded)
        : decoded.getChannelData(0);
    if (decoded.sampleRate === 16000) {
      return new Float32Array(channel);
    }
    return resampleLinear(channel, decoded.sampleRate, 16000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      msg.includes("decode") || msg.includes("Unable")
        ? `Could not decode mic audio (${blob.type || "unknown format"}). Try again.`
        : msg,
    );
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const out = new Float32Array(len);
  const n = buffer.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i] / n;
  }
  return out;
}

function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return new Float32Array(input);
  const ratio = fromRate / toRate;
  const newLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/** Preferred path: Node Whisper via API (q8, warm model). */
export async function transcribeViaServerPcm(
  samples: Float32Array,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<string> {
  onProgress?.({ phase: "uploading" });
  // Copy into a clean ArrayBuffer (avoids SharedArrayBuffer / offset issues)
  const body = new Float32Array(samples.length);
  body.set(samples);

  onProgress?.({ phase: "transcribing" });
  const res = await fetch("/api/speech/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Sample-Rate": "16000",
      "X-Format": "f32le",
    },
    body,
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(errBody?.error || `Transcription failed (${res.status})`);
  }
  const data = (await res.json()) as { text?: string; ms?: number };
  if (typeof data.ms === "number") {
    console.info(`[cortex-stt] server transcribed in ${data.ms}ms`);
  }
  return (data.text ?? "").trim();
}

/** Optional: cloud multipart when OPENAI_API_KEY is set (and PCM path unused). */
export async function transcribeViaCloudBlob(
  blob: Blob,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<string | null> {
  onProgress?.({ phase: "uploading" });
  const form = new FormData();
  const ext = blob.type.includes("mp4")
    ? "mp4"
    : blob.type.includes("ogg")
      ? "ogg"
      : "webm";
  form.append("audio", blob, `speech.${ext}`);

  try {
    const res = await fetch("/api/speech/transcribe", {
      method: "POST",
      body: form,
    });
    if (res.status === 501 || res.status === 503) return null;
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error || `Transcription failed (${res.status})`);
    }
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim() || null;
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
}

/**
 * Slow client-side fallback (fp32 WASM). Only if server is down.
 * Avoids q8 (broken MatMulNBits in Electron onnxruntime-web).
 */
async function transcribeLocallyWasm(
  samples: Float32Array,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<string> {
  onProgress?.({ phase: "loading-model", progress: 0 });
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  try {
    const backends = env.backends as {
      onnx?: { wasm?: { numThreads?: number; proxy?: boolean } };
    };
    if (backends.onnx?.wasm) {
      backends.onnx.wasm.numThreads = 1;
      backends.onnx.wasm.proxy = false;
    }
  } catch {
    /* optional */
  }

  onProgress?.({ phase: "loading-model", progress: 10 });
  const asr = await pipeline(
    "automatic-speech-recognition",
    "Xenova/whisper-tiny.en",
    {
      dtype: "fp32",
      progress_callback: (info: { status?: string; progress?: number }) => {
        if (info?.status === "progress" && typeof info.progress === "number") {
          onProgress?.({
            phase: "loading-model",
            progress: Math.round(info.progress),
          });
        }
      },
    },
  );

  onProgress?.({ phase: "transcribing" });
  const result: unknown = await asr(samples, { return_timestamps: false });
  if (typeof result === "string") return result.trim();
  if (result && typeof result === "object" && "text" in result) {
    const text = (result as { text?: unknown }).text;
    return typeof text === "string" ? text.trim() : "";
  }
  return "";
}

/**
 * Full pipeline: server Node Whisper (fast) → cloud blob → client WASM (slow).
 */
export async function transcribeAudio(
  blob: Blob,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<string> {
  const samples = await blobToMono16k(blob);
  // < ~0.1s of audio at 16 kHz — nothing useful to transcribe
  if (samples.length < 1600) return "";

  const errors: string[] = [];

  // 1) Fast local Node path
  try {
    const text = await transcribeViaServerPcm(samples, onProgress);
    return text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[cortex-stt] server PCM path failed", msg);
    errors.push(`server: ${msg}`);
  }

  // 2) Cloud multipart if configured
  try {
    const cloud = await transcribeViaCloudBlob(blob, onProgress);
    if (cloud) return cloud;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[cortex-stt] cloud path failed", msg);
    errors.push(`cloud: ${msg}`);
  }

  // 3) Slow in-renderer fallback
  try {
    return await transcribeLocallyWasm(samples, onProgress);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`wasm: ${msg}`);
    throw new Error(
      `Speech-to-text failed. ${errors.slice(0, 2).join(" · ")}`,
    );
  }
}

/** Pre-warm the server model so the first utterance is faster. */
export function warmSpeechServer(): void {
  if (typeof window === "undefined") return;
  void fetch("/api/speech/transcribe", { method: "GET" }).catch(() => undefined);
}

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export function isMicRecordingAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}
