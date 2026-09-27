// Earnings audit + book value — the deterministic halves (XBRL pickers and the
// arithmetic guards). These are the parts that must not regress silently: a
// wrong picker or a missing guard prints a plausible-looking wrong number.
import { test } from "node:test";
import assert from "node:assert/strict";

import { pickOneOffFacts, pickBookValueFacts } from "../src/lib/stock-research/sources/edgar.ts";
import { computeBookValue } from "../src/lib/stock-research/pipeline/book-value.ts";
import {
  computeAdjustment,
  normalizeImpactOn,
  filterLabeledItems,
  mirrorReported,
  pegBasis,
} from "../src/lib/stock-research/pipeline/earnings-audit.ts";
import type { TickerQuote } from "../src/lib/stock-research/types.ts";

// Minimal instance: consolidated + dimensional contexts, two years of instants,
// an aggregate-vs-component one-off pair, and a zero-value fact.
const INSTANCE = `<?xml version="1.0" ?>
<xbrli:xbrl xmlns:us-gaap="us-gaap" xmlns:dei="dei" xmlns:srt="srt">
<context id="d2026"><entity><segment><explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">srt:CloudMember</explicitMember></segment></entity><period><startDate>2025-07-01</startDate><endDate>2026-06-30</endDate></period></context>
<context id="d2025"><period><startDate>2024-07-01</startDate><endDate>2025-06-30</endDate></period></context>
<context id="dseg"><entity><segment><explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">srt:CloudMember</explicitMember></segment></entity><period><startDate>2025-07-01</startDate><endDate>2026-06-30</endDate></period></context>
<context id="i2026"><instant>2026-06-30</instant></context>
<context id="i2025"><instant>2025-06-30</instant></context>
<context id="icover"><instant>2026-07-23</instant></context>
<context id="iseg"><segment/></context>
<us-gaap:GoodwillImpairmentLoss contextRef="d2026" unitRef="usd">133200000</us-gaap:GoodwillImpairmentLoss>
<us-gaap:GoodwillImpairmentLoss contextRef="d2025" unitRef="usd">999999999</us-gaap:GoodwillImpairmentLoss>
<us-gaap:GoodwillImpairmentLoss contextRef="dseg" unitRef="usd">555</us-gaap:GoodwillImpairmentLoss>
<us-gaap:RestructuringCharges contextRef="d2026" unitRef="usd">4580000</us-gaap:RestructuringCharges>
<us-gaap:RestructuringCharges contextRef="d2026" unitRef="usd">0</us-gaap:RestructuringCharges>
<us-gaap:StockholdersEquity contextRef="i2026" unitRef="usd">500000000</us-gaap:StockholdersEquity>
<us-gaap:StockholdersEquity contextRef="i2025" unitRef="usd">400000000</us-gaap:StockholdersEquity>
<us-gaap:StockholdersEquity contextRef="iseg" unitRef="usd">12345</us-gaap:StockholdersEquity>
<us-gaap:Goodwill contextRef="i2026" unitRef="usd">200000000</us-gaap:Goodwill>
<us-gaap:IntangibleAssetsNetExcludingGoodwill contextRef="i2026" unitRef="usd">50000000</us-gaap:IntangibleAssetsNetExcludingGoodwill>
<dei:EntityCommonStockSharesOutstanding contextRef="icover" unitRef="shares">10000000</dei:EntityCommonStockSharesOutstanding>
</xbrli:xbrl>`;

// A quote the audit's arithmetic can consume (shares = marketCap / price = 10M).
function quote(over: Partial<TickerQuote> = {}): TickerQuote {
  return {
    symbol: "TEST",
    shortName: "Test Co",
    longName: null,
    exchange: "NAS",
    market: "US",
    currency: "USD",
    price: 20,
    previousClose: null,
    change: null,
    changePercent: null,
    dayLow: null,
    dayHigh: null,
    fiftyTwoWeekLow: null,
    fiftyTwoWeekHigh: null,
    volume: null,
    marketCap: 200_000_000,
    trailingPE: 10,
    forwardPE: null,
    priceToSalesTrailing12Months: null,
    priceToBook: null,
    pegRatio: null,
    epsTrailingTwelveMonths: 2,
    epsForward: null,
    revenueTrailingTwelveMonths: null,
    grossProfitTrailingTwelveMonths: null,
    earningsGrowth: 0.1,
    ...over,
  };
}

