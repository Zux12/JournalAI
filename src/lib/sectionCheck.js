// Lightweight section stats + heuristic warnings
export function computeSectionStats(text = '', styleId = 'ieee', density = 'normal', sectionName = '') {
  const t = String(text || '');
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  const sentences = (t.match(/[.!?](\s|$)/g) || []).length;

  // Inline cites: [n], [n–m], [n, m], or (Author, 2020; …)
  const numericCites = (t.match(/\[(?:\d+(?:–\d+)?(?:,\s*\d+(?:–\d+)?)*)\]/g) || []).length;
  const authorDateCites = (t.match(/\([^)]+\d{4}[a-z]?(?:;[^)]*\d{4}[a-z]?)*\)/g) || []).length;
  const cites = numericCites + authorDateCites;

  // Heuristic density targets (citations per 150 words)
  const targetPer150 = { normal: 0.7, dense: 1.2, extra: 1.8, extreme: 2.4 }[density] || 0.7;
  const expected = Math.max(1, Math.round((words / 150) * targetPer150));
  const underCited = cites < expected;

  const warnings = [];
  if (words < 120) warnings.push('This section is quite short (<120 words).');
  if (underCited) warnings.push(`Citation density is low for “${density}”: ${cites}/${expected} (approx.).`);
  if (/results/i.test(sectionName) && !/\{fig:|Figure\s+\d/.test(t)) {
    warnings.push('Results often benefit from at least one figure or table reference.');
  }
  if (/introduction/i.test(sectionName) && cites < 2) {
    warnings.push('Introductions typically cite ≥2 foundational works.');
  }

  return { words, sentences, cites, expected, warnings };
}
