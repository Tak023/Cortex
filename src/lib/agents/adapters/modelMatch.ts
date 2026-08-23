/**
 * Matching a configured model id against what a backend actually serves.
 *
 * The two sides never agree on spelling. The registry stores Hugging Face
 * repo ids with a packager prefix and a quantisation suffix:
 *
 *   lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-MLX-4bit
 *
 * while LM Studio serves its own normalised id under the *publisher's*
 * namespace, with the quantisation dropped:
 *
 *   qwen/qwen3-coder-30b
 *
 * Neither is a substring of the other — the prefixes differ (`lmstudio-
 * community/` vs `qwen/`) and the suffixes are absent — so plain substring
 * matching fails on every real model. Matching therefore works on tokens
 * from the bare name, treating one side as a match when its tokens are a
 * subset of the other's. That tolerates dropped qualifiers ("instruct",
 * "mlx", "4bit", "gguf") without letting two genuinely different models
 * match: Llama-3.3-70B does not match a loaded Hermes-3-Llama-3.1-70B,
 * because each has tokens the other lacks.
 *
 * Dependency-free so it can be unit-tested against real backend output.
 */

/** Bare, lower-cased name tokens — publisher prefix and file suffix removed. */
function tokenize(id: string): string[] {
  const bare = (id.toLowerCase().split("/").pop() ?? "").replace(
    /\.(gguf|safetensors|bin)$/,
    "",
  );
  // Keep dots so version tokens survive intact (4.6v, 3.1, v1.5).
  return bare.split(/[^a-z0-9.]+/).filter(Boolean);
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) {
    if (!b.has(t)) return false;
  }
  return true;
}

/**
 * Resolve `preferred` to an id the backend actually lists.
 * Returns undefined when nothing matches — callers decide whether to
 * substitute (chat) or fail (a model-pinned agent).
 */
export function matchPreferredModel(
  preferred: string,
  available: string[],
): string | undefined {
  if (!available.length) return undefined;

  // 1. Exact, then case-insensitive exact.
  if (available.includes(preferred)) return preferred;
  const lower = preferred.toLowerCase();
  const exact = available.find((id) => id.toLowerCase() === lower);
  if (exact) return exact;

  // 2. Whole-id substring either way — still correct when it fires
  //    (e.g. a backend that reports the full repo id plus a tag).
  const partial = available.find(
    (id) =>
      id.toLowerCase().includes(lower) || lower.includes(id.toLowerCase()),
  );
  if (partial) return partial;

  // 3. Token subset on the bare name. Score by overlap so a short id cannot
  //    win over a more specific candidate that shares more of the name.
  const want = new Set(tokenize(preferred));
  if (!want.size) return undefined;

  let best: { id: string; overlap: number } | null = null;
  for (const id of available) {
    const have = new Set(tokenize(id));
    if (!have.size) continue;
    if (!isSubset(have, want) && !isSubset(want, have)) continue;

    let overlap = 0;
    for (const t of have) if (want.has(t)) overlap += 1;
    // A single shared token is too weak to pin a model on unless that is
    // genuinely all either name contains.
    if (overlap < 2 && want.size > 1 && have.size > 1) continue;
    if (!best || overlap > best.overlap) best = { id, overlap };
  }
  return best?.id;
}
