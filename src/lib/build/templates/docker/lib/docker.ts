import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";

const execFileAsync = promisify(execFile);

export type PortMapping = {
  protocol: string;
  containerPort: string;
  hostIp: string;
  hostPort: string;
  /** e.g. 0.0.0.0:5433→5432/tcp */
  display: string;
};

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
  /** Container IPs on Docker networks */
  ips: string[];
  /** Network name → IP */
  networks: Array<{ name: string; ip: string; gateway: string }>;
  /** Published host ↔ container port mappings */
  portMappings: PortMapping[];
  /**
   * Best URL to open in a browser for this container (host-published HTTP-like port).
   * null if none detected.
   */
  launchUrl: string | null;
  /** All candidate launch URLs (http/https on host ports) */
  launchUrls: string[];
  /** Human hints e.g. connection strings for DBs */
  connectionHints: string[];
};

export type DockerInfo = {
  available: boolean;
  error?: string;
  hint?: string;
  version?: string;
  containers: DockerContainer[];
  socket?: string;
};

/** Ports commonly used for web UIs */
const WEB_HOST_PORTS = new Set([
  "80",
  "443",
  "3000",
  "3001",
  "3456",
  "4000",
  "4173",
  "5000",
  "5173",
  "8000",
  "8080",
  "8081",
  "8443",
  "8888",
  "9000",
  "9090",
  "9200",
]);

function dockerEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const pathParts = [
    process.env.PATH || "",
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(home, ".local", "bin"),
  ]
    .join(":")
    .split(":")
    .filter(Boolean);
  const seen = new Set<string>();
  const PATH = pathParts
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
    .join(":");

  const sockets = [
    process.env.DOCKER_HOST,
    `unix://${path.join(home, ".docker", "run", "docker.sock")}`,
    "unix:///var/run/docker.sock",
  ].filter(Boolean) as string[];

  let DOCKER_HOST = process.env.DOCKER_HOST;
  for (const s of sockets) {
    if (s.startsWith("unix://")) {
      const sockPath = s.replace("unix://", "");
      if (fs.existsSync(sockPath)) {
        DOCKER_HOST = s;
        break;
      }
    }
  }

  return { ...process.env, PATH, ...(DOCKER_HOST ? { DOCKER_HOST } : {}) };
}

async function docker(
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("docker", args, {
    timeout: opts.timeout ?? 15000,
    maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
    env: dockerEnv(),
  });
}

type InspectNetwork = {
  IPAddress?: string;
  Gateway?: string;
};

type InspectPortBind = { HostIp?: string; HostPort?: string };

type InspectEntry = {
  Id?: string;
  Name?: string;
  Created?: string;
  State?: { Status?: string; Running?: boolean };
  Config?: { Image?: string };
  NetworkSettings?: {
    Ports?: Record<string, InspectPortBind[] | null>;
    Networks?: Record<string, InspectNetwork>;
    IPAddress?: string;
  };
};

function parsePortMappings(
  ports: Record<string, InspectPortBind[] | null> | undefined,
): PortMapping[] {
  if (!ports) return [];
  const out: PortMapping[] = [];
  for (const [key, binds] of Object.entries(ports)) {
    // key like "5432/tcp"
    const [containerPort, protocol = "tcp"] = key.split("/");
    if (!binds || binds.length === 0) {
      out.push({
        protocol,
        containerPort,
        hostIp: "",
        hostPort: "",
        display: `${containerPort}/${protocol} (not published)`,
      });
      continue;
    }
    for (const b of binds) {
      const hostIp = b.HostIp || "0.0.0.0";
      const hostPort = b.HostPort || "";
      // Skip IPv6 duplicate entries for cleaner UI when IPv4 exists
      if (hostIp === "::") continue;
      out.push({
        protocol,
        containerPort,
        hostIp,
        hostPort,
        display: `${hostIp === "0.0.0.0" ? "localhost" : hostIp}:${hostPort} → ${containerPort}/${protocol}`,
      });
    }
  }
  return out;
}

function isDatabaseImage(image: string): boolean {
  const img = image.toLowerCase();
  return (
    img.includes("postgres") ||
    img.includes("mysql") ||
    img.includes("mariadb") ||
    img.includes("mongo") ||
    img.includes("redis") ||
    img.includes("memcached") ||
    img.includes("rabbitmq") ||
    img.includes("kafka") ||
    img.includes("elasticsearch") ||
    img.includes("clickhouse")
  );
}

function isLikelyWebPort(hostPort: string, containerPort: string): boolean {
  return (
    WEB_HOST_PORTS.has(hostPort) ||
    WEB_HOST_PORTS.has(containerPort) ||
    containerPort === "80" ||
    containerPort === "443"
  );
}

function buildLaunchUrls(
  mappings: PortMapping[],
  image: string,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const db = isDatabaseImage(image);

  const add = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  };

  const sorted = [...mappings].sort((a, b) => {
    const aw = isLikelyWebPort(a.hostPort, a.containerPort) ? 0 : 1;
    const bw = isLikelyWebPort(b.hostPort, b.containerPort) ? 0 : 1;
    return aw - bw;
  });

  for (const m of sorted) {
    if (!m.hostPort || m.protocol !== "tcp") continue;
    // Don't invent browser URLs for DB-style images unless port is clearly HTTP
    if (db && !isLikelyWebPort(m.hostPort, m.containerPort)) continue;

    const host =
      !m.hostIp || m.hostIp === "0.0.0.0" || m.hostIp === "::"
        ? "127.0.0.1"
        : m.hostIp;
    if (m.hostPort === "443" || m.containerPort === "443") {
      add(`https://${host}:${m.hostPort}`);
    } else {
      add(`http://${host}:${m.hostPort}`);
    }
  }
  return urls;
}

