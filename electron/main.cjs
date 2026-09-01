/**
 * Cortex desktop shell (Electron)
 * Single dock icon — server runs in-process (no second Electron/"exec" process).
 */
const {
  app,
  BrowserWindow,
  Menu,
  shell,
  dialog,
  session,
  systemPreferences,
  ipcMain,
} = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const Module = require("module");

const isDev = !app.isPackaged;
const DEV_URL = process.env.CORTEX_URL || "http://127.0.0.1:3000";

/** Fixed loopback port for packaged app (local-only). */
const PROD_PORT = Number(process.env.CORTEX_PORT || 47832);

const ptyHost = require("./pty-host.cjs");

// Dev must not share userData lock with /Applications/Cortex.app
if (isDev) {
  const { join } = require("path");
  app.setPath("userData", join(app.getPath("appData"), "cortex-dev"));
}

/**
 * Load KEY=value pairs from a file into process.env (does not override existing).
 * Used so TAVILY_API_KEY etc. work in packaged Electron without baking secrets
 * into the DMG.
 */
function loadEnvFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (e) {
    console.warn("[cortex] loadEnvFile failed", filePath, e);
  }
}

function loadCortexEnv() {
  // Project root (dev / next) — Next also loads .env.local itself
  const projectRoot = path.join(__dirname, "..");
  loadEnvFile(path.join(projectRoot, ".env"));
  loadEnvFile(path.join(projectRoot, ".env.local"));
  // User-level secrets for packaged app
  try {
    const userData = app.getPath("userData");
    loadEnvFile(path.join(userData, ".env"));
    loadEnvFile(path.join(userData, "cortex.env"));
  } catch {
    /* app not ready */
  }
}

let mainWindow = null;
/** Dedicated window for viewing generated project apps during build/test */
let previewWindow = null;
let stopping = false;
/** Base URL of the local Next server (set after resolveServerUrl). */
let serverBaseUrl = DEV_URL;

/**
 * Open (or focus) an in-app browser window for a local project URL.
 * Used during build/test so agents and users can see live runtime errors.
 */
function openProjectBrowserPreview(opts = {}) {
  const rawUrl = String(opts.url || "").trim();
  if (!rawUrl) {
    return { ok: false, detail: "Missing url" };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, detail: "Invalid url" };
  }
  // Only allow loopback previews inside Cortex (security)
  if (
    parsed.hostname !== "127.0.0.1" &&
    parsed.hostname !== "localhost"
  ) {
    shell.openExternal(rawUrl);
    return {
      ok: true,
      detail: "Opened external URL in system browser",
      external: true,
    };
  }

  const title = String(opts.title || "App preview — Cortex");
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.setTitle(title);
    previewWindow.loadURL(rawUrl);
    previewWindow.focus();
    return { ok: true, detail: "Refreshed in-app browser preview", url: rawUrl };
  }

  previewWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    title,
    backgroundColor: "#0a0a0f",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Allow local apps to use modern web APIs while previewing
      webSecurity: true,
    },
  });

  previewWindow.once("ready-to-show", () => {
    previewWindow?.show();
  });

  // Surface console errors from the previewed app into main process logs
  // (helps diagnose build/test failures when headed inspection is used).
  previewWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      console.warn(
        `[cortex-preview console L${level}] ${message} (${sourceId}:${line})`,
      );
    }
  });
  previewWindow.webContents.on("did-fail-load", (_e, code, desc, validatedURL) => {
    console.warn(`[cortex-preview load fail] ${code} ${desc} ${validatedURL}`);
  });

  previewWindow.on("closed", () => {
    previewWindow = null;
  });

  previewWindow.loadURL(rawUrl);
  return { ok: true, detail: "Opened in-app browser preview", url: rawUrl };
}

function isLocalAppUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "127.0.0.1" || u.hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Open agent terminal inside the main Cortex window (same shell — not a popup,
 * not macOS Terminal.app).
 */
function openAgentTerminalInMain({ agent, title, url }) {
  if (!agent) {
    return { ok: false, detail: "Missing agent id" };
  }
  let target = String(url || "").trim();
  if (!target) {
    if (!serverBaseUrl) {
      return { ok: false, detail: "Server not ready" };
    }
    target = `${serverBaseUrl}/agents/terminal?agent=${encodeURIComponent(agent)}`;
  }
  if (!isLocalAppUrl(target)) {
    return { ok: false, detail: "Invalid agent terminal URL" };
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, detail: "Main window not available" };
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();

  // Prefer soft client navigation (keeps SPA shell); fall back to loadURL.
  mainWindow.webContents
    .executeJavaScript(
      `(() => {
        try {
          const path = ${JSON.stringify(
            `/agents/terminal?agent=${encodeURIComponent(agent)}`,
          )};
          if (window.next && window.next.router) {
            window.next.router.push(path);
            return "router";
          }
          // App Router: use history + soft navigation event if available
          if (typeof window !== "undefined") {
            window.history.pushState({}, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
            // Hard navigation is more reliable across Next versions
            window.location.assign(path);
            return "assign";
          }
        } catch (e) {
          return "fail:" + (e && e.message ? e.message : String(e));
        }
        return "none";
      })()`,
    )
    .then((how) => {
      if (how === "none" || (typeof how === "string" && how.startsWith("fail"))) {
        mainWindow.loadURL(target).catch((err) => {
          console.error("[cortex] agent terminal navigate failed", err);
        });
      }
    })
    .catch(() => {
      mainWindow.loadURL(target).catch((err) => {
        console.error("[cortex] agent terminal loadURL failed", err);
      });
    });

  if (title) {
    mainWindow.setTitle(`${title} — Cortex`);
  }

  return { ok: true, detail: "Opened agent terminal in Cortex" };
}

