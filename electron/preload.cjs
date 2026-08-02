/**
 * Preload bridge — exposes a small, safe desktop API to the renderer.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("cortexDesktop", {
  isDesktop: true,
  platform: process.platform,
});