function connectionHints(
  image: string,
  mappings: PortMapping[],
): string[] {
  const hints: string[] = [];
  const img = image.toLowerCase();
  for (const m of mappings) {
    if (!m.hostPort) continue;
    const host =
      !m.hostIp || m.hostIp === "0.0.0.0" || m.hostIp === "::"
        ? "127.0.0.1"
        : m.hostIp;
    if (img.includes("postgres") || m.containerPort === "5432") {
      hints.push(`postgresql://${host}:${m.hostPort}`);
    } else if (img.includes("redis") || m.containerPort === "6379") {
      hints.push(`redis://${host}:${m.hostPort}`);
    } else if (img.includes("mongo") || m.containerPort === "27017") {
      hints.push(`mongodb://${host}:${m.hostPort}`);
    } else if (img.includes("mysql") || m.containerPort === "3306") {
      hints.push(`mysql://${host}:${m.hostPort}`);
    }
  }
  return [...new Set(hints)];
}

function enrichFromInspect(raw: InspectEntry): DockerContainer {
  const id = (raw.Id || "").slice(0, 12);
  const name = (raw.Name || "").replace(/^\//, "");
  const image = raw.Config?.Image || "";
  const state = raw.State?.Status || "unknown";
  const status = raw.State?.Running
    ? `Up`
    : raw.State?.Status || "unknown";

  const networks: DockerContainer["networks"] = [];
  const ips: string[] = [];
  const nets = raw.NetworkSettings?.Networks || {};
  for (const [netName, net] of Object.entries(nets)) {
    const ip = net.IPAddress || "";
    if (ip) ips.push(ip);
    networks.push({
      name: netName,
      ip: ip || "—",
      gateway: net.Gateway || "—",
    });
  }
  // Legacy top-level IP
  if (raw.NetworkSettings?.IPAddress && !ips.includes(raw.NetworkSettings.IPAddress)) {
    ips.unshift(raw.NetworkSettings.IPAddress);
  }

  const portMappings = parsePortMappings(raw.NetworkSettings?.Ports);
  const launchUrls = buildLaunchUrls(portMappings, image);
  const launchUrl = launchUrls[0] || null;

  const portsDisplay =
    portMappings
      .filter((p) => p.hostPort)
      .map((p) => p.display)
      .join(", ") || "none published";

  return {
    id,
    name,
    image,
    status: raw.State?.Status || status,
    state,
    ports: portsDisplay,
    created: raw.Created || "",
    ips,
    networks,
    portMappings,
    launchUrl,
    launchUrls,
    connectionHints: connectionHints(image, portMappings),
  };
}

export async function listContainers(): Promise<DockerInfo> {
  try {
    await docker(["version", "--format", "{{.Client.Version}}"], {
      timeout: 5000,
    });
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : String(e),
      hint: "Install Docker Desktop and ensure `docker` is on your PATH.",
      containers: [],
    };
  }

  try {
    const { stdout: versionOut } = await docker(
      ["version", "--format", "{{.Server.Version}}"],
      { timeout: 8000 },
    );

    const { stdout: idsOut } = await docker(["ps", "-aq"], { timeout: 15000 });
    const ids = idsOut.trim().split("\n").filter(Boolean);

    if (ids.length === 0) {
      return {
        available: true,
        version: versionOut.trim(),
        containers: [],
      };
    }

    const { stdout: inspectOut } = await docker(["inspect", ...ids], {
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
    });

    const inspected = JSON.parse(inspectOut) as InspectEntry[];
    const containers = inspected.map(enrichFromInspect);

    // Sort: running first, then name
    containers.sort((a, b) => {
      if (a.state === "running" && b.state !== "running") return -1;
      if (b.state === "running" && a.state !== "running") return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      available: true,
      version: versionOut.trim(),
      containers,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const daemonDown =
      msg.includes("Cannot connect to the Docker daemon") ||
      msg.includes("Is the docker daemon running") ||
      msg.includes("docker.sock");

    return {
      available: false,
      error: msg,
      hint: daemonDown
        ? "Docker Desktop is installed but not running. Open Docker Desktop, wait until it says “Engine running”, then click Refresh."
        : "Check Docker Desktop and try again.",
      containers: [],
    };
  }
}

export async function inspectContainer(id: string): Promise<string> {
  const { stdout } = await docker(["inspect", id], { timeout: 15000 });
  return stdout;
}

export async function containerLogs(id: string, tail = 200): Promise<string> {
  const { stdout, stderr } = await docker(
    ["logs", "--tail", String(tail), id],
    { timeout: 20000 },
  );
  return stdout || stderr;
}

export async function startContainer(id: string): Promise<string> {
  const { stdout, stderr } = await docker(["start", id], { timeout: 60000 });
  return (stdout || stderr).trim();
}

export async function stopContainer(id: string): Promise<string> {
  const { stdout, stderr } = await docker(["stop", id], { timeout: 60000 });
  return (stdout || stderr).trim();
}

export async function restartContainer(id: string): Promise<string> {
  const { stdout, stderr } = await docker(["restart", id], { timeout: 60000 });
  return (stdout || stderr).trim();
}

/** macOS: open Docker Desktop app */
export async function openDockerDesktop(): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", ["-a", "Docker"]);
  }
}
