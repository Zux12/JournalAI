import { ensureRefIds, formatInText } from './refFormat.js';

export function applyCitations(text, styleId, refs) {
  const all = ensureRefIds(refs?.items || []);
  const keyset = new Set(all.map(it => it._key));
  const used = new Set();

  const out = String(text || '').replace(/\{\{cite:([^}]+)\}\}/gi, (_, raw) => {
    const keys = raw
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(k => keyset.has(k));
    keys.forEach(k => used.add(k));
    const inText = formatInText(styleId, refs, keys);
    return inText || '';
  });

  return { text: out, citedKeys: Array.from(used) };
}
