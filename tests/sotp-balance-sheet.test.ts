import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBalanceSheetFacts } from "../src/lib/stock-research/sources/edgar.ts";

const INSTANCE = `<?xml version="1.0" ?><xbrli:xbrl xmlns:xbrli="w3-xbrli" xmlns:us-gaap="us-gaap" xmlns:aapl="aapl">
<context id="i2026"><instant>2026-06-30</instant></context>
<context id="i2025"><instant>2025-12-31</instant></context>
<context id="seg26"><segment><explicitmember contextref="i2026">srt:ConnectivityMember</explicitmember></segment></segment></context>
<us-gaap:CashAndCashEquivalents contextref="i2026" unitref="usd" decimals="-6">93522000000</us-gaap:CashAndCashEquivalents>
<us-gaap:CashAndCashEquivalents contextref="i2025" unitref="usd" decimals="-6">24747000000</us-gaap:CashAndCashEquivalents>
<us-gaap:CashAndCashEquivalents contextref="seg26" unitref="usd" decimals="-6">111</us-gaap:CashAndCashEquivalents>
<us-gaap:MarketableSecuritiesCurrent contextref="i2026" unitref="usd" decimals="-6">6487000000</us-gaap:MarketableSecuritiesCurrent>
<us-gaap:LongTermDebtNoncurrent contextref="i2026" unitref="usd" decimals="-6">36839000000</us-gaap:LongTermDebtNoncurrent>
<us-gaap:LongTermDebtCurrent contextref="i2026" unitref="usd" decimals="-6">2525000000</us-gaap:LongTermDebtCurrent>
<us-gaap:FinanceLeaseLiability contextref="i2026" unitref="usd" decimals="-6">1079000000</us-gaap:FinanceLeaseLiability>
<us-gaap:MinorityInterest contextref="i2026" unitref="usd" decimals="-6">0</us-gaap:MinorityInterest>
<us-gaap:RedeemableConvertiblePreferredStockValue contextref="i2026" unitref="usd" decimals="-6">2100000000</us-gaap:RedeemableConvertiblePreferredStockValue>
<dei:EntityCommonStockSharesOutstanding contextref="i2026" unitref="shares" decimals="-6">13170000000</dei:EntityCommonStockSharesOutstanding>
</xbrli:xbrl>`;

test("pickBalanceSheetFacts takes newest non-dimensional instant per tag", () => {
  const f = pickBalanceSheetFacts(INSTANCE as unknown as string);
  assert.equal(f.cash, 93522000000); // newest instant wins
  assert.equal(f.marketableSec, 6487000000); // dimensional row ignored
  assert.equal(f.totalDebt, 39364000000); // current + noncurrent
  assert.equal(f.financeLeases, 1079000000);
  assert.equal(f.minorityInterest, 0);
  assert.equal(f.redeemablePreferred, 2100000000);
  assert.equal(f.sharesOutstanding, 13170000000);
});
