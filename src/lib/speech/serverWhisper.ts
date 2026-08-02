/**
 * Server-side (Node) Whisper — much faster than browser WASM, and q8 works here.
 * onnxruntime-web in Electron breaks on q8 (MatMulNBits); onnxruntime-node does not.
 */
import path from "path";
import os from "os";

type AsrPipe = (
  audio: Float32Array,
  opts?: Record<string, unknown>,
) => Promise<{ text?: string } | string>;

let pipePromise: Promise<AsrPipe> | null = null;
let lastError: string | null = null;

function cacheDir(): string {
  const base =
    process.env.CORTEX_DATA_DIR ||
    path.join(os.homedir(), ".cache", "cortex");
  return path.join(base, "whisper-models");
}

export function getServerWhisperError(): string | null {
  return lastError;
}

export async function getServerWhisper(): Promise<AsrPipe> {
  if (pipePromise) return pipePromise;

  pipePromise = (async () => {
    lastError = null;
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.cacheDir = cacheDir();

    // Prefer base.en for accuracy (tiny often hallucinates / mishears).
    // q8 is fast on Node ORT (fails only in browser WASM/Electron).
    const candidates: Array<{ id: string; dtype: "q8" | "fp32" }> = [
      { id: "Xenova/whisper-base.en", dtype: "q8" },
      { id: "Xenova/whisper-base.en", dtype: "fp32" },
      { id: "Xenova/whisper-tiny.en", dtype: "q8" },
      { id: "Xenova/whisper-tiny.en", dtype: "fp32" },
      { id: "onnx-community/whisper-tiny.en", dtype: "q8" },
    ];

    const errors: string[] = [];
    for (const c of candidates) {
      try {
        const pipe = (await pipeline(
          "automatic-speech-recognition",
          c.id,
          { dtype: c.dtype },
        )) as unknown as AsrPipe;
        console.info(`[cortex-stt] server whisper ready: ${c.id} (${c.dtype})`);
        return pipe;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[cortex-stt] server model failed ${c.id}/${c.dtype}:`, msg);
        errors.push(`${c.id}/${c.dtype}: ${msg}`);
      }
    }
    lastError = errors.join("; ");
    throw new Error(`Server Whisper failed to load: ${lastError}`);
  })().catch((err) => {
    pipePromise = null;
    throw err;
  });

  return pipePromise;
}

/** Warm the model in the background (first load downloads weights). */
export function warmServerWhisper(): void {
  void getServerWhisper().catch((e) => {
    console.warn("[cortex-stt] warm-up failed", e);
  });
}

export async function transcribePcm16k(
  samples: Float32Array,
): Promise<string> {
  if (samples.length < 1600) return "";
  const pipe = await getServerWhisper();
  // English-only models reject language/task options
  const result = await pipe(samples, { return_timestamps: false });
  if (typeof result === "string") return result.trim();
  return (result?.text ?? "").trim();
}
