const DATA = window.PORTFOLIO_DATA;
const APP_NAME = "SimpleEquity";
const STORE_KEY = "simpleequity-automation-v1";
const LEGACY_STORE_KEYS = ["portfolio-usd-automation-v1"];
const BACKUP_FILE_VERSION = 1;

const appEl = document.querySelector("#app");
const titleEl = document.querySelector("#viewTitle");
const subtitleEl = document.querySelector("#viewSubtitle");
const sourceMetaEl = document.querySelector("#sourceMeta");

const state = {
  view: "dashboard",
  currency: "USD",
  scope: "all",
  selectedTicker: "",
  holdingsSearch: "",
  transactionSearch: "",
  watchlistSearch: "",
  editWatchlistId: "",
  expandedInvestmentRows: {},
  dividendYear: new Date(DATA.summary.asOfDate || Date.now()).getFullYear(),
  dividendMonth: new Date(DATA.summary.asOfDate || Date.now()).getMonth() + 1,
  dividendTab: "calendar",
  editDividendId: "",
  addDividend: false,
  dividendForecastTicker: "",
  earningsRange: "5",
  capitalPortfolioId: "",
  priceUpdateSlot: "open",
  appProcess: {
    available: false,
    checked: false,
    runningImport: false,
    nextRun: null,
    totalTickers: 0,
    lastRun: null,
  },
  dcfTicker: "",
  dcfMode: "dcf",
  showDcfGrowthEditor: false,
  editValuationId: "",
  importKind: "dividend-events",
  editDividendAnnualKey: "",
  sort: {
    holdings: { key: "value", dir: -1 },
    transactions: { key: "date", dir: -1 },
    watchlist: { key: "prioritySort", dir: -1 },
  },
};

const viewCopy = {
  dashboard: ["Portfolio total", "Consolidated portfolio overview"],
  portfolios: ["Portfolios", "Portfolio management and aggregate total"],
  capital: ["Capital", "Deposits, free cash and annual performance"],
  holdings: ["Holdings", "Current positions, allocation and return by ticker"],
  watchlist: ["Watchlist", "Companies under review and entry prices"],
  investments: ["Investments", "Instrument buys and sells"],
  dividends: ["Dividends", "Expected calendar and received payments"],
  earnings: ["Earnings", "Ticker, quote and fiscal-year profit"],
  valuation: ["DCF", "Direct DCF, reverse DCF and assumptions by ticker"],
  missing: ["Missing years", "Earnings coverage by ticker and fiscal year"],
};

try {
  const params = new URLSearchParams(window.location?.search || "");
  const requestedView = params.get("view");
  if (requestedView && Object.prototype.hasOwnProperty.call(viewCopy, requestedView)) {
    state.view = requestedView;
  }
} catch {}

const formatters = {
  USD: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }),
  EUR: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }),
  pct: new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
  num: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }),
  int: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
  date: new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }),
  dateTime: new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
};

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthParseAliases = [
  ...monthNames.map((label, index) => ({ label, index: index + 1 })),
  ...monthShort.map((label, index) => ({ label, index: index + 1 })),
  ...[
    "Janeiro",
    "Fevereiro",
    "Marco",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ].map((label, index) => ({ label, index: index + 1 })),
  ...[
    ["Fev", 2],
    ["Abr", 4],
    ["Mai", 5],
    ["Ago", 8],
    ["Set", 9],
    ["Out", 10],
    ["Dez", 12],
  ].map(([label, index]) => ({ label, index })),
];

const priceUpdateSlots = {
  open: { label: "Open", time: "14:45" },
  close: { label: "Close", time: "21:15" },
};

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value) {
  if (value === "" || value == null) return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseLooseNumber(value, fallback = NaN) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value == null) return fallback;
  let text = String(value).trim();
  if (!text) return fallback;
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
  if (!Number.isFinite(parsed)) return fallback;
  return negative ? -Math.abs(parsed) : parsed;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeImportKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function importValue(row, aliases) {
  const normalized = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    normalized[normalizeImportKey(key)] = value;
  });
  for (const alias of aliases) {
    const key = normalizeImportKey(alias);
    if (Object.prototype.hasOwnProperty.call(normalized, key) && normalized[key] !== "") return normalized[key];
  }
  return "";
}

function parseMonthIndex(value) {
  const numberValue = parseLooseNumber(value);
  if (Number.isFinite(numberValue) && numberValue >= 1 && numberValue <= 12) return Math.trunc(numberValue);
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const monthIndex = monthNames.findIndex((month) => normalizeText(month).startsWith(normalized.slice(0, 3)));
  if (monthIndex >= 0) return monthIndex + 1;
  const shortIndex = monthShort.findIndex((month) => normalizeText(month).startsWith(normalized.slice(0, 3)));
  if (shortIndex >= 0) return shortIndex + 1;
  const alias = monthParseAliases.find((month) => normalizeText(month.label).startsWith(normalized.slice(0, 3)));
  return alias?.index || null;
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return date.toISOString().slice(0, 10);
}

