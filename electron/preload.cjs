/**
 * Preload bridge — exposes a small, safe desktop API to the renderer.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cortexDesktop", {
  isDesktop: true,
  platform: process.platform,

  /**
   * Navigate the main Cortex window to an agent terminal route
   * (stays inside the app — no separate OS terminal / no popup window).
   */
  openAgentTerminal: (opts) =>
    ipcRenderer.invoke("agents:open-terminal", opts),

  /**
   * Open a local project URL in Cortex's in-app browser preview window.
   * Used during build/test so runtime UI errors are visible.
   */
  openBrowserPreview: (opts) =>
    ipcRenderer.invoke("browser:open-preview", opts),

  closeBrowserPreview: () => ipcRenderer.invoke("browser:close-preview"),

  /** True when main-process PTY host is available */
  hasPty: true,

  pty: {
    start: (opts) => ipcRenderer.invoke("pty:start", opts),
    write: (id, data) => ipcRenderer.invoke("pty:write", { id, data }),
    resize: (id, cols, rows) =>
      ipcRenderer.invoke("pty:resize", { id, cols, rows }),
    kill: (id) => ipcRenderer.invoke("pty:kill", { id }),
    onEvent: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("pty:event", handler);
      return () => ipcRenderer.removeListener("pty:event", handler);
    },
  },
});
