// Fair value — a defined, transparent formula over peer averages.
//
// Formula (per plan doc): implied price = peer-average PE × company EPS.
// Band: sensitivity of the peer-average PE by ±20% (a defensible, clearly
// disclosed spread) around the central estimate. All inputs shown to the user
// — no black box.

import type { PeerComparison } from "./peer-comparison.ts";

export type FairValue = {
  ticker: string;
  formula: string;
  peerPe: number | null;
  eps: number | null;
  impliedPrice: number | null;
  low: number | null;
  high: number | null;
  vsPrice: number | null; // implied / market price − 1 (fraction)
};

export async function computeFairValue(
  ticker: string,
  peerComparison: PeerComparison | null,
  eps: number | null,
  price: number | null,
): Promise<FairValue | null> {
  const peerPe = peerComparison?.averages.pe ?? null;
  if (peerPe === null || eps === null || eps <= 0 || price === null || price <= 0) return null;

  const implied = peerPe * eps;
  if (!isFinite(implied) || implied <= 0) return null;

  const spread = 0.2;
  return {
    ticker: ticker.trim().toUpperCase(),
    formula: "peer-average PE × EPS (±20% PE sensitivity band)",
    peerPe,
    eps: eps as number,
    impliedPrice: implied,
    low: implied * (1 - spread),
    high: implied * (1 + spread),
    vsPrice: implied / price - 1,
  };
}
