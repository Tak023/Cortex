import {
  getTerminalSession,
  subscribeTerminal,
} from "@/lib/agents/terminalSessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE stream of PTY output for an agent terminal session.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = getTerminalSession(id);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          /* client gone */
        }
      };

      send("meta", {
        id: session.id,
        agent: session.agent,
        label: session.label,
        display: session.display,
      });

      unsubscribe = subscribeTerminal(id, {
        onData: (data) => {
          const b64 =
            typeof Buffer !== "undefined"
              ? Buffer.from(data, "utf8").toString("base64")
              : btoa(unescape(encodeURIComponent(data)));
          send("data", b64);
        },
        onExit: (code) => {
          send("exit", code ?? 0);
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        },
      });

      if (!unsubscribe) {
        send("error", "subscribe failed");
        controller.close();
        return;
      }

      if (session.exited) {
        send("exit", session.exitCode ?? 0);
        controller.close();
      }

      req.signal.addEventListener("abort", () => {
        closed = true;
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
