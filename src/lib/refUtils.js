// Simple utils for references

// Build a stable dedupe key
export function refKey(entry = {}) {
  if (entry.DOI) return `doi:${String(entry.DOI).trim().toLowerCase()}`;
  if (entry.id)  return String(entry.id).trim().toLowerCase();
  if (entry.title) return `title:${normalizeTitle(entry.title)}`;
  return `tmp:${Math.random().toString(36).slice(2)}`;
}

export function normalizeTitle(t = '') {
  return String(t).toLowerCase().replace(/[\s\W]+/g, ' ').trim();
}

// Merge/unique by key (DOI > id > title)
export function dedupeRefs(items = []) {
  const map = new Map();
  for (const it of items) {
    const k = refKey(it);
    if (!map.has(k)) map.set(k, it);
  }
  return Array.from(map.values());
}

// Sentence case (very light) for titles
export function sentenceCaseTitle(t = '') {
  const s = String(t).trim();
  if (!s) return s;
  // keep common acronyms in caps
  const ACR = new Set(['DNA','RNA','AI','QDs','PLGA','GMP','FDA','ISO']);
  const first = s[0].toUpperCase() + s.slice(1).toLowerCase();
  return first.replace(/\b([A-Z]{2,})\b/g, (m)=> ACR.has(m) ? m : m.toUpperCase());
}
