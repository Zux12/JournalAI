// Simple, style-aware formatting helpers for in-text citations and bibliography.
// Numeric styles use [1], [2] by order of first appearance in project.references.items.
// Author-date styles render (Author, 2022; Other, 2023).

const NUMERIC_STYLES = new Set(['ieee','vancouver','ama','nature','acm','acs']);
const AUTHORDATE_STYLES = new Set(['apa-7','chicago-ad','icheme-harvard']);

function refKey(entry) {
  // Stable key for dedupe & lookup
  if (entry.DOI) return `doi:${String(entry.DOI).toLowerCase()}`;
  if (entry.id)  return String(entry.id).toLowerCase();
  if (entry.title) return `title:${String(entry.title).toLowerCase()}`;
  return `tmp:${crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

function firstAuthorFamily(entry) {
  return entry?.author?.[0]?.family || entry?.author?.[0]?.literal || 'Author';
}
function pubYear(entry) {
  return entry?.issued?.['date-parts']?.[0]?.[0] || entry?.issued?.year || '';
}

export function ensureRefIds(items=[]) {
  // Ensure each item has a stable id & _key
  return items.map((it, idx) => {
    const _k = refKey(it);
    return { _key: _k, id: it.id || _k, ...it };
  });
}

export function mergeReferences(curRefs, newItems) {
  const items = ensureRefIds(curRefs?.items || []);
  const map = new Map(items.map(x => [x._key, x]));
  for (const raw of newItems || []) {
    const entry = ensureRefIds([raw])[0];
    if (!map.has(entry._key)) {
      map.set(entry._key, entry);
      items.push(entry); // preserve "first seen" order to number numeric citations
    }
  }
  return { ...(curRefs || { styleId: 'ieee', items: [], unresolved: [] }), items };
}

export function formatInText(styleId, refs, keys=[]) {
  const items = ensureRefIds(refs?.items || []);
  if (!keys.length || !items.length) return '';

  if (NUMERIC_STYLES.has(styleId)) {
    // Map keys to numbers based on first-appearance order
    const order = new Map(items.map((it, i) => [it._key, i + 1]));
    const nums = keys
      .map(k => order.get(k.toLowerCase?.() || k) ?? order.get(String(k).toLowerCase()))
      .filter(n => typeof n === 'number')
      .sort((a,b)=>a-b);
    if (!nums.length) return '';
    // compress simple sequences: 1,2,3 -> 1–3 (simple pass)
    const ranges = [];
    let start = null, prev = null;
    for (const n of nums) {
      if (start == null) { start = n; prev = n; }
      else if (n === prev + 1) { prev = n; }
      else { ranges.push(start === prev ? `${start}` : `${start}–${prev}`); start = n; prev = n; }
    }
    if (start != null) ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    return `[${ranges.join(', ')}]`;
  }

  // Author-date variants
  if (AUTHORDATE_STYLES.has(styleId)) {
    const look = new Map(items.map(it => [it._key, it]));
    const parts = [];
    for (const k of keys) {
      const it = look.get((k.toLowerCase?.() || String(k).toLowerCase()));
      if (!it) continue;
      parts.push(`${firstAuthorFamily(it)}, ${pubYear(it)}`);
    }
    if (!parts.length) return '';
    return `(${parts.join('; ')})`;
  }

  // Fallback to numeric
  return formatInText('ieee', refs, keys);
}

export function formatBibliography(styleId, refs) {
  const items = ensureRefIds(refs?.items || []);
  if (!items.length) return '';
  const lines = [];

  if (NUMERIC_STYLES.has(styleId)) {
    items.forEach((it, i) => {
      const n = i + 1;
      const authors = (it.author || []).map(a => a.family ? `${a.family} ${a.given? a.given[0]+'.' : ''}` : a.literal || '').filter(Boolean).join(', ');
      const year = pubYear(it);
      const container = it['container-title'] || '';
      const vol = it.volume ? ` ${it.volume}` : '';
      const issue = it.issue ? `(${it.issue})` : '';
      const pages = it.page ? `:${it.page}` : '';
      const doi = it.DOI ? ` doi:${it.DOI}` : (it.URL ? ` ${it.URL}` : '');
      lines.push(`[${n}] ${authors}. ${it.title}. ${container}${vol}${issue}${pages} (${year}).${doi}`);
    });
    return lines.join('\n');
  }

  // Author-date (simple APA-like fallback)
  items.forEach(it => {
    const authors = (it.author || []).map(a => a.family ? `${a.family}, ${a.given? a.given[0]+'.' : ''}` : a.literal || '').filter(Boolean).join('; ');
    const year = pubYear(it);
    const container = it['container-title'] || '';
    const vol = it.volume ? ` ${it.volume}` : '';
    const issue = it.issue ? `(${it.issue})` : '';
    const pages = it.page ? `, ${it.page}` : '';
    const doi = it.DOI ? ` https://doi.org/${it.DOI}` : (it.URL ? ` ${it.URL}` : '');
    lines.push(`${authors} (${year}). ${it.title}. ${container}${vol}${issue}${pages}.${doi}`);
  });
  return lines.join('\n');
}
