import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  APP_DIR,
  MARKET_RUNS,
  PRICES_PATH,
  WATCHLIST_TICKERS_PATH,
  loadTickers,
  parseArgs,
  readExistingPrices,
  runImport,
  scheduledRunsAfter,
} from "./price_auto_import.mjs";

const DEFAULT_PORT = 47821;
const HOST = "127.0.0.1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const appState = {
  runningImport: false,
  lastRun: null,
  lastError: null,
  nextRun: null,
  startedAt: new Date().toISOString(),
};

function isCliEntry() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function textResponse(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Pedido demasiado grande.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function normalizeTicker(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9.-]{1,12}$/.test(ticker) ? ticker : "";
}

function normalizeTickers(values) {
  return [...new Set((values || []).map(normalizeTicker).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function readWatchlistTickers() {
  try {
    const text = await fs.readFile(WATCHLIST_TICKERS_PATH, "utf8");
    return normalizeTickers(text.replace(/#.*/g, "").split(/[,\s;]+/));
  } catch {
    return [];
  }
}

async function writeWatchlistTickers(tickers) {
  const normalized = normalizeTickers(tickers);
  const lines = [
    "# Updated by the SimpleEquity desktop app.",
    "# Extra watchlist tickers for the automatic importer.",
    ...normalized,
    "",
  ];
  await fs.mkdir(path.dirname(WATCHLIST_TICKERS_PATH), { recursive: true });
  await fs.writeFile(WATCHLIST_TICKERS_PATH, lines.join("\n"), "utf8");
  return normalized;
}

function nextRunPayload(now = new Date()) {
  const next = scheduledRunsAfter(now)[0] || null;
  if (!next) return null;
  return {
    slot: next.slot,
    label: MARKET_RUNS[next.slot]?.label || next.slot,
    at: next.when.toISOString(),
    local: next.when.toLocaleString("pt-PT"),
  };
}

async function statusPayload() {
  const prices = await readExistingPrices();
  const watchlistTickers = await readWatchlistTickers();
  let allTickers = [];
  try {
    allTickers = await loadTickers({});
  } catch {}
  return {
    ok: true,
    startedAt: appState.startedAt,
    runningImport: appState.runningImport,
    lastRun: appState.lastRun,
    lastError: appState.lastError,
    nextRun: appState.nextRun || nextRunPayload(),
    watchlistTickers,
    totalTickers: allTickers.length,
    pricesMeta: prices.meta || null,
  };
}

async function runAppImport(options = {}) {
  if (appState.runningImport) {
    const error = new Error("Ja existe uma importacao em curso.");
    error.status = 409;
    throw error;
  }
  appState.runningImport = true;
  appState.lastError = null;
  try {
    const args = {
      provider: options.provider || "auto",
      slot: options.slot || "auto",
      "delay-ms": options.delayMs ?? 600,
    };
    if (options.tickers?.length) args.tickers = normalizeTickers(options.tickers).join(",");
    if (options.only) args.only = true;
    const meta = await runImport(args, options.forcedSlot || "");
    appState.lastRun = meta;
    return meta;
  } catch (error) {
    appState.lastError = {
      at: new Date().toISOString(),
      message: String(error.message || error),
    };
    throw error;
  } finally {
    appState.runningImport = false;
  }
}

function scheduleImports() {
  const next = nextRunPayload();
  appState.nextRun = next;
  if (!next) return;
  const delay = Math.max(1000, new Date(next.at).getTime() - Date.now());
  console.log(`Proximo import: ${next.label} em ${next.local}`);
  setTimeout(async () => {
    try {
      await runAppImport({ provider: "auto", forcedSlot: next.slot });
    } catch (error) {
      console.error(`Import ${next.slot} falhou:`, error.message || error);
    } finally {
      scheduleImports();
    }
  }, delay);
}

async function serveStatic(req, res, url) {
  const requestPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const target = path.normalize(path.join(APP_DIR, requestPath.replace(/^\/+/, "")));
  const relative = path.relative(APP_DIR, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    textResponse(res, 403, "Forbidden");
    return;
  }
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      textResponse(res, 403, "Forbidden");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "no-cache",
    });
    res.end(await fs.readFile(target));
  } catch {
    textResponse(res, 404, "Not found");
  }
}

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${HOST}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    jsonResponse(res, 200, await statusPayload());
    return;
  }

  if (url.pathname === "/api/watchlist-tickers" && req.method === "GET") {
    jsonResponse(res, 200, { tickers: await readWatchlistTickers() });
    return;
  }

  if (url.pathname === "/api/watchlist-tickers" && req.method === "POST") {
    const body = await readJsonBody(req);
    const tickers = await writeWatchlistTickers(body.tickers || []);
    jsonResponse(res, 200, { ok: true, tickers });
    return;
  }

  if (url.pathname === "/api/import-prices" && req.method === "POST") {
    const body = await readJsonBody(req);
    const meta = await runAppImport({
      slot: body.slot || "auto",
      provider: body.provider || "auto",
      tickers: body.tickers || [],
      only: Boolean(body.only),
      delayMs: body.delayMs ?? 600,
    });
    jsonResponse(res, 200, { ok: true, meta });
    return;
  }

  if (url.pathname === "/api/prices" && req.method === "GET") {
    jsonResponse(res, 200, await readExistingPrices());
    return;
  }

  await serveStatic(req, res, url);
}

