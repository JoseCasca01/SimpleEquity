const DATA = window.PORTFOLIO_DATA;

const state = {
  view: "dashboard",
  currency: "USD",
  holdingsSearch: "",
  holdingsActiveOnly: true,
  holdingsSort: { key: "value", dir: -1 },
  investmentsSearch: "",
  investmentsStatus: "Todos",
  investmentsType: "Todos",
  investmentsSort: { key: "movementDate", dir: -1 },
};

const appEl = document.querySelector("#app");
const titleEl = document.querySelector("#viewTitle");
const subtitleEl = document.querySelector("#viewSubtitle");
const sourceMetaEl = document.querySelector("#sourceMeta");

const viewCopy = {
  dashboard: ["SimpleEquity", "Consolidated USD portfolio snapshot"],
  holdings: ["Holdings", "Posições atuais, alocação e retorno por ticker"],
  investments: ["Investimentos", "Histórico de compras, vendas e posições"],
  dividends: ["Dividendos", "Recebimentos, impostos e previsão anual"],
  growth: ["Crescimento", "Comparação entre plano e evolução real"],
};

const formatters = {
  USD: new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }),
  EUR: new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }),
  pct: new Intl.NumberFormat("pt-PT", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
  num: new Intl.NumberFormat("pt-PT", {
    maximumFractionDigits: 2,
  }),
  int: new Intl.NumberFormat("pt-PT", {
    maximumFractionDigits: 0,
  }),
  date: new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }),
  dateTime: new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
};

function fxRate() {
  const summary = DATA.summary;
  return (
    summary.eurUsd ||
    summary.totalPortfolioUsd / summary.totalPortfolioEur ||
    1
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function asCurrency(value, options = {}) {
  const raw = Number(value || 0);
  const converted =
    options.convert === false || state.currency === "USD"
      ? raw
      : raw / fxRate();
  return formatters[state.currency].format(converted);
}

function summaryCurrency(usd, eur) {
  return state.currency === "EUR"
    ? formatters.EUR.format(Number(eur || 0))
    : formatters.USD.format(Number(usd || 0));
}

function asPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return formatters.pct.format(value);
}

function asNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return formatters.num.format(value);
}