function parseImportDate(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) return isoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  const numericMatch = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (numericMatch) {
    const first = Number(numericMatch[1]);
    const second = Number(numericMatch[2]);
    const year = Number(numericMatch[3].length === 2 ? `20${numericMatch[3]}` : numericMatch[3]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return isoDate(year, month, day);
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function stableImportId(prefix, parts) {
  return `${prefix}_${parts
    .map((part) => String(part ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"))
    .filter(Boolean)
    .join("_")}`;
}

function fxRate() {
  return DATA.summary.eurUsd || DATA.summary.totalPortfolioUsd / DATA.summary.totalPortfolioEur || 1;
}

function money(value, options = {}) {
  const raw = toNumber(value);
  const converted = options.convert === false || state.currency === "USD" ? raw : raw / fxRate();
  return formatters[state.currency].format(converted);
}

function pct(value) {
  return Number.isFinite(Number(value)) ? formatters.pct.format(Number(value)) : "n/a";
}

function number(value) {
  return Number.isFinite(Number(value)) ? formatters.num.format(Number(value)) : "n/a";
}

function optionalNumber(value) {
  const parsed = toOptionalNumber(value);
  return Number.isFinite(parsed) ? number(parsed) : "n/a";
}

function optionalMoney(value, options = {}) {
  const parsed = toOptionalNumber(value);
  return Number.isFinite(parsed) ? money(parsed, options) : "n/a";
}

function axisMoney(value) {
  const suffix = state.currency === "EUR" ? "EUR" : "US$";
  const abs = Math.abs(value || 0);
  if (abs >= 1000) return `${formatters.num.format(value / 1000)}k ${suffix}`;
  return `${formatters.num.format(value)} ${suffix}`;
}

function dateLabel(value) {
  if (!value) return "n/a";
  return formatters.date.format(new Date(`${value}T00:00:00`));
}

function dateTimeLabel(value) {
  if (!value) return "n/a";
  return formatters.dateTime.format(new Date(value));
}

function statusBadge(label, tone = "") {
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

const uiTextTranslations = [
  ["Conteudo informativo. Nao e recomendacao financeira.", "Informational content. Not financial advice."],
  ["Conteúdo informativo. Não é recomendação financeira.", "Informational content. Not financial advice."],
  ["Resumo consolidado dos portfolios", "Consolidated portfolio overview"],
  ["Gestao de carteiras e total agregado", "Portfolio management and aggregate total"],
  ["Gestão de carteiras e total agregado", "Portfolio management and aggregate total"],
  ["Depositos, fundos livres e rentabilidade anual", "Deposits, free cash and annual performance"],
  ["Depósitos, fundos livres e rentabilidade anual", "Deposits, free cash and annual performance"],
  ["Posicoes atuais, alocacao e retorno por ticker", "Current positions, allocation and return by ticker"],
  ["Posições atuais, alocação e retorno por ticker", "Current positions, allocation and return by ticker"],
  ["Empresas em observacao e precos de entrada", "Companies under review and entry prices"],
  ["Empresas em observação e preços de entrada", "Companies under review and entry prices"],
  ["Compras e vendas de instrumentos", "Instrument buys and sells"],
  ["Calendario previsto e recebimentos", "Expected calendar and received payments"],
  ["Calendário previsto e recebimentos", "Expected calendar and received payments"],
  ["Ticker, cotacao e lucro por ano fiscal", "Ticker, quote and fiscal-year profit"],
  ["Ticker, cotação e lucro por ano fiscal", "Ticker, quote and fiscal-year profit"],
  ["DCF direto, DCF reverso e pressupostos por ticker", "Direct DCF, reverse DCF and assumptions by ticker"],
  ["Cobertura de earnings por ticker e ano fiscal", "Earnings coverage by ticker and fiscal year"],
  ["Plano vs evolucao real do portfolio inicial", "Plan vs real portfolio growth"],
  ["Plano vs evolução real do portfolio inicial", "Plan vs real portfolio growth"],
  ["Import automatico carregado", "Automatic import loaded"],
  ["Import automático carregado", "Automatic import loaded"],
  ["Import automatico concluido", "Automatic import completed"],
  ["Import automático concluido", "Automatic import completed"],
  ["automatico", "automatic"],
  ["automático", "automatic"],
  ["Nao encontrei precos automaticos novos.", "No new automatic prices found."],
  ["Não encontrei preços automáticos novos.", "No new automatic prices found."],
  ["Nao foi possivel exportar o backup", "Could not export the backup"],
  ["Não foi possível exportar o backup", "Could not export the backup"],
  ["Nao foi possivel importar o backup", "Could not import the backup"],
  ["Não foi possível importar o backup", "Could not import the backup"],
  ["Ficheiro JSON invalido.", "Invalid JSON file."],
  ["Ficheiro JSON inválido.", "Invalid JSON file."],
  ["O JSON nao parece ser um backup desta app.", "The JSON does not look like a backup from this app."],
  ["O JSON não parece ser um backup desta app.", "The JSON does not look like a backup from this app."],
  ["Backup importado com sucesso.", "Backup imported successfully."],
  ["Importar este backup e substituir os dados locais atuais?", "Import this backup and replace the current local data?"],
  ["Valores financeiros em milhoes, conforme a fonte.", "Financial values in millions, as reported by the source."],
  ["Earnings anuais carregados localmente a partir da StockAnalysis.", "Annual earnings loaded locally from StockAnalysis."],
  ["A serie historica de cotacao ainda nao esta carregada.", "The historical price series is not loaded yet."],
  ["Quando adicionares cotacao anual manualmente, o grafico combina EPS e preco.", "When you add annual prices manually, the chart combines EPS and price."],
  ["Guardar o Anual/acao recalcula o valor por acao mensal pelos meses ativos desse ticker.", "Saving Annual/share recalculates the monthly per-share value for that ticker's active months."],
  ["DCF reverso procura o crescimento anual que faria o DCF igualar o preco atual, mantendo desconto, anos e crescimento terminal.", "Reverse DCF finds the annual growth that makes the DCF match the current price, keeping discount rate, years and terminal growth unchanged."],
  ["Reverse DCF calcula o crescimento que o preco atual ja esta a assumir.", "Reverse DCF calculates the growth already implied by the current price."],
  ["DCF calcula o valor intrinseco a partir do crescimento, desconto e FCF por acao.", "DCF calculates intrinsic value from growth, discount rate and FCF per share."],
  ["EBITDA ainda nao carregado para este ticker.", "EBITDA is not loaded yet for this ticker."],
  ["Preenche FCF/acao para ver a projeccao.", "Enter FCF/share to see the projection."],
  ["Dividendos com data", "Dividends with dates"],
  ["Recorrencia por ticker", "Recurrence by ticker"],
  ["Sem erros registados", "No errors recorded"],
  ["Sem imports", "No imports"],
  ["Sem API key", "No API key"],
  ["Sem API", "No API"],
  ["Sem dados.", "No data."],
  ["Sem resultados.", "No results."],
  ["Sem posicoes abertas para apresentar.", "No open positions to show."],
  ["Sem setores para apresentar.", "No sectors to show."],
  ["Sem earnings registados.", "No earnings recorded."],
  ["Sem ano fiscal", "No fiscal year"],
  ["Sem ano", "No year"],
  ["Sem posicao", "No position"],
  ["Sem posição", "No position"],
  ["Sem meses", "No months"],
  ["Sem dividendos neste mes.", "No dividends this month."],
  ["Sem dividendos previstos neste mes", "No expected dividends this month"],
  ["Sem dividendos recebidos neste mes", "No received dividends this month"],
  ["Sem dados", "No data"],
  ["Por preencher", "To fill"],
  ["por preencher", "to fill"],
  ["Abertura feita", "Open update done"],
  ["Fecho feito", "Close update done"],
  ["Atualizacao de precos", "Price update"],
  ["Atualização de preços", "Price update"],
  ["Atualizado", "Updated"],
  ["Atualizar cotacoes", "Update quotes"],
  ["Atualizar cotações", "Update quotes"],
  ["Atualizar agora", "Update now"],
  ["Atualizar calculo", "Update calculation"],
  ["Atualizar cálculo", "Update calculation"],
  ["Atualizar avaliacao guardada", "Update saved valuation"],
  ["Atualizar avaliação guardada", "Update saved valuation"],
  ["Guardar avaliacao", "Save valuation"],
  ["Guardar avaliação", "Save valuation"],
  ["Nova avaliacao", "New valuation"],
  ["Nova avaliação", "New valuation"],
  ["A editar avaliacao", "Editing valuation"],
  ["A editar avaliação", "Editing valuation"],
  ["Valores colocados", "Entered values"],
  ["Valor intrinseco", "Intrinsic value"],
  ["Valor intrínseco", "Intrinsic value"],
  ["Valor explicado", "Explained value"],
  ["Valor descontado", "Discounted value"],
  ["Valor atual", "Current value"],
  ["Valor alvo", "Target value"],
  ["Valor total", "Total value"],
  ["Valor no portfolio", "Portfolio value"],
  ["Valor/acao", "Value/share"],
  ["Valor/ação", "Value/share"],
  ["Valor / preco - 1", "Value / price - 1"],
  ["Valor / preço - 1", "Value / price - 1"],
  ["Valor", "Value"],
  ["Preco atual", "Current price"],
  ["Preço atual", "Current price"],
  ["Preco alvo", "Target price"],
  ["Preço alvo", "Target price"],
  ["Preco", "Price"],
  ["Preço", "Price"],
  ["precos", "prices"],
  ["preços", "prices"],
  ["Crescimento implicito", "Implied growth"],
  ["Crescimento implícito", "Implied growth"],
  ["Crescimento projetado", "Projected growth"],
  ["Crescimento exigido", "Required growth"],
  ["Crescimento perpetuo", "Perpetual growth"],
  ["Crescimentos anuais", "Annual growth rates"],
  ["Crescimento %", "Growth %"],
  ["Crescimento", "Growth"],
  ["anos carregados", "years loaded"],
  ["anos em falta", "missing years"],
  ["anos + terminal", "years + terminal"],
  ["anos", "years"],
  ["Diferenca vs preco", "Difference vs price"],
  ["Diferença vs preço", "Difference vs price"],
  ["Deve ficar perto de 0", "Should be close to 0"],
  ["Da carteira ou manual", "From portfolio or manual"],
  ["Preco que o mercado tenta justificar", "Price the market is trying to justify"],
  ["Base FCF/acao", "Base FCF/share"],
  ["Base FCF/ação", "Base FCF/share"],
  ["FCF/acao", "FCF/share"],
  ["FCF/ação", "FCF/share"],
  ["Desconto", "Discount"],
  ["Terminal", "Terminal"],
  ["Horizonte do reverse", "Reverse horizon"],
  ["Comprar abaixo", "Buy below"],
  ["Margem seguranca", "Margin of safety"],
  ["Margem segurança", "Margin of safety"],
  ["Margem vs preco", "Margin vs price"],
  ["Margem vs preço", "Margin vs price"],
  ["Fluxos ao crescimento implicito", "Flows at implied growth"],
  ["Fluxos ao crescimento implícito", "Flows at implied growth"],
  ["Fluxos projetados", "Projected flows"],
  ["Fluxos DCF", "DCF flows"],
  ["Detalhe", "Detail"],
  ["Terminal descontado", "Discounted terminal"],
  ["Pressupostos", "Assumptions"],
  ["Resultado principal do Reverse DCF", "Main Reverse DCF result"],
  ["Anos fiscais em falta", "Missing fiscal years"],
  ["Anos fiscais", "Fiscal years"],
  ["Anos em falta", "Missing years"],
  ["8 anos mais recentes", "Latest 8 years"],
  ["ano fiscal", "fiscal year"],
  ["Ano fiscal", "Fiscal year"],
  ["Ano", "Year"],
  ["Anos", "Years"],
  ["Janela completa", "Full window"],
  ["Janela de 8 anos por ticker", "8-year window by ticker"],
  ["Cobertura completa", "Full coverage"],
  ["Completo", "Complete"],
  ["Em falta", "Missing"],
  ["Adicionar ano fiscal manual", "Add fiscal year manually"],
  ["Guardar ano fiscal", "Save fiscal year"],
  ["Adicionar movimento", "Add transaction"],
  ["Guardar movimento", "Save transaction"],
  ["Posicoes e movimentos", "Positions and transactions"],
  ["Posições e movimentos", "Positions and transactions"],
  ["posicoes abertas", "open positions"],
  ["posições abertas", "open positions"],
  ["posicoes", "positions"],
  ["posições", "positions"],
  ["posicao", "position"],
  ["posição", "position"],
  ["movimentos", "transactions"],
  ["Movimentos", "Transactions"],
  ["Mov.", "Txns"],
  ["Compras/vendas fechadas", "Closed buys/sells"],
  ["vendas", "sales"],
  ["compras", "buys"],
  ["Compras", "Buys"],
  ["Vendas", "Sells"],
  ["Compra", "Buy"],
  ["Venda", "Sell"],
  ["Comprar", "Buy"],
  ["Lado", "Side"],
  ["Quantidade", "Quantity"],
  ["Volume", "Volume"],
  ["Taxas", "Fees"],
  ["Data", "Date"],
  ["Instrumento/Posicao", "Instrument/Position"],
  ["Instrumento/Posição", "Instrument/Position"],
  ["Preco de abertura", "Opening price"],
  ["Preço de abertura", "Opening price"],
  ["Lucro liquido %", "Net profit %"],
  ["Lucro líquido %", "Net profit %"],
  ["Lucro liquido", "Net profit"],
  ["Lucro líquido", "Net profit"],
  ["Detalhes", "Details"],
  ["Investido", "Invested"],
  ["Investimentos", "Investments"],
  ["Dividendos liquidos", "Net dividends"],
  ["Dividendos líquidos", "Net dividends"],
  ["Dividendos brutos", "Gross dividends"],
  ["Dividendos previstos", "Expected dividends"],
  ["Dividendos recebidos", "Received dividends"],
  ["Dividendos", "Dividends"],
  ["Retencao", "Withholding"],
  ["Retenção", "Withholding"],
  ["Liquido calculado", "Calculated net"],
  ["Líquido calculado", "Calculated net"],
  ["Liquido", "Net"],
  ["Líquido", "Net"],
  ["Bruto", "Gross"],
  ["Recebidos", "Received"],
  ["Recebido", "Received"],
  ["Recebi?", "Received?"],
  ["Anular", "Undo"],
  ["Calendario", "Calendar"],
  ["Calendário", "Calendar"],
  ["Previsoes", "Forecasts"],
  ["Previsões", "Forecasts"],
  ["Previsao", "Forecast"],
  ["Previsão", "Forecast"],
  ["Calendario previsto", "Expected calendar"],
  ["recorrencia", "recurrence"],
  ["Recorrencia", "Recurrence"],
  ["meses ativos", "active months"],
  ["Meses", "Months"],
  ["mes", "month"],
  ["mês", "month"],
  ["P/L aberto", "Open P/L"],
  ["P/L realizado", "Realized P/L"],
  ["P/L portfolio", "Portfolio P/L"],
  ["Retorno", "Return"],
  ["Rent. historica", "Historical return"],
  ["Rent. histórica", "Historical return"],
  ["Rent. anual", "Annual return"],
  ["Rentabilidade", "Return"],
  ["Rentabilidade operacional antes de D&A", "Operating profitability before D&A"],
  ["Ganho liquido", "Net gain"],
  ["Ganho líquido", "Net gain"],
  ["Ganho", "Gain"],
  ["Maior posicao", "Largest position"],
  ["Maior posição", "Largest position"],
  ["Top posicoes", "Top positions"],
  ["Top posições", "Top positions"],
  ["Alocacao por setor", "Sector allocation"],
  ["Alocação por setor", "Sector allocation"],
  ["Setores", "Sectors"],
  ["Setor", "Sector"],
  ["Comparacao", "Comparison"],
  ["Comparação", "Comparison"],
  ["Portfolio total", "Portfolio total"],
  ["Total portfolio", "Total portfolio"],
  ["Total agregado", "Aggregate total"],
  ["Carteiras", "Portfolios"],
  ["Novo portfolio", "New portfolio"],
  ["Criar portfolio", "Create portfolio"],
  ["Nome", "Name"],
  ["Moeda", "Currency"],
  ["Deposito inicial EUR", "Initial deposit EUR"],
  ["Depósito inicial EUR", "Initial deposit EUR"],
  ["Deposito inicial portfolio", "Initial portfolio deposit"],
  ["Depósito inicial portfolio", "Initial portfolio deposit"],
  ["Depositos", "Deposits"],
  ["Depósitos", "Deposits"],
  ["Deposito", "Deposit"],
  ["Depósito", "Deposit"],
  ["Fundos livres", "Free cash"],
  ["fundos livres", "free cash"],
  ["Posicoes + fundos livres", "Positions + free cash"],
  ["Posições + fundos livres", "Positions + free cash"],
  ["Incluidos nos fundos livres", "Included in free cash"],
  ["Incluídos nos fundos livres", "Included in free cash"],
  ["Deposits + vendas + dividendos - compras", "Deposits + sales + dividends - buys"],
  ["Adicionar capital", "Add capital"],
  ["Para portfolios noutra moeda, regista", "For portfolios in another currency, record"],
  ["e o valor nessa moeda para acompanhares o crescimento tambem na tua moeda de vida.", "and the value in that currency to track growth in your home currency too."],
  ["e o valor nessa moeda para acompanhares o crescimento também na tua moeda de vida.", "and the value in that currency to track growth in your home currency too."],
  ["A rentabilidade anual usa os prices atuais para estimar valores de portfolio em anos passados.", "Annual return uses current prices to estimate portfolio values in past years."],
  ["Quando adicionarmos historico de cotacao, este calculo fica mais preciso.", "When historical quotes are added, this calculation becomes more precise."],
  ["Quando adicionarmos histórico de cotação, este cálculo fica mais preciso.", "When historical quotes are added, this calculation becomes more precise."],
  ["Aporte mensal", "Monthly contribution"],
  ["Inflacao media", "Average inflation"],
  ["Inflação média", "Average inflation"],
  ["Real acumulado", "Real accumulated"],
  ["Plano vs real", "Plan vs real"],
  ["Base do Excel", "Excel baseline"],
  ["Media do Excel", "Excel average"],
  ["Média do Excel", "Excel average"],
  ["Capital livre", "Free cash"],
  ["Dados", "Data"],
  ["Dados importados", "Imported data"],
  ["Fonte local", "Local source"],
  ["Fonte", "Source"],
  ["Prioridade", "Priority"],
  ["Alta", "High"],
  ["Media", "Medium"],
  ["Média", "Medium"],
  ["Baixa", "Low"],
  ["Tese", "Thesis"],
  ["Notas", "Notes"],
  ["Nota", "Note"],
  ["Rever em", "Review on"],
  ["Preco desejado", "Desired price"],
  ["Preço desejado", "Desired price"],
  ["preco entrada", "entry price"],
  ["preço entrada", "entry price"],
  ["Nova empresa", "New company"],
  ["Editar watchlist", "Edit watchlist"],
  ["Adicionar a watchlist", "Add to watchlist"],
  ["Guardar alteracoes", "Save changes"],
  ["Guardar alterações", "Save changes"],
  ["Sincronizar watchlist", "Sync watchlist"],
  ["Atualizar preços", "Update prices"],
  ["Ver avaliacao", "View valuation"],
  ["Ver avaliação", "View valuation"],
  ["Criar DCF", "Create DCF"],
  ["Com avaliacao", "With valuation"],
  ["Com avaliação", "With valuation"],
  ["DCF guardado", "Saved DCF"],
  ["Empresas", "Companies"],
  ["Na watchlist", "On watchlist"],
  ["Colar dados", "Paste data"],
  ["Importar linhas", "Import rows"],
  ["Eventos importados", "Imported events"],
  ["Ultimo import", "Last import"],
  ["Último import", "Last import"],
  ["linhas", "rows"],
  ["linha", "row"],
  ["Abertura", "Open"],
  ["Fecho", "Close"],
  ["Ficheiro", "File"],
  ["Guardado", "Saved"],
  ["Estado local", "Local state"],
  ["manuais", "manual"],
  ["Manual", "Manual"],
  ["A gerar...", "Generating..."],
  ["Exportar dados", "Export data"],
  ["Importar backup", "Import backup"],
  ["Backup local", "Local backup"],
  ["Chave local", "Local key"],
  ["Registos", "Records"],
  ["Tamanho", "Size"],
  ["Adicionar dividendo recebido", "Add received dividend"],
  ["Editar dividendo recebido", "Edit received dividend"],
  ["Adicionar dividendo", "Add dividend"],
  ["Guardar alteracoes", "Save changes"],
  ["Cancelar", "Cancel"],
  ["Editar", "Edit"],
  ["Remover", "Remove"],
  ["Guardar", "Save"],
  ["Aplicar crescimentos", "Apply growth rates"],
  ["Fechar", "Close"],
  ["Pesquisar", "Search"],
  ["Cotacao", "Quote"],
  ["Cotação", "Quote"],
  ["cotacao", "quote"],
  ["cotação", "quote"],
  ["Ultima quote", "Latest quote"],
  ["Última quote", "Latest quote"],
  ["Earnings vs quote", "Earnings vs quote"],
  ["unidades", "units"],
  ["carteira", "portfolio"],
  ["Carteira", "Portfolio"],
  ["fiscais", "fiscal"],
  ["Historico", "History"],
  ["Histórico", "History"],
  ["Anual/acao", "Annual/share"],
  ["Anual/ação", "Annual/share"],
  ["Mensal/acao", "Monthly/share"],
  ["Mensal/ação", "Monthly/share"],
  ["ativo", "active"],
  ["ativos", "active"],
  ["recebimentos", "payments"],
  ["eventos previstos", "expected events"],
  ["empresas/eventos previstos", "companies/events expected"],
  ["dividendos recebidos", "received dividends"],
  ["dividendos previstos", "expected dividends"],
  ["Erro", "Error"],
  ["falhas", "failures"],
  ["precos", "prices"],
  ["preços", "prices"],
  ["Import", "Import"],
];

function translateUiText(value) {
  return uiTextTranslations
    .slice()
    .sort((a, b) => b[0].length - a[0].length)
    .reduce((text, [from, to]) => text.replaceAll(from, to), String(value ?? ""));
}

if (typeof window.alert === "function") {
  const nativeAlert = window.alert.bind(window);
  window.alert = (message) => nativeAlert(translateUiText(message));
}

if (typeof window.confirm === "function") {
  const nativeConfirm = window.confirm.bind(window);
  window.confirm = (message) => nativeConfirm(translateUiText(message));
}

function getTickerMeta(ticker) {
  const holding = DATA.holdings.find((row) => row.ticker === ticker);
  const investment = DATA.investments.find((row) => row.ticker === ticker);
  return {
    ticker,
    sector: holding?.sector || investment?.type || "Outro",
    type: investment?.type || holding?.sector || "Instrumento",
  };
}

function createSeedStore() {
  const portfolioId = "portfolio_excel_usd";
  const prices = {};
  DATA.holdings.forEach((holding) => {
    if (holding.shares > 0 && holding.value > 0) {
      prices[holding.ticker] = holding.value / holding.shares;
    }
  });
  DATA.investments.forEach((row) => {
    if (!prices[row.ticker] && row.finalPrice) prices[row.ticker] = row.finalPrice;
  });

  const transactions = [];
  DATA.investments.forEach((row) => {
    if (!row.ticker || !row.quantity || !row.initialPrice) return;
    transactions.push({
      id: uid("tx"),
      portfolioId,
      date: row.movementDate,
      side: "buy",
      ticker: row.ticker,
      instrumentType: row.type || "Instrumento",
      quantity: row.quantity,
      price: row.initialPrice,
      fees: 0,
      notes: "Importado do Excel",
    });
    if (row.status === "Fechada" && row.closeDate && row.finalPrice) {
      transactions.push({
        id: uid("tx"),
        portfolioId,
        date: row.closeDate,
        side: "sell",
        ticker: row.ticker,
        instrumentType: row.type || "Instrumento",
        quantity: row.quantity,
        price: row.finalPrice,
        fees: 0,
        notes: "Venda importada do Excel",
      });
    }
  });

  const dividends = DATA.dividends.map((row) => ({
    id: uid("div"),
    portfolioId,
    ticker: row.ticker,
    year: row.year,
    monthIndex: row.monthIndex || 1,
    month: row.month,
    sharesPaid: row.sharesPaid || "",
    gross: row.dividend,
    withholding: row.tax,
    net: row.net,
    received: true,
    source: "Excel",
  }));
  const deposits = DATA.deposits
    .filter((row) => row.usd)
    .map((row) => ({
      id: uid("dep"),
      portfolioId,
      date: row.date,
      eur: row.eur || 0,
      usd: row.usd || 0,
      rate: row.rate || null,
      source: "Excel",
    }));

  return {
    version: 1,
    portfolios: [
      {
        id: portfolioId,
        name: "SimpleEquity USD",
        currency: "USD",
        createdAt: DATA.source.extractedAt,
        notes: "Initial portfolio imported from Excel",
      },
    ],
    transactions,
    deposits,
    dividends,
    watchlist: [],
    prices,
    priceUpdates: [],
    fundamentals: normalizePreloadedFundamentals(),
    benchmarks: [
      { id: "spy", symbol: "SPY", name: "SPY", startValue: "", currentValue: "", notes: "" },
      { id: "btc", symbol: "BTC", name: "Bitcoin", startValue: "", currentValue: "", notes: "" },
      { id: "qqq", symbol: "QQQ", name: "QQQ", startValue: "", currentValue: "", notes: "" },
    ],
    earnings: normalizePreloadedEarnings(),
    dcf: {},
    valuations: [],
    imports: normalizePreloadedImports(),
    settings: {
      withholdingRate: 0.15,
    },
  };
}

function normalizePreloadedEarnings() {
  return (window.PORTFOLIO_EARNINGS || [])
    .filter((row) => row.ticker && row.fiscalYear)
    .map((row) => ({
      id: `earn_${row.ticker}_${row.fiscalYear}`,
      ticker: String(row.ticker).toUpperCase(),
      fiscalYear: Math.trunc(toNumber(row.fiscalYear)),
      eps: row.eps == null ? "" : toNumber(row.eps),
      revenue: row.revenue == null ? "" : toNumber(row.revenue),
      netIncome: row.netIncome == null ? "" : toNumber(row.netIncome),
      price: row.price == null ? "" : toNumber(row.price),
      fiscalDate: row.fiscalDate || "",
      source: row.source || "StockAnalysis",
    }));
}

function normalizePreloadedFundamentals() {
  const sourceRows = (window.PORTFOLIO_FUNDAMENTALS || window.PORTFOLIO_EARNINGS || [])
    .filter((row) => row.ticker && row.fiscalYear);
  return sourceRows.map((row) => {
    const operatingCashFlow = row.operatingCashFlow == null ? "" : toNumber(row.operatingCashFlow);
    const capex = row.capex == null ? "" : toNumber(row.capex);
    const explicitFcf = row.freeCashFlow == null ? "" : toNumber(row.freeCashFlow);
    const freeCashFlow = explicitFcf !== "" ? explicitFcf : operatingCashFlow !== "" && capex !== "" ? operatingCashFlow + capex : "";
    return {
      id: `fund_${row.ticker}_${row.fiscalYear}`,
      ticker: String(row.ticker).toUpperCase(),
      fiscalYear: Math.trunc(toNumber(row.fiscalYear)),
      fiscalDate: row.fiscalDate || "",
      revenue: row.revenue == null ? "" : toNumber(row.revenue),
      netIncome: row.netIncome == null ? "" : toNumber(row.netIncome),
      eps: row.eps == null ? "" : toNumber(row.eps),
      price: row.price == null ? "" : toNumber(row.price),
      operatingCashFlow,
      capex,
      freeCashFlow,
      freeCashFlowPerShare: row.freeCashFlowPerShare == null ? "" : toNumber(row.freeCashFlowPerShare),
      ebitda: row.ebitda == null ? "" : toNumber(row.ebitda),
      assets: row.assets == null ? "" : toNumber(row.assets),
      liabilities: row.liabilities == null ? "" : toNumber(row.liabilities),
      equity: row.equity == null ? "" : toNumber(row.equity),
      productMix: Array.isArray(row.productMix) ? row.productMix : [],
      source: row.source || "StockAnalysis",
    };
  });
}

function createEmptyImports() {
  return {
    dividendEvents: [],
    dividendForecasts: [],
    dividendAnnualPerShare: [],
    lastResult: null,
  };
}

function normalizeDividendImportEvent(row, fallbackSource = "Import") {
  const ticker = String(importValue(row, ["ticker", "symbol", "simbolo"]) || "").trim().toUpperCase();
  if (!ticker) return null;
  const exDate = parseImportDate(importValue(row, ["exDate", "exDividendDate", "ex-dividend date", "data ex"]));
  const recordDate = parseImportDate(importValue(row, ["recordDate", "record date", "data record"]));
  const payDate = parseImportDate(importValue(row, ["payDate", "paymentDate", "payableDate", "pay date", "data pagamento", "date", "data"]));
  const explicitYear = parseLooseNumber(importValue(row, ["year", "ano"]));
  const dateForPeriod = payDate || exDate || recordDate;
  const year = Number.isFinite(explicitYear)
    ? Math.trunc(explicitYear)
    : dateForPeriod
      ? new Date(`${dateForPeriod}T00:00:00`).getFullYear()
      : NaN;
  const explicitMonth = parseMonthIndex(importValue(row, ["monthIndex", "month", "mes", "mês"]));
  const monthIndex = explicitMonth || (dateForPeriod ? new Date(`${dateForPeriod}T00:00:00`).getMonth() + 1 : null);
  if (!Number.isFinite(year) || !monthIndex) return null;
  const amountPerShare = parseLooseNumber(
    importValue(row, ["amountPerShare", "cashAmount", "cash amount", "dividendPerShare", "dividend", "amount", "valor por acao"]),
  );
  const gross = parseLooseNumber(importValue(row, ["gross", "bruto", "grossAmount", "valor bruto"]));
  if (!Number.isFinite(amountPerShare) && !Number.isFinite(gross)) return null;
  const source = importValue(row, ["source", "fonte"]) || fallbackSource;
  const portfolioId = String(importValue(row, ["portfolioId", "portfolio", "carteira"]) || "").trim();
  const id =
    importValue(row, ["id"]) ||
    stableImportId("impdiv", [portfolioId, ticker, year, monthIndex, payDate || exDate || recordDate, amountPerShare || gross]);
  return {
    id,
    ticker,
    portfolioId,
    year,
    monthIndex,
    month: monthNames[monthIndex - 1],
    amountPerShare: Number.isFinite(amountPerShare) ? amountPerShare : "",
    gross: Number.isFinite(gross) ? gross : "",
    exDate,
    recordDate,
    payDate,
    source,
    importedAt: importValue(row, ["importedAt", "importadoEm"]) || "",
  };
}

function normalizeDividendForecastImport(row, fallbackSource = "Import") {
  const ticker = String(importValue(row, ["ticker", "symbol", "simbolo"]) || "").trim().toUpperCase();
  if (!ticker) return null;
  const monthlyDividend = parseLooseNumber(importValue(row, ["monthlyDividend", "amountPerShare", "dividend", "amount", "valor por acao"]));
  const annualDividendPerShare = parseLooseNumber(importValue(row, ["annualDividendPerShare", "annualDividend", "dividendAnnual", "dividendo anual"]));
  const months = {};
  monthNames.forEach((month, index) => {
    const monthValue = importValue(row, [month, monthShort[index], normalizeText(month)]);
    months[month] = ["1", "true", "yes", "sim", "x"].includes(normalizeText(monthValue));
  });
  const explicitMonths = String(importValue(row, ["months", "meses"]) || "").split(/[|,; ]+/).filter(Boolean);
  explicitMonths.forEach((month) => {
    const index = parseMonthIndex(month);
    if (index) months[monthNames[index - 1]] = true;
  });
  if (!Object.values(months).some(Boolean)) return null;
  if (!Number.isFinite(monthlyDividend) && !Number.isFinite(annualDividendPerShare)) return null;
  const activeMonths = Object.values(months).filter(Boolean).length || 1;
  const source = importValue(row, ["source", "fonte"]) || fallbackSource;
  return {
    id: importValue(row, ["id"]) || stableImportId("impforecast", [ticker, monthlyDividend || annualDividendPerShare, activeMonths]),
    ticker,
    months,
    monthlyDividend: Number.isFinite(monthlyDividend) ? monthlyDividend : annualDividendPerShare / activeMonths,
    annualDividendPerShare: Number.isFinite(annualDividendPerShare) ? annualDividendPerShare : monthlyDividend * activeMonths,
    source,
    importedAt: importValue(row, ["importedAt", "importadoEm"]) || "",
  };
}

function normalizeDividendAnnualPerShareImport(row, fallbackSource = "Import") {
  const ticker = String(importValue(row, ["ticker", "symbol", "simbolo"]) || "").trim().toUpperCase();
  const year = Math.trunc(parseLooseNumber(importValue(row, ["year", "ano", "fiscalYear", "fiscal year"])));
  const annualDividendPerShare = parseLooseNumber(
    importValue(row, [
      "annualDividendPerShare",
      "annualPerShare",
      "dividendAnnualPerShare",
      "dividendPerShareAnnual",
      "receivedAnnualPerShare",
      "amountPerShare",
      "dividendPerShare",
      "dividend",
      "amount",
      "valor por acao",
      "valor anual por acao",
      "valorAnualPorAcao",
      "dividendo anual por acao",
      "recebido anual por acao",
    ]),
  );
  if (!ticker || !Number.isFinite(year) || !Number.isFinite(annualDividendPerShare)) return null;
  const source = importValue(row, ["source", "fonte"]) || fallbackSource;
  return {
    id: importValue(row, ["id"]) || stableImportId("impannual", [ticker, year]),
    ticker,
    year,
    annualDividendPerShare,
    source,
    notes: importValue(row, ["notes", "notas"]) || "",
    importedAt: importValue(row, ["importedAt", "importadoEm"]) || "",
  };
}

function normalizePreloadedImports() {
  const source = window.PORTFOLIO_IMPORTS || {};
  const imports = createEmptyImports();
  const sourceName = source.meta?.provider || "imports-data.js";
  imports.dividendEvents = (source.dividendEvents || [])
    .map((row) => normalizeDividendImportEvent(row, sourceName))
    .filter(Boolean);
  imports.dividendForecasts = (source.dividendForecasts || [])
    .map((row) => normalizeDividendForecastImport(row, sourceName))
    .filter(Boolean);
  imports.dividendAnnualPerShare = (source.dividendAnnualPerShare || [])
    .map((row) => normalizeDividendAnnualPerShareImport(row, sourceName))
    .filter(Boolean);
  if (source.meta && (imports.dividendEvents.length || imports.dividendForecasts.length || imports.dividendAnnualPerShare.length || source.meta.rows)) {
    imports.lastResult = {
      kind: "imports-data.js",
      source: sourceName,
      imported: imports.dividendEvents.length + imports.dividendForecasts.length + imports.dividendAnnualPerShare.length,
      updated: 0,
      skipped: 0,
      importedAt: source.meta.attemptedAt || "",
    };
  }
  return imports;
}

function normalizePreloadedPriceImportRow(row, fallbackSource) {
  const ticker = String(importValue(row, ["ticker", "symbol", "simbolo"]) || "").trim().toUpperCase();
  const price = parseLooseNumber(importValue(row, ["price", "preco", "last", "close", "cotacao", "valor"]));
  if (!ticker || !Number.isFinite(price) || price <= 0) return null;
  return {
    ticker,
    price,
    source: importValue(row, ["source", "provider", "fonte"]) || fallbackSource,
    url: importValue(row, ["url", "href"]) || "",
    fetchedAt: importValue(row, ["fetchedAt", "updatedAt", "attemptedAt", "importedAt"]) || "",
    timestamp: importValue(row, ["timestamp", "marketTime", "time"]) || "",
  };
}

function normalizePreloadedPriceUpdate(row, prices, fallbackSource) {
  if (!row) return null;
  const slot = priceUpdateSlots[row.slot] ? row.slot : suggestedPriceUpdateSlot();
  const stamp = row.completedAt || row.updatedAt || row.attemptedAt || row.fetchedAt || new Date().toISOString();
  const stampDate = new Date(stamp);
  const date = parseImportDate(row.date) || localIsoDate(Number.isFinite(stampDate.getTime()) ? stampDate : new Date());
  const tickers = Array.isArray(row.tickers) && row.tickers.length ? row.tickers : prices.map((price) => price.ticker);
  return {
    id: `${date}_${slot}`,
    date,
    slot,
    source: row.source || row.provider || fallbackSource,
    imported: toNumber(row.imported || row.rows || prices.length),
    updated: toOptionalNumber(row.updated),
    tickers,
    updatedAt: stamp,
    errors: Array.isArray(row.errors) ? row.errors : [],
  };
}

function normalizePreloadedPriceImports() {
  const source = window.PORTFOLIO_PRICE_IMPORTS || {};
  const fallbackSource = source.meta?.provider || "prices-data.js";
  let rawRows = [];
  if (Array.isArray(source.prices)) rawRows = source.prices;
  else if (Array.isArray(source.rows)) rawRows = source.rows;
  else if (source.prices && typeof source.prices === "object") {
    rawRows = Object.entries(source.prices).map(([ticker, price]) => ({ ticker, price }));
  }
  const prices = rawRows.map((row) => normalizePreloadedPriceImportRow(row, fallbackSource)).filter(Boolean);
  const rawUpdates = [];
  if (source.meta) rawUpdates.push(source.meta);
  if (Array.isArray(source.updates)) rawUpdates.push(...source.updates);
  const seenUpdates = new Set();
  const updates = rawUpdates
    .map((row) => normalizePreloadedPriceUpdate(row, prices, fallbackSource))
    .filter((row) => {
      if (!row || (!row.imported && !prices.length)) return false;
      const key = `${row.date}:${row.slot}`;
      if (seenUpdates.has(key)) return false;
      seenUpdates.add(key);
      return true;
    });
  if (!updates.length && prices.length) {
    updates.push(
      normalizePreloadedPriceUpdate(
        { ...source.meta, imported: prices.length, source: fallbackSource },
        prices,
        fallbackSource,
      ),
    );
  }
  return { prices, updates, meta: source.meta || null };
}

function mergePriceImportsIntoStore(targetStore, preloaded, options = {}) {
  const payload = preloaded || normalizePreloadedPriceImports();
  const unique = new Map((payload.prices || []).map((row) => [row.ticker, row]));
  let updated = 0;
  unique.forEach((row) => {
    if (targetStore.prices[row.ticker] !== row.price) updated += 1;
    targetStore.prices[row.ticker] = row.price;
    if (targetStore.dcf?.[row.ticker]) {
      targetStore.dcf[row.ticker] = { ...targetStore.dcf[row.ticker], currentPrice: row.price };
    }
  });
  targetStore.priceUpdates = targetStore.priceUpdates || [];
  (payload.updates || []).forEach((row) => {
    const update = {
      ...row,
      updated: Number.isFinite(row.updated) ? row.updated : updated,
      tickers: row.tickers?.length ? row.tickers : [...unique.keys()],
    };
    const existingIndex = targetStore.priceUpdates.findIndex((entry) => entry.date === update.date && entry.slot === update.slot);
    if (existingIndex >= 0) targetStore.priceUpdates.splice(existingIndex, 1, { ...targetStore.priceUpdates[existingIndex], ...update });
    else targetStore.priceUpdates.push(update);
  });
  if (options.refreshWatchlist) refreshWatchlistImportedData(unique.keys());
  return { imported: unique.size, updated, updates: (payload.updates || []).length };
}

function loadStore() {
  const seed = createSeedStore();
  for (const key of [STORE_KEY, ...LEGACY_STORE_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const hydrated = hydrateStore({
        ...seed,
        ...parsed,
        settings: { ...seed.settings, ...(parsed.settings || {}) },
        prices: { ...seed.prices, ...(parsed.prices || {}) },
      });
      if (key !== STORE_KEY) {
        localStorage.setItem(STORE_KEY, JSON.stringify(hydrated));
      }
      return hydrated;
    } catch {}
  }
  return hydrateStore(seed);
}

function hydrateStore(nextStore) {
  nextStore.deposits = nextStore.deposits || createSeedStore().deposits;
  nextStore.watchlist = nextStore.watchlist || [];
  nextStore.prices = nextStore.prices || {};
  nextStore.priceUpdates = nextStore.priceUpdates || [];
  nextStore.earnings = nextStore.earnings || [];
  nextStore.fundamentals = nextStore.fundamentals || [];
  nextStore.dcf = nextStore.dcf || {};
  nextStore.valuations = nextStore.valuations || [];
  nextStore.imports = {
    ...createEmptyImports(),
    ...(nextStore.imports || {}),
    dividendEvents: nextStore.imports?.dividendEvents || [],
    dividendForecasts: nextStore.imports?.dividendForecasts || [],
    dividendAnnualPerShare: nextStore.imports?.dividendAnnualPerShare || [],
  };
  Object.keys(nextStore.settings).forEach((key) => {
    const normalized = key.toLowerCase();
    if (normalized.includes("api") && normalized.includes("key")) delete nextStore.settings[key];
  });
  const existing = new Set((nextStore.earnings || []).map((row) => `${row.ticker}:${row.fiscalYear}`));
  normalizePreloadedEarnings().forEach((row) => {
    const key = `${row.ticker}:${row.fiscalYear}`;
    if (!existing.has(key)) {
      nextStore.earnings.push(row);
      existing.add(key);
    }
  });
  const existingFundamentals = new Set((nextStore.fundamentals || []).map((row) => `${row.ticker}:${row.fiscalYear}`));
  normalizePreloadedFundamentals().forEach((row) => {
    const key = `${row.ticker}:${row.fiscalYear}`;
    if (!existingFundamentals.has(key)) {
      nextStore.fundamentals.push(row);
      existingFundamentals.add(key);
    }
  });
  const preloadedImports = normalizePreloadedImports();
  const existingDividendImports = new Set((nextStore.imports.dividendEvents || []).map((row) => row.id));
  preloadedImports.dividendEvents.forEach((row) => {
    if (!existingDividendImports.has(row.id)) {
      nextStore.imports.dividendEvents.push(row);
      existingDividendImports.add(row.id);
    }
  });
  const existingForecastImports = new Set((nextStore.imports.dividendForecasts || []).map((row) => row.id));
  preloadedImports.dividendForecasts.forEach((row) => {
    if (!existingForecastImports.has(row.id)) {
      nextStore.imports.dividendForecasts.push(row);
      existingForecastImports.add(row.id);
    }
  });
  const existingAnnualImports = new Set((nextStore.imports.dividendAnnualPerShare || []).map((row) => row.id));
  preloadedImports.dividendAnnualPerShare.forEach((row) => {
    if (!existingAnnualImports.has(row.id)) {
      nextStore.imports.dividendAnnualPerShare.push(row);
      existingAnnualImports.add(row.id);
    }
  });
  if (preloadedImports.lastResult && (!nextStore.imports.lastResult || preloadedImports.lastResult.importedAt)) {
    nextStore.imports.lastResult = preloadedImports.lastResult;
  }
  mergePriceImportsIntoStore(nextStore, normalizePreloadedPriceImports());
  return nextStore;
}

let store = loadStore();

function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function applyPreloadedPriceImports(options = {}) {
  const result = mergePriceImportsIntoStore(store, normalizePreloadedPriceImports(), { refreshWatchlist: true });
  if (options.persist && (result.imported || result.updates)) saveStore();
  return result;
}

function isDesktopAppMode() {
  try {
    const loc = window.location || {};
    return loc.protocol === "http:" && ["127.0.0.1", "localhost"].includes(loc.hostname);
  } catch {
    return false;
  }
}

async function appProcessRequest(path, options = {}) {
  if (!isDesktopAppMode()) return null;
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Pedido falhou (${response.status})`);
  return payload;
}

function watchlistTickersForSync() {
  return [...new Set((store.watchlist || []).map((row) => String(row.ticker || "").trim().toUpperCase()).filter(Boolean))].sort();
}

async function syncWatchlistTickersToAppProcess(options = {}) {
  if (!isDesktopAppMode()) {
    if (options.alert) window.alert("Abre a app pelo atalho local para sincronizar a watchlist automaticamente.");
    return { ok: false, tickers: [] };
  }
  try {
    const payload = await appProcessRequest("/api/watchlist-tickers", {
      method: "POST",
      body: JSON.stringify({ tickers: watchlistTickersForSync() }),
    });
    if (options.alert) window.alert(`Watchlist sincronizada: ${payload.tickers?.length || 0} tickers.`);
    return payload;
  } catch (error) {
    if (options.alert) window.alert(`Nao foi possivel sincronizar a watchlist: ${error.message || error}`);
    return { ok: false, error: String(error.message || error) };
  }
}

async function refreshAppProcessStatus(options = {}) {
  if (!isDesktopAppMode()) {
    state.appProcess = { ...state.appProcess, available: false, checked: true };
    return null;
  }
  try {
    const payload = await appProcessRequest("/api/status");
    state.appProcess = {
      available: true,
      checked: true,
      runningImport: Boolean(payload.runningImport),
      nextRun: payload.nextRun || null,
      totalTickers: payload.totalTickers || 0,
      lastRun: payload.lastRun || payload.pricesMeta || null,
    };
    if (options.renderAfter) render();
    return payload;
  } catch {
    state.appProcess = { ...state.appProcess, available: false, checked: true };
    if (options.renderAfter) render();
    return null;
  }
}

function reloadAutoPriceImports(options = {}) {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `./prices-data.js?v=${Date.now()}`;
    script.onload = () => {
      script.remove();
      const result = applyPreloadedPriceImports({ persist: true });
      render();
      if (options.alert !== false) {
        window.alert(result.imported ? `Import automatico carregado: ${result.imported} precos.` : "Nao encontrei precos automaticos novos.");
      }
      resolve(result);
    };
    script.onerror = () => {
      script.remove();
      if (options.alert !== false) window.alert("Nao foi possivel carregar prices-data.js.");
      resolve({ imported: 0, updated: 0, updates: 0 });
    };
    document.head.appendChild(script);
  });
}

async function requestAutoPriceImportNow() {
  if (!isDesktopAppMode()) {
    window.alert("Abre a app pelo atalho local para usar a importacao automatica.");
    return;
  }
  try {
    state.appProcess.runningImport = true;
    render();
    const payload = await appProcessRequest("/api/import-prices", {
      method: "POST",
      body: JSON.stringify({ slot: state.priceUpdateSlot || suggestedPriceUpdateSlot(), provider: "auto" }),
    });
    await reloadAutoPriceImports({ alert: false });
    await refreshAppProcessStatus();
    const meta = payload.meta || {};
    window.alert(`Import automatico concluido: ${meta.imported || 0} precos, ${meta.errors?.length || 0} falhas.`);
    render();
  } catch (error) {
    window.alert(`Nao foi possivel importar agora: ${error.message || error}`);
  } finally {
    state.appProcess.runningImport = false;
    render();
  }
}

function cloneForBackup(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBackupPayload() {
  return {
    app: "simpleequity",
    version: BACKUP_FILE_VERSION,
    storeKey: STORE_KEY,
    exportedAt: new Date().toISOString(),
    source: {
      name: DATA.source.name,
      lastModified: DATA.source.lastModified,
    },
    data: cloneForBackup(store),
  };
}

function backupRecordCount() {
  const imports = store.imports || {};
  return [
    store.portfolios,
    store.transactions,
    store.deposits,
    store.dividends,
    store.watchlist,
    store.priceUpdates,
    store.earnings,
    store.fundamentals,
    store.valuations,
    store.benchmarks,
    Object.keys(store.dcf || {}),
    imports.dividendEvents,
    imports.dividendForecasts,
    imports.dividendAnnualPerShare,
  ].reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

function backupSizeLabel() {
  const bytes = JSON.stringify(createBackupPayload()).length;
  if (bytes >= 1024 * 1024) return `${number(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${number(bytes / 1024)} KB`;
  return `${formatters.int.format(bytes)} B`;
}

function hydrateImportedStore(payload) {
  const candidate = payload?.data || payload?.store || payload;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Ficheiro JSON invalido.");
  }
  if (!Array.isArray(candidate.portfolios) && !Array.isArray(candidate.transactions) && !Array.isArray(candidate.dividends)) {
    throw new Error("O JSON nao parece ser um backup desta app.");
  }
  const seed = createSeedStore();
  return hydrateStore({
    ...seed,
    ...candidate,
    settings: { ...seed.settings, ...(candidate.settings || {}) },
    prices: { ...seed.prices, ...(candidate.prices || {}) },
  });
}

function exportStoreBackup() {
  try {
    const payload = createBackupPayload();
    const json = JSON.stringify(payload, null, 2);
    const urlApi = window.URL || window.webkitURL;
    const blob = new Blob([json], { type: "application/json" });
    const url = urlApi.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `simpleequity-backup-${payload.exportedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    urlApi.revokeObjectURL(url);
  } catch (error) {
    window.alert(`Nao foi possivel exportar o backup: ${error.message || error}`);
  }
}

async function importStoreBackupFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const importedStore = hydrateImportedStore(parsed);
    const ok = window.confirm("Importar este backup e substituir os dados locais atuais?");
    if (!ok) return;
    store = importedStore;
    saveStore();
    render();
    window.alert("Backup importado com sucesso.");
  } catch (error) {
    window.alert(`Nao foi possivel importar o backup: ${error.message || error}`);
  }
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function priceUpdateSlotLabel(slot) {
  const item = priceUpdateSlots[slot] || priceUpdateSlots.open;
  return `${item.label} ${item.time}`;
}

function suggestedPriceUpdateSlot() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const closeMinutes = 21 * 60 + 15;
  return minutes >= closeMinutes ? "close" : "open";
}

function priceUpdateForDate(slot, date = localIsoDate()) {
  return (store.priceUpdates || []).find((row) => row.slot === slot && row.date === date) || null;
}

function latestPriceUpdate() {
  return (store.priceUpdates || [])
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}

function priceUpdatePlaceholder() {
  const symbols = [...new Set([...getHoldings(true).map((row) => row.ticker), ...(store.watchlist || []).map((row) => row.ticker)])]
    .filter(Boolean)
    .slice(0, 6);
  const sample = symbols.length ? symbols : ["MSFT", "NVDA", "KO"];
  return `ticker;price\n${sample.map((ticker) => `${ticker};`).join("\n")}`;
}

function normalizePriceImportRow(row) {
  const ticker = String(importValue(row, ["ticker", "symbol", "simbolo"]) || "").trim().toUpperCase();
  const price = parseLooseNumber(importValue(row, ["price", "preco", "preço", "last", "close", "cotacao", "cotação", "valor"]));
  if (!ticker || !Number.isFinite(price) || price <= 0) return null;
  return { ticker, price };
}

function importPriceRows(values) {
  const rows = parseImportRows(values.payload).map(normalizePriceImportRow).filter(Boolean);
  const unique = new Map(rows.map((row) => [row.ticker, row]));
  const normalizedRows = [...unique.values()];
  if (!normalizedRows.length) return { imported: 0, updated: 0, skipped: rows.length };
  const slot = priceUpdateSlots[values.slot] ? values.slot : suggestedPriceUpdateSlot();
  const date = values.date || localIsoDate();
  let updated = 0;
  normalizedRows.forEach((row) => {
    if (store.prices[row.ticker] !== row.price) updated += 1;
    store.prices[row.ticker] = row.price;
    if (store.dcf?.[row.ticker]) {
      store.dcf[row.ticker] = { ...store.dcf[row.ticker], currentPrice: row.price };
    }
  });
  store.priceUpdates = store.priceUpdates || [];
  const payload = {
    id: `${date}_${slot}`,
    date,
    slot,
    source: values.source || "Manual",
    imported: normalizedRows.length,
    updated,
    tickers: normalizedRows.map((row) => row.ticker),
    updatedAt: new Date().toISOString(),
  };
  const existingIndex = store.priceUpdates.findIndex((row) => row.date === date && row.slot === slot);
  if (existingIndex >= 0) store.priceUpdates.splice(existingIndex, 1, payload);
  else store.priceUpdates.push(payload);
  (store.watchlist || []).forEach((row) => {
    if (unique.has(row.ticker)) row.importedData = watchlistImportedData(row.ticker, row);
  });
  return { imported: normalizedRows.length, updated, skipped: Math.max(0, parseImportRows(values.payload).length - normalizedRows.length) };
}

function scopedPortfolioIds() {
  if (state.scope === "all") return store.portfolios.map((portfolio) => portfolio.id);
  return [state.scope];
}

function scopedPortfolios() {
  const ids = new Set(scopedPortfolioIds());
  return store.portfolios.filter((portfolio) => ids.has(portfolio.id));
}

function portfolioName(id) {
  return store.portfolios.find((portfolio) => portfolio.id === id)?.name || "Portfolio";
}

function portfolioCurrency(id) {
  return store.portfolios.find((portfolio) => portfolio.id === id)?.currency || "USD";
}

function selectedCapitalPortfolio() {
  const scoped = state.scope === "all" ? store.portfolios[0]?.id : state.scope;
  if (!state.capitalPortfolioId || !store.portfolios.some((portfolio) => portfolio.id === state.capitalPortfolioId)) {
    state.capitalPortfolioId = scoped || store.portfolios[0]?.id || "";
  }
  return state.capitalPortfolioId;
}

function transactionsInScope() {
  const ids = new Set(scopedPortfolioIds());
  return store.transactions.filter((transaction) => ids.has(transaction.portfolioId));
}

function dividendsInScope() {
  const ids = new Set(scopedPortfolioIds());
  return store.dividends.filter((dividend) => ids.has(dividend.portfolioId));
}

function depositsInScope() {
  const ids = new Set(scopedPortfolioIds());
  return (store.deposits || []).filter((deposit) => ids.has(deposit.portfolioId));
}

function getHoldings(includeClosed = false) {
  const positions = new Map();
  const sorted = transactionsInScope()
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  sorted.forEach((tx) => {
    const key = `${tx.portfolioId}:${tx.ticker.toUpperCase()}`;
    const current =
      positions.get(key) ||
      {
        portfolioId: tx.portfolioId,
        ticker: tx.ticker.toUpperCase(),
        sector: getTickerMeta(tx.ticker.toUpperCase()).sector,
        type: tx.instrumentType || getTickerMeta(tx.ticker.toUpperCase()).type,
        quantity: 0,
        cost: 0,
        invested: 0,
        realized: 0,
      };
    const qty = Math.max(0, toNumber(tx.quantity));
    const price = Math.max(0, toNumber(tx.price));
    const amount = qty * price + toNumber(tx.fees);
    if (tx.side === "sell") {
      const sellQty = Math.min(qty, current.quantity);
      const avgCost = current.quantity > 0 ? current.cost / current.quantity : 0;
      current.quantity -= sellQty;
      current.cost -= avgCost * sellQty;
      current.realized += sellQty * (price - avgCost) - toNumber(tx.fees);
    } else {
      current.quantity += qty;
      current.cost += amount;
      current.invested += amount;
    }
    positions.set(key, current);
  });

  const dividendsByTicker = new Map();
  dividendsInScope().forEach((dividend) => {
    const key = `${dividend.portfolioId}:${dividend.ticker.toUpperCase()}`;
    dividendsByTicker.set(key, (dividendsByTicker.get(key) || 0) + toNumber(dividend.net));
  });

  const rows = [...positions.values()]
    .filter((position) => includeClosed || position.quantity > 0.000001)
    .map((position) => {
      const price = store.prices[position.ticker] || (position.quantity ? position.cost / position.quantity : 0);
      const value = position.quantity * price;
      const avgCost = position.quantity ? position.cost / position.quantity : 0;
      const unrealized = value - position.cost;
      const dividends = dividendsByTicker.get(`${position.portfolioId}:${position.ticker}`) || 0;
      return {
        ...position,
        price,
        value,
        avgCost,
        unrealized,
        dividends,
        totalPl: unrealized + position.realized + dividends,
        totalPlPct: position.invested ? (unrealized + position.realized + dividends) / position.invested : 0,
      };
    });

  const totalValue = rows.filter((row) => row.quantity > 0.000001).reduce((total, row) => total + row.value, 0) || 1;
  return rows.map((row) => ({ ...row, portfolioPct: row.value / totalValue }));
}

function getSummary() {
  const positions = getHoldings(true);
  const holdings = positions.filter((row) => row.quantity > 0.000001);
  const transactions = transactionsInScope();
  const dividends = dividendsInScope();
  const deposited = depositsInScope().reduce((total, deposit) => total + toNumber(deposit.usd), 0);
  const buyCost = transactions
    .filter((transaction) => transaction.side === "buy")
    .reduce((total, transaction) => total + transaction.quantity * transaction.price + toNumber(transaction.fees), 0);
  const invested = deposited || buyCost;
  const currentValue = holdings.reduce((total, row) => total + row.value, 0);
  const unrealized = holdings.reduce((total, row) => total + row.unrealized, 0);
  const realized = positions.reduce((total, row) => total + row.realized, 0);
  const grossDividends = dividends.reduce((total, row) => total + toNumber(row.gross), 0);
  const tax = dividends.reduce((total, row) => total + toNumber(row.withholding), 0);
  const netDividends = dividends.reduce((total, row) => total + toNumber(row.net), 0);
  const netProfit = unrealized + realized + netDividends;
  return {
    invested,
    currentValue,
    unrealized,
    realized,
    grossDividends,
    tax,
    netDividends,
    netProfit,
    returnPct: invested ? netProfit / invested : 0,
    holdingsCount: holdings.length,
    transactionsCount: transactions.length,
  };
}

function depositUsd(row) {
  return toNumber(row.usd);
}

function depositEur(row) {
  return toNumber(row.eur);
}

function transactionGross(row) {
  return toNumber(row.quantity) * toNumber(row.price);
}

function transactionCost(row) {
  return transactionGross(row) + toNumber(row.fees);
}

function isOnOrBefore(date, cutoff) {
  if (!cutoff) return true;
  return String(date || "").slice(0, 10) <= cutoff;
}

function isBetweenDates(date, start, end) {
  const value = String(date || "").slice(0, 10);
  return value >= start && value <= end;
}

function dividendDate(row) {
  return `${row.year}-${String(row.monthIndex || 1).padStart(2, "0")}-15`;
}

function cashSummary(cutoff = "") {
  const transactions = transactionsInScope().filter((row) => isOnOrBefore(row.date, cutoff));
  const deposits = depositsInScope().filter((row) => isOnOrBefore(row.date, cutoff));
  const dividends = dividendsInScope().filter((row) => isOnOrBefore(dividendDate(row), cutoff));
  const holdings = cutoff ? portfolioStateAt(cutoff).holdings : getHoldings();
  const deposited = deposits.reduce((total, row) => total + depositUsd(row), 0);
  const depositedEur = deposits.reduce((total, row) => total + depositEur(row), 0);
  const buyCost = transactions.filter((row) => row.side === "buy").reduce((total, row) => total + transactionCost(row), 0);
  const sellProceeds = transactions.filter((row) => row.side === "sell").reduce((total, row) => total + transactionGross(row) - toNumber(row.fees), 0);
  const netDividends = dividends.reduce((total, row) => total + toNumber(row.net), 0);
  const investedOpen = holdings.reduce((total, row) => total + toNumber(row.cost), 0);
  const currentValue = holdings.reduce((total, row) => total + toNumber(row.value), 0);
  const freeFunds = deposited + sellProceeds + netDividends - buyCost;
  return {
    deposited,
    depositedEur,
    buyCost,
    sellProceeds,
    netDividends,
    investedOpen,
    currentValue,
    freeFunds,
    patrimony: currentValue + freeFunds,
  };
}

function portfolioStateAt(cutoff) {
  const positions = new Map();
  transactionsInScope()
    .filter((row) => isOnOrBefore(row.date, cutoff))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((tx) => {
      const key = `${tx.portfolioId}:${tx.ticker.toUpperCase()}`;
      const current =
        positions.get(key) ||
        {
          portfolioId: tx.portfolioId,
          ticker: tx.ticker.toUpperCase(),
          quantity: 0,
          cost: 0,
          realized: 0,
        };
      const qty = Math.max(0, toNumber(tx.quantity));
      const price = Math.max(0, toNumber(tx.price));
      if (tx.side === "sell") {
        const sellQty = Math.min(qty, current.quantity);
        const avgCost = current.quantity > 0 ? current.cost / current.quantity : 0;
        current.quantity -= sellQty;
        current.cost -= avgCost * sellQty;
        current.realized += sellQty * (price - avgCost) - toNumber(tx.fees);
      } else {
        current.quantity += qty;
        current.cost += qty * price + toNumber(tx.fees);
      }
      positions.set(key, current);
    });

  const holdings = [...positions.values()]
    .filter((position) => position.quantity > 0.000001)
    .map((position) => {
      const price = store.prices[position.ticker] || (position.quantity ? position.cost / position.quantity : 0);
      const value = position.quantity * price;
      return { ...position, price, value };
    });
  const currentValue = holdings.reduce((total, row) => total + row.value, 0);
  const summary = cashSummaryWithoutState(cutoff, currentValue);
  return { ...summary, holdings, currentValue, patrimony: currentValue + summary.freeFunds };
}

function cashSummaryWithoutState(cutoff, currentValue = 0) {
  const transactions = transactionsInScope().filter((row) => isOnOrBefore(row.date, cutoff));
  const deposits = depositsInScope().filter((row) => isOnOrBefore(row.date, cutoff));
  const dividends = dividendsInScope().filter((row) => isOnOrBefore(dividendDate(row), cutoff));
  const deposited = deposits.reduce((total, row) => total + depositUsd(row), 0);
  const depositedEur = deposits.reduce((total, row) => total + depositEur(row), 0);
  const buyCost = transactions.filter((row) => row.side === "buy").reduce((total, row) => total + transactionCost(row), 0);
  const sellProceeds = transactions.filter((row) => row.side === "sell").reduce((total, row) => total + transactionGross(row) - toNumber(row.fees), 0);
  const netDividends = dividends.reduce((total, row) => total + toNumber(row.net), 0);
  const freeFunds = deposited + sellProceeds + netDividends - buyCost;
  return { deposited, depositedEur, buyCost, sellProceeds, netDividends, freeFunds, patrimony: currentValue + freeFunds };
}

function daysBetween(start, end) {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

function annualReturnRows() {
  const candidates = [
    DATA.summary.startDate,
    ...depositsInScope().map((row) => row.date),
    ...transactionsInScope().map((row) => row.date),
  ].filter(Boolean);
  const firstYear = candidates.length ? Math.min(...candidates.map((date) => Number(String(date).slice(0, 4)))) : new Date().getFullYear();
  const currentYear = new Date(DATA.summary.asOfDate || Date.now()).getFullYear();
  return Array.from({ length: currentYear - firstYear + 1 }, (_, index) => firstYear + index).map((year) => {
    const start = `${year}-01-01`;
    const end = year === currentYear ? DATA.summary.asOfDate || new Date().toISOString().slice(0, 10) : `${year}-12-31`;
    const prevEnd = `${year - 1}-12-31`;
    const beginState = portfolioStateAt(prevEnd);
    const endState = portfolioStateAt(end);
    const flows = depositsInScope().filter((row) => isBetweenDates(row.date, start, end));
    const flowTotal = flows.reduce((total, row) => total + depositUsd(row), 0);
    const periodDays = Math.max(1, daysBetween(start, end) + 1);
    const weightedFlows = flows.reduce((total, row) => {
      const remainingDays = daysBetween(row.date, end) + 1;
      return total + depositUsd(row) * (remainingDays / periodDays);
    }, 0);
    const gain = endState.patrimony - beginState.patrimony - flowTotal;
    const denominator = beginState.patrimony + weightedFlows;
    const returnPct = denominator ? gain / denominator : NaN;
    return {
      year,
      beginValue: beginState.patrimony,
      endValue: endState.patrimony,
      flowTotal,
      weightedFlows,
      gain,
      returnPct,
    };
  });
}

function aggregateBy(items, keyFn, valueFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    map.set(key, (map.get(key) || 0) + valueFn(item));
  });
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

function sortRows(rows, sort) {
  return rows.slice().sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    const result =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""), "pt", { numeric: true });
    return result * sort.dir;
  });
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

