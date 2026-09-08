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

// Ratio-specific color coding — thresholds based on common valuation rules of thumb.
// Returns an object with text color, background badge color, and a human label.
export type RatioSignal = {
  textClass: string;
  badgeClass: string;
  label: string; // "Low" | "Reasonable" | "High"
};

export const peSignal = (v: number | null): RatioSignal => {
  if (v === null) return { textClass: "text-[color:var(--paper-muted)]", badgeClass: "bg-[color:var(--ink-700)] text-[color:var(--paper-dim)]", label: "N/A" };
  if (v < 12) return { textClass: "text-green-400", badgeClass: "bg-green-400/20 text-green-400", label: "Low" };
  if (v < 25) return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Reasonable" };
  return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "High" };
};

export const psSignal = (v: number | null): RatioSignal => {
  if (v === null) return { textClass: "text-[color:var(--paper-muted)]", badgeClass: "bg-[color:var(--ink-700)] text-[color:var(--paper-dim)]", label: "N/A" };
  if (v < 2) return { textClass: "text-green-400", badgeClass: "bg-green-400/20 text-green-400", label: "Low" };
  if (v < 5) return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Reasonable" };
  return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "High" };
};

export const pbSignal = (v: number | null): RatioSignal => {
  if (v === null) return { textClass: "text-[color:var(--paper-muted)]", badgeClass: "bg-[color:var(--ink-700)] text-[color:var(--paper-dim)]", label: "N/A" };
  if (v < 1) return { textClass: "text-green-400", badgeClass: "bg-green-400/20 text-green-400", label: "Low (<1)" };
  if (v < 3) return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Reasonable" };
  return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "High" };
};

export const pegSignal = (v: number | null): RatioSignal => {
  if (v === null) return { textClass: "text-[color:var(--paper-muted)]", badgeClass: "bg-[color:var(--ink-700)] text-[color:var(--paper-dim)]", label: "N/A" };
  if (v < 1) return { textClass: "text-green-400", badgeClass: "bg-green-400/20 text-green-400", label: "Attractive (<1)" };
  if (v < 1.5) return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Fair" };
  return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "Expensive" };
};

// Legacy generic function (kept for any existing callers)
export const ratioClass = (v: number | null): string => {
  if (v === null) return "text-[color:var(--paper-muted)]";
  if (v < 10) return "text-green-400";
  if (v < 20) return "text-yellow-300";
  return "text-red-400";
};

export const cur = (c: string | null): string => (c === "USD" ? "$" : c === "SGD" ? "S$" : "");
