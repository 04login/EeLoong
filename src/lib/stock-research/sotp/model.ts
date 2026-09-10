// Sum-of-the-parts (SOTP) — model types, form parsing, sanitizing, totals.
// Pure module: no I/O, no Cloudflare imports — safe in Node tests and pages alike.

import { formatNumber } from "../format.ts";
import type { SegmentResult } from "../pipeline/segments.ts";

export type SotpPart = {
  label: string; // "Starlink" / "iPhone"
  valuation: number; // the user's estimate, currency units. Negative allowed (e.g. net debt).
  note: string; // reasoning, e.g. "8× 2026E revenue of $12B"
  mode?: "manual" | "multiple"; // absent = manual (backward compatible)
  revenueRef?: number | null; // e.g. segment revenue backing a multiple
  multiple?: number; // e.g. 8 → valuation = revenueRef × 8
};

// Server-authoritative valuation for `multiple` parts: valuation = revenueRef ×
// multiple. Manual parts (and rows with a missing/zero multiple or no usable
// revenueRef) are returned untouched.
export const recomputeMultiples = (parts: SotpPart[]): SotpPart[] =>
  parts.map((p) =>
    p.mode === "multiple" &&
    (p.multiple ?? 0) > 0 &&
    typeof p.revenueRef === "number" && Number.isFinite(p.revenueRef) && p.revenueRef !== 0
      ? { ...p, valuation: p.revenueRef * p.multiple! }
      : p,
  );

export type SotpModel = {
  slug: string;
  companyName: string;
  currency: string; // display currency, e.g. "USD" (drives the $/S$ symbol)
  sharesOutstanding: number | null; // null until provided
  parts: SotpPart[];
  importedFrom: { ticker: string; period: string } | null; // provenance when seeded from SEC segments
  updatedAt: string; // ISO date — always set server-side, never trusted from the client
};

export const MAX_PARTS = 50;
const MAX_LABEL = 120;
const MAX_NOTE = 500;
const MAX_COMPANY = 120;

