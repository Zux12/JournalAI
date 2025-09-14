import { ensureRefIds } from './refFormat.js';

// Convert (Author, 2025; Lee, 2024) to {{cite:key1,key2}} using refs we know.
// If there's no match for an item, we leave the original parentheses.
export function convertAuthorYearToMarkers(text, refs) {
  const all = ensureRefIds(refs?.items || []);
  if (!text || !all.length) return { text, mappedKeys: [] };

  const used = new Set();

  const out = String(text).replace(/\(([^()]*\d{4}[a-z]?[^()]*)\)/g, (match, inner) => {
    // Split by semicolon or 'and'
    const parts = inner.split(/;|\band\b/gi).map(s => s.trim()).filter(Boolean);
    const keys = [];

    for (const part of parts) {
      // capture FirstAuthor and Year (supports "Bruno et al., 2025")
      const m = /([A-Z][A-Za-z\-']+)[^0-9]*(\d{4})/u.exec(part);
      if (!m) continue;
      const wantAuthor = m[1].toLowerCase();
      const wantYear = m[2];

      const hit = all.find(it => {
        const fam = (it.author?.[0]?.family || it.author?.[0]?.literal || '').toLowerCase();
        const year = String(it?.issued?.['date-parts']?.[0]?.[0] || it?.issued?.year || '');
        return fam === wantAuthor && year === wantYear;
      });

      if (hit) { keys.push(hit._key); used.add(hit._key); }
    }

    return keys.length ? `{{cite:${keys.join(',')}}}` : match;
  });

  return { text: out, mappedKeys: Array.from(used) };
}
