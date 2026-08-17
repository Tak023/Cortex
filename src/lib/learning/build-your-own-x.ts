/**
 * Build Your Own X — curated tutorial index from
 * https://github.com/codecrafters-io/build-your-own-x
 */
import type { CourseUnit } from "./types";

export const BUILD_YOUR_OWN_X_GITHUB =
  "https://github.com/codecrafters-io/build-your-own-x";
export const BUILD_YOUR_OWN_X_SITE = "https://codecrafters.io";

export function buildYourOwnXUrl(slug: string): string {
  const clean = slug.trim();
  if (!clean) return BUILD_YOUR_OWN_X_GITHUB;
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  if (clean.startsWith("#")) return `${BUILD_YOUR_OWN_X_GITHUB}${clean}`;
  return `${BUILD_YOUR_OWN_X_GITHUB}/${clean.replace(/^\/+/, "")}`;
}

export const BUILD_YOUR_OWN_X_UNITS: CourseUnit[] = [
  {
    id: "index",
    label: "Index",
    title: "The full list",
    description: "Every category lives in the README. Start here, then pick a technology.",
    lessons: [
      { slug: "", title: "GitHub README (all categories)" },
      { slug: "https://codecrafters.io", title: "CodeCrafters interactive tracks" },
    ],
  },
  {
    id: "ai",
    label: "AI",
    title: "AI models & neural nets",
    description: "LLMs, diffusion, RAG, and networks from scratch.",
    lessons: [
      { slug: "#build-your-own-ai-model", title: "Browse AI Model guides" },
      {
        slug: "https://github.com/rasbt/LLMs-from-scratch",
        title: "Python · A Large Language Model (LLM)",
      },
      {
        slug: "https://huggingface.co/learn/diffusion-course/en/unit1/3",
        title: "Python · Diffusion models",
      },
      {
        slug: "https://github.com/langchain-ai/rag-from-scratch",
        title: "Python · RAG for document search",
      },
      { slug: "#build-your-own-neural-network", title: "Browse Neural Network guides" },
      {
        slug: "https://karpathy.ai/zero-to-hero.html",
        title: "Python · Neural Nets: Zero to Hero",
      },
    ],
  },
  {
    id: "systems",
    label: "Systems",
    title: "OS, Docker, databases, Git",
    description: "Kernels, containers, Redis/SQL, and Git internals.",
    lessons: [
      { slug: "#build-your-own-operating-system", title: "Browse OS guides" },
      { slug: "https://os.phil-opp.com/", title: "Rust · Writing an OS in Rust" },
      { slug: "https://littleosbook.github.io/", title: "C · The little book about OS development" },
      { slug: "#build-your-own-docker", title: "Browse Docker guides" },
      {
        slug: "https://blog.lizzie.io/linux-containers-in-500-loc.html",
        title: "C · Linux containers in 500 lines",
      },
      { slug: "#build-your-own-database", title: "Browse Database guides" },
      { slug: "https://cstack.github.io/db_tutorial/", title: "C · Let's Build a Simple Database" },
      { slug: "https://build-your-own.org/redis", title: "C++ · Build Your Own Redis" },
      { slug: "#build-your-own-git", title: "Browse Git guides" },
      { slug: "https://wyag.thb.lt/", title: "Python · Write yourself a Git" },
    ],
  },
  {
    id: "lang",
    label: "Lang",
    title: "Languages, compilers, regex, shells",
    description: "Interpreters, compilers, matchers, and UNIX shells.",
    lessons: [
      { slug: "#build-your-own-programming-language", title: "Browse language guides" },
      { slug: "https://craftinginterpreters.com/", title: "Java · Crafting Interpreters" },
      { slug: "http://www.buildyourownlisp.com/", title: "C · Build Your Own Lisp" },
      { slug: "https://github.com/kanaka/mal", title: "Any · Make a Lisp" },
      { slug: "#build-your-own-regex-engine", title: "Browse regex guides" },
      {
        slug: "https://swtch.com/~rsc/regexp/regexp1.html",
        title: "C · Regular Expression Matching Can Be Simple And Fast",
      },
      { slug: "#build-your-own-shell", title: "Browse shell guides" },
      {
        slug: "https://brennan.io/2015/01/16/write-a-shell-in-c/",
        title: "C · Write a Shell in C",
      },
    ],
  },
  {
    id: "net",
    label: "Net",
    title: "Web, browsers, BitTorrent, blockchain",
    description: "HTTP servers, browsers, peers, and ledgers.",
    lessons: [
      { slug: "#build-your-own-web-server", title: "Browse web server guides" },
      { slug: "https://ruslanspivak.com/lsbaws-part1/", title: "Python · Let's Build A Web Server" },
      { slug: "https://build-your-own.org/webserver/", title: "Node.js · Web server from scratch" },
      { slug: "#build-your-own-web-browser", title: "Browse browser guides" },
      { slug: "https://browser.engineering", title: "Python · Browser Engineering" },
      { slug: "#build-your-own-bittorrent-client", title: "Browse BitTorrent guides" },
      {
        slug: "https://blog.jse.li/posts/torrent/",
        title: "Go · BitTorrent client from the ground up",
      },
      {
        slug: "#build-your-own-blockchain--cryptocurrency",
        title: "Browse blockchain guides",
      },
      {
        slug: "https://hackernoon.com/learn-blockchains-by-building-one-117428612f46",
        title: "Python · Learn Blockchains by Building One",
      },
    ],
  },
  {
    id: "graphics",
    label: "GFX",
    title: "Renderers, games, physics, voxels",
    description: "Ray tracers, engines, and 2D/3D games.",
    lessons: [
      { slug: "#build-your-own-3d-renderer", title: "Browse 3D renderer guides" },
      {
        slug: "https://raytracing.github.io/books/RayTracingInOneWeekend.html",
        title: "C++ · Ray Tracing in One Weekend",
      },
      {
        slug: "https://github.com/ssloy/tinyrenderer/wiki",
        title: "C++ · Tiny Renderer / How OpenGL works",
      },
      { slug: "#build-your-own-game", title: "Browse game guides" },
      { slug: "https://handmadehero.org/", title: "C · Handmade Hero" },
      { slug: "#build-your-own-physics-engine", title: "Browse physics guides" },
      { slug: "#build-your-own-voxel-engine", title: "Browse voxel guides" },
    ],
  },
  {
    id: "more",
    label: "More",
    title: "Editors, search, frameworks, and the rest",
    description: "Text editors, search engines, front-end libraries, emulators, and uncategorized classics.",
    lessons: [
      { slug: "#build-your-own-text-editor", title: "Browse text editor guides" },
      { slug: "https://viewsourcecode.org/snaptoken/kilo/", title: "C · Build Your Own Text Editor" },
      { slug: "#build-your-own-search-engine", title: "Browse search engine guides" },
      { slug: "#build-your-own-front-end-framework--library", title: "Browse front-end guides" },
      { slug: "https://pomb.us/build-your-own-react/", title: "JavaScript · Build your own React" },
      { slug: "#build-your-own-emulator--virtual-machine", title: "Browse emulator guides" },
      { slug: "#build-your-own-command-line-tool", title: "Browse CLI guides" },
      { slug: "#uncategorized", title: "Uncategorized (NAND to Tetris, hash tables, …)" },
      { slug: "https://nand2tetris.org/", title: "Any · From NAND to Tetris" },
    ],
  },
];