function axisCurrency(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const suffix = state.currency === "EUR" ? "€" : "US$";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${formatters.num.format(value / 1000)}k ${suffix}`;
  return `${formatters.num.format(value)} ${suffix}`;
}

function asDate(value) {
  if (!value) return "n/a";
  return formatters.date.format(new Date(`${value}T00:00:00`));
}

function asDateTime(value) {
  if (!value) return "n/a";
  return formatters.dateTime.format(new Date(value));
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt", { numeric: true });
}

function sortedRows(rows, sort) {
  return [...rows].sort((a, b) => compareValues(a[sort.key], b[sort.key]) * sort.dir);
}

function metricCard(label, value, sub = "", tone = "") {
  return `
    <article class="kpi ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(sub)}</small>
    </article>
  `;
}

function statusBadge(status) {
  const cls = status === "Aberta" ? "open" : status === "Fechada" ? "closed" : "";
  return `<span class="badge ${cls}">${escapeHtml(status || "n/a")}</span>`;
}

function sortMarker(sort, key) {
  if (sort.key !== key) return "";
  return sort.dir > 0 ? " &uarr;" : " &darr;";
}

function renderTable({ columns, rows, sortPrefix, sort }) {
  if (!rows.length) {
    return `<div class="empty">Sem resultados.</div>`;
  }
  const head = columns
    .map((col) => {
      const label = escapeHtml(col.label);
      const content = col.sortKey
        ? `<button data-sort-${sortPrefix}="${col.sortKey}">${label}${sortMarker(sort, col.sortKey)}</button>`
        : label;
      return `<th class="${col.className || ""}">${content}</th>`;
    })
    .join("");
  const body = rows
    .map(
      (row) => `
        <tr>
          ${columns
            .map(
              (col) =>
                `<td class="${col.className || ""}">${col.render(row)}</td>`,
            )
            .join("")}
        </tr>
      `,
    )
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function barList(items, options) {
  const rows = items.filter((item) => Math.abs(options.value(item)) > 0);
  if (!rows.length) return `<div class="empty">Sem dados.</div>`;
  const max = Math.max(...rows.map((item) => Math.abs(options.value(item))), 1);
  return `
    <div class="bar-list">
      ${rows
        .map((item, index) => {
          const value = options.value(item);
          const width = Math.max(2, (Math.abs(value) / max) * 100);
          const color = options.color?.(item, index) || "var(--teal)";
          return `
            <div class="bar-row">
              <div class="bar-label" title="${escapeHtml(options.label(item))}">${escapeHtml(options.label(item))}</div>
              <div class="bar-track"><span class="bar-fill" style="width:${width}%;background:${color}"></span></div>
              <div class="bar-value">${escapeHtml(options.format(value, item))}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function signedBars(items) {
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 1);
  return `
    <div class="signed-bars">
      ${items
        .map((item) => {
          const width = Math.max(1, (Math.abs(item.value) / max) * 50);
          const cls = item.value >= 0 ? "pos" : "neg";
          return `
            <div class="signed-row">
              <div class="bar-label">${escapeHtml(item.label)}</div>
              <div class="signed-track">
                <span class="signed-fill ${cls}" style="width:${width}%"></span>
              </div>
              <div class="bar-value ${item.value < 0 ? "negative" : "positive"}">${escapeHtml(asCurrency(item.value))}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function shortMonth(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("pt-PT", { month: "short", year: "2-digit" }).format(date);
}

function lineChart(series, options = {}) {
  const width = 860;
  const height = 310;
  const pad = { left: 60, right: 18, top: 22, bottom: 44 };
  const pointsCount = Math.max(...series.map((entry) => entry.points.length), 0);
  const values = series.flatMap((entry) => entry.points.map((point) => point.value));
  const cleanValues = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!pointsCount || !cleanValues.length) return `<div class="empty">Sem dados.</div>`;

  let min = Math.min(...cleanValues, options.includeZero === false ? Math.min(...cleanValues) : 0);
  let max = Math.max(...cleanValues, options.includeZero === false ? Math.max(...cleanValues) : 0);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padding = (max - min) * 0.08;
  min -= padding;
  max += padding;

  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (pointsCount === 1 ? 0 : (index / (pointsCount - 1)) * plotW);
  const y = (value) => pad.top + ((max - value) / (max - min)) * plotH;
  const yTicks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
  const labelFormatter = options.yFormat || axisCurrency;
  const labelPoints = [
    { index: 0, anchor: "start" },
    { index: Math.floor((pointsCount - 1) / 2), anchor: "middle" },
    { index: pointsCount - 1, anchor: "end" },
  ];
  const firstSeries = series.find((entry) => entry.points.length)?.points || [];

  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "Gráfico")}">
      ${yTicks
        .map((tick) => {
          const yy = y(tick);
          return `
            <line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"></line>
            <text x="${pad.left - 10}" y="${yy + 4}" text-anchor="end">${escapeHtml(labelFormatter(tick))}</text>
          `;
        })
        .join("")}
      <line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"></line>
      ${series
        .map((entry) => {
          const points = entry.points
            .map((point, index) => `${x(index)},${y(point.value)}`)
            .join(" ");
          return `<polyline points="${points}" fill="none" stroke="${entry.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
        })
        .join("")}
      ${series
        .map((entry) =>
          entry.points
            .map(
              (point, index) =>
                `<circle cx="${x(index)}" cy="${y(point.value)}" r="3.2" fill="${entry.color}"></circle>`,
            )
            .join(""),
        )
        .join("")}
      ${labelPoints
        .filter((item, pos, arr) => arr.findIndex((xItem) => xItem.index === item.index) === pos)
        .map((item) => {
          const point = firstSeries[item.index];
          return point
            ? `<text x="${x(item.index)}" y="${height - 14}" text-anchor="${item.anchor}">${escapeHtml(point.label)}</text>`
            : "";
        })
        .join("")}
    </svg>
    <div class="legend">
      ${series
        .map((entry) => `<span><i style="background:${entry.color}"></i>${escapeHtml(entry.name)}</span>`)
        .join("")}
    </div>
  `;
}

function tickerSummaryMap() {
  return new Map(DATA.tickerSummary.map((row) => [row.ticker, row]));
}

function forecastMap() {
  return new Map(DATA.dividendForecast.rows.map((row) => [row.ticker, row]));
}

function enrichedHoldings() {
  const summary = tickerSummaryMap();
  const forecast = forecastMap();
  return DATA.holdings.map((holding) => {
    const performance = summary.get(holding.ticker) || {};
    const dividend = forecast.get(holding.ticker) || {};
    return {
      ...holding,
      totalPlPct: performance.totalPlWithDividendsPct,
      unrealizedPl: performance.unrealizedPl || 0,
      dividends: performance.dividends || 0,
      annualDividend: dividend.annualDividend || 0,
      yieldOnCost: dividend.yieldOnCost || 0,
    };
  });
}

function activeHoldings() {
  return enrichedHoldings().filter((holding) => holding.active);
}

function activeSectors() {
  return DATA.auxiliary.sectors
    .filter((sector) => sector.value > 0)
    .sort((a, b) => b.value - a.value);
}

function monthlyKey(row) {
  return `${row.year}-${String(row.monthIndex || 0).padStart(2, "0")}`;
}

function monthlyDividendRows() {
  const taxes = new Map(DATA.auxiliary.taxMonthly.map((row) => [monthlyKey(row), row.value]));
  return DATA.auxiliary.dividendMonthly
    .map((row) => ({
      ...row,
      tax: taxes.get(monthlyKey(row)) || 0,
      date: `${row.year}-${String(row.monthIndex || 1).padStart(2, "0")}-01`,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function updateShell() {
  const [title, subtitle] = viewCopy[state.view];
  titleEl.textContent = title;
  subtitleEl.textContent = `${subtitle} · ${asDate(DATA.summary.asOfDate)}`;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  document.querySelectorAll("[data-currency]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.currency === state.currency);
  });

  const errorCount = Object.values(DATA.dataQuality.excelErrorCells).reduce((a, b) => a + b, 0);
  sourceMetaEl.innerHTML = `
    <div><strong>Ficheiro</strong><br>${escapeHtml(DATA.source.name)}</div>
    <div><strong>Guardado</strong><br>${escapeHtml(asDateTime(DATA.source.lastModified))}</div>
    <div><span class="badge ${errorCount ? "error" : ""}">${formatters.int.format(errorCount)} erros Excel</span></div>
  `;
}

function renderDashboard() {
  const summary = DATA.summary;
  const holdings = activeHoldings();
  const sectors = activeSectors();
  const largest = holdings.slice().sort((a, b) => b.value - a.value)[0];
  const winner = DATA.tickerSummary
    .filter((row) => typeof row.totalPlWithDividendsPct === "number")
    .slice()
    .sort((a, b) => b.totalPlWithDividendsPct - a.totalPlWithDividendsPct)[0];
  const latestGrowth = DATA.growth.rows.at(-1);

  const kpis = [
    metricCard(
      "Total portfolio",
      summaryCurrency(summary.totalPortfolioUsd, summary.totalPortfolioEur),
      `Depositado: ${summaryCurrency(summary.totalDepositedUsd, summary.totalDepositedEur)}`,
      "positive",
    ),
    metricCard(
      "Retorno",
      asPct(state.currency === "EUR" ? summary.returnPctEur : summary.returnPctUsd),
      `Ganho líquido: ${asCurrency(summary.netReturnUsd)}`,
      summary.netReturnUsd >= 0 ? "positive" : "negative",
    ),
    metricCard("P/L aberto", asCurrency(summary.openPl), `${holdings.length} posições abertas`, summary.openPl >= 0 ? "positive" : "negative"),
    metricCard("Dividendos", asCurrency(summary.dividends), `Impostos: ${asCurrency(Math.abs(summary.taxes))}`),
    metricCard("P/L fechado", asCurrency(summary.closedPl), `Juros: ${asCurrency(summary.interest)}`, summary.closedPl >= 0 ? "positive" : "negative"),
    metricCard("Dividendo anual", asCurrency(summary.annualDividendForecast), `Yield on cost: ${asPct(summary.yieldOnCost)}`),
    metricCard("Maior posição", largest?.ticker || "n/a", largest ? asCurrency(largest.value) : "n/a"),
    metricCard("Melhor ticker", winner?.ticker || "n/a", winner ? asPct(winner.totalPlWithDividendsPct) : "n/a", "positive"),
  ].join("");

  const growthSeries = [
    {
      name: "Plano",
      color: "var(--gold)",
      points: DATA.growth.rows.map((row) => ({
        label: shortMonth(row.period),
        value: state.currency === "EUR" ? row.plannedTotalAccum / fxRate() : row.plannedTotalAccum,
      })),
    },
    {
      name: "Real",
      color: "var(--teal)",
      points: DATA.growth.rows.map((row) => ({
        label: shortMonth(row.period),
        value: state.currency === "EUR" ? row.realTotalAccum / fxRate() : row.realTotalAccum,
      })),
    },
  ];

  const components = [
    { label: "P/L aberto", value: summary.openPl },
    { label: "P/L fechado", value: summary.closedPl },
    { label: "Dividendos", value: summary.dividends },
    { label: "Juros", value: summary.interest },
    { label: "Impostos", value: summary.taxes },
  ];

  return `
    <div class="kpi-grid">${kpis}</div>
    <div class="panel-grid">
      <section class="panel span-7">
        <div class="panel-header"><h2>Evolução acumulada</h2><span class="badge">${escapeHtml(asDate(latestGrowth?.period))}</span></div>
        <div class="panel-body">${lineChart(growthSeries, { label: "Evolução acumulada" })}</div>
      </section>
      <section class="panel span-5">
        <div class="panel-header"><h2>Composição do retorno</h2></div>
        <div class="panel-body">${signedBars(components)}</div>
      </section>
      <section class="panel span-6">
        <div class="panel-header"><h2>Top holdings</h2></div>
        <div class="panel-body">
          ${barList(holdings.slice().sort((a, b) => b.value - a.value).slice(0, 10), {
            label: (item) => item.ticker,
            value: (item) => item.value,
            format: (value) => asCurrency(value),
            color: (_, index) => ["var(--teal)", "var(--gold)", "var(--blue)", "var(--green)"][index % 4],
          })}
        </div>
      </section>
      <section class="panel span-6">
        <div class="panel-header"><h2>Alocação por setor</h2></div>
        <div class="panel-body">
          ${barList(sectors, {
            label: (item) => item.sector,
            value: (item) => item.value,
            format: (value, item) => `${asCurrency(value)} · ${asPct(item.portfolioPct)}`,
            color: (_, index) => ["var(--teal)", "var(--gold)", "var(--red)", "var(--blue)", "var(--green)"][index % 5],
          })}
        </div>
      </section>
    </div>
  `;
}

function renderHoldings() {
  const query = state.holdingsSearch.trim().toLowerCase();
  let rows = enrichedHoldings().filter((row) => {
    const matches =
      !query ||
      row.ticker.toLowerCase().includes(query) ||
      String(row.sector || "").toLowerCase().includes(query);
    return matches && (!state.holdingsActiveOnly || row.active);
  });
  rows = sortedRows(rows, state.holdingsSort);
  const active = activeHoldings();
  const topSector = activeSectors()[0];
  const totalValue = sum(active, "value");
  const totalAnnualDiv = sum(active, "annualDividend");

  const columns = [
    { label: "Ticker", sortKey: "ticker", render: (row) => `<strong>${escapeHtml(row.ticker)}</strong>` },
    { label: "Setor", sortKey: "sector", render: (row) => escapeHtml(row.sector || "n/a") },
    { label: "Shares", sortKey: "shares", className: "num", render: (row) => asNumber(row.shares) },
    { label: "Valor", sortKey: "value", className: "num", render: (row) => asCurrency(row.value) },
    { label: "% portfolio", sortKey: "portfolioPct", className: "num", render: (row) => asPct(row.portfolioPct) },
    {
      label: "P/L total",
      sortKey: "totalPlPct",
      className: "num",
      render: (row) => `<span class="${Number(row.totalPlPct || 0) < 0 ? "negative" : "positive"}">${asPct(row.totalPlPct)}</span>`,
    },
    { label: "Div. anual", sortKey: "annualDividend", className: "num", render: (row) => asCurrency(row.annualDividend) },
    { label: "YOC", sortKey: "yieldOnCost", className: "num", render: (row) => asPct(row.yieldOnCost) },
  ];

  return `
    <div class="toolbar">
      <div class="filters">
        <input class="input" id="holdingsSearch" value="${escapeHtml(state.holdingsSearch)}" placeholder="Pesquisar ticker ou setor" />
        <label class="toggle"><input type="checkbox" id="holdingsActiveOnly" ${state.holdingsActiveOnly ? "checked" : ""} />Só abertas</label>
      </div>
      <span class="badge">${rows.length} linhas</span>
    </div>
    <div class="kpi-grid">
      ${metricCard("Valor aberto", asCurrency(totalValue), `${active.length} posições abertas`)}
      ${metricCard("Setor principal", topSector?.sector || "n/a", topSector ? asPct(topSector.portfolioPct) : "n/a")}
      ${metricCard("Dividendo anual", asCurrency(totalAnnualDiv), `Média mensal: ${asCurrency(totalAnnualDiv / 12)}`)}
      ${metricCard("Tickers totais", String(DATA.holdings.length), `${DATA.holdings.length - active.length} sem posição aberta`)}
    </div>
    <div class="panel-grid">
      <section class="panel span-5">
        <div class="panel-header"><h2>Ranking de posições</h2></div>
        <div class="panel-body">
          ${barList(active.slice().sort((a, b) => b.value - a.value).slice(0, 12), {
            label: (item) => item.ticker,
            value: (item) => item.value,
            format: (value, item) => `${asCurrency(value)} · ${asPct(item.portfolioPct)}`,
            color: (_, index) => ["var(--teal)", "var(--gold)", "var(--blue)", "var(--green)"][index % 4],
          })}
        </div>
      </section>
      <section class="panel span-7">
        <div class="panel-header"><h2>Holdings</h2></div>
        <div class="panel-body">${renderTable({ columns, rows, sortPrefix: "holdings", sort: state.holdingsSort })}</div>
      </section>
    </div>
  `;
}

function renderInvestments() {
  const statuses = ["Todos", ...new Set(DATA.investments.map((row) => row.status).filter(Boolean))];
  const types = ["Todos", ...new Set(DATA.investments.map((row) => row.type).filter(Boolean))];
  const query = state.investmentsSearch.trim().toLowerCase();
  let rows = DATA.investments.filter((row) => {
    const matchesQuery =
      !query ||
      row.ticker.toLowerCase().includes(query) ||
      String(row.type || "").toLowerCase().includes(query) ||
      String(row.platform || "").toLowerCase().includes(query);
    const matchesStatus = state.investmentsStatus === "Todos" || row.status === state.investmentsStatus;
    const matchesType = state.investmentsType === "Todos" || row.type === state.investmentsType;
    return matchesQuery && matchesStatus && matchesType;
  });
  rows = sortedRows(rows, state.investmentsSort);
  const totalInvested = sum(rows, "invested");
  const totalProfit = sum(rows, "netProfit");
  const openRows = rows.filter((row) => row.status === "Aberta").length;
  const closedRows = rows.filter((row) => row.status === "Fechada").length;

  const columns = [
    { label: "Data", sortKey: "movementDate", render: (row) => asDate(row.movementDate) },
    { label: "Ticker", sortKey: "ticker", render: (row) => `<strong>${escapeHtml(row.ticker)}</strong>` },
    { label: "Tipo", sortKey: "type", render: (row) => escapeHtml(row.type || "n/a") },
    { label: "Qtd.", sortKey: "quantity", className: "num", render: (row) => asNumber(row.quantity) },
    { label: "Investido", sortKey: "invested", className: "num", render: (row) => asCurrency(row.invested) },
    { label: "Inicial", sortKey: "initialPrice", className: "num", render: (row) => asCurrency(row.initialPrice) },
    { label: "Final", sortKey: "finalPrice", className: "num", render: (row) => asCurrency(row.finalPrice) },
    {
      label: "NET P/L",
      sortKey: "netProfit",
      className: "num",
      render: (row) => `<span class="${Number(row.netProfit || 0) < 0 ? "negative" : "positive"}">${asCurrency(row.netProfit)}</span>`,
    },
    { label: "P/L %", sortKey: "netPlPct", className: "num", render: (row) => asPct(row.netPlPct) },
    { label: "TIR", sortKey: "irr", className: "num", render: (row) => asPct(row.irr) },
    { label: "Estado", sortKey: "status", render: (row) => statusBadge(row.status) },
  ];

  return `
    <div class="toolbar">
      <div class="filters">
        <input class="input" id="investmentsSearch" value="${escapeHtml(state.investmentsSearch)}" placeholder="Pesquisar ticker, tipo ou plataforma" />
        <select class="select" id="investmentsStatus">
          ${statuses.map((status) => `<option ${status === state.investmentsStatus ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
        </select>
        <select class="select" id="investmentsType">
          ${types.map((type) => `<option ${type === state.investmentsType ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}
        </select>
      </div>
      <span class="badge">${rows.length} movimentos</span>
    </div>
    <div class="kpi-grid">
      ${metricCard("Investido", asCurrency(totalInvested), `${rows.length} movimentos`)}
      ${metricCard("NET Profit", asCurrency(totalProfit), `${asPct(totalInvested ? totalProfit / totalInvested : 0)} sobre investido`, totalProfit >= 0 ? "positive" : "negative")}
      ${metricCard("Abertas", String(openRows), "Linhas em carteira")}
      ${metricCard("Fechadas", String(closedRows), "Linhas realizadas")}
    </div>
    <section class="panel">
      <div class="panel-header"><h2>Movimentos</h2></div>
      <div class="panel-body">${renderTable({ columns, rows, sortPrefix: "investments", sort: state.investmentsSort })}</div>
    </section>
  `;
}

function renderDividends() {
  const dividendRows = DATA.dividends;
  const gross = sum(dividendRows, "dividend");
  const tax = sum(dividendRows, "tax");
  const net = sum(dividendRows, "net");
  const monthly = monthlyDividendRows();
  const forecast = DATA.dividendForecast.rows
    .filter((row) => row.annualDividend > 0)
    .sort((a, b) => b.annualDividend - a.annualDividend);
  const monthHeaders = Object.keys(forecast[0]?.months || {});
  const scenarioSeries = DATA.dividendForecast.monthlyScenarios.map((scenario, index) => ({
    name: scenario.label,
    color: ["var(--teal)", "var(--gold)", "var(--red)"][index % 3],
    points: scenario.values.map((item) => ({
      label: String(item.month).slice(0, 3),
      value: state.currency === "EUR" ? item.value / fxRate() : item.value,
    })),
  }));
  const actualSeries = [
    {
      name: "Dividendos",
      color: "var(--teal)",
      points: monthly.map((row) => ({
        label: `${row.month} ${String(row.year).slice(2)}`,
        value: state.currency === "EUR" ? row.value / fxRate() : row.value,
      })),
    },
    {
      name: "Impostos",
      color: "var(--red)",
      points: monthly.map((row) => ({
        label: `${row.month} ${String(row.year).slice(2)}`,
        value: state.currency === "EUR" ? row.tax / fxRate() : row.tax,
      })),
    },
  ];

  const heatRows = forecast
    .slice(0, 18)
    .map(
      (row) => `
        <div class="heat-row">
          <strong>${escapeHtml(row.ticker)}</strong>
          ${monthHeaders
            .map((month) => `<span class="heat-cell ${row.months[month] ? "on" : ""}" title="${escapeHtml(row.ticker)} ${escapeHtml(month)}"></span>`)
            .join("")}
          <span class="bar-value">${escapeHtml(asCurrency(row.annualDividend))}</span>
        </div>
      `,
    )
    .join("");

  const forecastColumns = [
    { label: "Ticker", render: (row) => `<strong>${escapeHtml(row.ticker)}</strong>` },
    { label: "Qtd.", className: "num", render: (row) => asNumber(row.quantity) },
    { label: "Div. mensal", className: "num", render: (row) => asCurrency(row.monthlyDividend) },
    { label: "Div. anual", className: "num", render: (row) => asCurrency(row.annualDividend) },
    { label: "YOC", className: "num", render: (row) => asPct(row.yieldOnCost) },
  ];

  return `
    <div class="kpi-grid">
      ${metricCard("Recebido bruto", asCurrency(gross), `${dividendRows.length} lançamentos`)}
      ${metricCard("Imposto fonte", asCurrency(tax), asPct(gross ? tax / gross : 0), "negative")}
      ${metricCard("Recebido líquido", asCurrency(net), `Retenção: ${asCurrency(tax)}`)}
      ${metricCard("Previsão anual", asCurrency(DATA.summary.annualDividendForecast), `YOC: ${asPct(DATA.summary.yieldOnCost)}`)}
    </div>
    <div class="panel-grid">
      <section class="panel span-6">
        <div class="panel-header"><h2>Recebimentos mensais</h2></div>
        <div class="panel-body">${lineChart(actualSeries, { label: "Recebimentos mensais" })}</div>
      </section>
      <section class="panel span-6">
        <div class="panel-header"><h2>Previsão mensal</h2></div>
        <div class="panel-body">${lineChart(scenarioSeries, { label: "Previsão mensal" })}</div>
      </section>
      <section class="panel span-7">
        <div class="panel-header"><h2>Calendário previsto</h2></div>
        <div class="panel-body">
          <div class="heatmap">
            <div class="heat-row">
              <span></span>
              ${monthHeaders.map((month) => `<span class="heat-head">${escapeHtml(month.slice(0, 3))}</span>`).join("")}
              <span class="heat-head">Anual</span>
            </div>
            ${heatRows}
          </div>
        </div>
      </section>
      <section class="panel span-5">
        <div class="panel-header"><h2>Dividendos previstos</h2></div>
        <div class="panel-body">${renderTable({ columns: forecastColumns, rows: forecast, sortPrefix: "none", sort: { key: "", dir: 1 } })}</div>
      </section>
    </div>
  `;
}

function renderGrowth() {
  const rows = DATA.growth.rows;
  const latest = rows.at(-1) || {};
  const series = [
    {
      name: "Plano",
      color: "var(--gold)",
      points: rows.map((row) => ({
        label: shortMonth(row.period),
        value: state.currency === "EUR" ? row.plannedTotalAccum / fxRate() : row.plannedTotalAccum,
      })),
    },
    {
      name: "Real",
      color: "var(--teal)",
      points: rows.map((row) => ({
        label: shortMonth(row.period),
        value: state.currency === "EUR" ? row.realTotalAccum / fxRate() : row.realTotalAccum,
      })),
    },
  ];
  const columns = [
    { label: "Período", render: (row) => asDate(row.period) },
    { label: "Plano acumulado", className: "num", render: (row) => asCurrency(row.plannedTotalAccum) },
    { label: "Plano juros", className: "num", render: (row) => asCurrency(row.plannedInterestTotal) },
    { label: "Real acumulado", className: "num", render: (row) => asCurrency(row.realTotalAccum) },
    { label: "Real juros", className: "num", render: (row) => asCurrency(row.realInterestTotal) },
    { label: "Rent. real", className: "num", render: (row) => asPct(row.realReturnPct) },
  ];

  return `
    <div class="kpi-grid">
      ${metricCard("Rent. histórica", asPct(DATA.growth.historicalReturnPct), "Base S&P 500")}
      ${metricCard("Aporte mensal", asCurrency(DATA.growth.monthlyContribution), "Média da folha")}
      ${metricCard("Inflação média", asPct(DATA.growth.averageInflation), "Portugal")}
      ${metricCard("Real acumulado", asCurrency(latest.realTotalAccum), asPct(latest.realReturnPct), latest.realReturnPct >= 0 ? "positive" : "negative")}
    </div>
    <div class="panel-grid">
      <section class="panel span-8">
        <div class="panel-header"><h2>Plano vs real</h2></div>
        <div class="panel-body">${lineChart(series, { label: "Plano vs real" })}</div>
      </section>
      <section class="panel span-4">
        <div class="panel-header"><h2>Resumo</h2></div>
        <div class="panel-body">
          <div class="mini-grid">
            <div class="mini-stat"><span>Início</span><strong>${escapeHtml(asDate(DATA.summary.startDate))}</strong></div>
            <div class="mini-stat"><span>Atual</span><strong>${escapeHtml(asDate(DATA.summary.asOfDate))}</strong></div>
            <div class="mini-stat"><span>EUR/USD</span><strong>${escapeHtml(asNumber(DATA.summary.eurUsd))}</strong></div>
          </div>
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-header"><h2>Série mensal</h2></div>
        <div class="panel-body">${renderTable({ columns, rows, sortPrefix: "none", sort: { key: "", dir: 1 } })}</div>
      </section>
    </div>
  `;
}

function render() {
  updateShell();
  const html = {
    dashboard: renderDashboard,
    holdings: renderHoldings,
    investments: renderInvestments,
    dividends: renderDividends,
    growth: renderGrowth,
  }[state.view]();
  appEl.innerHTML = html;
}

function refocusInput(id) {
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    const input = document.querySelector(`#${id}`);
    if (!input || typeof input.focus !== "function") return;
    input.focus();
    if (typeof input.setSelectionRange === "function") {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  });
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    render();
    return;
  }

  const currencyButton = event.target.closest("[data-currency]");
  if (currencyButton) {
    state.currency = currencyButton.dataset.currency;
    render();
    return;
  }

  const holdingsSort = event.target.closest("[data-sort-holdings]");
  if (holdingsSort) {
    const key = holdingsSort.dataset.sortHoldings;
    state.holdingsSort =
      state.holdingsSort.key === key
        ? { key, dir: state.holdingsSort.dir * -1 }
        : { key, dir: -1 };
    render();
    return;
  }

  const investmentsSort = event.target.closest("[data-sort-investments]");
  if (investmentsSort) {
    const key = investmentsSort.dataset.sortInvestments;
    state.investmentsSort =
      state.investmentsSort.key === key
        ? { key, dir: state.investmentsSort.dir * -1 }
        : { key, dir: -1 };
    render();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "holdingsSearch") {
    state.holdingsSearch = event.target.value;
    render();
    refocusInput("holdingsSearch");
  }
  if (event.target.id === "investmentsSearch") {
    state.investmentsSearch = event.target.value;
    render();
    refocusInput("investmentsSearch");
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "holdingsActiveOnly") {
    state.holdingsActiveOnly = event.target.checked;
    render();
  }
  if (event.target.id === "investmentsStatus") {
    state.investmentsStatus = event.target.value;
    render();
  }
  if (event.target.id === "investmentsType") {
    state.investmentsType = event.target.value;
    render();
  }
});

render();
