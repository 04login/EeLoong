// Yahoo Finance — unofficial endpoints, keyless, best-effort.
//
// quoteSummary (EPS, revenue, market cap, PEG…) is crumb-gated: you must first
// fetch a cookie from fc.yahoo.com, read a crumb with that cookie, then send
// `&crumb=...` on the quoteSummary request. This mirrors what yfinance does.
// The v1 search and v8 chart endpoints work without a crumb.

import { YAHOO_USER_AGENT, HTTP_TIMEOUT_MS } from "../config.ts";
import type { SearchHit, TickerQuote } from "../types.ts";

// Astro/Vite rewrites nodejs-only fetch opts via its `fetch` polyfill, so the
// "signal" hook must be written defensively (plain fetch keeps working in the
// browser anyway). One tiny wrapper, used everywhere below.
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const fetchFn: typeof fetch = (globalThis as any).fetch;
    const hasSignal = "signal" in (fetchFn as any) || typeof (fetchFn as any) === "function";
    const response = await fetchFn(url, {
      ...init,
      ...(hasSignal ? { signal: ctrl.signal } : {}),
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

const parseNum = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null) {
    const { raw } = v as { raw?: unknown };
    if (typeof raw === "number") return raw;
  }
  return null;
};

const parseStr = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  return null;
};

// Chart meta reports changePercent in percent units (-1.11 means -1.11%);
// quoteSummary reports a fraction (-0.0111). Whichever source wins must come
// out as a fraction — the UI multiplies by 100 to format.
function changePercentAsFraction(
  fromChart: number | null,
  fromSummary: number | null,
): number | null {
  if (fromChart !== null) return fromChart / 100;
  return fromSummary;
}

function detectMarket(symbol: string): TickerQuote["market"] {
  const upper = symbol.toUpperCase();
  if (upper.endsWith(".SI")) return "SGP";
  // Anything else — US, HK, LSE, crypto, index x… — runs the same fetch;
  // the market label is cosmetic for now.
  return "US";
}

// Minimal "is this a tradeable-ish equity" filter for the search box.
function isEquityHit(hit: unknown): hit is SearchHit {
  const h = hit as Record<string, unknown> | null;
  if (!h) return false;
  const type = parseStr(h.quoteType);
  if (type && type !== "EQUITY") return false;
  const symbol = parseStr(h.symbol);
  if (!symbol) return false;
  return true;
}

// ------- Search -------

export async function searchTickers(q: string): Promise<SearchHit[]> {
  const clean = q.trim().toLowerCase();
  if (clean.length === 0) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=8&newsCount=0`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": YAHOO_USER_AGENT } });
  if (!res.ok) throw new Error(`Yahoo search failed with ${res.status}`);

  const json = (await res.json()) as { quotes?: unknown };
  const hits = (json.quotes ?? []).filter(isEquityHit);
  // The `quotes` array can include near-duplicate listings for the same company
  // (e.g. AAPL + AAPL19.BK). Prefer the plain ticker, exchange closest to home.
  const plain = hits.filter((h) => /^[A-Z.]+$/.test(h.symbol));
  const ordered = [...plain, ...hits.filter((h) => !plain.includes(h))];
  const seen = new Set<string>();
  return ordered.filter((h) => {
    if (seen.has(h.symbol)) return false;
    seen.add(h.symbol);
    return true;
  });
}

// ------- Crumb plumbing (for quoteSummary) -------

type CrumbSession = { cookie: string; crumb: string };

async function getCrumb(): Promise<CrumbSession> {
  // Step 1 — grab the A3 cookie.
  const cookieRes = await fetchWithTimeout("https://fc.yahoo.com/", {
    headers: { "User-Agent": YAHOO_USER_AGENT },
  });
  // fc.yahoo.com answers 404 but still sets the cookie — that's expected.
  const setCookie = cookieRes.headers.get("set-cookie");
  const cookie =
    parseStr(setCookie) ?? (cookieRes.headers.getSetCookie ? cookieRes.headers.getSetCookie()[0] ?? null : setCookie);
  const cookieValue = cookie?.split(";")[0] ?? "";
  if (!cookieValue) throw new Error("Yahoo denied cookie");

  // Step 2 — trade the cookie for a crumb.
  const crumbRes = await fetchWithTimeout("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": YAHOO_USER_AGENT, Cookie: cookieValue },
  });
  if (!crumbRes.ok) throw new Error(`Yahoo crumb request failed with ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb) throw new Error("Yahoo returned empty crumb");
  return { cookie: cookieValue, crumb };
}

// ------- quoteSummary -------

