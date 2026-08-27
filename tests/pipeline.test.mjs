/**
 * The Testing phase must not destroy the app the Implementation phase built.
 *
 * It did, on every run. `generateAppTests(appDir, { force: true })` — which
 * the Testing phase always passes — bypassed the "only repair a broken stub"
 * guard, so `app/page.tsx` and `app/layout.tsx` were overwritten with the
 * scaffold placeholder. The generated unit tests then asserted that
 * placeholder's structure ("Features" and "Stack" headings), passed, and the
 * phase reported success. A real implementation could not survive its own
 * pipeline, whatever the code generator produced.
 *
 * These cover both halves: the page is left alone, and the tests written
 * against it describe a working page rather than the scaffold's shape.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { suite, check, equals } from "./harness.mjs";

const CONCEPT = {
  id: "c1",
  title: "Open Theory Personal Lab Site",
  summary: "A personal lab notebook site.",
  features: ["Brand kit with hero mark", "Project gallery", "Journey blog"],
  stack: ["Next.js", "TypeScript"],
  difficulty: "medium",
  estimatedEffort: "",
  agentsUsed: [],
  score: 0,
};

/** A real generated app: no "Features"/"Stack" headings anywhere. */
const GENERATED_PAGE = `import { Hero } from "../components/home/Hero";
import { ProjectGallery } from "../components/projects/ProjectGallery";

export default function Page() {
  return (
    <main>
      <Hero />
      <section aria-label="Projects">
        <h2>Selected work</h2>
        <ProjectGallery />
      </section>
    </main>
  );
}
`;

const GENERATED_LAYOUT = `import "./globals.css";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`;

/** The broken auto-fix stub the repair path genuinely exists for. */
const STUB_PAGE = `export default function Page() {
  return <div><h1>App</h1></div>;
}
`;

function makeApp(pageSrc, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-pipeline-"));
  const files = {
    "package.json": JSON.stringify({
      name: "app",
      dependencies: { next: "15.2.4", react: "19.0.0" },
    }),
    "app/page.tsx": pageSrc,
    "app/layout.tsx": GENERATED_LAYOUT,
    "app/globals.css": "body{margin:0}",
    ...extra,
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

export async function run(mod) {
  const { generateAppTests, isAutoRecoveredStubPage, detectAppKind } =
    await import(mod("build/generateTests.js"));

  suite("A generated app survives the Testing phase");
  {
    const dir = makeApp(GENERATED_PAGE);
    equals("detected as a web app", detectAppKind(dir), "web");
    check("a real page is not mistaken for a stub", !isAutoRecoveredStubPage(dir));

    const before = fs.readFileSync(path.join(dir, "app/page.tsx"), "utf8");
    // force: true is exactly what the Testing phase passes.
    generateAppTests(dir, { concept: CONCEPT, force: true });
    const after = fs.readFileSync(path.join(dir, "app/page.tsx"), "utf8");

    equals("app/page.tsx is byte-identical after a forced run", after, before);
    check("the generated components are still referenced",
      after.includes("ProjectGallery"), after.slice(0, 80));
    check("the placeholder was not written",
      !after.includes("Scaffolded by Cortex"), after.slice(0, 80));

    const layout = fs.readFileSync(path.join(dir, "app/layout.tsx"), "utf8");
    equals("app/layout.tsx is untouched", layout, GENERATED_LAYOUT);

    check("test suites were still generated",
      fs.existsSync(path.join(dir, "tests/unit/page.test.tsx")));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  suite("A genuinely broken stub is still repaired");
  {
    const dir = makeApp(STUB_PAGE);
    check("the stub is detected", isAutoRecoveredStubPage(dir));
    generateAppTests(dir, { concept: CONCEPT, force: true });
    const after = fs.readFileSync(path.join(dir, "app/page.tsx"), "utf8");
    check("the stub was replaced with a concept-driven page",
      after.includes("concept") && !after.includes("<h1>App</h1>"),
      after.slice(0, 80));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  suite("A missing page is still restored");
  {
    const dir = makeApp(GENERATED_PAGE);
    fs.rmSync(path.join(dir, "app/page.tsx"));
    check("a missing page counts as a stub", isAutoRecoveredStubPage(dir));
    generateAppTests(dir, { concept: CONCEPT, force: true });
    check("a page was written back",
      fs.existsSync(path.join(dir, "app/page.tsx")));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  suite("Generated unit tests do not assert the scaffold's shape");
  {
    const dir = makeApp(GENERATED_PAGE);
    generateAppTests(dir, { concept: CONCEPT, force: true });
    const spec = fs.readFileSync(path.join(dir, "tests/unit/page.test.tsx"), "utf8");

    check("no required Features heading",
      !/getAllByRole\("heading", \{ name: \/features\/i \}\)/.test(spec));
    check("no required Stack heading",
      !/getAllByRole\("heading", \{ name: \/stack\/i \}\)/.test(spec));
    check("still asserts the page renders content",
      /toBeGreaterThan\(0\)/.test(spec) && /render\(<Page \/>\)/.test(spec));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
