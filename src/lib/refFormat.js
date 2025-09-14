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

export function formatInText(styleId, refs, keys = [], numberMap = null) {
  const items = ensureRefIds(refs?.items || []);
  if (!keys.length || !items.length) return '';

  if (NUMERIC_STYLES.has(styleId)) {
    // Map keys to numbers based on first-appearance order
     const order = numberMap
      ? numberMap // Map<keyLower, number>
      : new Map(items.map((it, i) => [it._key, i + 1]));
    const nums = keys
      .map(k => order.get((k.toLowerCase?.() || String(k).toLowerCase())) )
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
      const n = (it.author || []).length;
      const fam = firstAuthorFamily(it);
      const yr = pubYear(it);
      const label = n > 1 ? `${fam} et al., ${yr}` : `${fam}, ${yr}`;
      parts.push(label);
    }
    return parts.length ? `(${parts.join('; ')})` : '';
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


export function formatBibliographyCitedOnly(styleId, refs, citedKeys = []) {
  const all = ensureRefIds(refs?.items || []);
  if (!all.length || !citedKeys.length) return '';

  const keyset = new Set(citedKeys.map(k => String(k).toLowerCase()));
  const filtered = all.filter(it => keyset.has(it._key));
  if (!filtered.length) return '';

  // For numeric styles, keep original label number based on position in full list
  if (NUMERIC_STYLES.has(styleId)) {
    const lines = filtered.map(it => {
      const n = all.findIndex(x => x._key === it._key) + 1; // original label
      const authors = (it.author || [])
        .map(a => a.family ? `${a.family} ${a.given ? a.given[0] + '.' : ''}` : a.literal || '')
        .filter(Boolean).join(', ');
      const year = pubYear(it);
      const container = it['container-title'] || '';
      const vol = it.volume ? ` ${it.volume}` : '';
      const issue = it.issue ? `(${it.issue})` : '';
      const pages = it.page ? `:${it.page}` : '';
      const doi = it.DOI ? ` doi:${it.DOI}` : (it.URL ? ` ${it.URL}` : '');
      return `[${n}] ${authors}. ${it.title}. ${container}${vol}${issue}${pages} (${year}).${doi}`;
    });
    return lines.join('\n');
  }

  // Author–date family
  const lines = filtered.map(it => {
    const authors = (it.author || [])
      .map(a => a.family ? `${a.family}, ${a.given ? a.given[0] + '.' : ''}` : a.literal || '')
      .filter(Boolean).join('; ');
    const year = pubYear(it);
    const container = it['container-title'] || '';
    const vol = it.volume ? ` ${it.volume}` : '';
    const issue = it.issue ? `(${it.issue})` : '';
    const pages = it.page ? `, ${it.page}` : '';
    const doi = it.DOI ? ` https://doi.org/${it.DOI}` : (it.URL ? ` ${it.URL}` : '');
    return `${authors} (${year}). ${it.title}. ${container}${vol}${issue}${pages}.${doi}`;
  });
  return lines.join('\n');
}

export function formatBibliographyWithMap(styleId, refs, numberMap) {
  const all = ensureRefIds(refs?.items || []);
  if (!all.length || !numberMap || numberMap.size === 0) return '';
  if (!NUMERIC_STYLES.has(styleId)) return ''; // only applies to numeric

  const byKey = new Map(all.map(it => [it._key, it]));
  const seq = Array.from(numberMap.entries())
    .map(([k, n]) => ({ key: String(k), n }))
    .sort((a,b)=>a.n - b.n);

  const lines = [];
  for (const { key, n } of seq) {
    const it = byKey.get(String(key).toLowerCase());
    if (!it) continue;
    const authors = (it.author || [])
      .map(a => a.family ? `${a.family} ${a.given ? a.given[0]+'.' : ''}` : a.literal || '')
      .filter(Boolean).join(', ');
    const year = pubYear(it);
    const container = it['container-title'] || '';
    const vol = it.volume ? ` ${it.volume}` : '';
    const issue = it.issue ? `(${it.issue})` : '';
    const pages = it.page ? `:${it.page}` : '';
    const doi = it.DOI ? ` doi:${it.DOI}` : (it.URL ? ` ${it.URL}` : '');
    lines.push(`[${n}] ${authors}. ${it.title}. ${container}${vol}${issue}${pages} (${year}).${doi}`);
  }
  return lines.join('\n');
}
