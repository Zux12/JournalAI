import React from 'react';
import axios from 'axios';
import { useProjectState } from '../../app/state.js';

export default function Metadata(){
  const { project, setMetadata } = useProjectState();
  const [title, setTitle] = React.useState(project.metadata.title || '');
  const [discipline, setDiscipline] = React.useState(project.metadata.discipline || '');
  const [keywords, setKeywords] = React.useState(project.metadata.keywords || []);
  const [busy, setBusy] = React.useState(false);

  const save = ()=> setMetadata({ ...project.metadata, title, discipline, keywords });

  async function suggestKeywords(){
    try{
      setBusy(true);
      const { data } = await axios.post('/api/ai/keywords', { title, discipline, abstract:'', seedKeywords:keywords });
      setKeywords(data.suggestions || []);
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2>Metadata</h2>
      <div className="row cols-2">
        <div>
          <label>Title</label>
          <input className="input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Enter your working title"/>
        </div>
        <div>
          <label>Discipline</label>
          <input className="input" value={discipline} onChange={e=>setDiscipline(e.target.value)} placeholder="e.g., Tissue Engineering"/>
        </div>
      </div>
      <div style={{marginTop:12}}>
        <label>Keywords</label>
        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:6}}>
          {keywords.map((k,i)=>(<span key={i} className="badge" onClick={()=>setKeywords(keywords.filter((_,j)=>j!==i))} style={{cursor:'pointer'}}>{k} ✕</span>))}
        </div>
        <div style={{display:'flex', gap:8, marginTop:8}}>
          <button className="btn" onClick={suggestKeywords} disabled={busy}>{busy?'Suggesting…':'Suggest Keywords'}</button>
          <button onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
