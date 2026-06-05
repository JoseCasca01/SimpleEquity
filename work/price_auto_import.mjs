import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(ROOT_DIR, "outputs", "portfolio-app");
const DATA_PATH = path.join(APP_DIR, "data.js");
const PRICES_PATH = path.join(APP_DIR, "prices-data.js");
const WATCHLIST_TICKERS_PATH = path.join(ROOT_DIR, "work", "watchlist-tickers.txt");
const NEW_YORK_TZ = "America/New_York";

const MARKET_RUNS = {
  open: { label: "Abertura", hour: 9, minute: 45 },
  close: { label: "Fecho", hour: 16, minute: 15 },
};

const MARKETBEAT_EXCHANGES = ["NASDAQ", "NYSE", "NYSEARCA", "AMEX"];

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const clean = item.slice(2);
    const eqIndex = clean.indexOf("=");
    if (eqIndex >= 0) {
      args[clean.slice(0, eqIndex)] = clean.slice(eqIndex + 1);
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[clean] = argv[index + 1];
      index += 1;
    } else {
      args[clean] = true;
    }
  }
  return args;
}

function usage() {
  return [
    "Uso:",
    "  node work/price_auto_import.mjs --once --slot open",
    "  node work/price_auto_import.mjs --once --slot close --tickers MSFT,NVDA",
    "  node work/price_auto_import.mjs --watch",
    "",
    "Opcoes:",
    "  --provider auto|stockanalysis|marketbeat  Fonte preferida (default: auto)",
    "  --slot auto|open|close                  Momento do historico (default: auto)",
    "  --tickers MSFT,NVDA                    Tickers extra, por virgula",
    "  --only                                Usa apenas os tickers indicados",
    "  --watchlist-file caminho.txt           Ficheiro de tickers extra",
    "  --delay-ms 600                         Pausa entre pedidos",
  ].join("\n");
}

function readWindowAssignment(code, key, filename) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context, { filename });
  return context.window[key] || {};
}

async function readPortfolioData() {
  const code = await fs.readFile(DATA_PATH, "utf8");
  return readWindowAssignment(code, "PORTFOLIO_DATA", DATA_PATH);
}

async function readExistingPrices() {
  try {
    const code = await fs.readFile(PRICES_PATH, "utf8");
    return readWindowAssignment(code, "PORTFOLIO_PRICE_IMPORTS", PRICES_PATH);
  } catch {
    return { prices: [], updates: [], errors: [] };
  }
}

function isCliEntry() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

function normalizeTicker(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9.-]{1,12}$/.test(ticker) ? ticker : "";
}

function collectPortfolioTickers(data) {
  const tickers = new Set();
  for (const row of data.holdings || []) {
    if ((Number(row.shares) > 0 || Number(row.value) > 0) && normalizeTicker(row.ticker)) {
      tickers.add(normalizeTicker(row.ticker));
    }
  }
  for (const row of data.investments || []) {
    if (String(row.status || "").toLowerCase() !== "fechada" && normalizeTicker(row.ticker)) {
      tickers.add(normalizeTicker(row.ticker));
    }
  }
  return tickers;
}

function parseTickerList(value) {
  return String(value || "")
    .split(/[,\s;]+/)
    .map(normalizeTicker)
    .filter(Boolean);
}

async function readTickerFile(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parseTickerList(
      text
        .split(/\r?\n/)
        .map((line) => line.replace(/#.*/, ""))
        .join("\n"),
    );
  } catch {
    return [];
  }
}

function parseNumber(value) {
  let text = String(value || "").trim();
  if (!text) return NaN;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  text = text
    .replace(/[()]/g, "")
    .replace(/[^\d,.\-]/g, "")
    .replace(/^-/, "");
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma > -1 && dot > -1) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma > -1) {
    text = text.replace(",", ".");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : NaN;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanHtml(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
    },
  });
  const html = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.url = url;
    throw error;
  }
  return html;
}

