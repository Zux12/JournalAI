import React from 'react';
import { useProjectState } from '../../app/state.jsx';
import { fetchByDOI, fetchByPMID, fetchByArXiv } from '../../lib/refs.js';
import { mergeReferences } from '../../lib/refFormat.js';

export default function References(){
  const { project, setReferences } = useProjectState();
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);

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

  const items = project.references?.items || [];

  return (
    <div className="card">
      <h2>References</h2>
      <div className="row cols-2">
        <input className="input" placeholder="Enter DOI / PMID / arXiv" value={input} onChange={e=>setInput(e.target.value)}/>
        <div style={{display:'flex', gap:8}}>
          <button onClick={()=>add('doi')} disabled={busy}>Add DOI</button>
          <button onClick={()=>add('pmid')} disabled={busy}>Add PMID</button>
          <button onClick={()=>add('arxiv')} disabled={busy}>Add arXiv</button>
        </div>
      </div>

      <div style={{marginTop:12}}>
        {items.map((it,i)=>(
          <div key={i} className="card">
            <div><strong>{(it.author?.[0]?.family) || 'Author'}</strong> {it.issued?.['date-parts']?.[0]?.[0] || 'Year'} — {it.title}</div>
            <div style={{color:'#667'}}>{it['container-title']}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
