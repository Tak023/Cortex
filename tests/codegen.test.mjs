/**
 * Style-completeness check for generated apps.
 *
 * A passing `npm run build` says nothing about whether the app *looks*
 * finished. The first real generation run compiled cleanly while referencing
 * 105 class names that no stylesheet defined, producing a page with unstyled
 * navigation and raw blue links. This check turns that into a detectable
 * defect so the repair loop can act on it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { suite, check, equals } from "./harness.mjs";

function tmpApp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-style-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

export async function run(mod) {
  const { findUnstyledClasses } = await import(mod("build/styleCheck.js"));

  suite("Missing styles are detected");
  {
    const dir = tmpApp({
      "app/page.tsx": `export default function P(){return <div className="hero big"><nav className="nav"/></div>}`,
      "app/globals.css": `.hero{color:red}`,
    });
    const missing = findUnstyledClasses(dir);
    check("finds the classes with no rule",
      missing.includes("big") && missing.includes("nav"), missing.join(","));
    check("does not flag the styled one", !missing.includes("hero"));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  suite("A fully styled app is clean");
  {
    const dir = tmpApp({
      "app/page.tsx": `export default function P(){return <div className="card muted"/>}`,
      "app/globals.css": `.card{border:1px solid #222} .muted{color:#999}`,
    });
    equals("no false positives", findUnstyledClasses(dir).length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  suite("Non-literal class names are not guessed at");
  {
    const dir = tmpApp({
      "app/page.tsx":
        "export default function P(){const s={x:'y'};return <div className={s.x}><i className={`a ${'b'}`}/></div>}",
      "app/globals.css": `.nothing{}`,
    });
    equals("dynamic classNames are skipped", findUnstyledClasses(dir).length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  suite("Styles are found across nested files and build output is ignored");
  {
    const dir = tmpApp({
      "components/Nav.tsx": `export const N=()=><nav className="site-nav"/>;`,
      "styles/nav.css": `.site-nav{display:flex}`,
      "node_modules/pkg/index.tsx": `export const X=()=><div className="vendor-only"/>;`,
      ".next/static/chunk.tsx": `export const Y=()=><div className="build-artifact"/>;`,
    });
    const missing = findUnstyledClasses(dir);
    check("nested stylesheet satisfies a nested component",
      !missing.includes("site-nav"), missing.join(","));
    check("node_modules is not scanned", !missing.includes("vendor-only"));
    check("build output is not scanned", !missing.includes("build-artifact"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
