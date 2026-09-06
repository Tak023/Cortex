/**
 * Model-id matching and CLI output parsing.
 *
 * Both are covered against output captured from the real backends, in
 * `tests/fixtures/`. The matcher originally shipped broken because its
 * fixtures were hand-authored: nine invented cases passed while all five real
 * model ids failed, since LM Studio serves `qwen/qwen3-coder-30b` where the
 * registry stores `lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-MLX-4bit`
 * and neither is a substring of the other.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { suite, check, equals } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, "fixtures", name), "utf8");

/** Verbatim from `curl 127.0.0.1:1234/v1/models` on a live LM Studio. */
const LOADED = [
  "qwen/qwen3-coder-30b",
  "zai-org/glm-4.6v-flash",
  "nvidia/nemotron-3-nano-omni",
  "google/gemma-4-31b-qat",
  "hermes-3-llama-3.1-70b",
  "hermes-3-llama-3.1-8b-abliterated",
  "text-embedding-nomic-embed-text-v1.5",
];

export async function run(mod) {
  const { matchPreferredModel } = await import(mod("agents/adapters/modelMatch.js"));
  const { parseClaudeJson, parseCodexJsonl } = await import(
    mod("agents/adapters/cliOutput.js")
  );

  suite("Registry model ids resolve against real LM Studio ids");
  {
    const cases = [
      ["lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-MLX-4bit", "qwen/qwen3-coder-30b"],
      ["lmstudio-community/gemma-4-31B-it-QAT-GGUF", "google/gemma-4-31b-qat"],
      ["lmstudio-community/GLM-4.6V-Flash-MLX-4bit", "zai-org/glm-4.6v-flash"],
      ["lmstudio-community/nemotron-3-nano-omni-30b-a3b-reasoning", "nvidia/nemotron-3-nano-omni"],
      ["gulan28/Hermes-3-Llama-3.1-8B-abliterated-GGUF", "hermes-3-llama-3.1-8b-abliterated"],
    ];
    for (const [want, expect] of cases) {
      equals(want.split("/").pop().slice(0, 38), matchPreferredModel(want, LOADED), expect);
    }
  }

  suite("Genuinely different models are still refused");
  {
    check("llama-3.3-70b does not match a loaded hermes-3-llama-3.1-70b",
      matchPreferredModel("llama-3.3-70b", LOADED) === undefined);
    check("8B and 70B Hermes are not confused",
      matchPreferredModel("gulan28/Hermes-3-Llama-3.1-8B-abliterated-GGUF", LOADED)
        === "hermes-3-llama-3.1-8b-abliterated");
    check("a coder model does not match the embedding model",
      matchPreferredModel("lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-MLX-4bit", LOADED)
        !== "text-embedding-nomic-embed-text-v1.5");
    check("an unloaded model yields undefined",
      matchPreferredModel("meta/not-loaded-13b", LOADED) === undefined);
    check("an empty backend yields undefined",
      matchPreferredModel("qwen/qwen3-coder-30b", []) === undefined);
  }

  suite("CLI output parsed from real captures");
  {
    const c = parseClaudeJson(fixture("claude-print.json"));
    equals("claude: content extracted", c.content, "FIXTURE");
    check("claude: no error", !c.error);
    check("claude: real token count", typeof c.tokens === "number" && c.tokens > 0);

    const x = parseCodexJsonl(fixture("codex-exec.jsonl"));
    equals("codex: content extracted", x.content, "FIXTURE");
    check("codex: no error", !x.error);
    check("codex: real token count", typeof x.tokens === "number" && x.tokens > 0);
  }

  suite("CLI failures are reported, not silently passed");
  {
    check("claude: empty stdout", !!parseClaudeJson("").error);
    check("claude: non-JSON", !!parseClaudeJson("command not found").error);
    check("claude: is_error honoured",
      !!parseClaudeJson(JSON.stringify({ is_error: true, result: "Credit balance too low" })).error);
    check("claude: whitespace-only result",
      !!parseClaudeJson(JSON.stringify({ is_error: false, result: "   " })).error);

    check("codex: no agent message",
      !!parseCodexJsonl('{"type":"turn.started"}\n{"type":"turn.completed","usage":{}}').error);
    check("codex: explicit error surfaced",
      (parseCodexJsonl('{"type":"error","message":"sandbox denied"}').error || "")
        .includes("sandbox denied"));
    check("codex: non-JSON noise is skipped, not fatal",
      parseCodexJsonl('booting...\n{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}')
        .content === "OK");
    check("codex: last agent message wins",
      parseCodexJsonl('{"type":"item.completed","item":{"type":"agent_message","text":"first"}}\n{"type":"item.completed","item":{"type":"agent_message","text":"final"}}')
        .content === "final");
    check("codex: reasoning items ignored",
      parseCodexJsonl('{"type":"item.completed","item":{"type":"reasoning","text":"hmm"}}\n{"type":"item.completed","item":{"type":"agent_message","text":"ANS"}}')
        .content === "ANS");
  }
}
