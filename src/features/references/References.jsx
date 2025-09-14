import React from 'react';
import { useProjectState } from '../../app/state.jsx';
import { fetchByDOI, fetchByPMID, fetchByArXiv } from '../../lib/refs.js';
import { mergeReferences, ensureRefIds, formatBibliographyCitedOnly } from '../../lib/refFormat.js';
import { refKey, dedupeRefs, sentenceCaseTitle } from '../../lib/refUtils.js';

export default function References(){
  const { project, setReferences } = useProjectState();
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const items = ensureRefIds(project.references?.items || []);

  async function add(kind){
    if(!input.trim()) return;
    setBusy(true);
    try{
      const t = input.trim();
      let entry = null;
      if (kind==='doi')   entry = await fetchByDOI(t);
      if (kind==='pmid')  entry = await fetchByPMID(t);
      if (kind==='arxiv') entry = await fetchByArXiv(t);
      const merged = mergeReferences(project.references, [entry]);
      setReferences(merged);
      setInput('');
    } finally { setBusy(false); }
  }

  function onFieldChange(idx, field, value){
    const next = items.map((it,i)=> i===idx ? { ...it, [field]: value } : it);
    setReferences({ ...(project.references||{ styleId: project.styleId }), items: next });
  }

  function onAuthorChange(idx, iAuth, field, value){
    const next = items.map((it,i)=>{
      if (i!==idx) return it;
      const auth = Array.isArray(it.author) ? it.author.slice() : [];
      const cur = auth[iAuth] || { family:'', given:'' };
      auth[iAuth] = { ...cur, [field]: value };
      return { ...it, author: auth };
    });
    setReferences({ ...(project.references||{ styleId: project.styleId }), items: next });
  }

  function addAuthor(idx){
    const next = items.map((it,i)=>{
      if (i!==idx) return it;
      const auth = Array.isArray(it.author) ? it.author.slice() : [];
      auth.push({ family:'', given:'' });
      return { ...it, author: auth };
    });
    setReferences({ ...(project.references||{ styleId: project.styleId }), items: next });
  }

  function remove(idx){
    const next = items.filter((_,i)=> i!==idx);
    setReferences({ ...(project.references||{ styleId: project.styleId }), items: next });
  }

  function mergeDuplicates(){
    const unique = dedupeRefs(items);
    setReferences({ ...(project.references||{ styleId: project.styleId }), items: unique });
    alert(`Merged duplicates. ${items.length} → ${unique.length}`);
  }

  function fixTitles(){
    const next = items.map(it => ({ ...it, title: sentenceCaseTitle(it.title || '') }));
    setReferences({ ...(project.references||{ styleId: project.styleId }), items: next });
  }

  function exportRefs(all = true){
    // cited-only or all
    let text = '';
    if (all) {
      // simple plain list with [n] labels in current order
      text = items.map((it,i)=>{
        const fams = (it.author||[]).map(a=> a.family ? `${a.family} ${a.given? a.given[0]+'.' : ''}` : (a.literal||'')).filter(Boolean).join(', ');
        const yr = it?.issued?.['date-parts']?.[0]?.[0] || '';
        const cont = it['container-title'] || '';
        const vol = it.volume ? ` ${it.volume}` : '';
        const issue = it.issue ? `(${it.issue})` : '';
        const pages = it.page ? `:${it.page}` : '';
        const doi = it.DOI ? ` doi:${it.DOI}` : (it.URL ? ` ${it.URL}` : '');
        return `[${i+1}] ${fams}. ${it.title}. ${cont}${vol}${issue}${pages} (${yr}).${doi}`;
      }).join('\n');
    } else {
      const citedSet = new Set();
      Object.values(project.sections || {}).forEach(sec => (sec?.citedKeys || []).forEach(k => citedSet.add(String(k).toLowerCase())));
      const citedKeys = Array.from(citedSet);
      text = formatBibliographyCitedOnly(project.styleId, project.references || {}, citedKeys);
    }
    download(all ? 'references_all.txt' : 'references_cited.txt', text || '—');
  }

  function download(name, text){
    const blob = new Blob([text], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=name; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card">
      <h2>References</h2>
      <div className="row cols-2">
        <input className="input" placeholder="Enter DOI / PMID / arXiv" value={input} onChange={e=>setInput(e.target.value)}/>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <button onClick={()=>add('doi')} disabled={busy}>Add DOI</button>
          <button onClick={()=>add('pmid')} disabled={busy}>Add PMID</button>
          <button onClick={()=>add('arxiv')} disabled={busy}>Add arXiv</button>
          <button onClick={mergeDuplicates}>Merge Duplicates</button>
          <button onClick={fixTitles}>Fix Titles (Sentence Case)</button>
          <button onClick={()=>exportRefs(false)}>Export Cited-only</button>
          <button onClick={()=>exportRefs(true)}>Export All</button>
        </div>
      </div>

      <div style={{marginTop:12}}>
        {items.length === 0 && <div className="warn">No references yet. Add via DOI/PMID/arXiv or from Q&A auto-suggestions.</div>}
        {items.map((it, idx)=>(
          <div key={idx} className="card">
            <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
              <strong>[{idx+1}]</strong>
              <code style={{opacity:.7}}>{refKey(it)}</code>
              <div style={{marginLeft:'auto', display:'flex', gap:8}}>
                <button onClick={()=>remove(idx)}>Delete</button>
              </div>
            </div>

            <div className="row cols-2" style={{marginTop:8}}>
              <div>
                <label>Title</label>
                <input className="input" value={it.title || ''} onChange={e=>onFieldChange(idx,'title', e.target.value)} />
              </div>
              <div>
                <label>Journal / Container</label>
                <input className="input" value={it['container-title'] || ''} onChange={e=>onFieldChange(idx,'container-title', e.target.value)} />
              </div>
            </div>

            <div className="row cols-2" style={{marginTop:8}}>
              <div>
                <label>Year</label>
                <input className="input" value={it?.issued?.['date-parts']?.[0]?.[0] || ''} onChange={e=>{
                  const y = e.target.value.replace(/\D/g,'').slice(0,4);
                  const issued = { 'date-parts': [[ y ? Number(y) : '' ]] };
                  onFieldChange(idx, 'issued', issued);
                }} />
              </div>
              <div>
                <label>DOI</label>
                <input className="input" value={it.DOI || ''} onChange={e=>onFieldChange(idx,'DOI', e.target.value)} />
              </div>
            </div>

            <div className="row cols-3" style={{marginTop:8}}>
              <div>
                <label>Volume</label>
                <input className="input" value={it.volume || ''} onChange={e=>onFieldChange(idx,'volume', e.target.value)} />
              </div>
              <div>
                <label>Issue</label>
                <input className="input" value={it.issue || ''} onChange={e=>onFieldChange(idx,'issue', e.target.value)} />
              </div>
              <div>
                <label>Pages</label>
                <input className="input" value={it.page || ''} onChange={e=>onFieldChange(idx,'page', e.target.value)} />
              </div>
            </div>

            <div style={{marginTop:8}}>
              <label>Authors</label>
              <div style={{display:'grid', gap:6}}>
                {(it.author || []).map((a,i)=>(
                  <div key={i} className="row cols-2">
                    <input className="input" placeholder="Family (Surname)" value={a.family || ''} onChange={e=>onAuthorChange(idx, i, 'family', e.target.value)} />
                    <input className="input" placeholder="Given (Initials)" value={a.given || ''} onChange={e=>onAuthorChange(idx, i, 'given', e.target.value)} />
                  </div>
                ))}
              </div>
              <button style={{marginTop:6}} onClick={()=>addAuthor(idx)}>+ Add Author</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
