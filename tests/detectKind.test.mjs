/**
 * Choosing which kind of app to scaffold.
 *
 * A live run asked for "Shadowlog — Static Dark Changelog for CLI Tools",
 * stack Eleventy + Tailwind + GitHub Pages. Cortex scaffolded a command-line
 * application, because the classifier ran `hay.includes("cli")` over the
 * title. The title names the *topic*; the stack names the *runtime*, and it
 * said website in four different ways.
 *
 * The substring match was independently dangerous: "client", "clipboard",
 * "click" and "declining" all contain "cli".
 */
import { suite, check, equals } from "./harness.mjs";

const concept = (title, summary, stack = [], features = []) => ({
  id: "c",
  title,
  summary,
  stack,
  features,
  difficulty: "medium",
  estimatedEffort: "",
  agentsUsed: [],
  score: 0,
});

export async function run(mod) {
  const { detectKind } = await import(mod("build/detectKind.js"));

  suite("The stack outranks topic keywords");
  {
    equals(
      "the live regression: a changelog site *for* CLI tools is a website",
      detectKind(
        concept(
          "Shadowlog — Static Dark Changelog for CLI Tools",
          "A generate-once static site that turns a YAML release feed into a dark-themed changelog.",
          ["Eleventy", "Markdown", "Tailwind CSS", "GitHub Pages"],
        ),
      ),
      "web",
    );
    equals(
      "a Next.js dashboard that mentions containers is still a website",
      detectKind(
        concept("Container Dashboard", "Monitor your docker containers.", [
          "Next.js",
          "React",
        ]),
      ),
      "web",
    );
    equals(
      "an Astro docs site about terminal tooling is a website",
      detectKind(
        concept("Terminal Tips", "Docs for terminal power users.", ["Astro"]),
      ),
      "web",
    );
  }

  suite("Genuine non-web projects are still detected");
  {
    equals(
      "a real CLI with no web stack",
      detectKind(
        concept("Repo Sync", "A command-line tool that syncs repositories.", [
          "Node.js",
          "TypeScript",
        ]),
      ),
      "cli",
    );
    equals(
      "an explicit docker viewer",
      detectKind(
        concept("Whale Watch", "Inspect docker containers locally.", [
          "Node.js",
        ]),
      ),
      "docker",
    );
    equals(
      "a REST API service",
      detectKind(
        concept("Ledger API", "A rest api for double-entry bookkeeping.", [
          "Fastify",
          "Postgres",
        ]),
      ),
      "api",
    );
  }

  suite("Substring false positives are gone");
  {
    for (const [word, text] of [
      ["client", "A client portal for invoices."],
      ["clipboard", "A clipboard history manager page."],
      ["click", "Track click-through rates."],
      ["declining", "Reports on declining revenue."],
    ]) {
      equals(
        `"${word}" no longer reads as CLI`,
        detectKind(concept("Report Tool", text, ["Node.js"])),
        "web",
      );
    }
  }

  suite("Defaults");
  {
    equals(
      "an unclassifiable concept defaults to web",
      detectKind(concept("Something", "A thing that does stuff.", [])),
      "web",
    );
    check(
      "missing stack and features do not throw",
      ["web", "cli", "api", "docker"].includes(
        detectKind({ id: "x", title: "X", summary: "" }),
      ),
    );
  }
}