function createServer() {
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      const status = error.status || 500;
      jsonResponse(res, status, { ok: false, error: String(error.message || error) });
    });
  });
}

async function listen(server, preferredPort) {
  let port = Number(preferredPort) || DEFAULT_PORT;
  for (;;) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen(port, HOST, () => {
          server.off("error", onError);
          resolve();
        });
      });
      return server.address().port;
    } catch (error) {
      server.removeAllListeners("error");
      if (error.code !== "EADDRINUSE") throw error;
      port += 1;
    }
  }
}

function edgeCandidates() {
  const roots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);
  return roots.map((root) => path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
}

async function findEdge() {
  for (const candidate of edgeCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return "";
}

async function openAppWindow(url) {
  const edge = await findEdge();
  if (edge) {
    const child = spawn(edge, [`--app=${url}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return;
  }
  const child = spawn("cmd", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function startApp(options = {}) {
  const server = createServer();
  const port = await listen(server, options.port || DEFAULT_PORT);
  const url = `http://${HOST}:${port}/index.html`;
  console.log(`SimpleEquity: ${url}`);
  console.log(`Prices: ${PRICES_PATH}`);
  if (options.schedule !== false) scheduleImports();
  if (options.open !== false) await openAppWindow(url);
  return { server, port, url };
}

async function smokeTest() {
  const { server, url } = await startApp({ port: 0, open: false, schedule: false });
  try {
    const index = await fetch(url);
    const status = await fetch(`${url.replace(/\/index\.html$/, "")}/api/status`);
    if (!index.ok || !status.ok) throw new Error(`Smoke test falhou: index ${index.status}, status ${status.status}`);
    const payload = await status.json();
    console.log(JSON.stringify({ ok: true, totalTickers: payload.totalTickers, url }, null, 2));
  } finally {
    server.close();
  }
}

export {
  appState,
  createServer,
  readWatchlistTickers,
  runAppImport,
  smokeTest,
  startApp,
  statusPayload,
  writeWatchlistTickers,
};

if (isCliEntry()) {
  const args = parseArgs(process.argv.slice(2));
  if (args["smoke-test"]) {
    await smokeTest();
  } else {
    await startApp({
      port: args.port || DEFAULT_PORT,
      open: args.open !== false && !args["no-open"],
      schedule: args.schedule !== false && !args["no-schedule"],
    });
  }
}