function renderBackupPanel() {
  return `
    <section class="panel span-12 backup-panel">
      <div class="panel-header">
        <h2>Backup local</h2>
        <span class="badge">JSON</span>
      </div>
      <div class="panel-body backup-body">
        <div class="mini-grid backup-summary">
          <div class="mini-stat"><span>Chave local</span><strong>${escapeHtml(STORE_KEY)}</strong></div>
          <div class="mini-stat"><span>Registos</span><strong>${escapeHtml(formatters.int.format(backupRecordCount()))}</strong></div>
          <div class="mini-stat"><span>Tamanho</span><strong>${escapeHtml(backupSizeLabel())}</strong></div>
        </div>
        <div class="backup-actions">
          <button class="secondary-button" type="button" data-export-backup="1">Exportar dados</button>
          <button class="primary-button" type="button" data-import-backup="1">Importar backup</button>
          <input class="backup-file-input" id="backupImportInput" type="file" accept="application/json,.json" />
        </div>
      </div>
    </section>
  `;
}

function scopeBar(extra = "") {
  return `
    <div class="scope-bar">
      <label>
        <span>Portfolio</span>
        <select class="select" id="scopeSelect">
          <option value="all" ${state.scope === "all" ? "selected" : ""}>Total portfolio</option>
          ${store.portfolios
            .map(
              (portfolio) =>
                `<option value="${portfolio.id}" ${state.scope === portfolio.id ? "selected" : ""}>${escapeHtml(portfolio.name)}</option>`,
            )
            .join("")}
        </select>
      </label>
      ${extra}
    </div>
  `;
}

