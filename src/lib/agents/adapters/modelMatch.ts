/**
 * Matching a configured model id against what a backend actually serves.
 *
 * The registry stores Hugging Face style ids
 * (`lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-MLX-4bit`) while LM Studio
 * and Ollama report their own shortened, lower-cased tags
 * (`qwen3-coder-30b-a3b-instruct-mlx`). Neither side is wrong, so the match has
 * to tolerate one being a substring of the other — while still refusing to
 * match two genuinely different models.
 *
 * Dependency-free so it can be unit-tested in isolation.
 */

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
  if (available.includes(preferred)) return preferred;
  const lower = preferred.toLowerCase();
  const exact = available.find((id) => id.toLowerCase() === lower);
  if (exact) return exact;
  // Substring either way (LM Studio long ids vs short tags)
  const partial = available.find(
    (id) =>
      id.toLowerCase().includes(lower) || lower.includes(id.toLowerCase()),
  );
  return partial;
}
