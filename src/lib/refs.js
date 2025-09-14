import axios from 'axios';

// ------- Crossref / PubMed / arXiv resolvers -------

export async function fetchByDOI(doi){
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const { data } = await axios.get(url);
  return toCSLJSON(data.message);
}

export async function fetchByPMID(pmid){
  // Lightweight fallback (CORS-friendly). For MVP we return a minimal entry.
  // You can later switch to NCBI E-Utilities JSON if needed.
  return {
    type: "article-journal",
    title: `PMID:${pmid}`,
    author: [{ family: "Unknown", given: "" }],
    issued: { "date-parts": [[new Date().getFullYear()]] },
    "container-title": "PubMed",
    id: pmid
  };
}

export async function fetchByArXiv(id){
  // Minimal arXiv stub (Atom XML parse skipped for MVP)
  return {
    type: "article-journal",
    title: `arXiv:${id}`,
    author: [{ family: "Unknown", given: "" }],
    issued: { "date-parts": [[new Date().getFullYear()]] },
    "container-title": "arXiv",
    id
  };
}

// ------- Helpers -------

function toCSLJSON(m){
  // m can be either Crossref "message" object or an "items" element
  const authors = (m.author || []).map(a => ({ family: a.family, given: a.given }));
  // prefer published-print year; fallback to created year
  const year =
    Number(m['published-print']?.['date-parts']?.[0]?.[0]) ||
    Number(m['published-online']?.['date-parts']?.[0]?.[0]) ||
    Number(m.created?.['date-parts']?.[0]?.[0]) ||
    new Date().getFullYear();

  return {
    type: m.type || 'article-journal',
    title: Array.isArray(m.title) ? m.title[0] : (m.title || ''),
    author: authors,
    issued: { "date-parts": [[year]] },
    "container-title": (m['container-title'] || [])[0] || '',
    volume: m.volume, issue: m.issue, page: m.page,
    DOI: m.DOI, URL: m.URL,
    id: m.DOI || m.URL || m.title // keep something as id fallback
  };
}

// Extract DOIs from free text (used to mine uploaded Sources)
export function extractDois(text){
  const out = new Set();
  const re = /\b10\.\d{4,9}\/[^\s"'<>()]+/gi;
  let m;
  const s = String(text || '');
  while ((m = re.exec(s))) out.add(m[0].replace(/[).,;]+$/, ''));
  return Array.from(out);
}

// Crossref search with optional date filters (single canonical definition)
export async function searchCrossref(query, rows = 5, from = null, until = null) {
  const params = new URLSearchParams();
  params.set('query', query);
  params.set('rows', String(rows));
  params.set('select', 'DOI,title,author,issued,container-title,URL,volume,issue,page,type');
  params.set('sort', 'score');
  params.set('order', 'desc');
  const filters = ['type:journal-article'];
  if (from)  filters.push(`from-pub-date:${from}`);
  if (until) filters.push(`until-pub-date:${until}`);
  params.set('filter', filters.join(','));
  const url = `https://api.crossref.org/works?${params.toString()}`;
  const { data } = await axios.get(url);
  return (data?.message?.items || []).map(toCSLJSON);
}

// Run two searches: recent + foundational, then dedupe
export async function searchCrossrefDiverse(query, rowsRecent = 4, rowsOld = 3) {
  const [recent, old] = await Promise.all([
    searchCrossref(query, rowsRecent, '2018-01-01', null),
    searchCrossref(query, rowsOld, '2005-01-01', '2015-12-31')
  ]);
  const map = new Map();
  [...recent, ...old].forEach(it => {
    const key = (it.DOI ? `doi:${it.DOI}` : it.title || Math.random()).toLowerCase();
    if (!map.has(key)) map.set(key, it);
  });
  return Array.from(map.values());
}
