// Sum-of-the-parts (SOTP) — model types, form parsing, sanitizing, totals.
// Pure module: no I/O, no Cloudflare imports — safe in Node tests and pages alike.

import { formatNumber } from "../format.ts";
import type { SegmentResult } from "../pipeline/segments.ts";

export type SotpPart = {
  label: string; // "Starlink" / "iPhone"
  valuation: number; // the user's estimate, currency units. Negative allowed (e.g. net debt).
  note: string; // reasoning, e.g. "8× 2026E revenue of $12B"
};

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
  const rows = Math.max(labels.length, vals.length, notes.length);
  const parts: SotpPart[] = [];
  for (let i = 0; i < rows && parts.length < MAX_PARTS; i++) {
    const label = (labels[i] ?? "").trim().slice(0, MAX_LABEL);
    if (label === "") continue;
    parts.push({
      label,
      valuation: parseNumberInput(vals[i] ?? null) ?? 0,
      note: (notes[i] ?? "").trim().slice(0, MAX_NOTE),
    });
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