test("pickOneOffFacts keeps only consolidated facts of the filing period", () => {
  const rows = pickOneOffFacts(INSTANCE, "2026-06-30");
  assert.ok(rows);
  // Prior-year comparative and the segment-level restatement are both dropped.
  const labels = rows!.rows.map((r) => r.label);
  assert.deepEqual(labels.sort(), ["GoodwillImpairmentLoss", "RestructuringCharges"]);
  assert.equal(rows!.rows.find((r) => r.label === "GoodwillImpairmentLoss")!.value, 133_200_000);
  // Zero-value facts carry no information.
  assert.equal(rows!.rows.find((r) => r.label === "RestructuringCharges")!.value, 4_580_000);
  assert.equal(rows!.period, "2026-06-30");
});

test("pickOneOffFacts returns null when nothing survives the filters", () => {
  assert.equal(pickOneOffFacts(INSTANCE, "2027-06-30"), null);
});

test("pickBookValueFacts takes the newest non-dimensional instant", () => {
  const facts = pickBookValueFacts(INSTANCE);
  assert.equal(facts.equity, 500_000_000); // 2026 instant, not 2025 or the segment one
  assert.equal(facts.goodwill, 200_000_000);
  assert.equal(facts.intangiblesExclGoodwill, 50_000_000);
  assert.equal(facts.sharesOutstanding, 10_000_000);
  // The equity line's own date, NOT the newest instant in the document (the
  // cover-page share count carries a later date than the balance sheet).
  assert.equal(facts.periodEnd, "2026-06-30");
});

test("pickBookValueFacts falls back to the finite-lived intangibles note", () => {
  // Filers like Microsoft tag no combined intangibles figure; the note tag is
  // the balance-sheet line there. Without this the tangible figure is overstated.
  const xml = INSTANCE.replace("<us-gaap:IntangibleAssetsNetExcludingGoodwill contextRef=\"i2026\" unitRef=\"usd\">50000000</us-gaap:IntangibleAssetsNetExcludingGoodwill>", "")
    .replace("<us-gaap:Goodwill contextRef=\"i2026\" unitRef=\"usd\">200000000</us-gaap:Goodwill>", "<us-gaap:Goodwill contextRef=\"i2026\" unitRef=\"usd\">200000000</us-gaap:Goodwill><us-gaap:FiniteLivedIntangibleAssetsNet contextRef=\"i2026\" unitRef=\"usd\">18609000000</us-gaap:FiniteLivedIntangibleAssetsNet>");
  const facts = pickBookValueFacts(xml);
  assert.equal(facts.intangiblesExclGoodwill, null);
  assert.equal(facts.intangiblesFromNotes, 18_609_000_000);

  const book = computeBookValue(facts, quote(), []);
  assert.equal(book!.tangibleEquity, 500_000_000 - 200_000_000 - 18_609_000_000);
  assert.equal(book!.intangibles, 18_609_000_000);
  assert.match(book!.note ?? "", /finite-lived note/);
});

test("computeBookValue: tangible equity strips goodwill and intangibles", () => {
  const book = computeBookValue(pickBookValueFacts(INSTANCE), quote(), []);
  assert.ok(book);
  assert.equal(book!.equity, 500_000_000);
  assert.equal(book!.tangibleEquity, 250_000_000); // 500 − 200 − 50
  assert.equal(book!.shares, 10_000_000);
  assert.equal(book!.sharesSource, "market-cap");
  assert.equal(book!.priceToBook, 0.4); // 200M / 500M
  assert.equal(book!.priceToTangibleBook, 0.8); // 200M / 250M
  assert.equal(book!.bookPerShare, 50);
  assert.equal(book!.tangibleBookPerShare, 25);
  assert.equal(book!.note, null);
});

test("computeBookValue: a goodwill write-off does NOT move tangible book", () => {
  // The impairment already happened in the filed balance sheet, so a goodwill
  // item must not be fed in as a tangible-book adjustment.
  const book = computeBookValue(pickBookValueFacts(INSTANCE), quote(), []);
  assert.equal(book!.adjustedPriceToTangibleBook, null);
  assert.equal(book!.bookImpactCount, 0);

  // A charge that hits HARD assets (inventory/PP&E write-down) does adjust it.
  const withBookItem = computeBookValue(pickBookValueFacts(INSTANCE), quote(), [
    { amount: 50_000_000, impact: "charge" },
  ]);
  assert.equal(withBookItem!.adjustedTangibleBookPerShare, 30); // (250 + 50) / 10
  assert.equal(withBookItem!.adjustedPriceToTangibleBook, 200 / 300);
});

