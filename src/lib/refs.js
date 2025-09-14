import axios from 'axios';

// Very light resolvers; you can harden later.

export async function fetchByDOI(doi){
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const { data } = await axios.get(url);
  return toCSLJSON(data.message);
}

export async function fetchByPMID(pmid){
  const url = `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/?format=pubmed`;
  const { data } = await axios.get(url); // parsing pubmed is non-trivial; stub as minimal
  // For MVP you may switch to E-Utilities (esummary) JSON; here we return a minimal entry:
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
  // Simple arXiv API
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;
  const { data } = await axios.get(url);
  // TODO: parse Atom XML properly; for now return minimal
  return {
    type:"article-journal",
    title:`arXiv:${id}`,
    author:[{ family:"Unknown", given:"" }],
    issued:{ "date-parts":[[new Date().getFullYear()]] },
    "container-title":"arXiv",
    id
  };
}

function toCSLJSON(m){
  const authors = (m.author||[]).map(a=>({ family:a.family, given:a.given }));
  return {
    type: m.type || 'article-journal',
    title: m.title instanceof Array ? m.title[0] : m.title,
    author: authors,
    issued: { "date-parts":[[ Number(m['published-print']?.['date-parts']?.[0]?.[0] || m.created?.['date-parts']?.[0]?.[0] || new Date().getFullYear() ) ]] },
    "container-title": (m['container-title']||[])[0] || '',
    volume: m.volume, issue: m.issue, page: m.page,
    DOI: m.DOI, URL: m.URL
  };
}
