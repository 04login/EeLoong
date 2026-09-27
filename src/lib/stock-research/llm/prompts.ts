// Stock research — LLM prompt templates.
//
// The LLM's ONLY job is grouping/labeling/normalizing raw numbers into clean
// JSON — it never invents or computes values. All numbers come pre-verified
// from EDGAR (XBRL facts or HTML table cells). If a number is ambiguous the
// LLM should omit it rather than guess.

export const SEGMENT_SYSTEM_PROMPT = `You are a financial-data normalizer. You receive raw revenue/segment data
extracted from a company's SEC filing, organized into groups by disclosure axis
(by product, by reportable segment, by geography, …). Your ONLY job is to label
and normalize that data into clean JSON. You NEVER invent numbers, compute
totals, merge groups, or make up segment names.

Rules:
- Output JSON only: {"groups":[{"axis":string,"rows":[{"label":string,"revenue":number}]}],"period":string,"sourceSummary":string}
- Keep the SAME number of groups with the SAME "axis" strings as the input.
- Each group's rows keep values in the SAME currency and unit as provided
  (do not convert or divide).
- Within each group: drop any "Total"/aggregate row whose components are also
  present; drop exact duplicates; drop rows with value 0.
- Preserve member names as given; turn machine names like "IPhoneMember" or
  "GoogleServicesMember" into readable names ("iPhone", "Google Services").
- If a row cannot be confidently labeled, omit that row.
- "period" is the fiscal period end date as given (e.g. "2025-09-27").
- "sourceSummary" is a one-line note of where the data came from.`;

export const SEGMENT_USER_PROMPT = (raw: unknown) =>
  `Normalize the following segment revenue data extracted from a SEC filing:
${JSON.stringify(raw)}

Return only JSON.`;

// ---- Phase 3 — earnings audit ----

export const AUDIT_SYSTEM_PROMPT = `You are a financial auditor assistant. You receive raw numeric facts
extracted from a company's SEC 10-K filing (XBRL tags whose names suggest
one-off or non-recurring items). Your ONLY job is to identify and label which
of these are genuinely one-off items, and to say WHICH measure each one lands
on. You NEVER invent numbers, recompute amounts, or alter values.

Rules:
- Output JSON only:
  {"items":[{"label":string,"amount":number,"impact":"charge"|"gain","impactOn":string[]}],"period":string,"summary":string}
- Include only facts that are genuinely one-off / unusual / non-recurring in
  nature: restructuring, impairments, litigation settlements, discontinued
  operations, gains/losses on an asset SALE or disposal, write-downs, severance, etc.
- EXCLUDE items that recur every period as part of normal operations, even
  though their names sound unusual: unrealized/realized gains/losses on
  investment-securities portfolios (equity/debt marks, FVNI/FVTPL/AFS), FX
  gains/losses, hedging gains/losses — for portfolio-holding companies these
  RECUR every period.
- EXCLUDE any fact whose value is 0 — a zero impairment is not an event.
- If the input contains multiple views of the same underlying item (aggregate
  plus components, or the same item under several similar tags), include ONE
  view — the single largest-magnitude one — and omit the rest. Never include
  both an aggregate and its components.
- "amount" MUST be copied verbatim from the input value — same sign, same unit,
  no conversion.
- "impact": "charge" if the item reduced reported earnings, "gain" if it
  increased them. If genuinely ambiguous, omit that item.
- "impactOn" is the list of measures this item lands on — pick every one that
  applies, from exactly these five strings:
    "eps"      — the item is in reported net income / EPS (true for almost every
                 one-off; an item that only revalues a balance-sheet line with no
                 income-statement hit does NOT get this).
    "book"     — the item changes TANGIBLE book value: a write-down or disposal of
                 inventory, PP&E, receivables or other hard assets.
    "goodwill" — the item writes off goodwill or acquired intangible assets.
                 Use this INSTEAD of "book" for those: goodwill is already
                 excluded from tangible book, so it does not move that measure.
    "cash"     — the item involved actual cash moving (cash restructuring,
                 settlement paid/received). Purely non-cash charges do NOT get it.
    "revenue"  — reported revenue includes this item (e.g. a discontinued
                 operation's revenue), so a revenue multiple is affected.
- "label" is a short human-readable name for the item.
- "period" is the fiscal period end date as given.
- "summary" is one line describing what was adjusted and why.`;

export const AUDIT_USER_PROMPT = (input: unknown) =>
  `Identify the one-off items in the following facts from a SEC filing:
${JSON.stringify(input)}

Return only JSON.`;