import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
// Flat config requires the plugin to be declared in the same object that
// overrides one of its rules — the Next presets' copy is not in scope here.
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Generated and vendored trees. All four are git-ignored, but ESLint has
    // no way to know that — without this it lints ~57,500 problems' worth of
    // build output and a third-party clone, which buries every real finding
    // in the ~60 that belong to this project.
    "dist-desktop/**", // electron-builder output
    "desktop-runtime/**", // Next standalone bundle
    "data/**", // local state + generated project workspaces
    "RivalSearchMCP/**", // vendored MCP server (own repo, own tooling)
  ]),

  {
    // Electron main/preload and the build scripts are CommonJS by necessity:
    // Electron loads them as CJS, and pty-host uses createRequire to locate
    // native node-pty across several candidate paths at runtime. ESM import
    // is not available there, so the rule does not apply.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Underscore prefix is the codebase's existing "deliberately unused"
      // convention (_lang, _reason); make the linter honour it.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Known debt, tracked deliberately rather than suppressed: every data
      // panel fetches with `useEffect(() => { void load() }, [load])`, which
      // costs a double render on mount and blocks React Compiler. Fixing it
      // means adopting a data-fetching library or server components — a
      // migration, not a cleanup. Kept visible as a warning so it is not
      // forgotten, but not failing the error baseline.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
