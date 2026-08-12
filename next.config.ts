import type { NextConfig } from "next";
import path from "path";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Surface the package version in the UI. Inlined at build time, so the
  // packaged desktop app reports the version it was actually built from.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // Pin Turbopack root to this project (avoids parent lockfile confusion)
  turbopack: {
    root: process.cwd(),
  },
  // Minimal Node server bundle for the Electron desktop shell
  output: "standalone",
  // Allow packaging from monorepo-style paths
  outputFileTracingRoot: path.join(__dirname),
  // Whisper runs in the Node server (Electron). Keep native ORT out of the bundle.
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "onnxruntime-common",
    "sharp",
    "node-pty",
  ],
};

export default nextConfig;