// Tolerant numeric input: strip commas / $ / whitespace, then require a plain
// number. Anything else (e.g. "1.2B") is rejected, NOT guessed — the editor
// shows 0 and the user fixes it.
export const parseNumberInput = (raw: string | null): number | null => {
  if (raw === null) return null;
  const cleaned = raw.replace(/[\s,$]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// The editor form submits every row (label, valuation, note) in DOM order via
// repeated field names; FormData preserves order per name, so rows are zipped
// by index. Rows without a label are dropped; a labeled row with an unparseable
// valuation is KEPT at 0 — silently deleting the user's label would be worse.
export const parseModelForm = (fd: FormData): Omit<SotpModel, "updatedAt"> => {
  const one = (name: string): string => {
    const v = fd.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const labels = fd.getAll("partLabel").map(String);
  const vals = fd.getAll("partValuation").map(String);
  const notes = fd.getAll("partNote").map(String);
  const modes = fd.getAll("partMode").map(String);
  const multiples = fd.getAll("partMultiple").map(String);
  const refs = fd.getAll("partRevenueRef").map(String);
  const rows = Math.max(labels.length, vals.length, notes.length, modes.length, multiples.length, refs.length);
  const parts: SotpPart[] = [];
  for (let i = 0; i < rows && parts.length < MAX_PARTS; i++) {
    const label = (labels[i] ?? "").trim().slice(0, MAX_LABEL);
    if (label === "") continue;
    const part: SotpPart = {
      label,
      valuation: parseNumberInput(vals[i] ?? null) ?? 0,
      note: (notes[i] ?? "").trim().slice(0, MAX_NOTE),
    };
    // Attach the multiple mode ONLY when explicitly selected — a v1 form (no
    // partMode fields at all) must keep rows exactly `{label, valuation, note}`.
    if ((modes[i] ?? "").trim() === "multiple") {
      part.mode = "multiple";
      part.revenueRef = parseNumberInput(refs[i] ?? null); // null when unparseable
      const multiple = parseNumberInput(multiples[i] ?? null);
      if (multiple !== null) part.multiple = multiple;
    }
    parts.push(part);
  }
  const importTicker = one("importTicker");
  const importPeriod = one("importPeriod");
  const shares = parseNumberInput(one("sharesOutstanding"));
  return {
    slug: one("slug"),
    companyName: one("companyName"),
    currency: (one("currency") || "USD").toUpperCase().slice(0, 8),
    sharesOutstanding: shares !== null && shares > 0 ? shares : null,
    parts,
    importedFrom: importTicker && importPeriod
      ? { ticker: importTicker.slice(0, 20), period: importPeriod.slice(0, 40) }
      : null,
  };
};

// Validation + clamping boundary. Everything from the client goes through
// this before touching KV: sizes capped, junk dropped, shape rebuilt. Returns
// null when the model is unusable (caller maps to 400).
export const sanitizeModel = (raw: Omit<SotpModel, "updatedAt">, now: string): SotpModel | null => {
  const companyName = raw.companyName.trim().slice(0, MAX_COMPANY);
  if (!companyName) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.slug)) return null;
  const cleanParts = (Array.isArray(raw.parts) ? raw.parts : [])
    .map((p): SotpPart => {
      const part: SotpPart = {
        label: String(p?.label ?? "").trim().slice(0, MAX_LABEL),
        valuation: typeof p?.valuation === "number" && Number.isFinite(p.valuation) ? p.valuation : 0,
        note: String(p?.note ?? "").trim().slice(0, MAX_NOTE),
      };
      if (p?.mode === "multiple") part.mode = "multiple";
      if (typeof p?.revenueRef === "number" && Number.isFinite(p.revenueRef)) part.revenueRef = p.revenueRef;
      if (typeof p?.multiple === "number" && Number.isFinite(p.multiple) && p.multiple >= 0) part.multiple = p.multiple;
      return part;
    })
    .filter((p) => p.label !== "")
    .slice(0, MAX_PARTS);
  // Multiple parts get their valuation RE-DERIVED here — the client preview is
  // cosmetic; this is what actually persists.
  const parts = recomputeMultiples(cleanParts);
  return {
    slug: raw.slug,
    companyName,
    currency: (raw.currency || "USD").trim().toUpperCase().slice(0, 8),
    sharesOutstanding: typeof raw.sharesOutstanding === "number" && raw.sharesOutstanding > 0
      ? raw.sharesOutstanding
      : null,
    parts,
    importedFrom: raw.importedFrom && typeof raw.importedFrom.ticker === "string"
      ? { ticker: raw.importedFrom.ticker.slice(0, 20), period: String(raw.importedFrom.period ?? "").slice(0, 40) }
      : null,
    updatedAt: now,
  };
};

export type SotpTotals = {
  total: number; // sum of part valuations
  perShare: number | null; // total / sharesOutstanding; null while shares unknown
};

export const computeTotals = (model: Pick<SotpModel, "parts" | "sharesOutstanding">): SotpTotals => {
  const total = model.parts.reduce((sum, p) => sum + (Number.isFinite(p.valuation) ? p.valuation : 0), 0);
  const shares = model.sharesOutstanding;
  return { total, perShare: shares !== null && shares > 0 ? total / shares : null };
};

export type SotpBridge = {
  netDebt: number;           // + = subtract, − = net cash (adds)
  minorityInterests: number;
  preferred: number;
  sotpDiscountPct: number;   // whole % (10 = 10%), clamped 0–30
  illiquidityPct: number;    // whole %, clamped 0–60
};

const clampPct = (v: unknown, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : 0;

// computeBridge consumes already-sanitized models in production, so a percent
// outside [lo,hi] only appears when called directly with junk. Treat it as 0
// (no discount) rather than amplifying an out-of-range input.
const validPct = (v: unknown, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : 0;

// Strip binary floating-point noise (83 × 0.9 × 0.8 = 59.760000000000005)
// to 12 significant figures so division/multiplication chains compare cleanly.
const round12 = (n: number): number => Number(n.toPrecision(12));

export const computeBridge = (
  partsTotal: number,
  bridge: Partial<SotpBridge> | undefined,
  sharesOutstanding: number | null,
): {
  partsTotal: number;
  afterNetDebt: number;
  afterInterests: number;
  afterDiscount: number;
  equityValue: number;
  perShare: number | null;
} => {
  const netDebt = Number.isFinite(bridge?.netDebt) ? bridge.netDebt! : 0;
  const minority = Number.isFinite(bridge?.minorityInterests) ? bridge.minorityInterests! : 0;
  const preferred = Number.isFinite(bridge?.preferred) ? bridge.preferred! : 0;
  const afterNetDebt = round12(partsTotal - netDebt);
  const afterInterests = round12(afterNetDebt - minority - preferred);
  const sotpPct = validPct(bridge?.sotpDiscountPct, 0, 30);
  const illiqPct = validPct(bridge?.illiquidityPct, 0, 60);
  const afterDiscount = round12(afterInterests * (1 - sotpPct / 100) * (1 - illiqPct / 100));
  return {
    partsTotal,
    afterNetDebt,
    afterInterests,
    afterDiscount,
    equityValue: afterDiscount,
    perShare: sharesOutstanding !== null && sharesOutstanding > 0 ? round12(afterDiscount / sharesOutstanding) : null,
  };
};

// Turn an SEC segment breakdown into editable parts. Valuations start at 0 —
// the LLM/XBRL pipeline supplies the STRUCTURE (part names + reported segment
// revenue as a note); it never supplies a valuation. Prefers the reportable-
// segment axis (the natural "parts of the company"), then product, then first.
export const seedPartsFromSegments = (segments: SegmentResult): SotpPart[] => {
  const preferred =
    segments.groups.find((g) => /reportable segment/i.test(g.axisLabel)) ??
    segments.groups.find((g) => /product/i.test(g.axisLabel)) ??
    segments.groups[0];
  if (!preferred) return [];
  return preferred.rows
    .filter((r) => Number.isFinite(r.revenue) && r.revenue !== 0)
    .slice(0, MAX_PARTS)
    .map((r) => ({
      label: r.label.slice(0, MAX_LABEL),
      valuation: 0,
      note: `Segment revenue: ${formatNumber(r.revenue)} (period ${segments.period})`,
      revenueRef: r.revenue, // raw segment revenue — powers a later × multiple
    }));
};