test("computeBookValue: falls back to filing shares and flags missing tags", () => {
  const facts = { ...pickBookValueFacts(INSTANCE), goodwill: null };
  const book = computeBookValue(facts, quote({ marketCap: null }), []);
  assert.equal(book!.sharesSource, "filing");
  assert.equal(book!.tangibleEquity, 450_000_000); // no goodwill tag to subtract
  assert.match(book!.note ?? "", /Goodwill isn't tagged/);
});

test("computeBookValue: negative equity yields no P/B rather than a fake one", () => {
  const facts = { ...pickBookValueFacts(INSTANCE), equity: -100_000_000 };
  const book = computeBookValue(facts, quote(), []);
  assert.equal(book!.priceToBook, null);
  assert.equal(book!.priceToTangibleBook, null);
  assert.equal(book!.bookPerShare, -10); // still a real per-share number
});

test("computeAdjustment: normal one-offs move EPS without flagging", () => {
  // 20M of charges against 2.00 EPS × 10M shares = 20M of net income → 1.0×,
  // which is the boundary and therefore already NOT reliable.
  const justUnder = computeAdjustment(quote(), [
    { label: "Restructuring", amount: 10_000_000, impact: "charge", impactOn: ["eps"] },
  ]);
  assert.equal(justUnder.adjustedEps, 3); // 2 + 10M/10M
  assert.equal(justUnder.adjustedPe, 20 / 3);
  assert.equal(justUnder.oneOffMultiple, 0.5);
  assert.equal(justUnder.adjustedReliable, true);
});

test("computeAdjustment: one-offs larger than trailing earnings are flagged", () => {
  // The real-world case: 216.65M of charges against ~60.1M of implied net
  // income gave "Adjusted P/E 4.54" on a reported 20.92 — arithmetically
  // consistent, economically meaningless.
  const quoteReal = quote({ price: 42.26, trailingPE: 20.92, epsTrailingTwelveMonths: 2.02, marketCap: 42.26 * 29_680_000 });
  const adj = computeAdjustment(quoteReal, [
    { label: "Discontinued operations", amount: 74_560_000, impact: "charge", impactOn: ["eps"] },
    { label: "Goodwill impairment", amount: 133_200_000, impact: "charge", impactOn: ["eps", "goodwill"] },
    { label: "Business exit costs", amount: 4_310_000, impact: "charge", impactOn: ["eps", "cash"] },
    { label: "Restructuring", amount: 4_580_000, impact: "charge", impactOn: ["eps", "cash"] },
  ]);
  assert.equal(adj.adjustedEps !== null && adj.adjustedEps > 9, true);
  assert.equal(adj.adjustedReliable, false); // the guard fires
  assert.equal(Math.round(adj.oneOffMultiple! * 100) / 100, 3.61);
});

test("computeAdjustment: only eps-tagged items move EPS", () => {
  // A book-only item (PP&E write-down already reflected in the balance sheet
  // lines we read) must not be added back to earnings.
  const adj = computeAdjustment(quote(), [
    { label: "PP&E write-down", amount: 10_000_000, impact: "charge", impactOn: ["book"] },
  ]);
  assert.equal(adj.adjustedEps, 2); // unchanged — equals reported
  assert.equal(adj.netOneOff, 0);
  assert.equal(adj.oneOffMultiple, 0);
  assert.equal(adj.adjustedReliable, true);
});

test("computeAdjustment: loss-making companies get no adjusted EPS", () => {
  const adj = computeAdjustment(quote({ epsTrailingTwelveMonths: -1 }), [
    { label: "Impairment", amount: 10_000_000, impact: "charge", impactOn: ["eps"] },
  ]);
  assert.equal(adj.adjustedEps, null);
  assert.equal(adj.reportedPe, null);
});

test("normalizeImpactOn keeps only known kinds and defaults to eps", () => {
  assert.deepEqual(normalizeImpactOn(["eps", "cash", "nonsense"]), ["eps", "cash"]);
  assert.deepEqual(normalizeImpactOn(["book", "book"]), ["book"]);
  assert.deepEqual(normalizeImpactOn(undefined), ["eps"]);
  assert.deepEqual(normalizeImpactOn(["bogus"]), ["eps"]);
});

test("pegBasis: Yahoo's published PEG anchors both rows (INR case)", () => {
  // INR: Yahoo publishes pegRatio 0.13 but no earningsGrowth, so the old
  // P/E÷growth formula printed "—" in the audit while the card above showed
  // 0.13. The published figure now anchors both.
  const basis = pegBasis(quote({ trailingPE: 4.3, pegRatio: 0.13, earningsGrowth: null }));
  assert.equal(basis.reportedPeg, 0.13);
  assert.equal(Math.round(basis.pegForPe(3.19) * 1000) / 1000, Math.round((3.19 * 0.13) / 4.3 * 1000) / 1000);
  assert.equal(basis.pegForPe(null), null);
  assert.equal(basis.pegForPe(-1), null);
});

test("pegBasis: falls back to P/E ÷ growth, then to null", () => {
  const withGrowth = pegBasis(quote({ trailingPE: 20, pegRatio: null, earningsGrowth: 0.1 }));
  assert.equal(withGrowth.reportedPeg, 2); // 20 ÷ 10%
  assert.equal(withGrowth.pegForPe(10), 1); // 10 ÷ 10%
  const neither = pegBasis(quote({ trailingPE: 20, pegRatio: null, earningsGrowth: null }));
  assert.equal(neither.reportedPeg, null);
  assert.equal(neither.pegForPe(10), null);
});

test("computeAdjustment: adjusted PEG keeps the reported PEG's basis", () => {
  const adj = computeAdjustment(
    quote({ price: 20, epsTrailingTwelveMonths: 2, trailingPE: 10, pegRatio: 1.5, marketCap: 200_000_000 }),
    [{ label: "Impairment", amount: 5_000_000, impact: "charge", impactOn: ["eps"] }],
  );
  // adjusted EPS 2.5 → adjusted P/E 8 → scaled by the published basis 1.5/10.
  assert.equal(adj.adjustedEps, 2.5);
  assert.equal(adj.adjustedPe, 8);
  assert.equal(adj.adjustedPeg, 8 * (1.5 / 10));
});

test("mirrorReported keeps the adjusted row filled when nothing was stripped", () => {
  // Regression: with no one-off items the panel used to render no EPS/P/E/PEG
  // tiles at all, which reads as "the feature was deleted". Adjusted figures
  // mirror the reported ones instead (footnoted "unchanged" in the UI).
  const mirrored = mirrorReported(quote({ trailingPE: 4.3, epsTrailingTwelveMonths: 3.04, earningsGrowth: 0.2 }));
  assert.equal(mirrored.adjustedEps, 3.04);
  assert.equal(mirrored.adjustedPe, 4.3);
  assert.equal(mirrored.adjustedPeg, 4.3 / 20); // P/E ÷ growth%
  assert.equal(mirrored.netOneOff, 0);
  assert.equal(mirrored.adjustedReliable, true);
});

test("mirrorReported leaves genuinely uncomputable values null", () => {
  const mirrored = mirrorReported(quote({ epsTrailingTwelveMonths: null, trailingPE: null, pegRatio: null }));
  assert.equal(mirrored.reportedEps, null);
  assert.equal(mirrored.adjustedEps, null);
  assert.equal(mirrored.adjustedPe, null);
});

test("filterLabeledItems drops invented amounts and unknown impact kinds", () => {
  const rawRows = [
    { label: "GoodwillImpairmentLoss", value: 133_200_000 },
    { label: "RestructuringCharges", value: -4_580_000 },
  ];
  const kept = filterLabeledItems(
    [
      { label: "Goodwill impairment", amount: 133_200_000, impact: "charge", impactOn: ["eps", "goodwill"] },
      { label: "Restructuring", amount: -4_580_000, impact: "charge", impactOn: ["eps", "cash", "made-up"] },
      { label: "Invented charge", amount: 999_000_000, impact: "charge", impactOn: ["eps"] }, // not in the filing
      { label: "Nothing", amount: 0, impact: "charge", impactOn: ["eps"] }, // a $0 impairment is not an event
      { label: "No direction", amount: 133_200_000, impact: "unclear", impactOn: ["eps"] },
    ],
    rawRows,
  );
  assert.equal(kept.length, 2);
  assert.deepEqual(kept[0].impactOn, ["eps", "goodwill"]);
  assert.deepEqual(kept[1].impactOn, ["eps", "cash"]); // unknown kind stripped
});

test("filterLabeledItems collapses two labels on the same figure to one", () => {
  // Aggregate + component views of one event, both labeled, both matching a
  // raw magnitude: adding both back would double the adjustment.
  const rawRows = [
    { label: "AssetImpairmentCharges", value: 50_000_000 },
    { label: "ImpairmentOfIntangibleAssets", value: 50_000_000 },
  ];
  const kept = filterLabeledItems(
    [
      { label: "Impairment (aggregate)", amount: 50_000_000, impact: "charge", impactOn: ["eps"] },
      { label: "Impairment of intangibles", amount: 50_000_000, impact: "charge", impactOn: ["eps"] },
    ],
    rawRows,
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].label, "Impairment (aggregate)");
});

test("filterLabeledItems tolerates junk model output", () => {
  assert.deepEqual(filterLabeledItems(undefined, [{ label: "x", value: 1 }]), []);
  assert.deepEqual(filterLabeledItems("not an array", [{ label: "x", value: 1 }]), []);
  assert.deepEqual(filterLabeledItems([null, 42], [{ label: "x", value: 1 }]), []);
});
