import React from 'react';
import { fetchByDOI, fetchByPMID, fetchByArXiv } from '../../lib/refs.js';

export default function References(){
  const [items, setItems] = React.useState([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function addDOI(){
    if(!input.trim()) return;
    setBusy(true);
    try{
      const entry = await fetchByDOI(input.trim());
      setItems(prev=>[...prev, entry]);
      setInput('');
    } finally { setBusy(false); }
  }
  async function addPMID(){
    if(!input.trim()) return;
    setBusy(true);
    try{
      const entry = await fetchByPMID(input.trim());
      setItems(prev=>[...prev, entry]);
      setInput('');
    } finally { setBusy(false); }
  }
  async function addArXiv(){
    if(!input.trim()) return;
    setBusy(true);
    try{
      const entry = await fetchByArXiv(input.trim());
      setItems(prev=>[...prev, entry]);
      setInput('');
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2>References</h2>
      <div className="row cols-2">
        <input className="input" placeholder="Enter DOI / PMID / arXiv" value={input} onChange={e=>setInput(e.target.value)}/>
        <div style={{display:'flex', gap:8}}>
          <button onClick={addDOI} disabled={busy}>Add DOI</button>
          <button onClick={addPMID} disabled={busy}>Add PMID</button>
          <button onClick={addArXiv} disabled={busy}>Add arXiv</button>
        </div>
      </div>
      <div style={{marginTop:12}}>
        {items.map((it,i)=>(
          <div key={i} className="card">
            <div><strong>{it.author?.[0]?.family || 'Author'}</strong> {it.issued?.['date-parts']?.[0]?.[0] || 'Year'} — {it.title}</div>
            <div style={{color:'#667'}}>{it['container-title']}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
