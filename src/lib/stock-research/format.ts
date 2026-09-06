// Stock research UI — shared formatting helpers.
//
// Used by the result page and the SegmentPanel/AuditPanel components so both
// render identical numbers (the async panel partial must match the page).

export const formatNumber = (n: number | null, decimals = 2): string => {
  if (n === null || !isFinite(n)) return "—";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(decimals)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(decimals)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(decimals)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(decimals)}K`;
  return n.toFixed(decimals);
};

export const formatPercent = (n: number | null): string => {
  if (n === null || !isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
};

export const ratioClass = (v: number | null): string => {
  if (v === null) return "text-[color:var(--paper-muted)]";
  if (v < 10) return "text-green-400";
  if (v < 20) return "text-yellow-300";
  return "text-red-400";
};

export const cur = (c: string | null): string => (c === "USD" ? "$" : c === "SGD" ? "S$" : "");
