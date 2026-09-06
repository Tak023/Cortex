/**
 * Minimal assertion harness.
 *
 * Cortex has no test runner dependency, and the units worth covering here are
 * pure functions — routing decisions, cost tiers, model-id matching, CLI
 * output parsing. A runner is not needed to check them, and adding one would
 * be a heavier change than the tests themselves.
 */
let passed = 0;
let failed = 0;
const failures = [];

export function suite(name) {
  console.log(`\n${name}`);
}

export function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

export function equals(name, actual, expected) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}`);
}

export function report() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  return failed === 0;
}

export function totals() {
  return { passed, failed };
}