async function quoteSummary(symbol: string, modules: string[]): Promise<Record<string, unknown> | null> {
  const { cookie, crumb } = await getCrumb();
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=${modules.join(",")}&crumb=${encodeURIComponent(crumb)}`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": YAHOO_USER_AGENT, Cookie: cookie },
  });
  if (res.status === 401) {
    // Crumb expired mid-run — retry once with a fresh one.
    const retry = await getCrumb();
    const retryRes = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=${modules.join(",")}&crumb=${encodeURIComponent(retry.crumb)}`,
      { headers: { "User-Agent": YAHOO_USER_AGENT, Cookie: retry.cookie } },
    );
    if (!retryRes.ok) throw new Error(`Yahoo quoteSummary failed with ${retryRes.status}`);
    const j2 = (await retryRes.json()) as { quoteSummary?: { result?: unknown[] | null } };
    return j2.quoteSummary?.result?.[0] ?? null;
  }
  if (!res.ok) throw new Error(`Yahoo quoteSummary failed with ${res.status}`);
  const json = (await res.json()) as { quoteSummary?: { result?: unknown[] | null } };
  return json.quoteSummary?.result?.[0] ?? null;
}

// ------- Public data fetch (chart + quoteSummary merged) -------

export async function fetchQuote(symbol: string): Promise<TickerQuote | null> {
  const meta: Record<string, unknown> = {};
  let chartErr: unknown = null;

  // 1) Chart hit — cheap, no crumb, gives price / change / range / volume.
  const chartUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1d&interval=1d&includePrePost=false`;
  try {
    const cRes = await fetchWithTimeout(chartUrl, { headers: { "User-Agent": YAHOO_USER_AGENT } });
    if (cRes.ok) {
      const cJson = (await cRes.json()) as { chart?: { result?: { meta?: Record<string, unknown> }[] } };
      Object.assign(meta, cJson.chart?.result?.[0]?.meta ?? {});
    }
  } catch (e) {
    chartErr = e;
  }

  // 2) quoteSummary for the fundamentals — needs the crumb dance.
  let sm: Record<string, unknown> = {};
  try {
    sm =
      (await quoteSummary(symbol, ["price", "summaryDetail", "defaultKeyStatistics", "financialData"])) ?? {};
  } catch (e) {
    // If the summary failed, keep the chart data — price, change, range still
    // render; fundamentals just come up null.
  }

  const grab = (obj: Record<string, unknown>, key: string): Record<string, unknown> =>
    (obj[key] as Record<string, unknown> | undefined) ?? {};

  const price = grab(sm, "price");
  const summary = grab(sm, "summaryDetail");
  const stats = grab(sm, "defaultKeyStatistics");
  const fin = grab(sm, "financialData");

  const hadSummary = Object.keys(sm).length > 0;

  const currency = parseStr(meta.currency) ?? parseStr(price.currency) ?? null;

  return {
    symbol: parseStr(meta.symbol) ?? symbol.toUpperCase(),
    shortName: parseStr(meta.shortName) ?? parseStr(price.shortName) ?? parseStr(price.longName) ?? symbol.toUpperCase(),
    longName: parseStr(meta.longName) ?? parseStr(price.longName) ?? null,
    exchange: parseStr(meta.exchangeName) ?? parseStr(price.exchangeName) ?? null,
    market: detectMarket(symbol),
    currency,

    price: parseNum(meta.regularMarketPrice) ?? parseNum(price.regularMarketPrice),
    previousClose: parseNum(meta.chartPreviousClose),
    change: parseNum(meta.regularMarketChange) ?? parseNum(price.regularMarketChange),
    changePercent:
      changePercentAsFraction(
        parseNum(meta.regularMarketChangePercent),
        parseNum(price.regularMarketChangePercent),
      ),
    dayLow: parseNum(meta.regularMarketDayLow) ?? parseNum(summary.regularMarketDayLow) ?? parseNum(summary.dayLow),
    dayHigh: parseNum(meta.regularMarketDayHigh) ?? parseNum(summary.regularMarketDayHigh) ?? parseNum(summary.dayHigh),
    fiftyTwoWeekLow: parseNum(meta.fiftyTwoWeekLow) ?? parseNum(summary.fiftyTwoWeekLow),
    fiftyTwoWeekHigh: parseNum(meta.fiftyTwoWeekHigh) ?? parseNum(summary.fiftyTwoWeekHigh),
    volume: parseNum(meta.regularMarketVolume) ?? parseNum(summary.regularMarketVolume) ?? parseNum(summary.volume),

    marketCap: parseNum(summary.marketCap) ?? parseNum(stats.marketCap),
    trailingPE: parseNum(summary.trailingPE) ?? parseNum(stats.trailingPE),
    forwardPE: parseNum(summary.forwardPE) ?? parseNum(stats.forwardPE),
    priceToSalesTrailing12Months: parseNum(summary.priceToSalesTrailing12Months),
    priceToBook: parseNum(stats.bookValue) && parseNum(price.regularMarketPrice)
      ? (parseNum(price.regularMarketPrice)! / parseNum(stats.bookValue)!)
      : null,
    pegRatio: parseNum(summary.pegRatio) ?? parseNum(stats.pegRatio),
    epsTrailingTwelveMonths: parseNum(fin.epsTrailingTwelveMonths) ?? parseNum(stats.trailingEps),
    epsForward: parseNum(fin.epsForward) ?? parseNum(stats.forwardEps),
    revenueTrailingTwelveMonths: parseNum(fin.totalRevenue) ?? null,
    grossProfitTrailingTwelveMonths: parseNum(fin.grossProfits) ?? null,
    earningsGrowth: parseNum(fin.earningsGrowth),
  };
}