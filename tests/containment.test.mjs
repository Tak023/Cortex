/**
 * Path containment — the predicate behind two destructive decisions:
 * granting a coding agent write access, and killing a dev server by port.
 *
 * The symlink cases are here because a live check nearly passed silently:
 * macOS resolves /tmp to /private/tmp, so a process reporting cwd
 * `/private/tmp/x` failed a lexical comparison against `/tmp/x`. The guard
 * would have skipped and the caller would have concluded there was nothing
 * to clean up — a false negative that looks exactly like success.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { suite, check } from "./harness.mjs";

export async function run(mod) {
  const { isPathInside } = await import(mod("build/pathContainment.js"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-contain-"));
  const inner = path.join(root, "app");
  const deep = path.join(inner, "components", "ui");
  const sibling = path.join(root, "other");
  fs.mkdirSync(deep, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });

  suite("Containment");
  {
    check("a directory contains itself", isPathInside(inner, inner));
    check("direct child is inside", isPathInside(root, inner));
    check("deep descendant is inside", isPathInside(root, deep));
    check("sibling is not inside", !isPathInside(inner, sibling));
    check("parent is not inside its child", !isPathInside(deep, root));
    check("unrelated absolute path is not inside", !isPathInside(inner, "/usr/local"));
  }

  suite("Traversal cannot escape");
  {
    check("../ escape is rejected",
      !isPathInside(inner, path.join(inner, "..", "other")));
    check("../../ escape is rejected",
      !isPathInside(deep, path.join(deep, "..", "..", "..", "other")));
    check("a normalised path that stays inside is accepted",
      isPathInside(root, path.join(inner, "..", "app", "components")));
  }

  suite("Symlinked paths resolve before comparison");
  {
    // The real macOS case: /tmp is a symlink to /private/tmp.
    const link = path.join(root, "link-to-app");
    fs.symlinkSync(inner, link);
    check("a symlink to a child is recognised as inside",
      isPathInside(root, link), `${link} vs ${root}`);
    check("a child reached through a symlink is inside",
      isPathInside(inner, path.join(link, "components")));

    // A symlink pointing outside must not be treated as contained.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-outside-"));
    const escape = path.join(inner, "escape");
    fs.symlinkSync(outsideDir, escape);
    check("a symlink escaping the root is rejected",
      !isPathInside(inner, escape), `${escape} → ${outsideDir}`);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }

  suite("Degenerate input is refused, not defaulted to permissive");
  {
    check("empty parent", !isPathInside("", inner));
    check("empty child", !isPathInside(inner, ""));
    check("both empty", !isPathInside("", ""));
  }

  fs.rmSync(root, { recursive: true, force: true });
}