function parseStockAnalysisHtml(ticker, html, url) {
  const marker = `: ${ticker} `;
  const markerIndex = html.toUpperCase().indexOf(marker.toUpperCase());
  const area = markerIndex >= 0 ? html.slice(markerIndex, markerIndex + 9000) : html.slice(0, 70000);
  const priceMatch = area.match(/<div[^>]*class="[^"]*text-4xl[^"]*"[^>]*>\s*([0-9][0-9,.]*)\s*<\/div>/i);
  const price = parseNumber(priceMatch?.[1]);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Preco nao encontrado no StockAnalysis");

  const h1 = cleanHtml(html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1] || ticker);
  const name = h1.replace(new RegExp(`\\s*\\(${ticker}\\)\\s*$`, "i"), "").trim() || ticker;
  const exchangeLine = cleanHtml(html.match(/<div[^>]*class="[^"]*text-tiny[^"]*"[^>]*>(.*?)<\/div>/i)?.[1] || "");
  const timestamp = cleanHtml(area.match(/<div[^>]*class="[^"]*text-faded[^"]*"[^>]*>(.*?)<\/div>/i)?.[1] || "");

  return {
    ticker,
    price,
    provider: "StockAnalysis",
    source: "StockAnalysis automatico",
    name,
    exchange: exchangeLine.split(":")[0] || "",
    timestamp,
    url,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchStockAnalysisPrice(ticker) {
  const paths = [`stocks/${ticker.toLowerCase()}`, `etf/${ticker.toLowerCase()}`];
  const errors = [];
  for (const item of paths) {
    const url = `https://stockanalysis.com/${item}/`;
    try {
      const html = await fetchText(url);
      return parseStockAnalysisHtml(ticker, html, url);
    } catch (error) {
      errors.push(`${url}: ${error.message || error}`);
    }
  }
  throw new Error(errors.join(" | "));
}

function parseMarketBeatHtml(ticker, html, url, exchange) {
  const priceMatch =
    html.match(/<strong[^>]*font-size\s*:\s*1\.7em[^>]*>\s*\$([0-9][0-9,.]*)\s*<\/strong>/i) ||
    html.match(/<strong[^>]*>\s*\$([0-9][0-9,.]*)\s*<\/strong>\s*<strong[^>]*>\s*[+\-]/i);
  const price = parseNumber(priceMatch?.[1]);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Preco nao encontrado no MarketBeat");

  const title = cleanHtml(html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || ticker);
  const name = title.split("(")[0].trim() || ticker;
  const timestamp = cleanHtml(html.match(/<div class="price-updated">\s*([^<]+)/i)?.[1] || "");
  return {
    ticker,
    price,
    provider: "MarketBeat",
    source: "MarketBeat automatico",
    name,
    exchange,
    timestamp,
    url,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchMarketBeatPrice(ticker) {
  const errors = [];
  for (const exchange of MARKETBEAT_EXCHANGES) {
    const url = `https://www.marketbeat.com/stocks/${exchange}/${ticker}/`;
    try {
      const html = await fetchText(url);
      return parseMarketBeatHtml(ticker, html, url, exchange);
    } catch (error) {
      errors.push(`${exchange}: ${error.message || error}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function fetchPrice(ticker, provider) {
  if (provider === "stockanalysis") return fetchStockAnalysisPrice(ticker);
  if (provider === "marketbeat") return fetchMarketBeatPrice(ticker);
  try {
    return await fetchStockAnalysisPrice(ticker);
  } catch (stockAnalysisError) {
    try {
      return await fetchMarketBeatPrice(ticker);
    } catch (marketBeatError) {
      throw new Error(`StockAnalysis: ${stockAnalysisError.message}; MarketBeat: ${marketBeatError.message}`);
    }
  }
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dedupeByTicker(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const ticker = normalizeTicker(row.ticker);
    const price = parseNumber(row.price);
    if (ticker && Number.isFinite(price) && price > 0) map.set(ticker, { ...row, ticker, price });
  }
  return [...map.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function dedupeUpdates(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row?.date || !row?.slot) continue;
    const key = `${row.date}:${row.slot}`;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()].slice(0, 30);
}

function providerLabel(provider) {
  if (provider === "stockanalysis") return "StockAnalysis";
  if (provider === "marketbeat") return "MarketBeat";
  return "StockAnalysis/MarketBeat";
}

async function writePricesFile({ rows, errors, slot, provider, previous }) {
  const previousRows = dedupeByTicker(previous.prices || []);
  const previousMap = new Map(previousRows.map((row) => [row.ticker, row]));
  let updated = 0;
  for (const row of rows) {
    if (previousMap.get(row.ticker)?.price !== row.price) updated += 1;
    previousMap.set(row.ticker, row);
  }
  const completedAt = new Date().toISOString();
  const label = providerLabel(provider);
  const meta = {
    provider: label,
    source: `${label} automatico`,
    attemptedAt: completedAt,
    completedAt,
    date: localIsoDate(new Date()),
    slot,
    rows: rows.length,
    imported: rows.length,
    updated,
    tickers: rows.map((row) => row.ticker),
    errors,
  };
  const payload = {
    meta,
    prices: [...previousMap.values()].sort((a, b) => a.ticker.localeCompare(b.ticker)),
    updates: dedupeUpdates([meta, ...(previous.updates || [])]),
    errors,
  };
  await fs.writeFile(PRICES_PATH, `window.PORTFOLIO_PRICE_IMPORTS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
  return meta;
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function zonedTimeToDate(parts, timeZone) {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  const guessDate = new Date(guess);
  const actual = zonedParts(guessDate, timeZone);
  const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second || 0);
  return new Date(guess - (actualAsUtc - guess));
}

function datePartsFromUtcDay(baseDate, offsetDays) {
  const date = new Date(Date.UTC(baseDate.year, baseDate.month - 1, baseDate.day + offsetDays));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    dayOfWeek: date.getUTCDay(),
  };
}

function scheduledRunsAfter(now = new Date()) {
  const todayNy = zonedParts(now, NEW_YORK_TZ);
  const runs = [];
  for (let offset = 0; offset < 10; offset += 1) {
    const day = datePartsFromUtcDay(todayNy, offset);
    if (day.dayOfWeek === 0 || day.dayOfWeek === 6) continue;
    for (const [slot, run] of Object.entries(MARKET_RUNS)) {
      const when = zonedTimeToDate({ ...day, hour: run.hour, minute: run.minute, second: 0 }, NEW_YORK_TZ);
      if (when > now) runs.push({ slot, when });
    }
  }
  return runs.sort((a, b) => a.when - b.when);
}

function slotForNow(now = new Date()) {
  const runs = scheduledRunsAfter(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const past = runs.filter((run) => run.when <= now).sort((a, b) => b.when - a.when);
  return past[0]?.slot || "open";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadTickers(args) {
  const tickers = new Set();
  if (!args.only) {
    const data = await readPortfolioData();
    for (const ticker of collectPortfolioTickers(data)) tickers.add(ticker);
  }
  for (const ticker of parseTickerList(args.tickers)) tickers.add(ticker);
  for (const ticker of parseTickerList((args._ || []).join(","))) tickers.add(ticker);
  const watchlistFile = args["watchlist-file"] || WATCHLIST_TICKERS_PATH;
  for (const ticker of await readTickerFile(watchlistFile)) tickers.add(ticker);
  return [...tickers].sort((a, b) => a.localeCompare(b));
}

async function runImport(args, forcedSlot = "") {
  const provider = String(args.provider || "auto").toLowerCase();
  const slotArg = String(forcedSlot || args.slot || "auto").toLowerCase();
  const slot = slotArg === "close" || slotArg === "open" ? slotArg : slotForNow();
  const delayMs = Math.max(0, Number(args["delay-ms"] || 600));
  const tickers = await loadTickers(args);
  if (!tickers.length) throw new Error("Nao encontrei tickers para atualizar.");

  console.log(`Import ${slot}: ${tickers.length} tickers (${provider})`);
  const rows = [];
  const errors = [];
  for (const ticker of tickers) {
    try {
      const row = await fetchPrice(ticker, provider);
      rows.push(row);
      console.log(`${ticker}: ${row.price} (${row.provider})`);
    } catch (error) {
      errors.push({ ticker, message: String(error.message || error).slice(0, 500) });
      console.warn(`${ticker}: falhou`);
    }
    if (delayMs) await sleep(delayMs);
  }

  const previous = await readExistingPrices();
  const meta = await writePricesFile({ rows, errors, slot, provider, previous });
  console.log(`Guardado em ${PRICES_PATH}`);
  console.log(`Importados: ${meta.imported}; atualizados: ${meta.updated}; falhas: ${errors.length}`);
  return meta;
}

async function watch(args) {
  console.log("Importador em espera. Horarios: 09:45 e 16:15 New York.");
  for (;;) {
    const next = scheduledRunsAfter()[0];
    const delay = Math.max(0, next.when.getTime() - Date.now());
    console.log(`Proximo import: ${MARKET_RUNS[next.slot].label} em ${next.when.toLocaleString()}`);
    await sleep(delay);
    await runImport(args, next.slot);
  }
}

export {
  APP_DIR,
  DATA_PATH,
  MARKET_RUNS,
  PRICES_PATH,
  WATCHLIST_TICKERS_PATH,
  loadTickers,
  parseArgs,
  providerLabel,
  readExistingPrices,
  runImport,
  scheduledRunsAfter,
  usage,
  watch,
};

if (isCliEntry()) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(usage());
  } else if (args.watch) {
    await watch(args);
  } else {
    await runImport(args);
  }
}
