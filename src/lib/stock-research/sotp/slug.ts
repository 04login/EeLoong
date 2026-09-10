// Sum-of-the-parts (SOTP) — slug helpers.
// A model's slug is its identity in KV (`sotp:{slug}`) and its URL
// (/projects/valuation-lab/{slug}). Derived from the company name; must be
// URL-safe and unique within the namespace.

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // diacritics left over from NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

export const uniqueSlug = (base: string, taken: ReadonlySet<string>): string => {
  const clean = base || "model";
  if (!taken.has(clean)) return clean;
  for (let n = 2; n <= 99; n++) {
    const candidate = `${clean}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 99 same-named models — fall back to a unique-ish suffix rather than fail.
  return `${clean}-${Date.now()}`;
};
