/**
 * Style-completeness check for a generated app.
 *
 * A passing `npm run build` says nothing about whether the app *looks*
 * finished. The first real generation run compiled cleanly while referencing
 * 105 class names with no CSS behind them, producing a page with unstyled
 * navigation and raw blue links. `npm run build` cannot catch that; this can,
 * so it feeds the repair loop as a first-class failure alongside compile
 * errors.
 *
 * Dependency-free (fs + path only) so it can be unit-tested directly.
 */
import fs from "fs";
import path from "path";

/** Directories never scanned — regenerable, vendored, or huge. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "test-results",
  ".git",
]);

/**
 * Class names referenced in JSX that no stylesheet defines.
 *
 * A passing build says nothing about whether the app *looks* finished. The
 * first real generation run compiled cleanly while referencing 105 class names
 * with no CSS behind them, producing a page with unstyled navigation and raw
 * blue links. `npm run build` cannot catch that; this can, so it feeds the
 * repair loop as a first-class failure alongside compile errors.
 *
 * Only plain string literals are inspected. `className={styles.x}` and
 * template literals are skipped rather than guessed at.
 */
export function findUnstyledClasses(appDir: string): string[] {
  const sources: string[] = [];
  const styles: string[] = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
      } else if (/\.(tsx|jsx)$/.test(e.name)) {
        try {
          sources.push(fs.readFileSync(abs, "utf8"));
        } catch {
          /* skip */
        }
      } else if (/\.(css|scss)$/.test(e.name)) {
        try {
          styles.push(fs.readFileSync(abs, "utf8"));
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(appDir);

  const used = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/className="([^"{}]+)"/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls) used.add(cls);
      }
    }
  }
  const css = styles.join("\n");
  const defined = new Set(
    [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]),
  );
  return [...used].filter((c) => !defined.has(c)).sort();
}

