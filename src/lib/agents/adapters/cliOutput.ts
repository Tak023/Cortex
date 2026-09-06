/**
 * Parsers for the headless CLI agents' machine-readable output.
 *
 * Split out with no dependencies so they can be unit-tested against output
 * captured from the real binaries. Authoring fixtures by hand is how the
 * LM Studio model matcher shipped broken — every invented case passed and
 * every real one failed — so these tests use verbatim CLI output.
 */

export interface CliParseResult {
  content: string;
  tokens?: number;
  error?: string;
}

/** `claude -p --output-format json` emits a single JSON object. */
export function parseClaudeJson(stdout: string): CliParseResult {
  const trimmed = stdout.trim();
  if (!trimmed) return { content: "", error: "empty response from claude -p" };
  let o: {
    result?: string;
    is_error?: boolean;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    o = JSON.parse(trimmed);
  } catch {
    return {
      content: "",
      error: `unparseable claude output: ${trimmed.slice(0, 200)}`,
    };
  }
  if (o.is_error) {
    return { content: "", error: String(o.result || "claude reported an error") };
  }
  const content = String(o.result ?? "").trim();
  if (!content) return { content: "", error: "claude returned an empty result" };
  const u = o.usage ?? {};
  return {
    content,
    tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
  };
}

/**
 * `codex exec --json` emits JSONL. The answer is the last `agent_message`
 * item; token usage arrives separately on `turn.completed`. Non-JSON lines
 * appear in normal operation and are skipped rather than treated as failure.
 */
export function parseCodexJsonl(stdout: string): CliParseResult {
  let content = "";
  let tokens: number | undefined;

  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o.type === "item.completed") {
      const item = o.item as { type?: string; text?: string } | undefined;
      // Later agent messages supersede earlier ones within a turn.
      if (item?.type === "agent_message" && item.text) content = item.text;
    } else if (o.type === "turn.completed") {
      const u = o.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      if (u) tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
    } else if (o.type === "error" && typeof o.message === "string") {
      return { content: "", error: `codex error: ${o.message.slice(0, 200)}` };
    }
  }

  if (!content.trim()) {
    return { content: "", error: "codex exec produced no agent message" };
  }
  return { content: content.trim(), tokens };
}
