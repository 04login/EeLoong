// Peer comparison — live PE/PS/PEG for a handful of same-sector tickers.
//
// Peer universe: Yahoo's search/quoteSummary does not expose a "similar
// companies" endpoint that works keylessly, so we keep a small hand-curated
// peer map in config.ts (sector → representative tickers). This matches the
// tool's design (no stored universe, on-demand), stays honest (no invented
// peers), and is cheap: one quoteSummary per peer, computed live.
//
// All fetches run through Promise.allSettled — one bad peer must not sink the
// panel. Peers with no usable quote are dropped, and the panel reports which
// peers were actually compared.

import { fetchQuote } from "../sources/yahoo.ts";
import { computeFundamentals, type Fundamentals } from "./fundamentals.ts";
import type { TickerQuote } from "../types.ts";

export type PeerRow = {
  ticker: string;
  shortName: string;
  pe: number | null;
  ps: number | null;
  peg: number | null;
};

export type PeerComparison = {
  ticker: string;
  peers: PeerRow[];
  averages: { pe: number | null; ps: number | null; peg: number | null };
  unavailableNote: string | null;
};

// Drop peers whose quote failed or whose numbers are nonsense (PE ≤ 0, PEG
// outliers like 999).
const sane = (v: number | null | undefined): v is number =>
  typeof v === "number" && isFinite(v) && v > 0 && v < 500;

export async function getPeerComparison(
  ticker: string,
  peers: string[],
): Promise<PeerComparison | null> {
  const t = ticker.trim().toUpperCase();
  const list = peers.filter((p) => p.toUpperCase() !== t);
  if (list.length === 0) return null;

  const settled = await Promise.allSettled(list.map((p) => fetchQuote(p)));

  const rows: PeerRow[] = [];
  for (let i = 0; i < list.length; i++) {
    const s = settled[i];
    if (s.status !== "fulfilled" || !s.value) continue;
    const q: TickerQuote = s.value;
    if (q.price === null || q.price <= 0) continue;

    // Reuse Phase 1 fundamentals (Yahoo-reported ratios preferred).
    const f: Fundamentals = computeFundamentals(q);
    rows.push({
      ticker: q.symbol,
      shortName: q.shortName,
      pe: sane(f.pe) ? f.pe : null,
      ps: sane(f.ps) ? f.ps : null,
      peg: sane(f.peg) ? f.peg : null,
    });
  }

  if (rows.length === 0) {
    return {
      ticker: t,
      peers: [],
      averages: { pe: null, ps: null, peg: null },
      unavailableNote: "Peer data unavailable right now (Yahoo fetch failed for all peers).",
    };
  }

  const avg = (vals: (number | null)[]): number | null => {
    const good = vals.filter((v): v is number => sane(v));
    if (good.length === 0) return null;
    return good.reduce((a, b) => a + b, 0) / good.length;
  };

  return {
    ticker: t,
    peers: rows,
    averages: {
      pe: avg(rows.map((r) => r.pe)),
      ps: avg(rows.map((r) => r.ps)),
      peg: avg(rows.map((r) => r.peg)),
    },
    unavailableNote: null,
  };
}