function registerIpc() {
  ipcMain.handle("agents:open-terminal", (_event, opts = {}) => {
    try {
      const agent = String(opts.agent || "").trim();
      const title = String(opts.title || agent || "Agent");
      let url = String(opts.url || "").trim();
      if (!url && agent && serverBaseUrl) {
        url = `${serverBaseUrl}/agents/terminal?agent=${encodeURIComponent(agent)}`;
      }
      return openAgentTerminalInMain({ agent, title, url });
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  });

  // --- Main-process PTY (avoids Turbopack/standalone node-pty breakage) ---
  ipcMain.handle("pty:start", (event, opts = {}) => {
    const wc = event.sender;
    const emit = (payload) => {
      if (!wc.isDestroyed()) {
        wc.send("pty:event", payload);
      }
    };
    try {
      return ptyHost.createSession(
        {
          agent: String(opts.agent || "").trim(),
          cols: Number(opts.cols) || 120,
          rows: Number(opts.rows) || 36,
          cwd: opts.cwd ? String(opts.cwd) : undefined,
          // Fleet governance resolved by the Cortex server; re-validated in
          // pty-host before it reaches a spawn.
          extraArgs: Array.isArray(opts.extraArgs) ? opts.extraArgs : [],
          unsetEnv: Array.isArray(opts.unsetEnv) ? opts.unsetEnv : [],
        },
        emit,
      );
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.handle("pty:write", (_event, opts = {}) => {
    const ok = ptyHost.write(String(opts.id || ""), String(opts.data ?? ""));
    return { ok };
  });

  ipcMain.handle("pty:resize", (_event, opts = {}) => {
    const ok = ptyHost.resize(
      String(opts.id || ""),
      Number(opts.cols) || 80,
      Number(opts.rows) || 24,
    );
    return { ok };
  });

  ipcMain.handle("pty:kill", (_event, opts = {}) => {
    const ok = ptyHost.kill(String(opts.id || ""));
    return { ok };
  });

  // In-app browser for project apps (build/test visibility)
  ipcMain.handle("browser:open-preview", (_event, opts = {}) => {
    try {
      return openProjectBrowserPreview(opts);
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.handle("browser:close-preview", () => {
    try {
      if (previewWindow && !previewWindow.isDestroyed()) {
        previewWindow.close();
      }
      previewWindow = null;
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  });
}

function setDataDir() {
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.CORTEX_DATA_DIR = dataDir;
  return dataDir;
}

function waitForUrl(url, { timeoutMs = 90000, intervalMs = 300 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (stopping) {
        reject(new Error("App is quitting"));
        return;
      }
      const req = http.get(url, (res) => {
        res.resume();
        resolve(url);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for local server at ${url}.\n` +
                `Check that standalone/node_modules was packaged correctly.`,
            ),
          );
          return;
        }
        setTimeout(tick, intervalMs);
      });
    };
    tick();
  });
}

function findStandaloneDir() {
  const appPath = app.getAppPath();
  const resources = process.resourcesPath;
  const candidates = [
    path.join(resources, "standalone"),
    path.join(appPath, "desktop-runtime"),
    path.join(appPath, ".next", "standalone"),
    path.join(appPath, "standalone"),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, "server.js")));
}

/**
 * Start Next standalone in this process so macOS shows only one dock icon.
 * Spawning process.execPath (even with ELECTRON_RUN_AS_NODE) creates a second
 * "exec" dock entry on macOS.
 */
async function startProductionServer() {
  const standaloneDir = findStandaloneDir();
  if (!standaloneDir) {
    throw new Error(
      "Could not find standalone server.js in app resources.\n" +
        `resourcesPath=${process.resourcesPath}`,
    );
  }

  const nextModule = path.join(standaloneDir, "node_modules", "next");
  if (!fs.existsSync(nextModule)) {
    throw new Error(
      `Missing Next.js runtime at:\n${nextModule}\n\n` +
        "Reinstall Cortex from a freshly built DMG (v0.1.1+).",
    );
  }

  const dataDir =
    process.env.CORTEX_DATA_DIR || path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  // Resolve `next` (and peers) from the standalone bundle, not app.asar
  const nm = path.join(standaloneDir, "node_modules");
  process.env.NODE_PATH = [nm, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  Module._initPaths();

  process.chdir(standaloneDir);
  process.env.PORT = String(PROD_PORT);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.CORTEX_DATA_DIR = dataDir;
  process.env.NODE_ENV = "production";

  // Secrets for live search etc. (userData + optional packaged .env)
  loadCortexEnv();
  loadEnvFile(path.join(standaloneDir, ".env"));
  loadEnvFile(path.join(standaloneDir, ".env.local"));

  // server.js calls startServer() and begins listening
  require(path.join(standaloneDir, "server.js"));

  const url = `http://127.0.0.1:${PROD_PORT}`;
  await waitForUrl(url);
  return url;
}

async function resolveServerUrl() {
  if (isDev) {
    await waitForUrl(DEV_URL, { timeoutMs: 120000 });
    return DEV_URL;
  }
  return startProductionServer();
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.webContents.reload(),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          label: "Toggle Developer Tools",
          accelerator: isMac ? "Alt+Command+I" : "Ctrl+Shift+I",
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open data folder",
          click: () => {
            const dir = process.env.CORTEX_DATA_DIR || app.getPath("userData");
            shell.openPath(dir);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(serverUrl) {
  // Do NOT call app.dock.setIcon() with a raw PNG — it produces a square,
  // unmasked dock tile next to the proper .icns icon from Info.plist.
  // Let macOS use CFBundleIconFile (icon.icns) for correct rounded Dock treatment.

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: "Cortex — Agentic OS",
    backgroundColor: "#07090f",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost")
    ) {
      // Prefer dedicated preview window so build/test apps are easy to watch
      try {
        openProjectBrowserPreview({ url, title: "Local app — Cortex" });
        return { action: "deny" };
      } catch {
        return { action: "allow" };
      }
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(serverUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Single instance for packaged app only (dev uses separate userData + allows restarts)
const gotLock = isDev ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  if (!isDev) {
    app.on("second-instance", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }

  app.whenReady().then(async () => {
    try {
      // Ensure dock uses bundle icon, not a runtime override
      if (process.platform === "darwin") {
        app.dock?.show();
      }

      // macOS: request mic access early so built-in voice-to-text works.
      // Chromium Web Speech fails in Electron (`network`); we use MediaRecorder instead.
      if (process.platform === "darwin") {
        try {
          const status = systemPreferences.getMediaAccessStatus("microphone");
          if (status !== "granted") {
            await systemPreferences.askForMediaAccess("microphone");
          }
        } catch (e) {
          console.warn("Microphone permission request failed", e);
        }
      }

      // Permissions for voice STT + local app previews during build/test.
      // Localhost project apps may request clipboard, notifications, etc.
      const allowPerm = (permission) =>
        permission === "media" ||
        permission === "microphone" ||
        permission === "mediaKeySystem" ||
        permission === "display-capture" ||
        permission === "clipboard-read" ||
        permission === "clipboard-sanitized-write" ||
        permission === "notifications" ||
        permission === "fullscreen" ||
        permission === "pointerLock" ||
        permission === "openExternal" ||
        permission === "storage-access" ||
        permission === "window-management";

      session.defaultSession.setPermissionRequestHandler(
        (wc, permission, callback, details) => {
          const requestingUrl = String(details?.requestingUrl || "");
          const isLocal =
            requestingUrl.includes("127.0.0.1") ||
            requestingUrl.includes("localhost") ||
            (() => {
              try {
                const u = new URL(wc.getURL());
                return u.hostname === "127.0.0.1" || u.hostname === "localhost";
              } catch {
                return false;
              }
            })();

          if (allowPerm(permission) || (isLocal && permission !== "geolocation")) {
            callback(true);
            return;
          }
          callback(false);
        },
      );
      session.defaultSession.setPermissionCheckHandler(
        (wc, permission) => {
          if (allowPerm(permission)) return true;
          try {
            const u = new URL(wc?.getURL?.() || "");
            if (
              (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
              permission !== "geolocation"
            ) {
              return true;
            }
          } catch {
            /* ignore */
          }
          return false;
        },
      );

      // Allow Cortex + localhost project apps to open popups/windows
      session.defaultSession.setDevicePermissionHandler(() => true);

      setDataDir();
      buildMenu();
      app.setName("Cortex");
      registerIpc();

      const serverUrl = await resolveServerUrl();
      serverBaseUrl = serverUrl;
      await createWindow(serverUrl);

      app.on("activate", async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          await createWindow(serverUrl);
        }
      });
    } catch (err) {
      console.error(err);
      dialog.showErrorBox(
        "Cortex failed to start",
        err instanceof Error ? err.message : String(err),
      );
      app.quit();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopping = true;
  try {
    ptyHost.killAll();
  } catch {
    /* ignore */
  }
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    try {
      const u = new URL(url);
      if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });
});
