/**
 * "Is this directory inside that one?" — the check behind every containment
 * decision in Cortex: granting a coding agent write access, and killing a dev
 * server by port.
 *
 * Both are destructive if wrong, in opposite directions: too loose and an
 * agent writes outside its workspace or an unrelated process is killed; too
 * strict and the guard silently never fires.
 *
 * Symlinks are the trap. On macOS `/tmp` is a symlink to `/private/tmp`, so a
 * process reporting cwd `/private/tmp/x` fails a naive comparison against
 * `/tmp/x` — the guard skips, and the caller concludes there was nothing to
 * act on. Both paths are resolved before comparison.
 *
 * Dependency-free so it can be unit-tested directly.
 */
import fs from "fs";
import path from "path";

/** Resolve symlinks where possible, falling back to lexical resolution. */
function canonical(p: string): string | null {
  if (!p) return null;
  try {
    return fs.realpathSync(p);
  } catch {
    // Path may not exist (e.g. a deleted workspace) — still comparable.
    return path.resolve(p);
  }
}

/**
 * True when `child` is `parent` or lives beneath it.
 * Returns false for empty input rather than defaulting to permissive.
 */
export function isPathInside(parent: string, child: string): boolean {
  const p = canonical(parent);
  const c = canonical(child);
  if (!p || !c) return false;
  if (p === c) return true;
  const rel = path.relative(p, c);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
