/**
 * Spawn isolated uv Python for GPT Researcher / PaperQA2.
 * Scripts are written to a temp file so they survive the packaged app
 * (standalone strips repo scripts/).
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveUvCommand } from "@/lib/mcp/catalog";
import { ensureSecretsLoaded } from "@/lib/env/secrets";

export type GptrResult = {
  ok: boolean;
  report?: string;
  urls?: string[];
  error?: string;
};

export type PaperQaResult = {
  ok: boolean;
  answer?: string;
  citations?: string[];
  error?: string;
};

const GPTR_PY = `
import asyncio, json, os, sys

async def main():
    payload = json.loads(sys.stdin.read() or "{}")
    query = (payload.get("query") or "").strip()
    mode = payload.get("mode") or "quick"
    if not query:
        print(json.dumps({"ok": False, "error": "query required"}))
        return
    try:
        from gpt_researcher import GPTResearcher
        from gpt_researcher.memory.embeddings import Memory
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"gpt-researcher import: {e}"}))
        return

    class HashEmbeddings:
        def __init__(self, dim=64):
            self.dim = dim
        def embed_documents(self, texts):
            return [self.embed_query(t) for t in texts]
        def embed_query(self, text):
            import hashlib
            digest = hashlib.sha256((text or "").encode("utf-8", "ignore")).digest()
            raw = (digest * ((self.dim // 32) + 1))[: self.dim]
            return [b / 255.0 for b in raw]
        async def aembed_documents(self, texts):
            return self.embed_documents(texts)
        async def aembed_query(self, text):
            return self.embed_query(text)

    def _mem_init(self, embedding_provider, model, **embedding_kwargs):
        self._embeddings = HashEmbeddings()
    Memory.__init__ = _mem_init

    prompt = (
        "Write a concise 3–6 paragraph briefing. Lead with the answer, then key facts with sources. No invented URLs."
        if mode == "quick"
        else "Write a comprehensive research report with sections: Abstract, Key findings, Evidence, Counterpoints, Recommendations. 800–1600 words. Cite sources by title/URL. Do not invent URLs."
    )
    try:
        researcher = GPTResearcher(query=query, report_type="research_report", verbose=False)
        await researcher.conduct_research()
        report = await researcher.write_report(custom_prompt=prompt)
        urls = []
        try:
            urls = list(researcher.get_source_urls() or [])
        except Exception:
            pass
        sources = []
        try:
            sources = researcher.get_research_sources() or []
        except Exception:
            pass
        extra = []
        for s in sources:
            if isinstance(s, dict):
                u = s.get("url") or s.get("href") or ""
                if u:
                    extra.append(u)
            elif isinstance(s, str) and s.startswith("http"):
                extra.append(s)
        print(json.dumps({"ok": True, "report": report or "", "urls": list(dict.fromkeys(urls + extra))}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))

if __name__ == "__main__":
    asyncio.run(main())
`;

const PAPERQA_PY = `
import json, os, sys, tempfile, urllib.parse, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path

def download_arxiv(query, dest, limit=6):
    q = urllib.parse.quote(query)
    url = f"https://export.arxiv.org/api/query?search_query=all:{q}&start=0&max_results={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "Cortex-Research/0.2"})
    xml = urllib.request.urlopen(req, timeout=20).read()
    root = ET.fromstring(xml)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    saved = []
    for i, entry in enumerate(root.findall("a:entry", ns)):
        pdf = None
        for link in entry.findall("a:link", ns):
            if link.attrib.get("type") == "application/pdf" or link.attrib.get("title") == "pdf":
                pdf = link.attrib.get("href")
        if not pdf:
            id_el = entry.find("a:id", ns)
            if id_el is not None and id_el.text:
                aid = id_el.text.rsplit("/", 1)[-1]
                pdf = f"https://arxiv.org/pdf/{aid}.pdf"
        if not pdf:
            continue
        path = dest / f"paper_{i+1}.pdf"
        try:
            urllib.request.urlretrieve(pdf, path)
            if path.stat().st_size > 2000:
                saved.append(str(path))
        except Exception:
            continue
    return saved

def main():
    payload = json.loads(sys.stdin.read() or "{}")
    query = (payload.get("query") or "").strip()
    if not query:
        print(json.dumps({"ok": False, "error": "query required"}))
        return
    try:
        from paperqa import Settings, ask
        from paperqa.settings import AgentSettings, IndexSettings
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"paper-qa import: {e}"}))
        return
    dest = Path(tempfile.mkdtemp(prefix="cortex-pqa-"))
    try:
        papers = download_arxiv(query, dest, 6)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"arxiv download: {e}"}))
        return
    if not papers:
        print(json.dumps({"ok": False, "error": "No arXiv PDFs downloaded"}))
        return
    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("XAI_API_KEY") or ""
    api_base = os.environ.get("OPENAI_BASE_URL") or "https://api.x.ai/v1"
    model = os.environ.get("PAPERQA_LLM") or os.environ.get("XAI_CHAT_MODEL") or "grok-4.5"
    litellm_name = model if "/" in model else f"openai/{model}"
    llm_config = {
        "model_list": [{
            "model_name": litellm_name,
            "litellm_params": {
                "model": litellm_name,
                "api_base": api_base,
                "api_key": api_key,
            },
        }]
    }
    try:
        settings = Settings(
            llm=litellm_name,
            summary_llm=litellm_name,
            llm_config=llm_config,
            summary_llm_config=llm_config,
            embedding="sparse",
            temperature=0.1,
            agent=AgentSettings(
                agent_type="fake",
                agent_llm=litellm_name,
                search_count=4,
                index=IndexSettings(
                    paper_directory=str(dest),
                    index_directory=str(dest / "index"),
                    use_absolute_paper_directory=True,
                ),
            ),
        )
        resp = ask(query, settings=settings)
        session = getattr(resp, "session", resp)
        answer = getattr(session, "formatted_answer", None) or getattr(session, "answer", "") or str(session)
        citations = []
        ctx = getattr(session, "context", None)
        if isinstance(ctx, str) and ctx.strip():
            citations.append(ctx[:2000])
        print(json.dumps({"ok": True, "answer": answer, "citations": citations, "papers": len(papers)}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))

if __name__ == "__main__":
    main()
`;

function writeScript(name: string, source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-research-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, "utf8");
  return file;
}

function llmSpec(): string {
  const explicit = process.env.FAST_LLM?.trim();
  if (explicit) return explicit;
  const model = process.env.XAI_CHAT_MODEL?.trim() || "grok-4.5";
  return model.includes(":") ? model : `openai:${model}`;
}

function researchEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  ensureSecretsLoaded();
  const xai = process.env.XAI_API_KEY?.trim() || "";
  const openai = process.env.OPENAI_API_KEY?.trim() || xai;
  const useXaiCompat = Boolean(xai) && !process.env.OPENAI_API_KEY?.trim();
  const base =
    process.env.OPENAI_BASE_URL?.trim() ||
    (useXaiCompat ? "https://api.x.ai/v1" : undefined);
  const tavily = process.env.TAVILY_API_KEY?.trim() || "";
  const llm = llmSpec();
  return {
    ...process.env,
    OPENAI_API_KEY: openai,
    ...(base ? { OPENAI_BASE_URL: base } : {}),
    ...(tavily
      ? { TAVILY_API_KEY: tavily, RETRIEVER: "tavily" }
      : { RETRIEVER: "duckduckgo" }),
    FAST_LLM: llm,
    SMART_LLM: process.env.SMART_LLM?.trim() || llm,
    STRATEGIC_LLM: process.env.STRATEGIC_LLM?.trim() || llm,
    REPORT_FORMAT: "markdown",
    PYTHONUNBUFFERED: "1",
    ...extra,
  };
}

function spawnUv(
  pkgs: string[],
  scriptPath: string,
  input: unknown,
  timeoutMs: number,
  extraEnv?: Record<string, string>,
): Promise<string> {
  const uv = resolveUvCommand();
  const args = [
    "run",
    "--no-project",
    ...pkgs.flatMap((p) => ["--with", p]),
    "python",
    scriptPath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(uv, args, {
      env: researchEnv(extraEnv),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      reject(new Error(`Research engine timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout?.on("data", (b) => {
      stdout += b.toString("utf8");
    });
    child.stderr?.on("data", (b) => {
      stderr += b.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim().slice(-500) || `exit ${code}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin?.write(JSON.stringify(input));
    child.stdin?.end();
  });
}

function lastJson(text: string): unknown {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"));
  const raw = lines.pop() || text.trim();
  return JSON.parse(raw);
}

export async function runGptResearcher(
  query: string,
  mode: "quick" | "deep",
  timeoutMs: number,
): Promise<GptrResult> {
  const script = writeScript("cortex_gptr.py", GPTR_PY);
  try {
    const out = await spawnUv(
      ["gpt-researcher", "duckduckgo-search"],
      script,
      { query, mode },
      timeoutMs,
      {
        MAX_ITERATIONS: mode === "quick" ? "2" : "4",
        TOTAL_WORDS: mode === "quick" ? "500" : "1400",
      },
    );
    return lastJson(out) as GptrResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runPaperQa(
  query: string,
  timeoutMs: number,
): Promise<PaperQaResult> {
  const script = writeScript("cortex_paperqa.py", PAPERQA_PY);
  try {
    const out = await spawnUv(["paper-qa"], script, { query }, timeoutMs);
    return lastJson(out) as PaperQaResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
