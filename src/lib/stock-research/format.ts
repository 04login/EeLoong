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
// Returns an object with text color, background badge color, a human label,
// and a 0–100 position for a gradient bar indicator.
export type RatioSignal = {
  textClass: string;
  badgeClass: string;
  label: string; // "Low" | "Reasonable" | "High" | "Attractive" | "Fair" | "Expensive" | "Loss" | "N/A"
  barPosition: number; // 0–100, where on the gradient bar the value sits
  barColor: "green" | "yellow" | "red" | "gray"; // which color segment of the gradient
  inverted?: boolean; // when true, higher values are green/good and lower are red/bad (e.g. EPS)
};

export const epsSignal = (v: number | null): RatioSignal => {
  if (v === null) return { textClass: "text-[color:var(--paper-muted)]", badgeClass: "bg-[color:var(--ink-700)] text-[color:var(--paper-dim)]", label: "N/A", barPosition: 50, barColor: "gray", inverted: true };
  if (v < 0) {
    // Loss: 0 to 25% of the bar (red zone at bottom)
    const barPosition = Math.max(5, Math.round(25 - Math.min(20, Math.abs(v))));
    return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "Loss", barPosition, barColor: "red", inverted: true };
  }
  if (v === 0) {
    return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Flat", barPosition: 30, barColor: "yellow", inverted: true };
  }
  if (v < 2) {
    // Low positive: 30 to 60%
    const barPosition = Math.round(30 + (v / 2) * 30);
    return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Low", barPosition, barColor: "yellow", inverted: true };
  }
  // Healthy / strong profit: 60 to 100%
  const barPosition = Math.min(100, Math.round(60 + Math.min(40, ((v - 2) / 8) * 40)));
  return { textClass: "text-green-400", badgeClass: "bg-green-400/20 text-green-400", label: "Profitable", barPosition, barColor: "green", inverted: true };
};

export const peSignal = (v: number | null): RatioSignal => {
  if (v === null) return { textClass: "text-[color:var(--paper-muted)]", badgeClass: "bg-[color:var(--ink-700)] text-[color:var(--paper-dim)]", label: "N/A", barPosition: 50, barColor: "gray" };
  if (v < 0) return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "Loss", barPosition: 0, barColor: "red" };
  if (v < 12) return { textClass: "text-green-400", badgeClass: "bg-green-400/20 text-green-400", label: "Low", barPosition: Math.min(100, Math.max(0, (v / 12) * 33)), barColor: "green" };
  if (v < 25) return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Reasonable", barPosition: 33 + Math.min(67, ((v - 12) / 13) * 34), barColor: "yellow" };
  // cap at ~60 for visual purposes
  return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "High", barPosition: Math.min(100, 67 + Math.min(33, ((v - 25) / 35) * 33)), barColor: "red" };
};

export const psSignal = (v: number | null): RatioSignal => {
  if (v === null) return { textClass: "text-[color:var(--paper-muted)]", badgeClass: "bg-[color:var(--ink-700)] text-[color:var(--paper-dim)]", label: "N/A", barPosition: 50, barColor: "gray" };
  if (v < 0) return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "N/A", barPosition: 0, barColor: "gray" };
  if (v < 2) return { textClass: "text-green-400", badgeClass: "bg-green-400/20 text-green-400", label: "Low", barPosition: Math.min(100, Math.max(0, (v / 2) * 33)), barColor: "green" };
  if (v < 5) return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Reasonable", barPosition: 33 + Math.min(67, ((v - 2) / 3) * 34), barColor: "yellow" };
  return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "High", barPosition: Math.min(100, 67 + Math.min(33, ((v - 5) / 15) * 33)), barColor: "red" };
};

export const pbSignal = (v: number | null): RatioSignal => {
  if (v === null) return { textClass: "text-[color:var(--paper-muted)]", badgeClass: "bg-[color:var(--ink-700)] text-[color:var(--paper-dim)]", label: "N/A", barPosition: 50, barColor: "gray" };
  if (v < 0) return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "Neg Equity", barPosition: 0, barColor: "red" };
  if (v < 1) return { textClass: "text-green-400", badgeClass: "bg-green-400/20 text-green-400", label: "Low (<1)", barPosition: Math.min(100, Math.max(0, v * 33)), barColor: "green" };
  if (v < 3) return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Reasonable", barPosition: 33 + Math.min(67, ((v - 1) / 2) * 34), barColor: "yellow" };
  return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "High", barPosition: Math.min(100, 67 + Math.min(33, ((v - 3) / 10) * 33)), barColor: "red" };
};

export const pegSignal = (v: number | null): RatioSignal => {
  if (v === null) return { textClass: "text-[color:var(--paper-muted)]", badgeClass: "bg-[color:var(--ink-700)] text-[color:var(--paper-dim)]", label: "N/A", barPosition: 50, barColor: "gray" };
  if (v < 0) return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "Negative", barPosition: 0, barColor: "red" };
  if (v < 1) return { textClass: "text-green-400", badgeClass: "bg-green-400/20 text-green-400", label: "Attractive (<1)", barPosition: Math.min(100, Math.max(0, v * 50)), barColor: "green" };
  if (v < 1.5) return { textClass: "text-yellow-300", badgeClass: "bg-yellow-300/20 text-yellow-300", label: "Fair", barPosition: 50 + Math.min(50, ((v - 1) / 0.5) * 50), barColor: "yellow" };
  return { textClass: "text-red-400", badgeClass: "bg-red-400/20 text-red-400", label: "Expensive", barPosition: Math.min(100, 75 + Math.min(25, ((v - 1.5) / 3.5) * 25)), barColor: "red" };
};

// Legacy generic function (kept for any existing callers)
export const ratioClass = (v: number | null): string => {
  if (v === null) return "text-[color:var(--paper-muted)]";
  if (v < 0) return "text-red-400";
  if (v < 10) return "text-green-400";
  if (v < 20) return "text-yellow-300";
  return "text-red-400";
};

export const cur = (c: string | null): string => (c === "USD" ? "$" : c === "SGD" ? "S$" : "");

// Per-share / absolute price formatting — NO K/M/B compaction (a per-share
// value of 452,380.95 must not render as "452.38K"). Used by the Valuation Lab.
export const formatPrice = (n: number | null, decimals = 2): string => {
  if (n === null || !isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};
