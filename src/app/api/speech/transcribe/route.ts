import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import {
  getServerWhisperError,
  transcribePcm16k,
  warmServerWhisper,
} from "@/lib/speech/serverWhisper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kick off model load when this route is first imported (packaged app / first request)
warmServerWhisper();

/**
 * Speech transcription.
 *
 * Modes:
 * 1) Raw PCM f32le @ 16 kHz (preferred for built-in local STT — fast Node Whisper)
 *    Content-Type: application/octet-stream
 *    Headers: X-Sample-Rate: 16000, X-Format: f32le
 *
 * 2) Multipart audio file
 *    - OPENAI_API_KEY / WHISPER_* → cloud Whisper
 *    - else decode is client-side only; use raw PCM for local
 *
 * 3) GET → status / warm-up
 */
function getCloudWhisper(): { client: OpenAI; model: string } | null {
  const apiKey =
    process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || null;
  if (!apiKey) return null;

  const baseURL =
    process.env.WHISPER_BASE_URL || process.env.OPENAI_BASE_URL || undefined;

  return {
    client: new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    }),
    model:
      process.env.WHISPER_MODEL ||
      process.env.OPENAI_WHISPER_MODEL ||
      "whisper-1",
  };
}

function bufferToFloat32(buf: Buffer): Float32Array {
  // Float32Array requires byteLength to be a multiple of 4; truncate stray bytes
  // (truncated bodies / transport glitches) instead of throwing RangeError.
  const usable = buf.byteLength - (buf.byteLength % 4);
  if (usable <= 0) return new Float32Array(0);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable);
  return new Float32Array(ab);
}

export async function GET() {
  // Warm-up + status for the UI
  try {
    warmServerWhisper();
    return NextResponse.json({
      ok: true,
      local: true,
      cloud: Boolean(getCloudWhisper()),
      error: getServerWhisperError(),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";

  // --- Path A: raw PCM from the desktop client (fast local Node Whisper) ---
  if (
    contentType.includes("application/octet-stream") ||
    req.headers.get("x-format") === "f32le"
  ) {
    try {
      const rate = Number(req.headers.get("x-sample-rate") || "16000");
      if (rate !== 16000) {
        return NextResponse.json(
          { error: "Only 16 kHz PCM is supported" },
          { status: 400 },
        );
      }
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.byteLength < 4 * 1600) {
        return NextResponse.json({ text: "" });
      }
      const samples = bufferToFloat32(buf);
      const t0 = Date.now();
      const text = await transcribePcm16k(samples);
      return NextResponse.json({
        text,
        backend: "local-node",
        ms: Date.now() - t0,
      });
    } catch (err) {
      console.error("speech/transcribe local error", err);
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Local transcription failed",
        },
        { status: 502 },
      );
    }
  }

  // --- Path B: multipart file (cloud Whisper when configured) ---
  if (contentType.includes("multipart/form-data")) {
    const cloud = getCloudWhisper();
    if (!cloud) {
      return NextResponse.json(
        {
          error:
            "No cloud Whisper configured. Send raw PCM (f32le @ 16kHz) for local STT, or set OPENAI_API_KEY.",
          code: "no_cloud_stt",
        },
        { status: 501 },
      );
    }

    try {
      const form = await req.formData();
      const audio = form.get("audio");
      if (!audio || !(audio instanceof Blob)) {
        return NextResponse.json(
          { error: "Missing audio file field 'audio'" },
          { status: 400 },
        );
      }
      if (audio.size < 256) {
        return NextResponse.json({ text: "" });
      }

      const type = audio.type || "audio/webm";
      const ext = type.includes("mp4")
        ? "mp4"
        : type.includes("ogg")
          ? "ogg"
          : type.includes("wav")
            ? "wav"
            : "webm";

      const buffer = Buffer.from(await audio.arrayBuffer());
      const file = await toFile(buffer, `speech.${ext}`, { type });
      const t0 = Date.now();
      const result = await cloud.client.audio.transcriptions.create({
        file,
        model: cloud.model,
      });
      const text =
        typeof result === "string"
          ? result
          : ((result as { text?: string }).text ?? "");
      return NextResponse.json({
        text: text.trim(),
        backend: "cloud",
        ms: Date.now() - t0,
      });
    } catch (err) {
      console.error("speech/transcribe cloud error", err);
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "Cloud transcription failed",
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    {
      error:
        "Unsupported content type. Use application/octet-stream (f32le PCM) or multipart/form-data.",
    },
    { status: 415 },
  );
}
