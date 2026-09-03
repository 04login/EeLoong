// Stock research — configuration and shared constants.
import type { SearchHit } from "./types.ts";

// SEC EDGAR requires a descriptive User-Agent with real contact info on every
// request (used by edgar.ts in a later phase). Keeping it central so it's easy
// to find/replace before the first remote deploy.
export const SEC_USER_AGENT = "EeLoong Portfolio eeloonglow@gmail.com";

export const YAHOO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// Yahoo's unofficial endpoints are crumb-gated for quoteSummary. Timeouts keep
// a slow provider from hanging the whole page; callee handles them by marking
// the section unavailable.
export const HTTP_TIMEOUT_MS = 8000;

export const CACHE_TTL = {
  tickerCikMap: 60 * 60 * 24 * 14, // 2 weeks (SEC mapping file)
  quote: 60 * 5, // 5 min
  segments: 60 * 60 * 24 * 90, // ~months
  audit: 60 * 60 * 24 * 90, // ~months
} as const;

// Screener-constant price-to-book thresholds used for a blunt
// cheap/expensive read on the fundamentals card.
export const PB_LOW_THRESHOLD = 1;
export const PB_HIGH_THRESHOLD = 3;

// Hand-curated peer sets for the peer-comparison / fair-value phases. Yahoo's
// keyless endpoints expose no "similar companies" list, so we map the handful
// of well-known tickers into representative same-sector groups. Tickers not in
// a group get no peer panel (honest "not available" rather than invented
// peers). Keys are the PRIMARY ticker; the array is its comparison set.
export const PEER_GROUPS: Record<string, string[]> = {
  AAPL: ["MSFT", "GOOGL", "META", "HPQ"],
  MSFT: ["AAPL", "GOOGL", "ORCL", "CRM"],
  GOOGL: ["MSFT", "META", "AAPL"],
  META: ["GOOGL", "SNAP", "PINS"],
  AMZN: ["WMT", "BABA", "EBAY"],
  NVDA: ["AMD", "INTC", "AVGO", "QCOM"],
  AMD: ["NVDA", "INTC", "QCOM"],
  INTC: ["AMD", "NVDA", "QCOM"],
  AVGO: ["NVDA", "QCOM", "TXN"],
  QCOM: ["AVGO", "INTC", "TXN"],
  TSLA: ["GM", "F", "RIVN"],
  JPM: ["BAC", "WFC", "C"],
  BAC: ["JPM", "WFC", "C"],
  WFC: ["JPM", "BAC", "C"],
  V: ["MA", "PYPL"],
  MA: ["V", "PYPL"],
  JNJ: ["PFE", "MRK", "ABBV"],
  PFE: ["JNJ", "MRK", "ABBV"],
  MRK: ["JNJ", "PFE", "ABBV"],
  XOM: ["CVX", "COP", "SHEL"],
  CVX: ["XOM", "COP", "SHEL"],
  KO: ["PEP", "MNST"],
  PEP: ["KO", "MNST"],
  WMT: ["COST", "TGT", "AMZN"],
  COST: ["WMT", "TGT"],
  HD: ["LOW", "TGT"],
  MCD: ["SBUX", "CMG", "YUM"],
  NFLX: ["DIS", "WBD"],
  DIS: ["NFLX", "WBD", "PARA"],
  CRM: ["ORCL", "SAP", "NOW"],
  ORCL: ["CRM", "SAP", "NOW"],
  SAP: ["CRM", "ORCL"],
  "0700.HK": ["TCEHY", "BABA"],
  "D05.SI": ["O39.SI", "U11.SI"],
  "O39.SI": ["D05.SI", "U11.SI"],
  "U11.SI": ["D05.SI", "O39.SI"],
};

// A small static fallback used when Yahoo search is down (Phase 1 has no KV/LLM
// dependencies, but search results still shouldn't hard-fail the landing page).
export const FALLBACK_SEARCH_RESULTS: SearchHit[] = [
  { symbol: "AAPL", shortName: "Apple Inc.", longName: "Apple Inc.", exchange: "NAS", quoteType: "EQUITY", sector: "Technology" },
  { symbol: "MSFT", shortName: "Microsoft", longName: "Microsoft Corporation", exchange: "NAS", quoteType: "EQUITY", sector: "Technology" },
  { symbol: "AMZN", shortName: "Amazon.com", longName: "Amazon.com, Inc.", exchange: "NAS", quoteType: "EQUITY", sector: "Consumer Cyclical" },
  { symbol: "NVDA", shortName: "NVIDIA", longName: "NVIDIA Corporation", exchange: "NAS", quoteType: "EQUITY", sector: "Technology" },
  { symbol: "TSLA", shortName: "Tesla", longName: "Tesla, Inc.", exchange: "NAS", quoteType: "EQUITY", sector: "Consumer Cyclical" },
  { symbol: "D05.SI", shortName: "DBS Group", longName: "DBS Group Holdings Ltd", exchange: "SES", quoteType: "EQUITY", sector: "Financial Services" },
];