function renderTable({ columns, rows, sortKey }) {
  if (!rows.length) return `<div class="empty">Sem resultados.</div>`;
  const sort = sortKey ? state.sort[sortKey] : null;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${columns
              .map((column) => {
                const marker = sort && sort.key === column.key ? (sort.dir > 0 ? " &uarr;" : " &darr;") : "";
                const label = escapeHtml(column.label);
                return `<th class="${column.className || ""}">${
                  column.key && sortKey ? `<button data-sort="${sortKey}:${column.key}">${label}${marker}</button>` : label
                }</th>`;
              })
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  ${columns.map((column) => `<td class="${column.className || ""}">${column.render(row)}</td>`).join("")}
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
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
              <div class="signed-track"><span class="signed-fill ${cls}" style="width:${width}%"></span></div>
              <div class="bar-value ${item.value < 0 ? "negative" : "positive"}">${escapeHtml(optionsMoney(item.value))}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function optionsMoney(value) {
  return money(value);
}

function lineChart(series, options = {}) {
  const width = 860;
  const height = 310;
  const pad = { left: 62, right: 18, top: 22, bottom: 44 };
  const count = Math.max(...series.map((entry) => entry.points.length), 0);
  const values = series.flatMap((entry) => entry.points.map((point) => point.value)).filter(Number.isFinite);
  if (!count || !values.length) return `<div class="empty">Sem dados.</div>`;
  let min = Math.min(...values, options.includeZero === false ? Math.min(...values) : 0);
  let max = Math.max(...values, options.includeZero === false ? Math.max(...values) : 0);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const buffer = (max - min) * 0.08;
  min -= buffer;
  max += buffer;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (count === 1 ? 0 : (index / (count - 1)) * plotW);
  const y = (value) => pad.top + ((max - value) / (max - min)) * plotH;
  const yTicks = [0, 1, 2, 3].map((index) => min + ((max - min) * index) / 3);
  const labels = [
    { index: 0, anchor: "start" },
    { index: Math.floor((count - 1) / 2), anchor: "middle" },
    { index: count - 1, anchor: "end" },
  ];
  const first = series.find((entry) => entry.points.length)?.points || [];
  const yFormat = options.yFormat || axisMoney;
  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "Grafico")}">
      ${yTicks
        .map((tick) => {
          const yy = y(tick);
          return `
            <line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"></line>
            <text x="${pad.left - 10}" y="${yy + 4}" text-anchor="end">${escapeHtml(yFormat(tick))}</text>
          `;
        })
        .join("")}
      <line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"></line>
      ${series
        .map((entry) => {
          const points = entry.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
          return `<polyline points="${points}" fill="none" stroke="${entry.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
        })
        .join("")}
      ${series
        .map((entry) =>
          entry.points
            .map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="3.2" fill="${entry.color}"></circle>`)
            .join(""),
        )
        .join("")}
      ${labels
        .filter((item, index, all) => all.findIndex((candidate) => candidate.index === item.index) === index)
        .map((item) => {
          const point = first[item.index];
          return point ? `<text x="${x(item.index)}" y="${height - 14}" text-anchor="${item.anchor}">${escapeHtml(point.label)}</text>` : "";
        })
        .join("")}
    </svg>
    <div class="legend">
      ${series.map((entry) => `<span><i style="background:${entry.color}"></i>${escapeHtml(entry.name)}</span>`).join("")}
    </div>
  `;
}

function renderDashboard() {
  const summary = getSummary();
  const holdings = getHoldings().sort((a, b) => b.value - a.value);
  const sectors = aggregateBy(holdings, (row) => row.sector, (row) => row.value).sort((a, b) => b.value - a.value);
  const largest = holdings[0];
  const benchmarks = benchmarkRows();
  const components = [
    { label: "P/L aberto", value: summary.unrealized },
    { label: "P/L realizado", value: summary.realized },
    { label: "Dividendos liquidos", value: summary.netDividends },
    { label: "Retencao", value: -summary.tax },
  ];

  return `
    ${scopeBar()}
    <div class="kpi-grid">
      ${metricCard("Valor atual", money(summary.currentValue), `${summary.holdingsCount} posicoes abertas`, "positive")}
      ${metricCard("Investido", money(summary.invested), `${summary.transactionsCount} movimentos`)}
      ${metricCard("Retorno", pct(summary.returnPct), `Ganho liquido: ${money(summary.netProfit)}`, summary.netProfit >= 0 ? "positive" : "negative")}
      ${metricCard("Dividendos", money(summary.grossDividends), `Retencao: ${money(summary.tax)}`)}
      ${metricCard("P/L aberto", money(summary.unrealized), "Nao realizado", summary.unrealized >= 0 ? "positive" : "negative")}
      ${metricCard("P/L realizado", money(summary.realized), "Compras/vendas fechadas", summary.realized >= 0 ? "positive" : "negative")}
      ${metricCard("Maior posicao", largest?.ticker || "n/a", largest ? money(largest.value) : "n/a")}
      ${metricCard("Portfolios", String(scopedPortfolios().length), state.scope === "all" ? "Total agregado" : portfolioName(state.scope))}
    </div>
    <div class="panel-grid">
      <section class="panel span-6">
        <div class="panel-header"><h2>Top holdings</h2></div>
        <div class="panel-body">
          ${barList(holdings.slice(0, 10), {
            label: (item) => item.ticker,
            value: (item) => item.value,
            format: (value, item) => `${money(value)} · ${pct(item.portfolioPct)}`,
            color: (_, index) => ["var(--teal)", "var(--gold)", "var(--blue)", "var(--green)"][index % 4],
          })}
        </div>
      </section>
      <section class="panel span-6">
        <div class="panel-header"><h2>Retorno</h2></div>
        <div class="panel-body">${signedBars(components)}</div>
      </section>
      <section class="panel span-6">
        <div class="panel-header"><h2>Setores</h2></div>
        <div class="panel-body">
          ${barList(sectors, {
            label: (item) => item.label,
            value: (item) => item.value,
            format: (value) => money(value),
            color: (_, index) => ["var(--teal)", "var(--gold)", "var(--red)", "var(--blue)", "var(--green)"][index % 5],
          })}
        </div>
      </section>
      <section class="panel span-6">
        <div class="panel-header"><h2>Comparacao</h2></div>
        <div class="panel-body">
          ${barList(benchmarks.slice(0, 6), {
            label: (item) => item.symbol,
            value: (item) => Math.abs(item.returnPct),
            format: (_, item) => pct(item.returnPct),
            color: (item) => (item.returnPct >= 0 ? "var(--green)" : "var(--red)"),
          })}
        </div>
      </section>
      ${renderBackupPanel()}
    </div>
  `;
}

function renderPortfolios() {
  const originalScope = state.scope;
  const rows = store.portfolios.map((portfolio) => {
    state.scope = portfolio.id;
    const summary = getSummary();
    state.scope = originalScope;
    return { ...portfolio, ...summary };
  });
  state.scope = "all";
  const totalSummary = getSummary();
  state.scope = originalScope;
  return `
    ${scopeBar()}
    <div class="panel-grid">
      <section class="panel span-4">
        <div class="panel-header"><h2>Novo portfolio</h2></div>
        <div class="panel-body">
          <form class="form-grid" id="portfolioForm">
            <label><span>Nome</span><input class="input" name="name" required placeholder="Portfolio EUR" /></label>
            <label><span>Moeda</span><select class="select" name="currency"><option>USD</option><option>EUR</option></select></label>
            <label><span>Deposito inicial EUR</span><input class="input" type="number" step="0.01" min="0" name="initialDepositEur" placeholder="0" /></label>
            <label><span>Deposito inicial portfolio</span><input class="input" type="number" step="0.01" min="0" name="initialDepositUsd" placeholder="0" /></label>
            <label class="full"><span>Notas</span><input class="input" name="notes" placeholder="Estratégia, corretora, objetivo" /></label>
            <button class="primary-button" type="submit">Criar portfolio</button>
          </form>
        </div>
      </section>
      <section class="panel span-8">
        <div class="panel-header"><h2>Carteiras</h2><span class="badge">${rows.length} portfolios</span></div>
        <div class="panel-body">
          ${renderTable({
            rows,
            columns: [
              { label: "Portfolio", render: (row) => `<strong>${escapeHtml(row.name)}</strong>` },
              { label: "Moeda", render: (row) => escapeHtml(row.currency || "USD") },
              { label: "Valor", className: "num", render: (row) => money(row.currentValue) },
              { label: "Investido", className: "num", render: (row) => money(row.invested) },
              { label: "Retorno", className: "num", render: (row) => `<span class="${row.netProfit >= 0 ? "positive" : "negative"}">${pct(row.returnPct)}</span>` },
              { label: "Mov.", className: "num", render: (row) => formatters.int.format(row.transactionsCount) },
              { label: "", render: (row) => `<button class="text-button" data-set-scope="${row.id}">Abrir</button>` },
            ],
          })}
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-header"><h2>Total portfolio</h2></div>
        <div class="panel-body">
          <div class="mini-grid">
            ${metricMini("Valor total", money(totalSummary.currentValue))}
            ${metricMini("Investido total", money(totalSummary.invested))}
            ${metricMini("Retorno total", pct(totalSummary.returnPct))}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderCapital() {
  const cash = cashSummary();
  const returnRows = annualReturnRows();
  const latestReturn = returnRows.at(-1);
  const capitalPortfolioId = selectedCapitalPortfolio();
  const capitalCurrency = portfolioCurrency(capitalPortfolioId);
  const isEuroPortfolio = capitalCurrency === "EUR";
  const movements = depositsInScope()
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const portfolioOptions = store.portfolios
    .map((p) => `<option value="${p.id}" ${p.id === capitalPortfolioId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");
  const eurUsdSub = cash.depositedEur ? `${number(cash.depositedEur)} EUR deposited` : "No EUR total recorded";
  return `
    ${scopeBar()}
    <div class="kpi-grid">
      ${metricCard("Deposited USD", money(cash.deposited), `${movements.length} capital movements`)}
      ${metricCard("Deposited EUR", `${number(cash.depositedEur)} EUR`, "Home currency")}
      ${metricCard("Free cash", money(cash.freeFunds), "Deposits + sales + dividends - buys", cash.freeFunds >= 0 ? "positive" : "negative")}
      ${metricCard("Total assets", money(cash.patrimony), "Positions + free cash", cash.patrimony >= cash.deposited ? "positive" : "negative")}
      ${metricCard("Assets EUR", `${number(cash.patrimony / fxRate())} EUR`, eurUsdSub, cash.patrimony >= cash.deposited ? "positive" : "negative")}
      ${metricCard("Net dividends", money(cash.netDividends), "Included in free cash")}
      ${metricCard("Annual return", latestReturn && Number.isFinite(latestReturn.returnPct) ? pct(latestReturn.returnPct) : "n/a", latestReturn ? String(latestReturn.year) : "No data", latestReturn && Number.isFinite(latestReturn.returnPct) ? (latestReturn.returnPct >= 0 ? "positive" : "negative") : "")}
    </div>
    <div class="panel-grid">
      <section class="panel span-4">
        <div class="panel-header"><h2>Add capital</h2></div>
        <div class="panel-body">
          <form class="form-grid" id="capitalMovementForm">
            <label><span>Portfolio</span><select class="select" id="capitalPortfolioSelect" name="portfolioId">${portfolioOptions}</select></label>
            <label><span>Type</span><select class="select" name="type"><option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option></select></label>
            <label><span>Data</span><input class="input" type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
            <label><span>EUR amount</span><input class="input" type="number" step="0.01" min="0" name="eur" ${isEuroPortfolio ? "required" : ""} /></label>
            ${
              isEuroPortfolio
                ? `<input type="hidden" name="usd" value="" />`
                : `<label><span>${escapeHtml(capitalCurrency)} amount</span><input class="input" type="number" step="0.01" min="0" name="usd" required /></label>`
            }
            <label class="full"><span>Notes</span><input class="input" name="notes" placeholder="Transfer, top-up, withdrawal..." /></label>
            <button class="primary-button" type="submit">Save capital</button>
          </form>
          <button class="secondary-button full-width-button" type="button" data-reset-capital="${escapeHtml(capitalPortfolioId)}">Reset this portfolio's capital</button>
          <p class="note">For EUR portfolios, the EUR amount is enough. For portfolios in another currency, record both EUR and the portfolio-currency amount to track growth in your home currency too.</p>
        </div>
      </section>
      <section class="panel span-8">
        <div class="panel-header"><h2>Capital movements</h2><span class="badge">${movements.length} rows</span></div>
        <div class="panel-body">
          ${renderTable({
            rows: movements,
            columns: [
              { label: "Data", render: (row) => dateLabel(row.date) },
              { label: "Portfolio", render: (row) => escapeHtml(portfolioName(row.portfolioId)) },
              { label: "Type", render: (row) => statusBadge(depositUsd(row) >= 0 ? "Deposit" : "Withdrawal", depositUsd(row) >= 0 ? "open" : "closed") },
              { label: "USD", className: "num", render: (row) => `<span class="${depositUsd(row) >= 0 ? "positive" : "negative"}">${money(depositUsd(row), { convert: false })}</span>` },
              { label: "EUR", className: "num", render: (row) => row.eur ? `${number(row.eur)} EUR` : "n/a" },
              { label: "Moeda", render: (row) => escapeHtml(portfolioCurrency(row.portfolioId)) },
              { label: "Fonte", render: (row) => escapeHtml(row.source || "Manual") },
              { label: "Notas", render: (row) => escapeHtml(row.notes || "") },
            ],
          })}
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-header"><h2>Annual portfolio return</h2><span class="badge">Approx. Dietz</span></div>
        <div class="panel-body">
          ${renderTable({
            rows: returnRows,
            columns: [
              { label: "Ano", render: (row) => String(row.year) },
              { label: "Inicio", className: "num", render: (row) => money(row.beginValue) },
              { label: "Fim", className: "num", render: (row) => money(row.endValue) },
              { label: "Fluxos externos", className: "num", render: (row) => money(row.flowTotal) },
              { label: "Ganho", className: "num", render: (row) => `<span class="${row.gain >= 0 ? "positive" : "negative"}">${money(row.gain)}</span>` },
              { label: "Rentabilidade", className: "num", render: (row) => Number.isFinite(row.returnPct) ? `<span class="${row.returnPct >= 0 ? "positive" : "negative"}">${pct(row.returnPct)}</span>` : "n/a" },
            ],
          })}
          <p class="note">Annual return uses current prices to estimate portfolio values in past years. When historical quotes are added, this calculation becomes more precise.</p>
        </div>
      </section>
    </div>
  `;
}

function metricMini(label, value) {
  return `<div class="mini-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderHoldings() {
  const query = state.holdingsSearch.trim().toLowerCase();
  let holdings = getHoldings().filter((row) => !query || row.ticker.toLowerCase().includes(query) || row.sector.toLowerCase().includes(query));
  holdings = sortRows(holdings, state.sort.holdings);
  const columns = [
    {
      label: "Ticker",
      key: "ticker",
      render: (row) => `<button class="ticker-button" data-open-ticker="${row.ticker}">${escapeHtml(row.ticker)}</button>`,
    },
    { label: "Portfolio", render: (row) => escapeHtml(portfolioName(row.portfolioId)) },
    { label: "Setor", key: "sector", render: (row) => escapeHtml(row.sector) },
    { label: "Qtd.", key: "quantity", className: "num", render: (row) => number(row.quantity) },
    { label: "Preco", key: "price", className: "num", render: (row) => money(row.price) },
    { label: "Valor", key: "value", className: "num", render: (row) => money(row.value) },
    { label: "%", key: "portfolioPct", className: "num", render: (row) => pct(row.portfolioPct) },
    { label: "P/L", key: "totalPl", className: "num", render: (row) => `<span class="${row.totalPl >= 0 ? "positive" : "negative"}">${money(row.totalPl)}</span>` },
    { label: "P/L %", key: "totalPlPct", className: "num", render: (row) => pct(row.totalPlPct) },
  ];
  return `
    ${scopeBar(`<input class="input" id="holdingsSearch" value="${escapeHtml(state.holdingsSearch)}" placeholder="Pesquisar ticker ou setor" />`)}
    <section class="panel">
      <div class="panel-header"><h2>Holdings</h2><span class="badge">${holdings.length} posicoes</span></div>
      <div class="panel-body">${renderTable({ columns, rows: holdings, sortKey: "holdings" })}</div>
    </section>
  `;
}

function latestValuationForTicker(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  return valuationRows().find((row) => row.ticker === symbol) || null;
}

function priceHintForTicker(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  const holding = getHoldings(true).find((row) => row.ticker === symbol);
  const latestFundamental = earningsRows(symbol).at(-1);
  const latestInvestment = DATA.investments
    .filter((row) => row.ticker === symbol)
    .sort((a, b) => String(b.closeDate || b.movementDate || "").localeCompare(String(a.closeDate || a.movementDate || "")))[0];
  const investmentPrice =
    toOptionalNumber(latestInvestment?.finalPrice) ||
    (toOptionalNumber(latestInvestment?.currentValue) && toOptionalNumber(latestInvestment?.quantity)
      ? toOptionalNumber(latestInvestment.currentValue) / toOptionalNumber(latestInvestment.quantity)
      : NaN);
  const dcfPrice = toOptionalNumber(store.dcf?.[symbol]?.currentPrice);
  const price = [holding?.price, store.prices?.[symbol], investmentPrice, latestFundamental?.price, dcfPrice].map((value) => toOptionalNumber(value)).find(Number.isFinite);
  return Number.isFinite(price) ? price : "";
}

function watchlistImportedData(ticker, fallback = {}) {
  const symbol = String(ticker || "").trim().toUpperCase();
  const meta = getTickerMeta(symbol);
  const investment = DATA.investments.find((row) => row.ticker === symbol);
  const earnings = earningsRows(symbol);
  const dividendForecast = forecastMap().get(symbol);
  const currentPrice = toOptionalNumber(priceHintForTicker(symbol));
  const autoName = companyLabel(symbol);
  return {
    name: autoName && autoName !== symbol ? autoName : fallback.name || symbol,
    sector: meta.sector && meta.sector !== "Outro" ? meta.sector : investment?.type || fallback.sector || "Outro",
    currentPrice: Number.isFinite(currentPrice) ? currentPrice : "",
    earningsYears: earnings.length,
    latestFiscalYear: earnings.at(-1)?.fiscalYear || "",
    hasDividendForecast: Boolean(dividendForecast),
    hasDcfConfig: Boolean(store.dcf?.[symbol]),
    importedAt: new Date().toISOString(),
  };
}

function refreshWatchlistImportedData(tickers = null) {
  const scope = tickers ? new Set([...tickers].map((ticker) => String(ticker || "").trim().toUpperCase())) : null;
  (store.watchlist || []).forEach((row) => {
    const ticker = String(row.ticker || "").trim().toUpperCase();
    if (!scope || scope.has(ticker)) row.importedData = watchlistImportedData(ticker, row);
  });
}

function emptyWatchlistEntry() {
  return {
    id: "",
    ticker: "",
    priority: "medium",
    desiredPrice: "",
    reviewDate: "",
    thesis: "",
    notes: "",
  };
}

function selectedWatchlistEntry() {
  return (store.watchlist || []).find((row) => row.id === state.editWatchlistId) || emptyWatchlistEntry();
}

function watchlistPriorityLabel(priority) {
  return (
    {
      high: "Alta",
      medium: "Media",
      low: "Baixa",
    }[priority] || "Media"
  );
}

function watchlistRows() {
  const query = state.watchlistSearch.trim().toLowerCase();
  return sortRows(
    (store.watchlist || [])
      .map((row) => {
        const ticker = String(row.ticker || "").trim().toUpperCase();
        const importedData = watchlistImportedData(ticker, row);
        const autoPrice = toOptionalNumber(importedData.currentPrice);
        const legacyPrice = toOptionalNumber(row.currentPrice);
        const currentPrice = Number.isFinite(autoPrice) ? autoPrice : legacyPrice;
        const desiredPrice = toOptionalNumber(row.desiredPrice);
        const latestValuation = latestValuationForTicker(ticker);
        const entryGap = Number.isFinite(currentPrice) && currentPrice > 0 && Number.isFinite(desiredPrice) ? currentPrice / desiredPrice - 1 : NaN;
        const prioritySort = { high: 3, medium: 2, low: 1 }[row.priority] || 2;
        return {
          ...row,
          ticker,
          name: importedData.name,
          sector: importedData.sector,
          currentPrice: Number.isFinite(currentPrice) ? currentPrice : "",
          desiredPrice: Number.isFinite(desiredPrice) ? desiredPrice : "",
          entryGap,
          prioritySort,
          currentPriceSort: Number.isFinite(currentPrice) ? currentPrice : -999,
          desiredPriceSort: Number.isFinite(desiredPrice) ? desiredPrice : -999,
          latestValuation,
          importedData,
          inBuyZone: Number.isFinite(currentPrice) && Number.isFinite(desiredPrice) && currentPrice <= desiredPrice,
        };
      })
      .filter((row) => {
        if (!query) return true;
        return [row.ticker, row.name, row.sector, row.priority, row.thesis, row.notes]
          .some((value) => String(value || "").toLowerCase().includes(query));
      }),
    state.sort.watchlist,
  );
}

function watchlistDataBadges(row) {
  const data = row.importedData || watchlistImportedData(row.ticker, row);
  const badges = [];
  if (Number.isFinite(toOptionalNumber(data.currentPrice))) badges.push("Preco");
  if (data.earningsYears) badges.push(`${data.earningsYears} FY`);
  if (data.hasDividendForecast) badges.push("Dividendos");
  if (data.hasDcfConfig || row.latestValuation) badges.push("DCF");
  return badges.length
    ? badges.map((label) => `<span class="badge open">${escapeHtml(label)}</span>`).join(" ")
    : `<span class="badge closed">Sem dados locais</span>`;
}

function renderWatchlistForm(row) {
  const isEditing = Boolean(row.id);
  const ticker = String(row.ticker || "").trim().toUpperCase();
  return `
    <form class="form-grid watchlist-form" id="watchlistForm" onsubmit="return window.__portfolioSaveWatchlistForm(event, this)">
      <input type="hidden" name="id" value="${escapeHtml(row.id || "")}" />
      <label><span>Ticker</span><input class="input" name="ticker" required placeholder="MSFT" value="${escapeHtml(ticker)}" /></label>
      <label><span>Prioridade</span><select class="select" name="priority">
        ${["high", "medium", "low"]
          .map((priority) => `<option value="${priority}" ${priority === (row.priority || "medium") ? "selected" : ""}>${watchlistPriorityLabel(priority)}</option>`)
          .join("")}
      </select></label>
      <label><span>Preco entrada</span><input class="input" type="number" step="0.0001" min="0" name="desiredPrice" value="${escapeHtml(row.desiredPrice ?? "")}" /></label>
      <label><span>Rever em</span><input class="input" type="date" name="reviewDate" value="${escapeHtml(row.reviewDate || "")}" /></label>
      <label class="full"><span>Tese</span><textarea class="input" name="thesis" rows="4" placeholder="Porque vale a pena acompanhar?">${escapeHtml(row.thesis || "")}</textarea></label>
      <label class="full"><span>Notas</span><input class="input" name="notes" placeholder="Catalisadores, risco, fonte dos numeros" value="${escapeHtml(row.notes || "")}" /></label>
      <button class="primary-button" type="submit" onclick="return window.__portfolioSaveWatchlistForm(event, this.form)">${isEditing ? "Guardar alteracoes" : "Adicionar a watchlist"}</button>
      ${isEditing ? `<button class="secondary-button" type="button" data-cancel-watchlist-edit="1">Cancelar</button>` : ""}
    </form>
  `;
}

function renderPriceUpdatePanel() {
  if (!state.priceUpdateSlot || !priceUpdateSlots[state.priceUpdateSlot]) state.priceUpdateSlot = suggestedPriceUpdateSlot();
  const today = localIsoDate();
  const openUpdate = priceUpdateForDate("open", today);
  const closeUpdate = priceUpdateForDate("close", today);
  const last = latestPriceUpdate();
  const process = state.appProcess || {};
  const processLabel = !process.checked ? "A verificar" : process.available ? (process.runningImport ? "A importar" : "Ativo") : "Ficheiro local";
  const nextRunLabel = process.nextRun?.local || (process.available ? "A calcular" : "Manual");
  const recentRows = (store.priceUpdates || [])
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, 6);
  return `
    <section class="panel span-12">
      <div class="panel-header">
        <h2>Atualizacao de precos</h2>
        <div class="inline-actions">
          <span class="badge ${openUpdate ? "open" : ""}">Abertura ${openUpdate ? "feita" : "pendente"}</span>
          <span class="badge ${closeUpdate ? "open" : ""}">Fecho ${closeUpdate ? "feito" : "pendente"}</span>
          <button class="secondary-button compact-button" type="button" data-run-auto-prices="1" ${process.runningImport ? "disabled" : ""}>${process.runningImport ? "A importar" : "Importar precos"}</button>
          <button class="secondary-button compact-button" type="button" data-sync-watchlist="1">Sincronizar watchlist</button>
          <button class="secondary-button compact-button" type="button" data-load-auto-prices="1">Recarregar ficheiro</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="mini-grid price-update-summary">
          ${metricMini("Abertura", openUpdate ? dateTimeLabel(openUpdate.updatedAt) : priceUpdateSlots.open.time)}
          ${metricMini("Fecho", closeUpdate ? dateTimeLabel(closeUpdate.updatedAt) : priceUpdateSlots.close.time)}
          ${metricMini("Ultima", last ? `${priceUpdateSlots[last.slot]?.label || last.slot} - ${last.imported} tickers` : "Sem atualizacoes")}
          ${metricMini("Processo", processLabel)}
          ${metricMini("Proximo", nextRunLabel)}
        </div>
        <form class="form-grid price-update-form" id="priceUpdateForm">
          <label><span>Momento</span><select class="select" name="slot" id="priceUpdateSlot">
            <option value="open" ${state.priceUpdateSlot === "open" ? "selected" : ""}>${priceUpdateSlotLabel("open")}</option>
            <option value="close" ${state.priceUpdateSlot === "close" ? "selected" : ""}>${priceUpdateSlotLabel("close")}</option>
          </select></label>
          <label><span>Fonte</span><input class="input" name="source" value="Manual" /></label>
          <label class="full"><span>Precos</span><textarea class="input import-textarea" name="payload" rows="7" placeholder="${escapeHtml(priceUpdatePlaceholder())}" required></textarea></label>
          <button class="primary-button" type="submit">Guardar precos</button>
        </form>
        ${
          recentRows.length
            ? `<div class="price-update-history">
                ${renderTable({
                  rows: recentRows,
                  columns: [
                    { label: "Data", render: (row) => escapeHtml(row.date || "") },
                    { label: "Momento", render: (row) => escapeHtml(priceUpdateSlots[row.slot]?.label || row.slot) },
                    { label: "Tickers", className: "num", render: (row) => String(row.imported || 0) },
                    { label: "Fonte", render: (row) => escapeHtml(row.source || "Manual") },
                    { label: "Atualizado", render: (row) => escapeHtml(dateTimeLabel(row.updatedAt)) },
                  ],
                })}
              </div>`
            : ""
        }
      </div>
    </section>
  `;
}

function renderWatchlist() {
  const rows = watchlistRows();
  const allRows = store.watchlist || [];
  const actionable = rows.filter((row) => row.inBuyZone).length;
  const highPriority = allRows.filter((row) => row.priority === "high").length;
  const reviewToday = allRows.filter((row) => row.reviewDate && row.reviewDate <= new Date().toISOString().slice(0, 10)).length;
  const valuationsCount = rows.filter((row) => row.latestValuation).length;
  const formRow = selectedWatchlistEntry();
  const process = state.appProcess || {};
  return `
    ${scopeBar(`
      <input class="input watchlist-search" id="watchlistSearch" value="${escapeHtml(state.watchlistSearch)}" placeholder="Pesquisar ticker, setor, tese..." />
      <div class="watchlist-top-actions">
        <button class="primary-button compact-button" type="button" data-run-auto-prices="1" ${process.runningImport ? "disabled" : ""}>${process.runningImport ? "A importar" : "Importar precos"}</button>
        <button class="secondary-button compact-button" type="button" data-sync-watchlist="1">Sincronizar watchlist</button>
      </div>
    `)}
    <div class="kpi-grid">
      ${metricCard("Empresas", String(allRows.length), "Na watchlist")}
      ${metricCard("Zona compra", String(actionable), "Preco atual <= preco entrada", actionable ? "positive" : "")}
      ${metricCard("Alta prioridade", String(highPriority), "Prioridade manual")}
      ${metricCard("Com avaliacao", String(valuationsCount), "DCF guardado")}
      ${metricCard("Rever agora", String(reviewToday), "Datas de revisao vencidas", reviewToday ? "negative" : "")}
    </div>
    <div class="panel-grid">
      <section class="panel span-5">
        <div class="panel-header">
          <h2>${formRow.id ? "Editar watchlist" : "Nova empresa"}</h2>
          ${formRow.id ? `<span class="badge open">${escapeHtml(formRow.ticker)}</span>` : `<span class="badge">Manual</span>`}
        </div>
        <div class="panel-body">
          ${renderWatchlistForm(formRow)}
        </div>
      </section>
      <section class="panel span-7">
        <div class="panel-header"><h2>Oportunidades</h2><span class="badge">${rows.length} linhas</span></div>
        <div class="panel-body">
          ${renderTable({
            rows,
            sortKey: "watchlist",
            columns: [
              { label: "Ticker", key: "ticker", render: (row) => `<button class="ticker-button" data-open-ticker="${escapeHtml(row.ticker)}">${escapeHtml(row.ticker)}</button><br><small>${escapeHtml(row.name || companyLabel(row.ticker))}</small>` },
              { label: "Dados", render: watchlistDataBadges },
              { label: "Prioridade", key: "prioritySort", render: (row) => escapeHtml(watchlistPriorityLabel(row.priority)) },
              { label: "Atual", key: "currentPriceSort", className: "num", render: (row) => optionalMoney(row.currentPrice, { convert: false }) },
              { label: "Entrada", key: "desiredPriceSort", className: "num", render: (row) => optionalMoney(row.desiredPrice, { convert: false }) },
              { label: "Dist. entrada", key: "entryGap", className: "num", render: (row) => Number.isFinite(row.entryGap) ? `<span class="${row.inBuyZone ? "positive" : ""}">${pct(row.entryGap)}</span>` : "n/a" },
              {
                label: "Avaliacao",
                render: (row) =>
                  row.latestValuation
                    ? `<button class="text-button" type="button" data-open-valuation="${escapeHtml(row.latestValuation.id)}">Ver avaliacao</button>`
                    : `<button class="text-button" type="button" data-open-watchlist-dcf="${escapeHtml(row.ticker)}">Criar DCF</button>`,
              },
              { label: "Rever", key: "reviewDate", render: (row) => row.reviewDate ? escapeHtml(dateLabel(row.reviewDate)) : "n/a" },
              {
                label: "",
                render: (row) => `
                  <div class="inline-actions">
                    <button class="text-button" type="button" data-edit-watchlist="${escapeHtml(row.id)}">Editar</button>
                    <button class="text-button" type="button" data-delete-watchlist="${escapeHtml(row.id)}">Remover</button>
                  </div>
                `,
              },
            ],
          })}
        </div>
      </section>
      ${renderPriceUpdatePanel()}
      <section class="panel span-12">
        <div class="panel-header"><h2>Notas de acompanhamento</h2></div>
        <div class="panel-body">
          ${renderTable({
            rows,
            columns: [
              { label: "Ticker", render: (row) => `<strong>${escapeHtml(row.ticker)}</strong>` },
              { label: "Setor", render: (row) => escapeHtml(row.sector || getTickerMeta(row.ticker).sector) },
              { label: "Dist. entrada", className: "num", render: (row) => Number.isFinite(row.entryGap) ? `<span class="${row.inBuyZone ? "positive" : ""}">${pct(row.entryGap)}</span>` : "n/a" },
              { label: "Tese", render: (row) => escapeHtml(row.thesis || "") },
              { label: "Notas", render: (row) => escapeHtml(row.notes || "") },
            ],
          })}
        </div>
      </section>
    </div>
  `;
}

function investmentPositionGroups() {
  const query = state.transactionSearch.trim().toLowerCase();
  const positions = new Map(getHoldings(true).map((row) => [`${row.portfolioId}:${row.ticker}`, row]));
  const groups = new Map();
  transactionsInScope()
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .forEach((row) => {
      const ticker = String(row.ticker || "").trim().toUpperCase();
      const key = `${row.portfolioId}:${ticker}`;
      const group =
        groups.get(key) ||
        {
          key,
          portfolioId: row.portfolioId,
          ticker,
          type: row.instrumentType || getTickerMeta(ticker).type,
          transactions: [],
        };
      group.transactions.push(row);
      groups.set(key, group);
    });

  return [...groups.values()]
    .map((group) => {
      const position = positions.get(group.key) || {};
      const buyRows = group.transactions.filter((row) => row.side === "buy");
      const buyQty = buyRows.reduce((total, row) => total + toNumber(row.quantity), 0);
      const buyCost = buyRows.reduce((total, row) => total + transactionCost(row), 0);
      const quantity = toNumber(position.quantity);
      const avgOpenPrice = quantity > 0 ? toNumber(position.avgCost) : buyQty ? buyCost / buyQty : 0;
      const currentPrice = toNumber(position.price, avgOpenPrice);
      const value = quantity * currentPrice;
      const totalPl = toNumber(position.totalPl);
      const totalPlPct = toNumber(position.totalPlPct);
      return {
        ...group,
        quantity,
        avgOpenPrice,
        currentPrice,
        value,
        totalPl,
        totalPlPct,
        transactionCount: group.transactions.length,
      };
    })
    .filter((group) => {
      if (!query) return true;
      const haystack = [
        group.ticker,
        group.type,
        portfolioName(group.portfolioId),
        ...group.transactions.flatMap((row) => [row.date, row.side, row.notes, row.instrumentType]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.ticker.localeCompare(b.ticker));
}

function investmentTransactionMetrics(row, group) {
  const qty = toNumber(row.quantity);
  const cost = transactionCost(row);
  const isBuy = row.side === "buy";
  const value = isBuy ? qty * group.currentPrice : transactionGross(row) - toNumber(row.fees);
  const gain = isBuy ? value - cost : NaN;
  return {
    quantity: isBuy ? qty : -qty,
    value,
    gain,
    gainPct: cost ? gain / cost : NaN,
  };
}

function renderInvestmentPositionsTable(groups) {
  if (!groups.length) return `<div class="empty">Sem movimentos.</div>`;
  return `
    <div class="table-wrap investment-table-wrap">
      <table class="investment-table">
        <thead>
          <tr>
            <th>Instrumento/Posicao</th>
            <th class="num">Volume</th>
            <th class="num">Preco de abertura</th>
            <th class="num">Preco atual</th>
            <th class="num">Valor</th>
            <th class="num">Lucro liquido %</th>
            <th class="num">Lucro liquido</th>
            <th class="num">Detalhes</th>
          </tr>
        </thead>
        <tbody>
          ${groups
            .map((group) => {
              const expanded = Boolean(state.expandedInvestmentRows[group.key]);
              const tone = group.totalPl >= 0 ? "positive" : "negative";
              const children = expanded
                ? group.transactions
                    .map((row) => {
                      const metrics = investmentTransactionMetrics(row, group);
                      const childTone = Number.isFinite(metrics.gain) ? (metrics.gain >= 0 ? "positive" : "negative") : "";
                      return `
                        <tr class="investment-child-row">
                          <td>
                            <div class="investment-child-label">
                              <span>${escapeHtml(dateLabel(row.date))}</span>
                              ${statusBadge(row.side === "buy" ? "Compra" : "Venda", row.side === "buy" ? "open" : "closed")}
                              ${row.notes ? `<small>${escapeHtml(row.notes)}</small>` : ""}
                            </div>
                          </td>
                          <td class="num">${number(metrics.quantity)}</td>
                          <td class="num">${money(row.price)}</td>
                          <td class="num">${row.side === "buy" ? money(group.currentPrice) : "n/a"}</td>
                          <td class="num">${money(metrics.value)}</td>
                          <td class="num">${Number.isFinite(metrics.gainPct) ? `<span class="${childTone}">${pct(metrics.gainPct)}</span>` : "n/a"}</td>
                          <td class="num">${Number.isFinite(metrics.gain) ? `<span class="${childTone}">${money(metrics.gain)}</span>` : "n/a"}</td>
                          <td class="num"></td>
                        </tr>
                      `;
                    })
                    .join("")
                : "";
              return `
                <tr class="investment-summary-row">
                  <td>
                    <div class="investment-position-label">
                      <button class="ticker-button" data-open-ticker="${escapeHtml(group.ticker)}">${escapeHtml(group.ticker)}</button>
                      <span class="badge">${escapeHtml(group.type)}</span>
                      <small>${escapeHtml(portfolioName(group.portfolioId))}</small>
                    </div>
                  </td>
                  <td class="num">${number(group.quantity)}</td>
                  <td class="num">${money(group.avgOpenPrice)}</td>
                  <td class="num">${money(group.currentPrice)}</td>
                  <td class="num">${money(group.value)}</td>
                  <td class="num"><span class="${tone}">${pct(group.totalPlPct)}</span></td>
                  <td class="num"><span class="${tone}">${money(group.totalPl)}</span></td>
                  <td class="num">
                    <button class="investment-expand-button" type="button" data-toggle-investment-group="${escapeHtml(group.key)}" aria-expanded="${expanded ? "true" : "false"}">
                      ${expanded ? "-" : "+"} ${group.transactionCount}
                    </button>
                  </td>
                </tr>
                ${children}
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderInvestments() {
  const groups = investmentPositionGroups();
  const movementCount = groups.reduce((total, group) => total + group.transactionCount, 0);
  return `
    ${scopeBar(`<input class="input" id="transactionSearch" value="${escapeHtml(state.transactionSearch)}" placeholder="Pesquisar ticker, setor, movimento..." />`)}
    <div class="panel-grid">
      <section class="panel span-12">
        <div class="panel-header"><h2>Adicionar movimento</h2></div>
        <div class="panel-body">
          <form class="form-grid" id="transactionForm">
            <label><span>Portfolio</span><select class="select" name="portfolioId">${store.portfolios.map((p) => `<option value="${p.id}" ${p.id === (state.scope === "all" ? store.portfolios[0]?.id : state.scope) ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select></label>
            <label><span>Tipo</span><select class="select" name="side"><option value="buy">Compra</option><option value="sell">Venda</option></select></label>
            <label><span>Data</span><input class="input" type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
            <label><span>Ticker</span><input class="input" name="ticker" required placeholder="MSFT" /></label>
            <label><span>Instrumento</span><input class="input" name="instrumentType" placeholder="Acao, ETF, Crypto" /></label>
            <label><span>Quantidade</span><input class="input" type="number" step="0.000001" min="0" name="quantity" required /></label>
            <label><span>Preco</span><input class="input" type="number" step="0.0001" min="0" name="price" required /></label>
            <label><span>Comissoes</span><input class="input" type="number" step="0.01" min="0" name="fees" value="0" /></label>
            <label class="full"><span>Notas</span><input class="input" name="notes" /></label>
            <button class="primary-button" type="submit">Guardar movimento</button>
          </form>
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-header"><h2>Posicoes e movimentos</h2><span class="badge">${groups.length} posicoes | ${movementCount} movimentos</span></div>
        <div class="panel-body">${renderInvestmentPositionsTable(groups)}</div>
      </section>
    </div>
  `;
}

function forecastMap() {
  const map = new Map(DATA.dividendForecast.rows.map((row) => [row.ticker, { ...row, source: "Excel" }]));
  deriveForecastsFromImportedDividendEvents().forEach((row) => {
    map.set(row.ticker, row);
  });
  (store.imports?.dividendForecasts || []).forEach((row) => {
    map.set(row.ticker, { ...row, source: row.source || "Import" });
  });
  return map;
}

function deriveForecastsFromImportedDividendEvents() {
  const byTicker = new Map();
  (store.imports?.dividendEvents || []).forEach((row) => {
    const amount = toOptionalNumber(row.amountPerShare);
    if (!row.ticker || !Number.isFinite(amount) || !row.monthIndex) return;
    const existing = byTicker.get(row.ticker) || {
      ticker: row.ticker,
      months: {},
      monthlyDividend: amount,
      annualDividendPerShare: amount,
      source: row.source || "Import",
      importedAt: row.importedAt || "",
      latestKey: "",
    };
    existing.months[monthNames[row.monthIndex - 1]] = true;
    const recencyKey = row.payDate || row.exDate || `${row.year}-${String(row.monthIndex).padStart(2, "0")}`;
    if (!existing.latestKey || recencyKey >= existing.latestKey) {
      existing.latestKey = recencyKey;
      existing.monthlyDividend = amount;
      existing.source = row.source || existing.source;
      existing.importedAt = row.importedAt || existing.importedAt;
    }
    const activeMonths = Object.values(existing.months).filter(Boolean).length || 1;
    existing.annualDividendPerShare = existing.monthlyDividend * activeMonths;
    byTicker.set(row.ticker, existing);
  });
  return [...byTicker.values()].map(({ latestKey, ...row }) => row);
}

function dividendAnnualKey(row) {
  return `${String(row.ticker || "").toUpperCase()}:${row.year}`;
}

function calculatedDividendAnnualPerShareRows() {
  const byTickerYear = new Map();
  (store.dividends || []).forEach((row) => {
    if (row.received === false) return;
    const ticker = String(row.ticker || "").trim().toUpperCase();
    const year = Math.trunc(toNumber(row.year, NaN));
    const sharesPaid = toOptionalNumber(row.sharesPaid);
    const gross = toOptionalNumber(row.gross);
    const recordedPerShare = toOptionalNumber(row.dividendPerShare);
    const dividendPerShare =
      Number.isFinite(recordedPerShare)
        ? recordedPerShare
        : Number.isFinite(gross) && Number.isFinite(sharesPaid) && sharesPaid > 0
          ? gross / sharesPaid
          : NaN;
    if (!ticker || !Number.isFinite(year) || !Number.isFinite(dividendPerShare)) return;
    const key = `${ticker}:${year}`;
    const existing = byTickerYear.get(key) || {
      key,
      ticker,
      year,
      calculatedAnnualPerShare: 0,
      events: 0,
      source: "Recebidos",
    };
    existing.calculatedAnnualPerShare += dividendPerShare;
    existing.events += 1;
    byTickerYear.set(key, existing);
  });
  return [...byTickerYear.values()];
}

function dividendAnnualPerShareRows() {
  const calculated = new Map(calculatedDividendAnnualPerShareRows().map((row) => [row.key, row]));
  const manual = new Map(
    (store.imports?.dividendAnnualPerShare || [])
      .map((row) => normalizeDividendAnnualPerShareImport(row, row.source || "Manual"))
      .filter(Boolean)
      .map((row) => [dividendAnnualKey(row), row]),
  );
  return [...new Set([...calculated.keys(), ...manual.keys()])]
    .map((key) => {
      const calculatedRow = calculated.get(key);
      const manualRow = manual.get(key);
      const manualValue = toOptionalNumber(manualRow?.annualDividendPerShare);
      const calculatedValue = toOptionalNumber(calculatedRow?.calculatedAnnualPerShare);
      const [ticker, yearText] = key.split(":");
      return {
        key,
        ticker: manualRow?.ticker || calculatedRow?.ticker || ticker,
        year: manualRow?.year || calculatedRow?.year || Math.trunc(toNumber(yearText)),
        manualId: manualRow?.id || "",
        calculatedAnnualPerShare: Number.isFinite(calculatedValue) ? calculatedValue : "",
        manualAnnualPerShare: Number.isFinite(manualValue) ? manualValue : "",
        annualDividendPerShare: Number.isFinite(manualValue) ? manualValue : calculatedValue,
        source: Number.isFinite(manualValue) ? manualRow?.source || "Manual" : calculatedRow?.source || "Recebidos",
        notes: manualRow?.notes || "",
        events: calculatedRow?.events || 0,
        importedAt: manualRow?.importedAt || "",
      };
    })
    .sort((a, b) => b.year - a.year || a.ticker.localeCompare(b.ticker));
}

function importedDividendEventsForYear(year = state.dividendYear) {
  const holdings = getHoldings();
  const events = [];
  (store.imports?.dividendEvents || [])
    .filter((row) => row.year === year)
    .forEach((row) => {
      const matchingHoldings = holdings.filter(
        (holding) => holding.ticker === row.ticker && (!row.portfolioId || row.portfolioId === holding.portfolioId),
      );
      matchingHoldings.forEach((holding) => {
        const amountPerShare = toOptionalNumber(row.amountPerShare);
        const explicitGross = toOptionalNumber(row.gross);
        const gross = Number.isFinite(amountPerShare) ? amountPerShare * holding.quantity : explicitGross;
        if (!Number.isFinite(gross)) return;
        events.push({
          id: `${row.id}:${holding.portfolioId}`,
          portfolioId: holding.portfolioId,
          ticker: row.ticker,
          month: row.month || monthNames[row.monthIndex - 1],
          monthIndex: row.monthIndex,
          year: row.year,
          sharesPaid: holding.quantity,
          amountPerShare: Number.isFinite(amountPerShare) ? amountPerShare : "",
          gross,
          withholding: gross * store.settings.withholdingRate,
          net: gross * (1 - store.settings.withholdingRate),
          exDate: row.exDate,
          payDate: row.payDate,
          source: row.source || "Import",
        });
      });
    });
  return events;
}

function expectedDividendEvents() {
  return expectedDividendEventsForYear(state.dividendYear);
}

function expectedDividendEventsForYear(year) {
  const forecasts = forecastMap();
  const holdings = getHoldings();
  const events = importedDividendEventsForYear(year);
  const importedKeys = new Set(events.map((event) => `${event.portfolioId}:${event.ticker}:${event.year}:${event.monthIndex}`));
  holdings.forEach((holding) => {
    const forecast = forecasts.get(holding.ticker);
    if (!forecast) return;
    Object.entries(forecast.months || {}).forEach(([monthName, active], index) => {
      if (!active) return;
      const monthIndex = index + 1;
      const eventKey = `${holding.portfolioId}:${holding.ticker}:${year}:${monthIndex}`;
      if (importedKeys.has(eventKey)) return;
      const gross = toNumber(forecast.monthlyDividend) * holding.quantity;
      events.push({
        id: `${holding.portfolioId}:${holding.ticker}:${year}:${monthIndex}`,
        portfolioId: holding.portfolioId,
        ticker: holding.ticker,
        month: monthName,
        monthIndex,
        year,
        sharesPaid: holding.quantity,
        amountPerShare: toNumber(forecast.monthlyDividend),
        gross,
        withholding: gross * store.settings.withholdingRate,
        net: gross * (1 - store.settings.withholdingRate),
        source: forecast.source || "Excel",
      });
    });
  });
  return events.sort((a, b) => a.monthIndex - b.monthIndex || a.ticker.localeCompare(b.ticker));
}

function receivedKey(row) {
  return `${row.portfolioId}:${row.ticker}:${row.year}:${row.monthIndex}`;
}

function shiftYearMonth(year, month, offset) {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function dividendEventExactDate(row) {
  const value = row.payDate || row.exDate || row.recordDate || row.date || "";
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return {
    date: value,
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
  };
}

function dividendEventsForCalendarMonth(events, year, month) {
  const withDay = new Map();
  const floating = [];
  events
    .filter((row) => row.year === year && row.monthIndex === month)
    .forEach((row) => {
      const exact = dividendEventExactDate(row);
      if (exact && exact.year === year && exact.month === month) {
        const dayRows = withDay.get(exact.day) || [];
        dayRows.push(row);
        withDay.set(exact.day, dayRows);
      } else {
        floating.push(row);
      }
    });
  return { withDay, floating };
}

function renderCalendarEventChip(row) {
  if (row.received) {
    return `<button class="calendar-chip received" type="button" data-edit-dividend="${row.receivedRow?.id || ""}" title="${escapeHtml(row.ticker)} recebido">${escapeHtml(row.ticker)}</button>`;
  }
  return `<button class="calendar-chip" type="button" data-receive-dividend="${row.id}" title="Marcar ${escapeHtml(row.ticker)} como recebido">${escapeHtml(row.ticker)}</button>`;
}

function renderDividendMonthCalendar(events, year, month) {
  const firstDay = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const { withDay, floating } = dividendEventsForCalendarMonth(events, year, month);
  const blanks = Array.from({ length: firstDay }, (_, index) => `<div class="calendar-cell is-blank" aria-hidden="true" data-blank="${index}"></div>`);
  const dayCells = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const dayEvents = (withDay.get(day) || []).sort((a, b) => a.ticker.localeCompare(b.ticker));
    const intensity = Math.min(5, dayEvents.length);
    return `
      <div class="calendar-cell ${dayEvents.length ? `has-events intensity-${intensity}` : ""}">
        <span class="calendar-day">${String(day).padStart(2, "0")}</span>
        ${dayEvents.length ? `<div class="calendar-chips">${dayEvents.map(renderCalendarEventChip).join("")}</div>` : ""}
      </div>
    `;
  });
  return `
    <section class="month-calendar">
      <div class="calendar-grid">${blanks.join("")}${dayCells.join("")}</div>
      <h3>${escapeHtml(monthNames[month - 1])}</h3>
      ${
        floating.length
          ? `<div class="floating-dividends">${floating
              .sort((a, b) => a.ticker.localeCompare(b.ticker))
              .map(
                (row) => `
                  <div class="floating-dividend">
                    <span>${escapeHtml(row.ticker)}</span>
                    <strong>${escapeHtml(money(row.gross))}</strong>
                    ${
                      row.received
                        ? `<button class="text-button" type="button" data-edit-dividend="${row.receivedRow?.id || ""}">Editar</button>`
                        : `<button class="text-button" type="button" data-receive-dividend="${row.id}">Recebi?</button>`
                    }
                  </div>
                `,
              )
              .join("")}</div>`
          : ""
      }
    </section>
  `;
}

function renderDividendCalendarPanel(calendarRows) {
  const selectedRows = calendarRows.filter((row) => row.monthIndex === state.dividendMonth).sort((a, b) => a.ticker.localeCompare(b.ticker));
  return `
    <section class="panel span-12">
      <div class="panel-header">
        <h2>Dividendos previstos</h2>
        <span class="badge">${state.dividendYear}</span>
      </div>
      <div class="panel-body">
        <div class="chart-tags month-tags">
          ${monthShort
            .map(
              (month, index) =>
                `<button class="tag-button ${state.dividendMonth === index + 1 ? "is-active" : ""}" type="button" data-dividend-select-month="${index + 1}">${escapeHtml(month)}</button>`,
            )
            .join("")}
        </div>
        <div class="month-company-panel compact">
          <div class="month-company-header">
            <div>
              <h3>${escapeHtml(monthNames[state.dividendMonth - 1])}</h3>
              <p>${selectedRows.length ? `${selectedRows.length} empresas/eventos previstos` : "Sem dividendos previstos neste mes"}</p>
            </div>
            <strong>${escapeHtml(money(selectedRows.reduce((sum, row) => sum + toNumber(row.gross), 0)))}</strong>
          </div>
          ${renderDividendMonthRows(selectedRows, true)}
        </div>
      </div>
    </section>
  `;
}

function renderDividendMonthRows(rows, allowReceive = false) {
  return `
    <div class="month-company-list">
      ${
        rows.length
          ? rows
              .map(
                (row) => `
                  <div class="month-company-row ${row.received ? "is-received" : ""}">
                    <div>
                      <button class="ticker-button" data-open-ticker="${row.ticker}">${escapeHtml(row.ticker)}</button>
                      <span>${escapeHtml(portfolioName(row.portfolioId))}</span>
                    </div>
                    <div class="num">
                      <strong>${escapeHtml(money(row.gross))}</strong>
                      <small>Ret. ${escapeHtml(money(row.withholding))} | Liq. ${escapeHtml(money(row.net))}</small>
                    </div>
                    <div class="inline-actions">
                      ${
                        row.received
                          ? `${statusBadge("Recebido", "open")}<button class="text-button" data-edit-dividend="${row.receivedRow?.id || row.id || ""}">Editar</button><button class="text-button" data-unreceive-dividend="${row.receivedRow?.id || row.id || ""}">Anular</button>`
                          : allowReceive
                            ? `<button class="text-button" data-receive-dividend="${row.id}">Recebi?</button>`
                            : `<button class="text-button" data-edit-dividend="${row.id}">Editar</button>`
                      }
                    </div>
                  </div>
                `,
              )
              .join("")
          : `<div class="empty">Sem dividendos neste mes.</div>`
      }
    </div>
  `;
}

function renderReceivedDividendPanel(receivedRows) {
  const yearRows = receivedRows.filter((row) => row.year === state.dividendYear);
  const selectedRows = yearRows
    .filter((row) => row.monthIndex === state.dividendMonth)
    .slice()
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  return `
    <section class="panel span-12 dividend-year-panel">
      <div class="panel-header">
        <h2>Recebidos por mes</h2>
        <div class="inline-actions">
          <span class="badge">${yearRows.length} linhas</span>
          <button class="secondary-button" type="button" data-add-dividend="1">Adicionar dividendo</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="dividend-month-grid">
          ${monthShort
            .map((month, index) => {
              const monthIndex = index + 1;
              const rows = yearRows.filter((row) => row.monthIndex === monthIndex);
              const total = rows.reduce((sum, row) => sum + toNumber(row.gross), 0);
              return `
                <button class="dividend-month-tile ${state.dividendMonth === monthIndex ? "is-active" : ""}" type="button" data-dividend-select-month="${monthIndex}">
                  <span>${escapeHtml(month)}</span>
                  <strong>${rows.length}</strong>
                  <small>${escapeHtml(money(total))}</small>
                  ${rows.length ? `<em>${escapeHtml(money(rows.reduce((sum, row) => sum + toNumber(row.net), 0)))} liquido</em>` : ""}
                </button>
              `;
            })
            .join("")}
        </div>
        <div class="month-company-panel">
          <div class="month-company-header">
            <div>
              <h3>${escapeHtml(monthNames[state.dividendMonth - 1])}</h3>
              <p>${selectedRows.length ? `${selectedRows.length} dividendos recebidos` : "Sem dividendos recebidos neste mes"}</p>
            </div>
            <strong>${escapeHtml(money(selectedRows.reduce((sum, row) => sum + toNumber(row.gross), 0)))}</strong>
          </div>
          ${renderDividendMonthRows(selectedRows, false)}
        </div>
      </div>
    </section>
  `;
}

function emptyDividendFormRow() {
  const portfolioId = state.scope !== "all" ? state.scope : store.portfolios[0]?.id || "";
  return {
    id: "",
    portfolioId,
    ticker: "",
    year: state.dividendYear,
    monthIndex: state.dividendMonth,
    month: monthNames[state.dividendMonth - 1],
    sharesPaid: "",
    gross: "",
    withholding: "",
    net: "",
    notes: "",
    source: "Manual",
  };
}

function renderDividendEditForm(row, mode = "edit") {
  if (!row) return "";
  const sharesPaid = toOptionalNumber(row.sharesPaid);
  const gross = parseLooseNumber(row.gross, 0);
  const withholding = parseLooseNumber(row.withholding, 0);
  const calculatedNet = gross - withholding;
  const title = mode === "add" ? "Adicionar dividendo recebido" : "Editar dividendo recebido";
  return `
    <section class="panel span-12">
      <div class="panel-header"><h2>${title}</h2><span class="badge open">${escapeHtml(row.ticker || "Manual")} ${row.year}</span></div>
      <div class="panel-body">
        <form class="form-grid dividend-edit-form" id="dividendEditForm" onsubmit="return window.__portfolioSaveDividendForm(event, this)">
          <input type="hidden" name="id" value="${escapeHtml(row.id)}" />
          <label><span>Portfolio</span><select class="select" name="portfolioId">${store.portfolios.map((portfolio) => `<option value="${portfolio.id}" ${portfolio.id === row.portfolioId ? "selected" : ""}>${escapeHtml(portfolio.name)}</option>`).join("")}</select></label>
          <label><span>Ticker</span><input class="input" name="ticker" value="${escapeHtml(row.ticker)}" required /></label>
          <label><span>Ano</span><input class="input" type="number" min="2000" max="2100" name="year" value="${escapeHtml(row.year)}" required /></label>
          <label><span>Mes</span><select class="select" name="monthIndex">${monthShort.map((month, index) => `<option value="${index + 1}" ${index + 1 === toNumber(row.monthIndex, 1) ? "selected" : ""}>${escapeHtml(month)}</option>`).join("")}</select></label>
          <label><span>Dividendo total recebido</span><input class="input" type="text" inputmode="decimal" name="gross" value="${escapeHtml(row.gross)}" required /></label>
          <label><span>Retencao total</span><input class="input" type="text" inputmode="decimal" name="withholding" value="${escapeHtml(row.withholding)}" required /></label>
          <label><span>Acoes pagaram</span><input class="input" type="text" inputmode="decimal" name="sharesPaid" value="${Number.isFinite(sharesPaid) ? escapeHtml(sharesPaid) : ""}" /></label>
          <label><span>Liquido calculado</span><input class="input" type="text" value="${escapeHtml(calculatedNet.toFixed(2))}" data-dividend-net-preview readonly /></label>
          <label class="full"><span>Notas</span><input class="input" name="notes" value="${escapeHtml(row.notes || "")}" /></label>
          <button class="primary-button" type="button" data-save-dividend-form="1" onclick="return window.__portfolioSaveDividendForm(event, this.form)">${mode === "add" ? "Adicionar dividendo" : "Guardar alteracoes"}</button>
          <button class="secondary-button" type="button" data-cancel-dividend-edit="1">Cancelar</button>
        </form>
      </div>
    </section>
  `;
}

function emptyForecastMonths() {
  return monthNames.reduce((months, month) => {
    months[month] = false;
    return months;
  }, {});
}

function dividendForecastFormState() {
  const ticker = String(state.dividendForecastTicker || "").trim().toUpperCase();
  const forecast = ticker ? forecastMap().get(ticker) : null;
  return {
    ticker: forecast?.ticker || ticker,
    annualDividendPerShare: forecastInputNumber(forecast?.annualDividendPerShare),
    months: forecast?.months || emptyForecastMonths(),
    source: forecast?.source || "Manual",
  };
}

function renderForecastMonthChecks(months) {
  return `
    <div class="forecast-month-checks">
      ${monthShort
        .map((month, index) => {
          const monthName = monthNames[index];
          return `
            <label class="toggle month-toggle">
              <input type="checkbox" name="month_${index + 1}" value="1" ${months?.[monthName] ? "checked" : ""} />
              <span>${escapeHtml(month)}</span>
            </label>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderDividendForecastPanel() {
  const formRow = dividendForecastFormState();
  const forecastRows = [...forecastMap().values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return `
    <section class="panel span-12">
      <div class="panel-header">
        <h2>Previsao recorrente</h2>
        <div class="inline-actions">
          <span class="badge">${forecastRows.length} tickers</span>
          <button class="text-button" type="button" data-new-forecast-schedule="1">Novo</button>
        </div>
      </div>
      <div class="panel-body">
        <form class="form-grid dividend-forecast-form" id="dividendForecastForm">
          <label><span>Ticker</span><input class="input" name="ticker" value="${escapeHtml(formRow.ticker)}" placeholder="MSFT" required /></label>
          <label><span>Valor anual total por acao</span><input class="input" type="text" inputmode="decimal" name="annualDividendPerShare" value="${escapeHtml(formRow.annualDividendPerShare)}" placeholder="3,64" required /></label>
          <input type="hidden" name="source" value="Manual" />
          <div class="full">
            <span class="field-label">Meses em que paga</span>
            ${renderForecastMonthChecks(formRow.months)}
          </div>
          <button class="primary-button" type="submit">Guardar previsao</button>
        </form>
        <div class="table-section">
          ${renderTable({
            rows: forecastRows,
            columns: [
              { label: "Ticker", render: (row) => `<button class="ticker-button" data-open-ticker="${row.ticker}">${escapeHtml(row.ticker)}</button>` },
              { label: "Meses", render: forecastMonthBadges },
              { label: "Valor/acao", className: "num", render: (row) => optionalNumber(row.monthlyDividend) },
              { label: "Valor anual", className: "num", render: (row) => optionalNumber(row.annualDividendPerShare) },
              { label: "Fonte", render: (row) => escapeHtml(row.source || "Excel") },
              {
                label: "",
                render: (row) => `
                  <div class="inline-actions">
                    <button class="text-button" type="button" data-edit-forecast-schedule="${escapeHtml(row.ticker)}">Editar</button>
                    ${hasDividendForecastOverride(row.ticker) ? `<button class="text-button" type="button" data-clear-forecast-schedule="${escapeHtml(row.ticker)}">Limpar</button>` : ""}
                  </div>
                `,
              },
            ],
          })}
        </div>
      </div>
    </section>
  `;
}

function renderDividends() {
  const summary = getSummary();
  const receivedRows = dividendsInScope();
  const received = new Set(receivedRows.map(receivedKey));
  const receivedByKey = new Map(receivedRows.map((row) => [receivedKey(row), row]));
  const expected = expectedDividendEventsForYear(state.dividendYear);
  const calendarRows = expected.map((event) => {
    const receivedRow = receivedByKey.get(receivedKey(event));
    if (!receivedRow) return { ...event, received: false, receivedRow: null };
    return {
      ...event,
      ...receivedRow,
      id: event.id,
      payDate: receivedRow.payDate || event.payDate,
      exDate: receivedRow.exDate || event.exDate,
      recordDate: receivedRow.recordDate || event.recordDate,
      amountPerShare: receivedRow.dividendPerShare || event.amountPerShare,
      received: true,
      receivedRow,
    };
  });
  const editRow = receivedRows.find((row) => row.id === state.editDividendId);
  const dividendFormRow = editRow || (state.addDividend ? emptyDividendFormRow() : null);
  const expectedForSelectedYear = expected;
  return `
    ${scopeBar(`
      <label class="inline-field"><span>Ano</span><input class="input small-input" id="dividendYear" type="number" min="2020" max="2040" value="${state.dividendYear}" /></label>
      <label class="inline-field"><span>Retencao</span><input class="input small-input" id="withholdingRate" type="number" min="0" max="1" step="0.01" value="${store.settings.withholdingRate}" /></label>
    `)}
    <div class="view-tabs">
      <button class="tag-button ${state.dividendTab === "calendar" ? "is-active" : ""}" type="button" data-dividend-tab="calendar">Calendario</button>
      <button class="tag-button ${state.dividendTab === "received" ? "is-active" : ""}" type="button" data-dividend-tab="received">Recebidos</button>
      <button class="tag-button ${state.dividendTab === "forecasts" ? "is-active" : ""}" type="button" data-dividend-tab="forecasts">Previsoes</button>
    </div>
    <div class="kpi-grid">
      ${metricCard("Dividendos brutos", money(summary.grossDividends), `${dividendsInScope().length} recebimentos`)}
      ${metricCard("Retencao", money(summary.tax), pct(summary.grossDividends ? summary.tax / summary.grossDividends : 0), "negative")}
      ${metricCard("Liquido", money(summary.netDividends), "Recebido apos imposto")}
      ${metricCard("Previsto no ano", money(expectedForSelectedYear.reduce((total, row) => total + row.gross, 0)), `${expectedForSelectedYear.length} eventos`)}
    </div>
    <div class="panel-grid">
      ${
        state.dividendTab === "forecasts"
          ? renderDividendForecastPanel()
          : `
              ${renderDividendEditForm(dividendFormRow, state.addDividend ? "add" : "edit")}
              ${state.dividendTab === "received" ? renderReceivedDividendPanel(receivedRows) : renderDividendCalendarPanel(calendarRows)}
            `
      }
    </div>
  `;
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(line) {
  const candidates = ["\t", ";", ","];
  return candidates
    .map((delimiter) => ({ delimiter, count: splitDelimitedLine(line, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function parseImportRows(payload) {
  const text = String(payload || "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed.rows || parsed.dividendEvents || parsed.dividends || parsed.fundamentals || [];
    return rows.map((row) => ({ ...row }));
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitDelimitedLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line, delimiter);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function resolvePortfolioId(value) {
  const raw = String(value || "").trim();
  if (raw) {
    const byId = store.portfolios.find((portfolio) => portfolio.id === raw);
    if (byId) return byId.id;
    const byName = store.portfolios.find((portfolio) => normalizeText(portfolio.name) === normalizeText(raw));
    if (byName) return byName.id;
  }
  return state.scope !== "all" ? state.scope : store.portfolios[0]?.id || "";
}

function dividendImportKey(row) {
  return [row.portfolioId || "", row.ticker, row.year, row.monthIndex, row.payDate || row.exDate || ""].join(":");
}

function importDividendEvents(rows, source) {
  const result = { imported: 0, updated: 0, skipped: 0 };
  store.imports.dividendEvents = store.imports.dividendEvents || [];
  rows.forEach((rawRow) => {
    const row = normalizeDividendImportEvent(rawRow, source);
    if (!row) {
      result.skipped += 1;
      return;
    }
    row.importedAt = new Date().toISOString();
    const key = dividendImportKey(row);
    const existing = store.imports.dividendEvents.find((event) => dividendImportKey(event) === key);
    if (existing) {
      Object.assign(existing, row, { id: existing.id });
      result.updated += 1;
    } else {
      store.imports.dividendEvents.push(row);
      result.imported += 1;
    }
  });
  return result;
}

function importDividendForecasts(rows, source) {
  const result = { imported: 0, updated: 0, skipped: 0 };
  store.imports.dividendForecasts = store.imports.dividendForecasts || [];
  rows.forEach((rawRow) => {
    const row = normalizeDividendForecastImport(rawRow, source);
    if (!row) {
      result.skipped += 1;
      return;
    }
    row.importedAt = new Date().toISOString();
    const existing = store.imports.dividendForecasts.find((forecast) => forecast.ticker === row.ticker);
    if (existing) {
      Object.assign(existing, row, { id: existing.id });
      result.updated += 1;
    } else {
      store.imports.dividendForecasts.push(row);
      result.imported += 1;
    }
  });
  return result;
}

function forecastActiveMonthCount(row) {
  return Object.values(row?.months || {}).filter(Boolean).length || 1;
}

function defaultForecastMonths() {
  return monthNames.reduce((months, month) => {
    months[month] = true;
    return months;
  }, {});
}

function forecastInputNumber(value) {
  const parsed = toOptionalNumber(value);
  return Number.isFinite(parsed) ? String(Math.round((parsed + Number.EPSILON) * 10000) / 10000) : "";
}

function normalizeForecastAnnualPerShareInput(row, fallbackSource = "Manual") {
  const ticker = String(importValue(row, ["ticker", "symbol", "simbolo"]) || "").trim().toUpperCase();
  const annualDividendPerShare = parseLooseNumber(
    importValue(row, [
      "annualDividendPerShare",
      "annualPerShare",
      "dividendAnnualPerShare",
      "dividendPerShareAnnual",
      "receivedAnnualPerShare",
      "amountPerShare",
      "dividendPerShare",
      "dividend",
      "amount",
      "valor por acao",
      "valor anual por acao",
      "valorAnualPorAcao",
      "dividendo anual por acao",
      "recebido anual por acao",
    ]),
  );
  if (!ticker || !Number.isFinite(annualDividendPerShare)) return null;
  return {
    ticker,
    annualDividendPerShare,
    source: importValue(row, ["source", "fonte"]) || fallbackSource,
    notes: importValue(row, ["notes", "notas"]) || "",
  };
}

function normalizeForecastScheduleInput(values, fallbackSource = "Manual") {
  const ticker = String(values.ticker || "").trim().toUpperCase();
  const annualDividendPerShare = parseLooseNumber(values.annualDividendPerShare ?? values.totalAnnual ?? values.valorTotal);
  const months = {};
  monthNames.forEach((month, index) => {
    months[month] = ["1", "true", "on", "sim", "x"].includes(normalizeText(values[`month_${index + 1}`]));
  });
  const activeMonths = Object.values(months).filter(Boolean).length;
  if (!ticker || !Number.isFinite(annualDividendPerShare) || activeMonths < 1) return null;
  return {
    ticker,
    months,
    monthlyDividend: annualDividendPerShare / activeMonths,
    annualDividendPerShare,
    source: values.source || fallbackSource,
    notes: values.notes || "",
  };
}

function upsertDividendForecastSchedule(values, source = "Manual") {
  const input = normalizeForecastScheduleInput(values, source);
  if (!input) return false;
  store.imports.dividendForecasts = store.imports.dividendForecasts || [];
  const existing = store.imports.dividendForecasts.find((forecast) => forecast.ticker === input.ticker);
  const payload = {
    id: existing?.id || stableImportId("impforecast", [input.ticker]),
    ticker: input.ticker,
    months: input.months,
    monthlyDividend: input.monthlyDividend,
    annualDividendPerShare: input.annualDividendPerShare,
    source: input.source || "Manual",
    notes: input.notes || existing?.notes || "",
    importedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, payload, { id: existing.id });
  else store.imports.dividendForecasts.push(payload);
  state.dividendForecastTicker = input.ticker;
  return true;
}

function upsertDividendForecastAnnual(values, source = "Manual") {
  const input = normalizeForecastAnnualPerShareInput(values, source);
  if (!input) return false;
  store.imports.dividendForecasts = store.imports.dividendForecasts || [];
  const activeForecast = forecastMap().get(input.ticker);
  const existing = store.imports.dividendForecasts.find((forecast) => forecast.ticker === input.ticker);
  const months = existing?.months || activeForecast?.months || defaultForecastMonths();
  const activeMonths = forecastActiveMonthCount({ months });
  const payload = {
    id: existing?.id || stableImportId("impforecast", [input.ticker]),
    ticker: input.ticker,
    months,
    monthlyDividend: input.annualDividendPerShare / activeMonths,
    annualDividendPerShare: input.annualDividendPerShare,
    source: input.source || "Manual",
    notes: input.notes || existing?.notes || "",
    importedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, payload, { id: existing.id });
  else store.imports.dividendForecasts.push(payload);
  return true;
}

function removeDividendForecastOverride(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  const before = store.imports.dividendForecasts?.length || 0;
  store.imports.dividendForecasts = (store.imports.dividendForecasts || []).filter((row) => row.ticker !== symbol);
  return (store.imports.dividendForecasts?.length || 0) < before;
}

function hasDividendForecastOverride(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  return (store.imports?.dividendForecasts || []).some((row) => row.ticker === symbol);
}

function upsertDividendAnnualPerShare(values, source = "Manual") {
  const row = normalizeDividendAnnualPerShareImport(values, source);
  if (!row) return false;
  store.imports.dividendAnnualPerShare = store.imports.dividendAnnualPerShare || [];
  row.importedAt = new Date().toISOString();
  const key = dividendAnnualKey(row);
  const existing = store.imports.dividendAnnualPerShare.find((entry) => dividendAnnualKey(entry) === key);
  if (existing) Object.assign(existing, row, { id: existing.id });
  else store.imports.dividendAnnualPerShare.push(row);
  state.editDividendAnnualKey = key;
  return true;
}

function importDividendAnnualPerShare(rows, source) {
  const result = { imported: 0, updated: 0, skipped: 0 };
  rows.forEach((rawRow) => {
    const row = normalizeForecastAnnualPerShareInput(rawRow, source);
    if (!row) {
      result.skipped += 1;
      return;
    }
    const existed = (store.imports.dividendForecasts || []).some((entry) => entry.ticker === row.ticker);
    if (upsertDividendForecastAnnual(row, source)) {
      if (existed) result.updated += 1;
      else result.imported += 1;
    } else {
      result.skipped += 1;
    }
  });
  return result;
}

function quantityForTicker(ticker, portfolioId) {
  return getHoldings()
    .filter((holding) => holding.ticker === ticker && holding.portfolioId === portfolioId)
    .reduce((total, holding) => total + holding.quantity, 0);
}

function importReceivedDividends(rows, source) {
  const result = { imported: 0, updated: 0, skipped: 0 };
  rows.forEach((rawRow) => {
    const ticker = String(importValue(rawRow, ["ticker", "symbol", "simbolo"]) || "").trim().toUpperCase();
    const portfolioId = resolvePortfolioId(importValue(rawRow, ["portfolioId", "portfolio", "carteira"]));
    const date = parseImportDate(importValue(rawRow, ["payDate", "paymentDate", "date", "data", "exDate"]));
    const explicitYear = parseLooseNumber(importValue(rawRow, ["year", "ano"]));
    const year = Number.isFinite(explicitYear)
      ? Math.trunc(explicitYear)
      : date
        ? new Date(`${date}T00:00:00`).getFullYear()
        : NaN;
    const monthIndex = parseMonthIndex(importValue(rawRow, ["monthIndex", "month", "mes", "mês"])) || (date ? new Date(`${date}T00:00:00`).getMonth() + 1 : null);
    if (!ticker || !portfolioId || !Number.isFinite(year) || !monthIndex) {
      result.skipped += 1;
      return;
    }
    const amountPerShare = parseLooseNumber(importValue(rawRow, ["amountPerShare", "cashAmount", "dividendPerShare", "dividend", "amount"]));
    const sharesPaid = parseLooseNumber(importValue(rawRow, ["sharesPaid", "shares", "quantity", "qtd", "acoes", "ações", "#acoes", "#ações"]));
    let gross = parseLooseNumber(importValue(rawRow, ["gross", "bruto", "grossAmount", "valor bruto"]));
    if (!Number.isFinite(gross) && Number.isFinite(amountPerShare)) {
      gross = amountPerShare * (Number.isFinite(sharesPaid) ? sharesPaid : quantityForTicker(ticker, portfolioId));
    }
    if (!Number.isFinite(gross)) {
      result.skipped += 1;
      return;
    }
    const withholdingInput = parseLooseNumber(importValue(rawRow, ["withholding", "retencao", "retenção", "tax", "imposto"]));
    const netInput = parseLooseNumber(importValue(rawRow, ["net", "liquido", "líquido", "valor liquido"]));
    const withholding = Number.isFinite(withholdingInput) ? withholdingInput : Number.isFinite(netInput) ? gross - netInput : gross * store.settings.withholdingRate;
    const net = gross - withholding;
    const payload = {
      id: stableImportId("div", [portfolioId, ticker, year, monthIndex]),
      portfolioId,
      ticker,
      year,
      monthIndex,
      month: monthNames[monthIndex - 1],
      sharesPaid: Number.isFinite(sharesPaid) ? sharesPaid : "",
      gross,
      withholding,
      net,
      dividendPerShare: Number.isFinite(sharesPaid) && sharesPaid > 0 ? gross / sharesPaid : Number.isFinite(amountPerShare) ? amountPerShare : "",
      received: true,
      source,
      notes: importValue(rawRow, ["notes", "notas"]) || "",
    };
    const existing = store.dividends.find((row) => receivedKey(row) === receivedKey(payload));
    if (existing) {
      Object.assign(existing, payload, { id: existing.id });
      result.updated += 1;
    } else {
      store.dividends.push(payload);
      result.imported += 1;
    }
  });
  return result;
}

function upsertFundamentalRecord(values, source) {
  const ticker = String(values.ticker || "").trim().toUpperCase();
  const fiscalYear = Math.trunc(parseLooseNumber(values.fiscalYear));
  if (!ticker || !Number.isFinite(fiscalYear)) return false;
  const existing = store.earnings.find((row) => row.ticker === ticker && row.fiscalYear === fiscalYear);
  const numeric = {
    eps: parseLooseNumber(values.eps),
    revenue: parseLooseNumber(values.revenue),
    netIncome: parseLooseNumber(values.netIncome),
    price: parseLooseNumber(values.price),
    operatingCashFlow: parseLooseNumber(values.operatingCashFlow),
    capex: parseLooseNumber(values.capex),
    freeCashFlow: parseLooseNumber(values.freeCashFlow),
    freeCashFlowPerShare: parseLooseNumber(values.freeCashFlowPerShare),
    ebitda: parseLooseNumber(values.ebitda),
    assets: parseLooseNumber(values.assets),
    liabilities: parseLooseNumber(values.liabilities),
    equity: parseLooseNumber(values.equity),
  };
  const hasData = Object.values(numeric).some(Number.isFinite);
  if (!hasData) return false;
  const earningsPayload = {
    id: existing?.id || uid("earn"),
    ticker,
    fiscalYear,
    eps: Number.isFinite(numeric.eps) ? numeric.eps : existing?.eps || "",
    revenue: Number.isFinite(numeric.revenue) ? numeric.revenue : existing?.revenue || "",
    netIncome: Number.isFinite(numeric.netIncome) ? numeric.netIncome : existing?.netIncome || "",
    price: Number.isFinite(numeric.price) ? numeric.price : existing?.price || "",
    source,
  };
  if (existing) Object.assign(existing, earningsPayload);
  else store.earnings.push(earningsPayload);

  const fundamentalExisting = store.fundamentals.find((row) => row.ticker === ticker && row.fiscalYear === fiscalYear);
  const operatingCashFlow = Number.isFinite(numeric.operatingCashFlow) ? numeric.operatingCashFlow : fundamentalExisting?.operatingCashFlow;
  const capex = Number.isFinite(numeric.capex) ? numeric.capex : fundamentalExisting?.capex;
  const freeCashFlow =
    Number.isFinite(numeric.freeCashFlow)
      ? numeric.freeCashFlow
      : Number.isFinite(toOptionalNumber(operatingCashFlow)) && Number.isFinite(toOptionalNumber(capex))
        ? toNumber(operatingCashFlow) + toNumber(capex)
        : fundamentalExisting?.freeCashFlow;
  const fundamentalPayload = {
    ...(fundamentalExisting || {}),
    ...earningsPayload,
    operatingCashFlow: Number.isFinite(toOptionalNumber(operatingCashFlow)) ? toNumber(operatingCashFlow) : fundamentalExisting?.operatingCashFlow || "",
    capex: Number.isFinite(toOptionalNumber(capex)) ? toNumber(capex) : fundamentalExisting?.capex || "",
    freeCashFlow: Number.isFinite(toOptionalNumber(freeCashFlow)) ? toNumber(freeCashFlow) : fundamentalExisting?.freeCashFlow || "",
    freeCashFlowPerShare: Number.isFinite(numeric.freeCashFlowPerShare) ? numeric.freeCashFlowPerShare : fundamentalExisting?.freeCashFlowPerShare || "",
    ebitda: Number.isFinite(numeric.ebitda) ? numeric.ebitda : fundamentalExisting?.ebitda || "",
    assets: Number.isFinite(numeric.assets) ? numeric.assets : fundamentalExisting?.assets || "",
    liabilities: Number.isFinite(numeric.liabilities) ? numeric.liabilities : fundamentalExisting?.liabilities || "",
    equity: Number.isFinite(numeric.equity) ? numeric.equity : fundamentalExisting?.equity || "",
    productMix: fundamentalExisting?.productMix || [],
  };
  if (fundamentalExisting) Object.assign(fundamentalExisting, fundamentalPayload);
  else store.fundamentals.push(fundamentalPayload);
  return true;
}

function importFundamentals(rows, source) {
  const result = { imported: 0, updated: 0, skipped: 0 };
  rows.forEach((row) => {
    const ticker = importValue(row, ["ticker", "symbol", "simbolo"]);
    const fiscalYear = importValue(row, ["fiscalYear", "fiscal year", "year", "ano", "fy"]);
    const existed = store.fundamentals.some((entry) => entry.ticker === String(ticker).trim().toUpperCase() && entry.fiscalYear === Math.trunc(parseLooseNumber(fiscalYear)));
    const ok = upsertFundamentalRecord(
      {
        ticker,
        fiscalYear,
        eps: importValue(row, ["eps", "dilutedEps", "diluted eps"]),
        revenue: importValue(row, ["revenue", "receita", "sales"]),
        netIncome: importValue(row, ["netIncome", "net income", "lucro liquido", "lucro líquido"]),
        price: importValue(row, ["price", "cotacao", "cotação"]),
        operatingCashFlow: importValue(row, ["operatingCashFlow", "operating cash flow", "ocf"]),
        capex: importValue(row, ["capex", "capital expenditures"]),
        freeCashFlow: importValue(row, ["freeCashFlow", "free cash flow", "fcf"]),
        freeCashFlowPerShare: importValue(row, ["freeCashFlowPerShare", "fcf per share", "fcf/acao", "fcf/ação"]),
        ebitda: importValue(row, ["ebitda"]),
        assets: importValue(row, ["assets", "ativos"]),
        liabilities: importValue(row, ["liabilities", "passivos"]),
        equity: importValue(row, ["equity", "capital proprio", "capital próprio"]),
      },
      source,
    );
    if (!ok) result.skipped += 1;
    else if (existed) result.updated += 1;
    else result.imported += 1;
  });
  return result;
}

function handleImportForm(values) {
  const rows = parseImportRows(values.payload);
  const source = values.source || "Manual CSV";
  if (!rows.length) {
    window.alert("Nao encontrei linhas para importar.");
    return;
  }
  const result =
    values.importKind === "dividend-received"
      ? importReceivedDividends(rows, source)
      : values.importKind === "fundamentals"
        ? importFundamentals(rows, source)
        : values.importKind === "dividend-forecast"
          ? importDividendForecasts(rows, source)
          : values.importKind === "dividend-annual"
            ? importDividendAnnualPerShare(rows, source)
            : importDividendEvents(rows, source);
  store.imports.lastResult = {
    ...result,
    kind: values.importKind,
    source,
    importedAt: new Date().toISOString(),
  };
}

function importPlaceholder(kind) {
  if (kind === "dividend-received") {
    return "ticker;payDate;gross;withholding;sharesPaid;portfolio\nMSFT;2026-06-11;2.73;0.41;3;SimpleEquity USD";
  }
  if (kind === "fundamentals") {
    return "ticker;fiscalYear;eps;revenue;netIncome;freeCashFlow;freeCashFlowPerShare;price\nMSFT;2026;13.42;305453;88300;74000;9.59;441.31";
  }
  if (kind === "dividend-forecast") {
    return "ticker;months;monthlyDividend;source\nMSFT;Mar Jun Set Dez;0.91;StockAnalysis\nO;Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez;0.27;StockAnalysis";
  }
  if (kind === "dividend-annual") {
    return "ticker;annualDividendPerShare;source\nMSFT;3,64;Manual\nKO;2,12;Manual";
  }
  return "ticker;exDate;amountPerShare;payDate;source\nMSFT;2026-05-21;0.91;2026-06-11;StockAnalysis\nKO;2026-06-12;0.53;2026-07-01;MarketBeat";
}

function importKindLabel(kind) {
  return (
    {
      "dividend-events": "Dividendos previstos",
      "dividend-received": "Dividendos recebidos",
      "dividend-forecast": "Previsao recorrente",
      "dividend-annual": "Anual por acao",
      fundamentals: "Fundamentals",
      "imports-data.js": "Ficheiro local",
    }[kind] || kind
  );
}

function forecastMonthBadges(row) {
  const activeMonths = Object.entries(row.months || {}).filter(([, active]) => active);
  if (!activeMonths.length) return statusBadge("Sem meses", "error");
  return activeMonths
    .map(([month]) => {
      const index = monthNames.findIndex((name) => normalizeText(name) === normalizeText(month));
      return `<span class="badge open">${escapeHtml(index >= 0 ? monthShort[index] : month)}</span>`;
    })
    .join(" ");
}

function renderImports() {
  const imports = store.imports || createEmptyImports();
  const dividendEvents = imports.dividendEvents || [];
  const dividendForecasts = imports.dividendForecasts || [];
  const derivedForecasts = deriveForecastsFromImportedDividendEvents();
  const forecastRows = [...forecastMap().values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const tickers = new Set([
    ...dividendEvents.map((row) => row.ticker),
    ...dividendForecasts.map((row) => row.ticker),
    ...derivedForecasts.map((row) => row.ticker),
    ...forecastRows.map((row) => row.ticker),
  ]);
  const last = imports.lastResult;
  return `
    ${scopeBar(`
      <label class="inline-field"><span>Tipo</span><select class="select" id="importKind">
        <option value="dividend-events" ${state.importKind === "dividend-events" ? "selected" : ""}>Dividendos previstos</option>
        <option value="dividend-received" ${state.importKind === "dividend-received" ? "selected" : ""}>Dividendos recebidos</option>
        <option value="dividend-forecast" ${state.importKind === "dividend-forecast" ? "selected" : ""}>Previsao recorrente</option>
        <option value="dividend-annual" ${state.importKind === "dividend-annual" ? "selected" : ""}>Anual por acao</option>
        <option value="fundamentals" ${state.importKind === "fundamentals" ? "selected" : ""}>Fundamentals</option>
      </select></label>
    `)}
    <div class="kpi-grid">
      ${metricCard("Eventos importados", String(dividendEvents.length), "Dividendos com data")}
      ${metricCard("Previsoes", String(dividendForecasts.length + derivedForecasts.length), "Recorrencia por ticker")}
      ${metricCard("Tickers", String(tickers.size), "Cobertura local")}
      ${metricCard("Ultimo import", last ? `${last.imported || 0}/${last.updated || 0}` : "0/0", last ? `${importKindLabel(last.kind)} - ${last.source}` : "Sem imports")}
    </div>
    <div class="panel-grid">
      <section class="panel span-5">
        <div class="panel-header"><h2>Colar dados</h2><span class="badge open">Sem API</span></div>
        <div class="panel-body">
          <form class="form-grid import-form" id="importForm">
            <input type="hidden" name="importKind" value="${escapeHtml(state.importKind)}" />
            <label><span>Fonte</span><select class="select" name="source">
              <option value="StockAnalysis">StockAnalysis</option>
              <option value="MarketBeat">MarketBeat</option>
              <option value="Broker">Broker</option>
              <option value="Manual CSV">Manual CSV</option>
            </select></label>
            <label><span>Formato</span><input class="input" value="${escapeHtml(importKindLabel(state.importKind))}" readonly /></label>
            <label class="full"><span>Dados</span><textarea class="input import-textarea" name="payload" rows="10" placeholder="${escapeHtml(importPlaceholder(state.importKind))}" required></textarea></label>
            <button class="primary-button" type="submit">Importar linhas</button>
          </form>
        </div>
      </section>
      <section class="panel span-7">
        <div class="panel-header">
          <h2>Eventos de dividendos</h2>
          <div class="inline-actions">
            <span class="badge">${dividendEvents.length} linhas</span>
            <button class="text-button" type="button" data-clear-import-dividends="1">Limpar</button>
          </div>
        </div>
        <div class="panel-body">
          ${renderTable({
            rows: dividendEvents
              .slice()
              .sort((a, b) => b.year - a.year || b.monthIndex - a.monthIndex || a.ticker.localeCompare(b.ticker))
              .slice(0, 60),
            columns: [
              { label: "Ticker", render: (row) => `<button class="ticker-button" data-open-ticker="${row.ticker}">${escapeHtml(row.ticker)}</button>` },
              { label: "Mes", render: (row) => `${escapeHtml(monthShort[row.monthIndex - 1])} ${row.year}` },
              { label: "Ex-date", render: (row) => escapeHtml(row.exDate || "") },
              { label: "Pay date", render: (row) => escapeHtml(row.payDate || "") },
              { label: "Valor/acao", className: "num", render: (row) => optionalNumber(row.amountPerShare) },
              { label: "Fonte", render: (row) => escapeHtml(row.source || "Import") },
              { label: "", render: (row) => `<button class="text-button" data-delete-import-dividend="${row.id}">Remover</button>` },
            ],
          })}
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-header"><h2>Previsao ativa por ticker</h2></div>
        <div class="panel-body">
          ${renderTable({
            rows: forecastRows,
            columns: [
              { label: "Ticker", render: (row) => escapeHtml(row.ticker) },
              { label: "Meses", render: forecastMonthBadges },
              { label: "Valor/acao", className: "num", render: (row) => optionalNumber(row.monthlyDividend) },
              {
                label: "Anual/acao",
                className: "num",
                render: (row) =>
                  `<input class="input small-input" inputmode="decimal" data-forecast-annual-input="${escapeHtml(row.ticker)}" value="${escapeHtml(forecastInputNumber(row.annualDividendPerShare))}" aria-label="Anual por acao ${escapeHtml(row.ticker)}" />`,
              },
              { label: "Fonte", render: (row) => escapeHtml(row.source || "Excel") },
              {
                label: "",
                render: (row) => `
                  <div class="inline-actions">
                    <button class="text-button" type="button" data-save-forecast-annual="${escapeHtml(row.ticker)}">Guardar</button>
                    ${hasDividendForecastOverride(row.ticker) ? `<button class="text-button" type="button" data-clear-forecast-annual="${escapeHtml(row.ticker)}">Limpar</button>` : ""}
                  </div>
                `,
              },
            ],
          })}
          <p class="note">Guardar o Anual/acao recalcula o valor por acao mensal pelos meses ativos desse ticker.</p>
        </div>
      </section>
    </div>
  `;
}

function benchmarkRows() {
  const summary = getSummary();
  const rows = [
    {
      id: "portfolio",
      symbol: "Portfolio",
      name: "Portfolio",
      returnPct: summary.returnPct,
      startValue: summary.invested,
      currentValue: summary.currentValue + summary.realized + summary.netDividends,
    },
    ...store.benchmarks
      .map((row) => {
        const start = toOptionalNumber(row.startValue);
        const current = toOptionalNumber(row.currentValue);
        return {
          ...row,
          returnPct: Number.isFinite(start) && start > 0 && Number.isFinite(current) ? current / start - 1 : NaN,
        };
      })
      .filter((row) => Number.isFinite(row.returnPct)),
  ];
  return rows.sort((a, b) => b.returnPct - a.returnPct);
}

function benchmarkTableRows() {
  const summary = getSummary();
  return [
    {
      id: "portfolio",
      symbol: "Portfolio",
      name: "Portfolio",
      startValue: summary.invested,
      currentValue: summary.currentValue + summary.realized + summary.netDividends,
      returnPct: summary.returnPct,
    },
    ...store.benchmarks.map((row) => {
      const start = toOptionalNumber(row.startValue);
      const current = toOptionalNumber(row.currentValue);
      return {
        ...row,
        returnPct: Number.isFinite(start) && start > 0 && Number.isFinite(current) ? current / start - 1 : NaN,
      };
    }),
  ];
}

function dcfModeLabel(mode = state.dcfMode) {
  return mode === "reverse" ? "Reverse DCF" : "DCF";
}

function dcfConfigFromValues(values, existing = {}) {
  const years = Math.max(1, Math.min(40, Math.trunc(toNumber(values.years, 10))));
  const existingGrowthRates = Array.isArray(existing.growthRates) ? existing.growthRates.slice(0, years) : [];
  return {
    currentPrice: toNumber(values.currentPrice),
    baseFcfPerShare: toNumber(values.baseFcfPerShare),
    growthRate: toNumber(values.growthRate) / 100,
    discountRate: Math.max(0.0001, toNumber(values.discountRate) / 100),
    terminalGrowth: toNumber(values.terminalGrowth) / 100,
    years,
    marginOfSafety: Math.max(0, Math.min(0.9, toNumber(values.marginOfSafety) / 100)),
    growthRates: existingGrowthRates,
  };
}

function saveDcfConfigFromValues(values) {
  const ticker = String(values.ticker || "").trim().toUpperCase();
  if (!ticker) return null;
  const config = dcfConfigFromValues(values, store.dcf?.[ticker] || {});
  store.dcf[ticker] = config;
  state.dcfTicker = ticker;
  return { ticker, config };
}

function normalizedGrowthRates(config) {
  const years = Math.max(1, Math.min(40, Math.trunc(toNumber(config.years, 10))));
  const baseGrowth = toNumber(config.growthRate);
  const rates = Array.isArray(config.growthRates) ? config.growthRates : [];
  return Array.from({ length: years }, (_, index) => {
    const parsed = toOptionalNumber(rates[index]);
    return Number.isFinite(parsed) ? parsed : baseGrowth;
  });
}

function hasCustomGrowthRates(config) {
  return Array.isArray(config.growthRates) && config.growthRates.some((rate) => Number.isFinite(toOptionalNumber(rate)));
}

function saveDcfGrowthSchedule(values) {
  const ticker = String(values.ticker || "").trim().toUpperCase();
  if (!ticker) return false;
  const current = dcfConfig(ticker);
  const years = Math.max(1, Math.min(40, Math.trunc(toNumber(current.years, 10))));
  const rates = Array.from({ length: years }, (_, index) => {
    const parsed = parseLooseNumber(values[`growth_${index + 1}`]);
    return Number.isFinite(parsed) ? parsed / 100 : toNumber(current.growthRate);
  });
  store.dcf[ticker] = {
    ...current,
    growthRates: rates,
  };
  state.dcfTicker = ticker;
  state.showDcfGrowthEditor = false;
  return true;
}

function dcfValuationSnapshot(ticker, config, mode = state.dcfMode) {
  const projection = dcfProjection(config);
  const reverseGrowth = reverseDcfGrowth(config);
  const effectiveProjection =
    mode === "reverse" && Number.isFinite(reverseGrowth) ? dcfProjection(config, reverseGrowth) : projection;
  const currentPrice = toOptionalNumber(config.currentPrice);
  const intrinsicValue = Number.isFinite(effectiveProjection.value) ? effectiveProjection.value : "";
  const margin =
    Number.isFinite(currentPrice) && currentPrice > 0 && Number.isFinite(effectiveProjection.value)
      ? effectiveProjection.value / currentPrice - 1
      : "";
  const targetBuy = Number.isFinite(effectiveProjection.value) ? effectiveProjection.value * (1 - toNumber(config.marginOfSafety)) : "";
  return {
    ticker,
    mode,
    config: { ...config },
    intrinsicValue,
    currentPrice: Number.isFinite(currentPrice) ? currentPrice : "",
    margin,
    targetBuy,
    reverseGrowth: Number.isFinite(reverseGrowth) ? reverseGrowth : "",
    discountedTerminal: Number.isFinite(effectiveProjection.discountedTerminal) ? effectiveProjection.discountedTerminal : "",
    terminalValue: Number.isFinite(effectiveProjection.terminalValue) ? effectiveProjection.terminalValue : "",
  };
}

function saveDcfValuationFromValues(values, mode = state.dcfMode) {
  const saved = saveDcfConfigFromValues(values);
  if (!saved) return null;
  store.valuations = store.valuations || [];
  const existing = state.editValuationId ? store.valuations.find((row) => row.id === state.editValuationId) : null;
  const snapshot = dcfValuationSnapshot(saved.ticker, saved.config, mode);
  const payload = {
    ...(existing || {}),
    ...snapshot,
    id: existing?.id || uid("valuation"),
    calculatedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, payload);
  else store.valuations.push(payload);
  state.editValuationId = payload.id;
  state.dcfMode = mode;
  return payload;
}

function selectedValuation() {
  return (store.valuations || []).find((row) => row.id === state.editValuationId) || null;
}

function valuationRows() {
  return (store.valuations || [])
    .slice()
    .sort((a, b) => String(b.calculatedAt || "").localeCompare(String(a.calculatedAt || "")));
}

function valuationInputList(row) {
  if (!row) return "";
  const config = row.config || {};
  const items =
    row.mode === "reverse"
      ? [
          ["Preco alvo", optionalMoney(config.currentPrice, { convert: false })],
          ["FCF/acao base", optionalMoney(config.baseFcfPerShare, { convert: false })],
          ["Crescimento implicito", Number.isFinite(toOptionalNumber(row.reverseGrowth)) ? pct(row.reverseGrowth) : "n/a"],
          ["Desconto", pct(config.discountRate)],
          ["Terminal", pct(config.terminalGrowth)],
          ["Anos", String(config.years || "")],
          ["Margem seguranca", pct(config.marginOfSafety)],
        ]
      : [
          ["Preco atual", optionalMoney(config.currentPrice, { convert: false })],
          ["FCF/acao base", optionalMoney(config.baseFcfPerShare, { convert: false })],
          ["Crescimento projetado", pct(config.growthRate)],
          ["Cresc. anuais", hasCustomGrowthRates(config) ? `${normalizedGrowthRates(config).length} anos` : "Nao"],
          ["Desconto", pct(config.discountRate)],
          ["Terminal", pct(config.terminalGrowth)],
          ["Anos", String(config.years || "")],
          ["Margem seguranca", pct(config.marginOfSafety)],
        ];
  return `
    <div class="mini-grid">
      ${items.map(([label, value]) => metricMini(label, value || "n/a")).join("")}
    </div>
  `;
}

function renderValuationHistory(selected) {
  const rows = valuationRows();
  return `
    <section class="panel span-12">
      <div class="panel-header">
        <h2>Avaliacoes guardadas</h2>
        <div class="inline-actions">
          <span class="badge">${rows.length} linhas</span>
          ${selected ? `<button class="text-button" type="button" data-new-valuation="1">Nova avaliacao</button>` : ""}
        </div>
      </div>
      <div class="panel-body">
        ${renderTable({
          rows,
          columns: [
            { label: "Data", render: (row) => escapeHtml(dateTimeLabel(row.calculatedAt)) },
            { label: "Ticker", render: (row) => `<button class="ticker-button" data-open-valuation="${escapeHtml(row.id)}">${escapeHtml(row.ticker)}</button>` },
            { label: "Metodo", render: (row) => escapeHtml(dcfModeLabel(row.mode)) },
            { label: "Valor intrinseco", className: "num", render: (row) => optionalMoney(row.intrinsicValue, { convert: false }) },
            { label: "Preco", className: "num", render: (row) => optionalMoney(row.currentPrice, { convert: false }) },
            { label: "Margem", className: "num", render: (row) => Number.isFinite(toOptionalNumber(row.margin)) ? pct(row.margin) : "n/a" },
            { label: "Cresc. implicito", className: "num", render: (row) => Number.isFinite(toOptionalNumber(row.reverseGrowth)) ? pct(row.reverseGrowth) : "n/a" },
            { label: "", render: (row) => `<button class="text-button" type="button" data-edit-valuation="${escapeHtml(row.id)}">Editar</button>` },
          ],
        })}
        ${
          selected
            ? `<div class="valuation-detail">
                <h3>Valores colocados - ${escapeHtml(selected.ticker)} ${escapeHtml(dcfModeLabel(selected.mode))}</h3>
                ${valuationInputList(selected)}
              </div>`
            : ""
        }
      </div>
    </section>
  `;
}

function renderDcfGrowthEditor(ticker, config) {
  if (!state.showDcfGrowthEditor || state.dcfMode !== "dcf") return "";
  const rates = normalizedGrowthRates(config);
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="mini-modal" role="dialog" aria-modal="true" aria-labelledby="dcfGrowthEditorTitle">
        <div class="panel-header">
          <div>
            <h2 id="dcfGrowthEditorTitle">Crescimentos anuais</h2>
            <p>${escapeHtml(ticker)} - ${config.years} anos</p>
          </div>
          <button class="text-button" type="button" data-close-dcf-growth-editor="1">Fechar</button>
        </div>
        <div class="panel-body">
          <form class="form-grid growth-schedule-form" id="dcfGrowthScheduleForm">
            <input type="hidden" name="ticker" value="${escapeHtml(ticker)}" />
            ${rates
              .map(
                (rate, index) => `
                  <label>
                    <span>Y${index + 1}</span>
                    <input class="input" type="number" step="0.01" name="growth_${index + 1}" value="${escapeHtml(percentInput(rate))}" />
                  </label>
                `,
              )
              .join("")}
            <button class="primary-button" type="submit">Aplicar crescimentos</button>
            <button class="secondary-button" type="button" data-close-dcf-growth-editor="1">Cancelar</button>
          </form>
        </div>
      </section>
    </div>
  `;
}

function renderValuation() {
  const ticker = dcfTicker();
  const config = dcfConfig(ticker);
  const projection = dcfProjection(config);
  const reverseGrowth = reverseDcfGrowth(config);
  const activeProjection =
    state.dcfMode === "reverse" && Number.isFinite(reverseGrowth) ? dcfProjection(config, reverseGrowth) : projection;
  const currentPrice = toOptionalNumber(config.currentPrice);
  const margin = Number.isFinite(currentPrice) && currentPrice > 0 && Number.isFinite(activeProjection.value) ? activeProjection.value / currentPrice - 1 : NaN;
  const targetBuy = Number.isFinite(activeProjection.value) ? activeProjection.value * (1 - toNumber(config.marginOfSafety)) : NaN;
  const rows = earningsRows(ticker);
  const latest = rows.at(-1);
  const saved = selectedValuation();
  const isReverse = state.dcfMode === "reverse";
  return `
    ${scopeBar(`
      <label class="inline-field"><span>Ticker</span><select class="select" id="dcfTickerSelect">${allTickers().map((item) => `<option value="${item}" ${item === ticker ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></label>
    `)}
    <div class="view-tabs">
      <button class="tag-button ${state.dcfMode === "dcf" ? "is-active" : ""}" type="button" data-dcf-mode="dcf">DCF</button>
      <button class="tag-button ${state.dcfMode === "reverse" ? "is-active" : ""}" type="button" data-dcf-mode="reverse">Reverse DCF</button>
    </div>
    <section class="company-hero">
      <div>
        <div class="company-title">
          <h2>${escapeHtml(companyLabel(ticker))}</h2>
          <span class="ticker-pill">${escapeHtml(ticker)}</span>
          <span class="badge open">${escapeHtml(dcfModeLabel())}</span>
        </div>
        <p>${escapeHtml(
          isReverse
            ? "Reverse DCF calcula o crescimento que o preco atual ja esta a assumir."
            : "DCF calcula o valor intrinseco a partir do crescimento, desconto e FCF por acao.",
        )}</p>
      </div>
      <div class="company-tags">
        <span class="badge">${latest ? fiscalLabel(latest) : "Sem ano fiscal"}</span>
        <span class="badge">${latest?.source || "Manual"}</span>
        ${saved ? `<span class="badge open">A editar avaliacao</span>` : ""}
      </div>
    </section>
    <div class="kpi-grid">
      ${
        isReverse
          ? `
              ${metricCard("Crescimento implicito", Number.isFinite(reverseGrowth) ? pct(reverseGrowth) : "n/a", "Resultado principal do Reverse DCF", Number.isFinite(reverseGrowth) && reverseGrowth >= 0 ? "positive" : "negative")}
              ${metricCard("Preco alvo", Number.isFinite(currentPrice) ? money(currentPrice, { convert: false }) : "n/a", "Preco que o mercado tenta justificar")}
              ${metricCard("Valor explicado", Number.isFinite(activeProjection.value) ? money(activeProjection.value, { convert: false }) : "n/a", "DCF com crescimento implicito")}
              ${metricCard("Diferenca vs preco", Number.isFinite(margin) ? pct(margin) : "n/a", "Deve ficar perto de 0", Number.isFinite(margin) && Math.abs(margin) < 0.005 ? "positive" : "")}
              ${metricCard("Base FCF/acao", optionalMoney(config.baseFcfPerShare, { convert: false }), "Input principal")}
              ${metricCard("Desconto", pct(config.discountRate), "Taxa requerida")}
              ${metricCard("Terminal", pct(config.terminalGrowth), "Crescimento perpetuo")}
              ${metricCard("Anos", String(config.years), "Horizonte do reverse")}
            `
          : `
              ${metricCard("Valor intrinseco", Number.isFinite(activeProjection.value) ? money(activeProjection.value, { convert: false }) : "n/a", `${config.years} anos + terminal`, Number.isFinite(margin) ? (margin >= 0 ? "positive" : "negative") : "")}
              ${metricCard("Preco atual", Number.isFinite(currentPrice) ? money(currentPrice, { convert: false }) : "n/a", "Da carteira ou manual")}
              ${metricCard("Margem vs preco", Number.isFinite(margin) ? pct(margin) : "n/a", "Valor / preco - 1", Number.isFinite(margin) && margin >= 0 ? "positive" : "negative")}
              ${metricCard("Crescimento exigido", Number.isFinite(reverseGrowth) ? pct(reverseGrowth) : "n/a", "Reverse DCF de referencia")}
              ${metricCard("Comprar abaixo", Number.isFinite(targetBuy) ? money(targetBuy, { convert: false }) : "n/a", `Margem seguranca ${pct(config.marginOfSafety)}`)}
              ${metricCard("Base FCF/acao", optionalMoney(config.baseFcfPerShare, { convert: false }), "Input principal")}
              ${metricCard("Desconto", pct(config.discountRate), "Taxa requerida")}
              ${metricCard("Terminal", pct(config.terminalGrowth), "Crescimento perpetuo")}
            `
      }
    </div>
    <div class="panel-grid">
      <section class="panel span-4">
        <div class="panel-header"><h2>Pressupostos ${escapeHtml(dcfModeLabel())}</h2></div>
        <div class="panel-body">
          <form class="form-grid" id="dcfForm">
            <input type="hidden" name="ticker" value="${escapeHtml(ticker)}" />
            <label><span>Preco atual</span><input class="input" type="number" step="0.0001" min="0" name="currentPrice" value="${escapeHtml(config.currentPrice)}" /></label>
            <label><span>FCF/acao base</span><input class="input" type="number" step="0.0001" min="0" name="baseFcfPerShare" value="${escapeHtml(config.baseFcfPerShare)}" /></label>
            ${
              isReverse
                ? `<label><span>Crescimento implicito %</span><input class="input" type="text" value="${escapeHtml(Number.isFinite(reverseGrowth) ? percentInput(reverseGrowth) : "")}" readonly /><input type="hidden" name="growthRate" value="${escapeHtml(percentInput(config.growthRate))}" /></label>`
                : `<label><span>Crescimento %</span><input class="input" type="number" step="0.01" name="growthRate" value="${percentInput(config.growthRate)}" /></label>`
            }
            ${
              isReverse
                ? ""
                : `<button class="secondary-button" type="button" data-open-dcf-growth-editor="1">${hasCustomGrowthRates(config) ? "Editar anos" : "Crescimentos anuais"}</button>`
            }
            <label><span>Desconto %</span><input class="input" type="number" step="0.01" name="discountRate" value="${percentInput(config.discountRate)}" /></label>
            <label><span>Terminal %</span><input class="input" type="number" step="0.01" name="terminalGrowth" value="${percentInput(config.terminalGrowth)}" /></label>
            <label><span>Anos</span><input class="input" type="number" step="1" min="1" max="40" name="years" value="${escapeHtml(config.years)}" /></label>
            <label class="full"><span>Margem seguranca %</span><input class="input" type="number" step="0.01" min="0" max="90" name="marginOfSafety" value="${percentInput(config.marginOfSafety)}" /></label>
            <button class="primary-button" type="submit">Atualizar calculo</button>
            <button class="secondary-button full" type="button" data-save-dcf-valuation="1">${saved ? "Atualizar avaliacao guardada" : "Guardar avaliacao"}</button>
          </form>
        </div>
      </section>
      <section class="panel span-8">
        <div class="panel-header"><h2>${isReverse ? "Fluxos ao crescimento implicito" : "Fluxos projetados"}</h2><span class="badge">Por acao</span></div>
        <div class="panel-body">
          ${annualBarChart(
            activeProjection.rows.map((row) => ({ label: `Y${row.year}`, value: row.discounted })),
            { label: "Fluxos DCF", color: "var(--teal)", yFormat: (value) => money(value, { convert: false }), empty: "Preenche FCF/acao para ver a projeccao." },
          )}
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-header"><h2>Detalhe ${escapeHtml(dcfModeLabel())}</h2><span class="badge">Terminal descontado: ${Number.isFinite(activeProjection.discountedTerminal) ? money(activeProjection.discountedTerminal, { convert: false }) : "n/a"}</span></div>
        <div class="panel-body">
          ${renderTable({
            rows: activeProjection.rows,
            columns: [
              { label: "Ano", render: (row) => `Y${row.year}` },
              { label: "Crescimento", className: "num", render: (row) => pct(row.growthRate) },
              { label: "FCF/acao", className: "num", render: (row) => money(row.fcf, { convert: false }) },
              { label: "Valor descontado", className: "num", render: (row) => money(row.discounted, { convert: false }) },
            ],
          })}
          <p class="note">DCF reverso procura o crescimento anual que faria o DCF igualar o preco atual, mantendo desconto, anos e crescimento terminal.</p>
        </div>
      </section>
      ${renderValuationHistory(saved)}
    </div>
    ${renderDcfGrowthEditor(ticker, config)}
  `;
}

function allTickers() {
  return [
    ...new Set([
      ...getHoldings().map((row) => row.ticker),
      ...(store.watchlist || []).map((row) => String(row.ticker || "").trim().toUpperCase()).filter(Boolean),
      ...store.fundamentals.map((row) => row.ticker),
      ...store.earnings.map((row) => row.ticker),
      ...DATA.holdings.map((row) => row.ticker),
    ]),
  ].sort();
}

function selectedTicker() {
  const tickers = allTickers();
  if (!state.selectedTicker || !tickers.includes(state.selectedTicker)) state.selectedTicker = tickers[0] || "";
  return state.selectedTicker;
}

function earningsRows(ticker) {
  const rows = store.fundamentals?.length ? store.fundamentals : store.earnings;
  return rows
    .filter((row) => row.ticker === ticker)
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
}

function dcfTicker() {
  const tickers = allTickers();
  if (!state.dcfTicker || !tickers.includes(state.dcfTicker)) state.dcfTicker = selectedTicker();
  return state.dcfTicker || tickers[0] || "";
}

const companyNames = {
  ACN: "ACCENTURE PLC",
  AMZN: "AMAZON.COM INC",
  CMCSA: "COMCAST CORP",
  CNI: "CANADIAN NATIONAL RAILWAY",
  CRM: "SALESFORCE INC",
  CVX: "CHEVRON CORP",
  GOOGL: "ALPHABET INC",
  IBM: "IBM",
  JPM: "JPMORGAN CHASE & CO",
  KO: "COCA-COLA CO",
  META: "META PLATFORMS INC",
  MRK: "MERCK & CO",
  MSFT: "MICROSOFT CORP",
  NVDA: "NVIDIA CORP",
  OXY: "OCCIDENTAL PETROLEUM",
  PANW: "PALO ALTO NETWORKS",
  PEP: "PEPSICO INC",
  PG: "PROCTER & GAMBLE CO",
  PYPL: "PAYPAL HOLDINGS",
  TSM: "TAIWAN SEMICONDUCTOR",
  V: "VISA INC",
  VICI: "VICI PROPERTIES",
  WMT: "WALMART INC",
};

function companyLabel(ticker) {
  return companyNames[ticker] || ticker;
}

function financialValue(value) {
  const parsed = toOptionalNumber(value);
  if (!Number.isFinite(parsed)) return "n/a";
  const abs = Math.abs(parsed);
  if (abs >= 1000) return `${formatters.num.format(parsed / 1000)}B`;
  return `${formatters.num.format(parsed)}M`;
}

function fiscalLabel(row) {
  return `FY${row.fiscalYear}`;
}

function dcfDefaults(ticker) {
  const rows = earningsRows(ticker);
  const latest = rows.at(-1) || {};
  const holding = getHoldings().find((row) => row.ticker === ticker);
  const currentPrice = toOptionalNumber(holding?.price ?? store.prices[ticker] ?? latest.price);
  const baseFcfPerShare = toOptionalNumber(latest.freeCashFlowPerShare) || toOptionalNumber(latest.eps);
  return {
    currentPrice: Number.isFinite(currentPrice) ? currentPrice : "",
    baseFcfPerShare: Number.isFinite(baseFcfPerShare) ? baseFcfPerShare : "",
    growthRate: 0.08,
    discountRate: 0.1,
    terminalGrowth: 0.03,
    years: 10,
    marginOfSafety: 0.25,
    growthRates: [],
  };
}

function dcfConfig(ticker) {
  return { ...dcfDefaults(ticker), ...(store.dcf?.[ticker] || {}) };
}

function dcfProjection(config, overrideGrowth = null) {
  const base = toOptionalNumber(config.baseFcfPerShare);
  const growth = overrideGrowth == null ? toNumber(config.growthRate) : overrideGrowth;
  const discount = Math.max(0.0001, toNumber(config.discountRate));
  const terminalGrowth = Math.min(discount - 0.0001, toNumber(config.terminalGrowth));
  const years = Math.max(1, Math.min(40, Math.trunc(toNumber(config.years, 10))));
  if (!Number.isFinite(base) || base <= 0) return { value: NaN, rows: [], terminalValue: NaN };
  let value = 0;
  let fcf = base;
  const growthRates = overrideGrowth == null && hasCustomGrowthRates(config) ? normalizedGrowthRates(config) : null;
  const rows = [];
  for (let year = 1; year <= years; year += 1) {
    const yearGrowth = growthRates ? growthRates[year - 1] : growth;
    fcf *= 1 + yearGrowth;
    const discounted = fcf / Math.pow(1 + discount, year);
    value += discounted;
    rows.push({ year, fcf, discounted, growthRate: yearGrowth });
  }
  const terminalFcf = rows.at(-1).fcf * (1 + terminalGrowth);
  const terminalValue = terminalFcf / (discount - terminalGrowth);
  const discountedTerminal = terminalValue / Math.pow(1 + discount, years);
  value += discountedTerminal;
  return { value, rows, terminalValue, discountedTerminal };
}

function reverseDcfGrowth(config) {
  const target = toOptionalNumber(config.currentPrice);
  if (!Number.isFinite(target) || target <= 0) return NaN;
  let low = -0.25;
  let high = 0.45;
  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    const value = dcfProjection(config, mid).value;
    if (!Number.isFinite(value)) return NaN;
    if (value > target) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

function percentInput(value) {
  return Number.isFinite(toNumber(value, NaN)) ? (toNumber(value) * 100).toFixed(2) : "";
}

function earningsRowsForRange(rows) {
  if (state.earningsRange === "all") return rows;
  const limit = Math.max(1, Math.trunc(toNumber(state.earningsRange, 5)));
  return rows.slice(-limit);
}

function cagr(rows, key) {
  const values = rows
    .map((row) => ({ year: row.fiscalYear, value: toOptionalNumber(row[key]) }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0);
  if (values.length < 2) return NaN;
  const first = values[0];
  const last = values.at(-1);
  const periods = Math.max(1, last.year - first.year);
  return Math.pow(last.value / first.value, 1 / periods) - 1;
}

function yearlyChange(rows, key) {
  const values = rows.map((row) => toOptionalNumber(row[key])).filter(Number.isFinite);
  if (values.length < 2 || values.at(-2) === 0) return NaN;
  return values.at(-1) / values.at(-2) - 1;
}

function rangeTags() {
  return `
    <div class="chart-tags" aria-label="Periodo">
      ${[
        ["5", "5A"],
        ["10", "10A"],
        ["all", "All"],
      ]
        .map(
          ([value, label]) =>
            `<button class="tag-button ${state.earningsRange === value ? "is-active" : ""}" data-earnings-range="${value}" type="button">${label}</button>`,
        )
        .join("")}
    </div>
  `;
}

function annualBarChart(points, options = {}) {
  const rows = points
    .map((point) => ({ ...point, value: toOptionalNumber(point.value) }))
    .filter((point) => Number.isFinite(point.value));
  if (!rows.length) return `<div class="empty chart-empty">${escapeHtml(options.empty || "Sem dados.")}</div>`;

  const width = 680;
  const height = 300;
  const pad = { left: 70, right: 22, top: 24, bottom: 58 };
  const rawMin = Math.min(...rows.map((point) => point.value));
  const rawMax = Math.max(...rows.map((point) => point.value));
  let min = Math.min(0, rawMin);
  let max = Math.max(0, rawMax);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const buffer = (max - min) * 0.08;
  if (rawMin >= 0) {
    min = 0;
    max += buffer;
  } else if (rawMax <= 0) {
    min -= buffer;
    max = 0;
  } else {
    min -= buffer;
    max += buffer;
  }

  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const y = (value) => pad.top + ((max - value) / (max - min)) * plotH;
  const zeroY = y(0);
  const band = plotW / rows.length;
  const barW = Math.min(52, Math.max(18, band * 0.54));
  const yFormat = options.yFormat || financialValue;
  const ticks = [0, 1, 2, 3].map((index) => min + ((max - min) * index) / 3);

  return `
    <svg class="bar-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "Barras anuais")}">
      ${ticks
        .map((tick) => {
          const yy = y(tick);
          return `
            <line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"></line>
            <text x="${pad.left - 10}" y="${yy + 4}" text-anchor="end">${escapeHtml(yFormat(tick))}</text>
          `;
        })
        .join("")}
      <line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${zeroY}" y2="${zeroY}"></line>
      ${rows
        .map((point, index) => {
          const x = pad.left + index * band + (band - barW) / 2;
          const barY = Math.min(y(point.value), zeroY);
          const barH = Math.max(2, Math.abs(y(point.value) - zeroY));
          const fill = point.value < 0 ? "var(--red)" : options.color || "var(--teal)";
          return `
            <rect class="bar-column" x="${x}" y="${barY}" width="${barW}" height="${barH}" rx="5" fill="${fill}"></rect>
            <text class="x-label" x="${x + barW / 2}" y="${height - 18}" text-anchor="middle" transform="rotate(-35 ${x + barW / 2} ${height - 18})">${escapeHtml(point.label)}</text>
          `;
        })
        .join("")}
    </svg>
  `;
}

function groupedAnnualBarChart(rows, groups, options = {}) {
  const prepared = rows.map((row) => ({
    label: fiscalLabel(row),
    values: groups.map((group) => ({ ...group, value: toOptionalNumber(row[group.key]) })),
  }));
  const values = prepared.flatMap((row) => row.values.map((entry) => entry.value)).filter(Number.isFinite);
  if (!values.length) return `<div class="empty chart-empty">${escapeHtml(options.empty || "Sem dados.")}</div>`;

  const width = 680;
  const height = 300;
  const pad = { left: 70, right: 22, top: 24, bottom: 58 };
  let max = Math.max(...values, 0);
  if (max <= 0) max = 1;
  max *= 1.08;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const y = (value) => pad.top + ((max - value) / max) * plotH;
  const band = plotW / prepared.length;
  const groupGap = 3;
  const barW = Math.min(18, Math.max(7, (band * 0.68) / groups.length - groupGap));
  const yFormat = options.yFormat || financialValue;
  const ticks = [0, 1, 2, 3].map((index) => (max * index) / 3);

  return `
    <svg class="bar-chart grouped-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "Balanco")}">
      ${ticks
        .map((tick) => {
          const yy = y(tick);
          return `
            <line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"></line>
            <text x="${pad.left - 10}" y="${yy + 4}" text-anchor="end">${escapeHtml(yFormat(tick))}</text>
          `;
        })
        .join("")}
      <line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"></line>
      ${prepared
        .map((row, index) => {
          const groupWidth = groups.length * barW + (groups.length - 1) * groupGap;
          const baseX = pad.left + index * band + (band - groupWidth) / 2;
          return row.values
            .map((entry, groupIndex) => {
              if (!Number.isFinite(entry.value)) return "";
              const x = baseX + groupIndex * (barW + groupGap);
              const yy = y(Math.max(0, entry.value));
              const barH = Math.max(2, height - pad.bottom - yy);
              return `<rect class="bar-column" x="${x}" y="${yy}" width="${barW}" height="${barH}" rx="4" fill="${entry.color}"></rect>`;
            })
            .join("");
        })
        .join("")}
      ${prepared
        .map((row, index) => {
          const x = pad.left + index * band + band / 2;
          return `<text class="x-label" x="${x}" y="${height - 18}" text-anchor="middle" transform="rotate(-35 ${x} ${height - 18})">${escapeHtml(row.label)}</text>`;
        })
        .join("")}
    </svg>
    <div class="legend">
      ${groups.map((group) => `<span><i style="background:${group.color}"></i>${escapeHtml(group.label)}</span>`).join("")}
    </div>
  `;
}

function earningsMetricCard(label, value, sub = "", tone = "") {
  return `
    <article class="earnings-metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(sub)}</small>
    </article>
  `;
}

function earningsChartCard(title, subtitle, rows, key, options = {}) {
  const points = rows.map((row) => ({
    label: fiscalLabel(row),
    value: row[key],
  }));
  return `
    <section class="panel earnings-card ${options.wide ? "span-12" : "span-6"}">
      <div class="panel-header">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        ${rangeTags()}
      </div>
      <div class="panel-body">
        ${annualBarChart(points, {
          label: title,
          color: options.color,
          yFormat: options.yFormat,
          empty: options.empty,
        })}
      </div>
    </section>
  `;
}

function balanceSheetCard(rows) {
  return `
    <section class="panel earnings-card span-6">
      <div class="panel-header">
        <div>
          <h2>Balance sheet</h2>
          <p>Assets, liabilities e equity</p>
        </div>
        ${rangeTags()}
      </div>
      <div class="panel-body">
        ${groupedAnnualBarChart(
          rows,
          [
            { key: "assets", label: "Assets", color: "var(--blue)" },
            { key: "liabilities", label: "Liabilities", color: "var(--teal)" },
            { key: "equity", label: "Equity", color: "var(--gold)" },
          ],
          { label: "Balance sheet", empty: "Balanco ainda nao carregado para este ticker." },
        )}
      </div>
    </section>
  `;
}

function renderEarningsChart(ticker) {
  const rows = earningsRows(ticker);
  if (!rows.length) return `<div class="empty">Sem earnings registados.</div>`;
  const series = [
    {
      name: "EPS",
      color: "var(--teal)",
      points: rows.map((row) => ({ label: String(row.fiscalYear), value: toOptionalNumber(row.eps) })).filter((point) => Number.isFinite(point.value)),
    },
  ];
  if (rows.some((row) => Number.isFinite(toOptionalNumber(row.price)))) {
    series.push({
      name: "Cotacao",
      color: "var(--gold)",
      points: rows.map((row) => ({ label: String(row.fiscalYear), value: toOptionalNumber(row.price) })).filter((point) => Number.isFinite(point.value)),
    });
  }
  return lineChart(series, {
    label: `${ticker} earnings`,
    includeZero: false,
    yFormat: (value) => number(value),
  });
}

function renderEarnings() {
  const ticker = selectedTicker();
  const rows = earningsRows(ticker);
  const visibleRows = earningsRowsForRange(rows);
  const tickerHoldings = getHoldings().filter((row) => row.ticker === ticker);
  const holdingValue = tickerHoldings.reduce((total, row) => total + row.value, 0);
  const holdingQuantity = tickerHoldings.reduce((total, row) => total + row.quantity, 0);
  const holdingPl = tickerHoldings.reduce((total, row) => total + row.totalPl, 0);
  const holding = tickerHoldings[0] || DATA.holdings.find((row) => row.ticker === ticker);
  const latest = rows.at(-1);
  const loadedYears = new Set(rows.map((row) => row.fiscalYear));
  const latestLoaded = Math.max(...loadedYears);
  const expectedYears = expectedFiscalYears(Number.isFinite(latestLoaded) ? latestLoaded : null);
  const missingYears = expectedYears.filter((year) => !loadedYears.has(year));
  const meta = window.PORTFOLIO_EARNINGS_META || {};
  const source = latest?.source || meta.provider || "StockAnalysis";
  const revenueCagr = cagr(rows, "revenue");
  const epsCagr = cagr(rows, "eps");
  const netIncomeChange = yearlyChange(rows, "netIncome");
  const latestYear = latest ? fiscalLabel(latest) : "n/a";
  const latestPrice = tickerHoldings.length ? optionalMoney(tickerHoldings[0].price) : "n/a";

  return `
    ${scopeBar(`
      <div class="filters">
        <label class="inline-field"><span>Ticker</span><select class="select" id="tickerSelect">${allTickers().map((item) => `<option value="${item}" ${item === ticker ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></label>
        ${rangeTags()}
      </div>
    `)}
    <section class="company-hero">
      <div>
        <div class="company-title">
          <h2>${escapeHtml(companyLabel(ticker))}</h2>
          <span class="ticker-pill">${escapeHtml(ticker)}</span>
          ${holding?.sector ? `<span class="badge">${escapeHtml(holding.sector)}</span>` : ""}
          <span class="badge open">Sem API key</span>
        </div>
        <p>Earnings anuais carregados localmente a partir da StockAnalysis. Valores financeiros em milhoes, conforme a fonte.</p>
      </div>
      <div class="company-tags">
        <span class="badge open">${escapeHtml(source)}</span>
        <span class="badge">${rows.length} anos carregados</span>
        <span class="badge ${missingYears.length ? "error" : "open"}">${missingYears.length ? `${missingYears.length} anos em falta` : "Cobertura completa"}</span>
        ${meta.attemptedAt ? `<span class="badge">Atualizado ${escapeHtml(meta.attemptedAt)}</span>` : ""}
      </div>
    </section>

    <div class="earnings-metric-grid">
      ${earningsMetricCard("Price", latestPrice, "Ultima cotacao do Excel")}
      ${earningsMetricCard("Valor no portfolio", holdingValue ? money(holdingValue) : "n/a", holdingQuantity ? `${number(holdingQuantity)} unidades` : "Sem posicao")}
      ${earningsMetricCard("EPS ultimo ano", latest ? optionalNumber(latest.eps) : "n/a", latestYear)}
      ${earningsMetricCard("Revenue CAGR", Number.isFinite(revenueCagr) ? pct(revenueCagr) : "n/a", `${rows.length} anos carregados`, Number.isFinite(revenueCagr) && revenueCagr >= 0 ? "positive" : "")}
      ${earningsMetricCard("EPS CAGR", Number.isFinite(epsCagr) ? pct(epsCagr) : "n/a", `${rows.length} anos carregados`, Number.isFinite(epsCagr) && epsCagr >= 0 ? "positive" : "")}
      ${earningsMetricCard("Net income YoY", Number.isFinite(netIncomeChange) ? pct(netIncomeChange) : "n/a", latestYear, Number.isFinite(netIncomeChange) ? (netIncomeChange >= 0 ? "positive" : "negative") : "")}
      ${earningsMetricCard("P/L portfolio", tickerHoldings.length ? money(holdingPl) : "n/a", state.scope === "all" ? "Total agregado" : portfolioName(state.scope), tickerHoldings.length ? (holdingPl >= 0 ? "positive" : "negative") : "")}
      ${earningsMetricCard("Anos em falta", String(missingYears.length), missingYears.length ? missingYears.join(", ") : "Janela completa", missingYears.length ? "negative" : "positive")}
    </div>

    <div class="panel-grid earnings-board">
      ${earningsChartCard("Revenue", "Top-line trend anual", visibleRows, "revenue", { color: "var(--blue)", yFormat: financialValue })}
      ${earningsChartCard("Net income", "Bottom-line trend anual", visibleRows, "netIncome", { color: "var(--teal)", yFormat: financialValue })}
      ${earningsChartCard("Diluted EPS", "Lucro por acao diluido", visibleRows, "eps", { color: "var(--gold)", yFormat: number })}
      ${earningsChartCard("Free cash flow", "Operating cash flow menos capex", visibleRows, "freeCashFlow", { color: "var(--green)", yFormat: financialValue, empty: "FCF ainda nao carregado para este ticker." })}
      ${earningsChartCard("EBITDA", "Rentabilidade operacional antes de D&A", visibleRows, "ebitda", { color: "var(--red)", yFormat: financialValue, empty: "EBITDA ainda nao carregado para este ticker." })}
      ${balanceSheetCard(visibleRows)}
      <section class="panel earnings-card span-6">
        <div class="panel-header">
          <div>
            <h2>Filosofia earnings</h2>
            <p>Earnings vs cotacao</p>
          </div>
          <span class="badge">Watch</span>
        </div>
        <div class="panel-body">
          ${
            rows.some((row) => Number.isFinite(toOptionalNumber(row.price)))
              ? renderEarningsChart(ticker)
              : `<div class="empty chart-empty">A serie historica de cotacao ainda nao esta carregada. Quando adicionares cotacao anual manualmente, o grafico combina EPS e preco.</div>`
          }
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-header"><h2>Anos fiscais</h2></div>
        <div class="panel-body">
          ${renderTable({
            rows,
            columns: [
              { label: "Ano", render: (row) => String(row.fiscalYear) },
              { label: "EPS", className: "num", render: (row) => optionalNumber(row.eps) },
              { label: "Receita", className: "num", render: (row) => financialValue(row.revenue) },
              { label: "Net Income", className: "num", render: (row) => financialValue(row.netIncome) },
              { label: "FCF", className: "num", render: (row) => financialValue(row.freeCashFlow) },
              { label: "EBITDA", className: "num", render: (row) => financialValue(row.ebitda) },
              { label: "Cotacao", className: "num", render: (row) => optionalMoney(row.price, { convert: false }) },
              { label: "Fonte", render: (row) => escapeHtml(row.source || "Manual") },
            ],
          })}
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-header"><h2>Adicionar ano fiscal manual</h2><span class="badge open">Sem API</span></div>
        <div class="panel-body">
          <form class="form-grid earnings-manual-form" id="earningsForm">
            <input type="hidden" name="ticker" value="${escapeHtml(ticker)}" />
            <label><span>Ano fiscal</span><input class="input" type="number" min="1990" max="2100" name="fiscalYear" required /></label>
            <label><span>EPS</span><input class="input" type="number" step="0.0001" name="eps" /></label>
            <label><span>Receita</span><input class="input" type="number" step="0.01" name="revenue" /></label>
            <label><span>Net income</span><input class="input" type="number" step="0.01" name="netIncome" /></label>
            <label><span>FCF/acao</span><input class="input" type="number" step="0.0001" name="freeCashFlowPerShare" /></label>
            <label><span>Operating CF</span><input class="input" type="number" step="0.01" name="operatingCashFlow" /></label>
            <label><span>Capex</span><input class="input" type="number" step="0.01" name="capex" /></label>
            <label><span>Free cash flow</span><input class="input" type="number" step="0.01" name="freeCashFlow" /></label>
            <label><span>EBITDA</span><input class="input" type="number" step="0.01" name="ebitda" /></label>
            <label><span>Assets</span><input class="input" type="number" step="0.01" name="assets" /></label>
            <label><span>Liabilities</span><input class="input" type="number" step="0.01" name="liabilities" /></label>
            <label><span>Equity</span><input class="input" type="number" step="0.01" name="equity" /></label>
            <label><span>Cotacao anual</span><input class="input" type="number" step="0.0001" name="price" /></label>
            <button class="primary-button" type="submit">Guardar ano fiscal</button>
          </form>
        </div>
      </section>
    </div>
  `;
}

function expectedFiscalYears(latestYear = null) {
  const latest = latestYear || new Date().getFullYear() - 1;
  return Array.from({ length: 8 }, (_, index) => latest - index);
}

function missingYearRows() {
  return getHoldings()
    .slice()
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
    .map((holding) => {
      const loadedYears = new Set(earningsRows(holding.ticker).map((row) => row.fiscalYear));
      const latestLoaded = Math.max(...loadedYears);
      const years = expectedFiscalYears(Number.isFinite(latestLoaded) ? latestLoaded : null);
      const missingYears = years.filter((year) => !loadedYears.has(year));
      return {
        ticker: holding.ticker,
        portfolio: portfolioName(holding.portfolioId),
        sector: holding.sector,
        loaded: years.length - missingYears.length,
        total: years.length,
        latestLoaded: Number.isFinite(latestLoaded) ? latestLoaded : null,
        missingYears,
      };
    });
}

function renderMissingYears() {
  const rows = missingYearRows();
  const complete = rows.filter((row) => row.missingYears.length === 0).length;
  const missingTotal = rows.reduce((total, row) => total + row.missingYears.length, 0);
  const meta = window.PORTFOLIO_EARNINGS_META || {};
  return `
    ${scopeBar()}
    <div class="kpi-grid">
      ${metricCard("Tickers ativos", String(rows.length), "Carteiras no filtro")}
      ${metricCard("Cobertura completa", String(complete), `${rows.length - complete} tickers incompletos`)}
      ${metricCard("Anos em falta", String(missingTotal), "Janela de 8 anos por ticker")}
      ${metricCard("Earnings import", meta.rows ? `${meta.rows} linhas` : "0 linhas", meta.provider || meta.error || "Sem erros registados", meta.error ? "negative" : "")}
    </div>
    <section class="panel">
      <div class="panel-header"><h2>Anos fiscais em falta</h2><span class="badge">8 anos mais recentes</span></div>
      <div class="panel-body">
        ${renderTable({
          rows,
          columns: [
            { label: "Ticker", render: (row) => `<button class="ticker-button" data-open-ticker="${row.ticker}">${escapeHtml(row.ticker)}</button>` },
            { label: "Portfolio", render: (row) => escapeHtml(row.portfolio) },
            { label: "Setor", render: (row) => escapeHtml(row.sector) },
            { label: "Carregados", className: "num", render: (row) => `${row.loaded}/${row.total}` },
            { label: "Ultimo ano", className: "num", render: (row) => row.latestLoaded || "n/a" },
            { label: "Em falta", render: (row) => row.missingYears.length ? row.missingYears.map((year) => `<span class="badge error">${year}</span>`).join(" ") : statusBadge("Completo", "open") },
          ],
        })}
      </div>
    </section>
  `;
}

function renderGrowth() {
  const rows = DATA.growth.rows;
  const series = [
    {
      name: "Plano",
      color: "var(--gold)",
      points: rows.map((row) => ({ label: row.period.slice(5, 7), value: state.currency === "EUR" ? row.plannedTotalAccum / fxRate() : row.plannedTotalAccum })),
    },
    {
      name: "Real",
      color: "var(--teal)",
      points: rows.map((row) => ({ label: row.period.slice(5, 7), value: state.currency === "EUR" ? row.realTotalAccum / fxRate() : row.realTotalAccum })),
    },
  ];
  const latest = rows.at(-1) || {};
  return `
    ${scopeBar()}
    <div class="kpi-grid">
      ${metricCard("Rent. historica", pct(DATA.growth.historicalReturnPct), "Base do Excel")}
      ${metricCard("Aporte mensal", money(DATA.growth.monthlyContribution), "Media do Excel")}
      ${metricCard("Inflacao media", pct(DATA.growth.averageInflation), "Portugal")}
      ${metricCard("Real acumulado", money(latest.realTotalAccum), pct(latest.realReturnPct), latest.realReturnPct >= 0 ? "positive" : "negative")}
    </div>
    <section class="panel">
      <div class="panel-header"><h2>Plano vs real</h2></div>
      <div class="panel-body">${lineChart(series, { label: "Plano vs real" })}</div>
    </section>
  `;
}

function render() {
  const [title, subtitle] = viewCopy[state.view];
  titleEl.textContent = translateUiText(title);
  subtitleEl.textContent = translateUiText(`${subtitle} - ${state.scope === "all" ? "Total portfolio" : portfolioName(state.scope)}`);
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  document.querySelectorAll("[data-currency]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.currency === state.currency);
  });
  sourceMetaEl.innerHTML = `
    <div><strong>File</strong><br>${escapeHtml(DATA.source.name)}</div>
    <div><strong>Saved</strong><br>${escapeHtml(dateTimeLabel(DATA.source.lastModified))}</div>
    <div><strong>Local state</strong><br>${store.portfolios.length} portfolios</div>
    <div><strong>Watchlist</strong><br>${toNumber(store.watchlist?.length)} companies</div>
    <div><strong>Forecasts</strong><br>${toNumber(store.imports?.dividendForecasts?.length)} manual</div>
  `;
  const html = {
    dashboard: renderDashboard,
    portfolios: renderPortfolios,
    holdings: renderHoldings,
    watchlist: renderWatchlist,
    investments: renderInvestments,
    dividends: renderDividends,
    earnings: renderEarnings,
    capital: renderCapital,
    valuation: renderValuation,
    missing: renderMissingYears,
  }[state.view]();
  appEl.innerHTML = translateUiText(html);
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

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function updateDividendNetPreview(form) {
  const preview = form.querySelector("[data-dividend-net-preview]");
  if (!preview) return;
  const gross = parseLooseNumber(form.elements.gross?.value);
  const withholding = parseLooseNumber(form.elements.withholding?.value);
  preview.value = Number.isFinite(gross) && Number.isFinite(withholding) ? (gross - withholding).toFixed(2) : "";
}

function roundMoneyValue(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function saveWatchlistValues(values) {
  const ticker = String(values.ticker || "").trim().toUpperCase();
  if (!ticker) {
    window.alert("Indica um ticker para guardar na watchlist.");
    return false;
  }
  store.watchlist = store.watchlist || [];
  const existing =
    (values.id ? store.watchlist.find((row) => row.id === values.id) : null) ||
    store.watchlist.find((row) => String(row.ticker || "").trim().toUpperCase() === ticker);
  const desiredPrice = parseLooseNumber(values.desiredPrice);
  const importedData = watchlistImportedData(ticker, existing || {});
  const existingBase = existing ? { ...existing } : {};
  delete existingBase.status;
  delete existingBase.currentPrice;
  delete existingBase.targetPrice;
  const payload = {
    ...existingBase,
    id: existing?.id || values.id || uid("watch"),
    ticker,
    name: importedData.name,
    sector: importedData.sector,
    priority: values.priority || existing?.priority || "medium",
    desiredPrice: Number.isFinite(desiredPrice) ? desiredPrice : "",
    reviewDate: values.reviewDate || "",
    thesis: values.thesis || "",
    notes: values.notes || "",
    importedData,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (Number.isFinite(toOptionalNumber(importedData.currentPrice))) store.prices[ticker] = importedData.currentPrice;
  if (existing) {
    store.watchlist = store.watchlist.map((row) => (row.id === existing.id ? payload : row));
  } else {
    store.watchlist = [...store.watchlist, payload];
  }
  state.editWatchlistId = "";
  state.watchlistSearch = "";
  return true;
}

function saveWatchlistFormFromDom(event, form) {
  if (event?.preventDefault) event.preventDefault();
  if (!form) return false;
  if (saveWatchlistValues(formData(form))) {
    state.view = "watchlist";
    saveStore();
    syncWatchlistTickersToAppProcess();
    render();
  }
  return false;
}

function saveDividendValues(values) {
  const isAdding = !values.id;
  const ticker = String(values.ticker || "").trim().toUpperCase();
  const portfolioId = values.portfolioId || store.portfolios[0]?.id || "";
  const year = Math.trunc(parseLooseNumber(values.year, state.dividendYear));
  const monthIndex = Math.max(1, Math.min(12, Math.trunc(parseLooseNumber(values.monthIndex, state.dividendMonth))));
  const gross = roundMoneyValue(parseLooseNumber(values.gross, 0));
  const withholding = roundMoneyValue(parseLooseNumber(values.withholding, 0));
  const sharesPaid = parseLooseNumber(values.sharesPaid);
  if (!ticker || !portfolioId || !Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    window.alert("Indica portfolio, ticker, ano e mes para guardar o dividendo.");
    return false;
  }
  const fallbackKey = `${portfolioId}:${ticker}:${year}:${monthIndex}`;
  const existing =
    (values.id ? store.dividends.find((row) => row.id === values.id) : null) ||
    store.dividends.find((row) => receivedKey(row) === fallbackKey);
  const payload = {
    id: existing?.id || values.id || uid("div"),
    portfolioId,
    ticker,
    year,
    monthIndex,
    month: monthNames[monthIndex - 1] || monthShort[monthIndex - 1],
    sharesPaid: Number.isFinite(sharesPaid) ? sharesPaid : "",
    gross,
    withholding,
    net: roundMoneyValue(gross - withholding),
    dividendPerShare: Number.isFinite(sharesPaid) && sharesPaid > 0 ? roundMoneyValue(gross / sharesPaid) : existing?.dividendPerShare || "",
    notes: values.notes || "",
    received: true,
    source: existing?.source || "Manual",
    updatedAt: new Date().toISOString(),
  };
  if (existing) {
    const index = store.dividends.findIndex((row) => row.id === existing.id);
    if (index >= 0) store.dividends.splice(index, 1, { ...existing, ...payload });
    else Object.assign(existing, payload);
  } else {
    store.dividends.push(payload);
  }
  state.editDividendId = "";
  state.addDividend = false;
  if (isAdding) state.dividendTab = "received";
  state.dividendYear = year;
  state.dividendMonth = monthIndex;
  return true;
}

function saveDividendFormFromDom(event, form) {
  if (event?.preventDefault) event.preventDefault();
  if (!form) return false;
  if (saveDividendValues(formData(form))) {
    saveStore();
    render();
  }
  return false;
}

window.__portfolioSaveDividendForm = saveDividendFormFromDom;
window.__portfolioSaveWatchlistForm = saveWatchlistFormFromDom;

function handleSubmit(event) {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const values = formData(form);

  if (form.id === "portfolioForm") {
    const portfolio = {
      id: uid("portfolio"),
      name: values.name.trim(),
      currency: values.currency || "USD",
      notes: values.notes || "",
      createdAt: new Date().toISOString(),
    };
    store.portfolios.push(portfolio);
    const initialEur = toOptionalNumber(values.initialDepositEur);
    const initialPortfolioAmount = toOptionalNumber(values.initialDepositUsd);
    const initialUsd = portfolio.currency === "EUR" ? (Number.isFinite(initialEur) ? initialEur : initialPortfolioAmount) : initialPortfolioAmount;
    if (Number.isFinite(initialUsd) && initialUsd > 0 || Number.isFinite(initialEur) && initialEur > 0) {
      store.deposits.push({
        id: uid("dep"),
        portfolioId: portfolio.id,
        date: new Date().toISOString().slice(0, 10),
        eur: Number.isFinite(initialEur) ? initialEur : 0,
        usd: Number.isFinite(initialUsd) ? initialUsd : 0,
        rate: null,
        source: "Manual",
      });
    }
    state.scope = portfolio.id;
  }

  if (form.id === "transactionForm") {
    const ticker = values.ticker.trim().toUpperCase();
    const price = toNumber(values.price);
    store.transactions.push({
      id: uid("tx"),
      portfolioId: values.portfolioId,
      date: values.date,
      side: values.side,
      ticker,
      instrumentType: values.instrumentType || getTickerMeta(ticker).type,
      quantity: toNumber(values.quantity),
      price,
      fees: toNumber(values.fees),
      notes: values.notes || "",
    });
    store.prices[ticker] = price;
  }

  if (form.id === "watchlistForm") {
    if (!saveWatchlistValues(values)) return;
    state.view = "watchlist";
  }

  if (form.id === "priceUpdateForm") {
    const result = importPriceRows(values);
    if (!result.imported) {
      window.alert("Nao encontrei precos validos. Usa colunas ticker e price.");
      return;
    }
    state.priceUpdateSlot = values.slot;
    state.view = "watchlist";
  }

  if (form.id === "capitalMovementForm") {
    const currency = portfolioCurrency(values.portfolioId);
    const eur = toOptionalNumber(values.eur);
    const usdInput = toOptionalNumber(values.usd);
    const unsignedUsd = currency === "EUR" ? (Number.isFinite(usdInput) ? usdInput : Number.isFinite(eur) ? eur : 0) : Number.isFinite(usdInput) ? usdInput : 0;
    if (currency !== "EUR" && (!Number.isFinite(eur) || !Number.isFinite(usdInput))) {
      window.alert("Para portfolios fora de EUR, indica o valor em EUR e o valor na moeda do portfolio.");
      return;
    }
    if (currency === "EUR" && !Number.isFinite(eur)) {
      window.alert("Indica o valor em EUR.");
      return;
    }
    const sign = values.type === "withdrawal" ? -1 : 1;
    store.deposits.push({
      id: uid("dep"),
      portfolioId: values.portfolioId,
      date: values.date,
      eur: Number.isFinite(eur) ? eur * sign : 0,
      usd: unsignedUsd * sign,
      rate: null,
      source: "Manual",
      notes: values.notes || "",
    });
    state.scope = values.portfolioId;
    state.capitalPortfolioId = values.portfolioId;
  }

  if (form.id === "dividendEditForm") {
    if (!saveDividendValues(values)) return;
  }

  if (form.id === "dividendForecastForm") {
    const existed = hasDividendForecastOverride(values.ticker);
    if (!upsertDividendForecastSchedule(values, "Manual")) {
      window.alert("Indica ticker, pelo menos um mes e o valor anual total por acao.");
      return;
    }
    store.imports.lastResult = {
      kind: "dividend-forecast",
      source: "Manual",
      imported: existed ? 0 : 1,
      updated: existed ? 1 : 0,
      skipped: 0,
      importedAt: new Date().toISOString(),
    };
    state.view = "dividends";
    state.dividendTab = "forecasts";
  }

  if (form.id === "importForm") {
    handleImportForm(values);
    state.view = "dividends";
  }

  if (form.id === "dividendAnnualForm") {
    if (!upsertDividendForecastAnnual(values, values.source || "Manual")) {
      window.alert("Indica ticker e valor anual por acao para guardar.");
      return;
    }
    state.view = "dividends";
  }

  if (form.id === "benchmarkForm") {
    const symbol = values.symbol.trim().toUpperCase();
    const existing = store.benchmarks.find((row) => row.symbol === symbol);
    const payload = {
      id: existing?.id || uid("bench"),
      symbol,
      name: values.name || symbol,
      startValue: toNumber(values.startValue),
      currentValue: toNumber(values.currentValue),
      notes: "",
    };
    if (existing) Object.assign(existing, payload);
    else store.benchmarks.push(payload);
  }

  if (form.id === "dcfForm") {
    if (!saveDcfConfigFromValues(values)) {
      window.alert("Escolhe um ticker para atualizar o DCF.");
      return;
    }
  }

  if (form.id === "dcfGrowthScheduleForm") {
    if (!saveDcfGrowthSchedule(values)) {
      window.alert("Escolhe um ticker para aplicar os crescimentos anuais.");
      return;
    }
  }

  if (form.id === "earningsForm") {
    const ticker = values.ticker.trim().toUpperCase();
    const fiscalYear = Math.trunc(toNumber(values.fiscalYear));
    upsertFundamentalRecord({
      ticker,
      fiscalYear,
      eps: values.eps,
      revenue: values.revenue,
      netIncome: values.netIncome,
      freeCashFlowPerShare: values.freeCashFlowPerShare,
      operatingCashFlow: values.operatingCashFlow,
      capex: values.capex,
      freeCashFlow: values.freeCashFlow,
      ebitda: values.ebitda,
      assets: values.assets,
      liabilities: values.liabilities,
      equity: values.equity,
      price: values.price,
    }, "Manual");
    state.selectedTicker = ticker;
  }

  const shouldSyncWatchlist = form.id === "watchlistForm";
  saveStore();
  if (shouldSyncWatchlist) syncWatchlistTickersToAppProcess();
  render();
}

document.addEventListener("submit", handleSubmit);

document.addEventListener("click", async (event) => {
  const exportBackupButton = event.target.closest("[data-export-backup]");
  if (exportBackupButton) {
    exportStoreBackup();
    return;
  }
  const importBackupButton = event.target.closest("[data-import-backup]");
  if (importBackupButton) {
    document.querySelector("#backupImportInput")?.click();
    return;
  }
  const saveDividendButton = event.target.closest("[data-save-dividend-form]");
  if (saveDividendButton) {
    const form = saveDividendButton.closest("form");
    if (form?.id === "dividendEditForm") {
      event.preventDefault();
      if (saveDividendValues(formData(form))) {
        saveStore();
        render();
      }
      return;
    }
  }
  const saveDcfValuationButton = event.target.closest("[data-save-dcf-valuation]");
  if (saveDcfValuationButton) {
    const form = saveDcfValuationButton.closest("form");
    if (form?.id === "dcfForm") {
      event.preventDefault();
      const valuation = saveDcfValuationFromValues(formData(form), state.dcfMode);
      if (!valuation) {
        window.alert("Preenche os pressupostos antes de guardar a avaliacao.");
        return;
      }
      saveStore();
      render();
      return;
    }
  }
  const dcfModeButton = event.target.closest("[data-dcf-mode]");
  if (dcfModeButton) {
    state.dcfMode = dcfModeButton.dataset.dcfMode === "reverse" ? "reverse" : "dcf";
    if (state.dcfMode === "reverse") state.showDcfGrowthEditor = false;
    render();
    return;
  }
  const openDcfGrowthEditorButton = event.target.closest("[data-open-dcf-growth-editor]");
  if (openDcfGrowthEditorButton) {
    state.showDcfGrowthEditor = true;
    render();
    return;
  }
  const closeDcfGrowthEditorButton = event.target.closest("[data-close-dcf-growth-editor]");
  if (closeDcfGrowthEditorButton) {
    state.showDcfGrowthEditor = false;
    render();
    return;
  }
  const newValuationButton = event.target.closest("[data-new-valuation]");
  if (newValuationButton) {
    state.editValuationId = "";
    render();
    return;
  }
  const valuationButton = event.target.closest("[data-edit-valuation], [data-open-valuation]");
  if (valuationButton) {
    const id = valuationButton.dataset.editValuation || valuationButton.dataset.openValuation;
    const row = (store.valuations || []).find((entry) => entry.id === id);
    if (row) {
      state.editValuationId = row.id;
      state.dcfTicker = row.ticker;
      state.dcfMode = row.mode === "reverse" ? "reverse" : "dcf";
      store.dcf[row.ticker] = { ...dcfDefaults(row.ticker), ...(row.config || {}) };
      state.view = "valuation";
      render();
    }
    return;
  }
  const openWatchlistDcfButton = event.target.closest("[data-open-watchlist-dcf]");
  if (openWatchlistDcfButton) {
    const ticker = String(openWatchlistDcfButton.dataset.openWatchlistDcf || "").trim().toUpperCase();
    if (ticker) {
      state.dcfTicker = ticker;
      state.selectedTicker = ticker;
      state.editValuationId = "";
      state.view = "valuation";
      render();
    }
    return;
  }
  const editWatchlistButton = event.target.closest("[data-edit-watchlist]");
  if (editWatchlistButton) {
    state.editWatchlistId = editWatchlistButton.dataset.editWatchlist;
    state.view = "watchlist";
    render();
    return;
  }
  const cancelWatchlistEditButton = event.target.closest("[data-cancel-watchlist-edit]");
  if (cancelWatchlistEditButton) {
    state.editWatchlistId = "";
    render();
    return;
  }
  const deleteWatchlistButton = event.target.closest("[data-delete-watchlist]");
  if (deleteWatchlistButton) {
    const id = deleteWatchlistButton.dataset.deleteWatchlist;
    const row = (store.watchlist || []).find((entry) => entry.id === id);
    const ok = window.confirm(`Remover ${row?.ticker || "este ticker"} da watchlist?`);
    if (ok) {
      store.watchlist = (store.watchlist || []).filter((entry) => entry.id !== id);
      if (state.editWatchlistId === id) state.editWatchlistId = "";
      saveStore();
      syncWatchlistTickersToAppProcess();
      render();
    }
    return;
  }
  const loadAutoPricesButton = event.target.closest("[data-load-auto-prices]");
  if (loadAutoPricesButton) {
    await reloadAutoPriceImports();
    return;
  }
  const runAutoPricesButton = event.target.closest("[data-run-auto-prices]");
  if (runAutoPricesButton) {
    await requestAutoPriceImportNow();
    return;
  }
  const syncWatchlistButton = event.target.closest("[data-sync-watchlist]");
  if (syncWatchlistButton) {
    await syncWatchlistTickersToAppProcess({ alert: true });
    await refreshAppProcessStatus({ renderAfter: true });
    return;
  }
  const investmentGroupButton = event.target.closest("[data-toggle-investment-group]");
  if (investmentGroupButton) {
    const key = investmentGroupButton.dataset.toggleInvestmentGroup;
    state.expandedInvestmentRows = {
      ...(state.expandedInvestmentRows || {}),
      [key]: !state.expandedInvestmentRows?.[key],
    };
    render();
    return;
  }
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
  const sortButton = event.target.closest("[data-sort]");
  if (sortButton) {
    const [sortKey, key] = sortButton.dataset.sort.split(":");
    const current = state.sort[sortKey];
    state.sort[sortKey] = current.key === key ? { key, dir: current.dir * -1 } : { key, dir: -1 };
    render();
    return;
  }
  const scopeButton = event.target.closest("[data-set-scope]");
  if (scopeButton) {
    state.scope = scopeButton.dataset.setScope;
    state.view = "dashboard";
    render();
    return;
  }
  const resetCapitalButton = event.target.closest("[data-reset-capital]");
  if (resetCapitalButton) {
    const portfolioId = resetCapitalButton.dataset.resetCapital;
    const ok = window.confirm(`Limpar todos os movimentos de capital de ${portfolioName(portfolioId)}? Isto so altera os dados locais da app.`);
    if (ok) {
      store.deposits = (store.deposits || []).filter((row) => row.portfolioId !== portfolioId);
      saveStore();
      render();
    }
    return;
  }
  const clearImportDividendsButton = event.target.closest("[data-clear-import-dividends]");
  if (clearImportDividendsButton) {
    const ok = window.confirm("Limpar os dividendos importados localmente, incluindo previsoes e valores anuais por acao? Os dividendos recebidos e o Excel original ficam intactos.");
    if (ok) {
      store.imports.dividendEvents = [];
      store.imports.dividendForecasts = [];
      store.imports.dividendAnnualPerShare = [];
      store.imports.lastResult = {
        kind: "clear",
        source: "Local",
        imported: 0,
        updated: 0,
        skipped: 0,
        importedAt: new Date().toISOString(),
      };
      saveStore();
      render();
    }
    return;
  }
  const deleteImportDividendButton = event.target.closest("[data-delete-import-dividend]");
  if (deleteImportDividendButton) {
    const id = deleteImportDividendButton.dataset.deleteImportDividend;
    store.imports.dividendEvents = (store.imports.dividendEvents || []).filter((row) => row.id !== id);
    saveStore();
    render();
    return;
  }
  const newForecastScheduleButton = event.target.closest("[data-new-forecast-schedule]");
  if (newForecastScheduleButton) {
    state.dividendForecastTicker = "";
    state.view = "dividends";
    state.dividendTab = "forecasts";
    render();
    return;
  }
  const editForecastScheduleButton = event.target.closest("[data-edit-forecast-schedule]");
  if (editForecastScheduleButton) {
    state.dividendForecastTicker = editForecastScheduleButton.dataset.editForecastSchedule;
    state.view = "dividends";
    state.dividendTab = "forecasts";
    render();
    return;
  }
  const clearForecastScheduleButton = event.target.closest("[data-clear-forecast-schedule]");
  if (clearForecastScheduleButton) {
    const ticker = clearForecastScheduleButton.dataset.clearForecastSchedule;
    if (removeDividendForecastOverride(ticker)) {
      if (state.dividendForecastTicker === ticker) state.dividendForecastTicker = "";
      store.imports.lastResult = {
        kind: "dividend-forecast-clear",
        source: "Manual",
        imported: 0,
        updated: 0,
        skipped: 0,
        importedAt: new Date().toISOString(),
      };
      saveStore();
      state.dividendTab = "forecasts";
      render();
    }
    return;
  }
  const saveForecastAnnualButton = event.target.closest("[data-save-forecast-annual]");
  if (saveForecastAnnualButton) {
    const ticker = saveForecastAnnualButton.dataset.saveForecastAnnual;
    const rowEl = saveForecastAnnualButton.closest("tr");
    const input = rowEl?.querySelector("[data-forecast-annual-input]");
    const existed = hasDividendForecastOverride(ticker);
    if (!upsertDividendForecastAnnual({ ticker, annualDividendPerShare: input?.value || "" }, "Manual")) {
      window.alert("Indica um valor anual por acao valido.");
      return;
    }
    store.imports.lastResult = {
      kind: "dividend-annual",
      source: "Manual",
      imported: existed ? 0 : 1,
      updated: existed ? 1 : 0,
      skipped: 0,
      importedAt: new Date().toISOString(),
    };
    saveStore();
    render();
    return;
  }
  const clearForecastAnnualButton = event.target.closest("[data-clear-forecast-annual]");
  if (clearForecastAnnualButton) {
    const ticker = clearForecastAnnualButton.dataset.clearForecastAnnual;
    if (removeDividendForecastOverride(ticker)) {
      store.imports.lastResult = {
        kind: "dividend-forecast-clear",
        source: "Manual",
        imported: 0,
        updated: 0,
        skipped: 0,
        importedAt: new Date().toISOString(),
      };
      saveStore();
      render();
    }
    return;
  }
  const tickerButton = event.target.closest("[data-open-ticker]");
  if (tickerButton) {
    state.selectedTicker = tickerButton.dataset.openTicker;
    state.view = "earnings";
    render();
    return;
  }
  const earningsRangeButton = event.target.closest("[data-earnings-range]");
  if (earningsRangeButton) {
    state.earningsRange = earningsRangeButton.dataset.earningsRange;
    render();
    return;
  }
  const dividendTabButton = event.target.closest("[data-dividend-tab]");
  if (dividendTabButton) {
    state.dividendTab = dividendTabButton.dataset.dividendTab;
    render();
    return;
  }
  const addDividendButton = event.target.closest("[data-add-dividend]");
  if (addDividendButton) {
    state.dividendTab = "received";
    state.editDividendId = "";
    state.addDividend = true;
    render();
    return;
  }
  const dividendSelectMonthButton = event.target.closest("[data-dividend-select-month]");
  if (dividendSelectMonthButton) {
    state.dividendMonth = Math.max(1, Math.min(12, Math.trunc(toNumber(dividendSelectMonthButton.dataset.dividendSelectMonth, state.dividendMonth))));
    render();
    return;
  }
  const dividendMonthButton = event.target.closest("[data-dividend-month]");
  if (dividendMonthButton) {
    if (dividendMonthButton.dataset.dividendMonth === "today") {
      const today = new Date(DATA.summary.asOfDate || Date.now());
      state.dividendYear = today.getFullYear();
      state.dividendMonth = today.getMonth() + 1;
    } else {
      const shifted = shiftYearMonth(state.dividendYear, state.dividendMonth, toNumber(dividendMonthButton.dataset.dividendMonth));
      state.dividendYear = shifted.year;
      state.dividendMonth = shifted.month;
    }
    render();
    return;
  }
  const receiveButton = event.target.closest("[data-receive-dividend]");
  if (receiveButton) {
    const eventRow = expectedDividendEvents().find((row) => row.id === receiveButton.dataset.receiveDividend);
    if (eventRow) {
      store.dividends.push({
        id: uid("div"),
        portfolioId: eventRow.portfolioId,
        ticker: eventRow.ticker,
        year: eventRow.year,
        monthIndex: eventRow.monthIndex,
        month: eventRow.month,
        sharesPaid: eventRow.sharesPaid || "",
        gross: eventRow.gross,
        withholding: eventRow.withholding,
        net: eventRow.net,
        dividendPerShare: eventRow.amountPerShare || "",
        received: true,
        source: eventRow.source || "Calendario",
      });
      saveStore();
      render();
    }
    return;
  }
  const editDividendButton = event.target.closest("[data-edit-dividend]");
  if (editDividendButton) {
    state.editDividendId = editDividendButton.dataset.editDividend;
    state.addDividend = false;
    render();
    return;
  }
  const cancelDividendEditButton = event.target.closest("[data-cancel-dividend-edit]");
  if (cancelDividendEditButton) {
    state.editDividendId = "";
    state.addDividend = false;
    render();
    return;
  }
  const unreceiveButton = event.target.closest("[data-unreceive-dividend]");
  if (unreceiveButton) {
    const id = unreceiveButton.dataset.unreceiveDividend;
    if (id) {
      store.dividends = store.dividends.filter((row) => row.id !== id);
      if (state.editDividendId === id) state.editDividendId = "";
      saveStore();
      render();
    }
    return;
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "backupImportInput") {
    await importStoreBackupFile(event.target.files?.[0]);
    event.target.value = "";
    return;
  }
  if (event.target.id === "scopeSelect") {
    state.scope = event.target.value;
    if (state.view === "capital" && state.scope !== "all") state.capitalPortfolioId = state.scope;
    render();
  }
  if (event.target.id === "tickerSelect") {
    state.selectedTicker = event.target.value;
    render();
  }
  if (event.target.id === "capitalPortfolioSelect") {
    state.capitalPortfolioId = event.target.value;
    state.scope = event.target.value;
    render();
  }
  if (event.target.id === "dcfTickerSelect") {
    state.dcfTicker = event.target.value;
    state.selectedTicker = event.target.value;
    state.editValuationId = "";
    state.showDcfGrowthEditor = false;
    render();
  }
  if (event.target.id === "dividendYear") {
    state.dividendYear = Math.trunc(toNumber(event.target.value, state.dividendYear));
    render();
  }
  if (event.target.id === "withholdingRate") {
    store.settings.withholdingRate = Math.max(0, Math.min(1, toNumber(event.target.value, 0.15)));
    saveStore();
    render();
  }
  if (event.target.id === "importKind") {
    state.importKind = event.target.value;
    render();
  }
  if (event.target.id === "priceUpdateSlot") {
    state.priceUpdateSlot = event.target.value;
  }
});

document.addEventListener("input", (event) => {
  const dividendEditForm = event.target.closest("#dividendEditForm");
  if (dividendEditForm && ["gross", "withholding"].includes(event.target.name)) {
    updateDividendNetPreview(dividendEditForm);
  }
  if (event.target.id === "holdingsSearch") {
    state.holdingsSearch = event.target.value;
    render();
    refocusInput("holdingsSearch");
  }
  if (event.target.id === "transactionSearch") {
    state.transactionSearch = event.target.value;
    render();
    refocusInput("transactionSearch");
  }
  if (event.target.id === "watchlistSearch") {
    state.watchlistSearch = event.target.value;
    render();
    refocusInput("watchlistSearch");
  }
});

render();
if (isDesktopAppMode()) {
  refreshAppProcessStatus({ renderAfter: true }).then(() => syncWatchlistTickersToAppProcess());
  setInterval(() => refreshAppProcessStatus({ renderAfter: state.view === "watchlist" }), 60000);
}
