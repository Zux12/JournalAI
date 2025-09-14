import React from 'react';
import axios from 'axios';
import { useProjectState } from '../../app/state.jsx';

export default function Metadata(){
  const { project, setMetadata } = useProjectState();
  const md = project.metadata || {};

  const [title, setTitle] = React.useState(md.title || '');
  const [discipline, setDiscipline] = React.useState(md.discipline || '');
  const [keywords, setKeywords] = React.useState(md.keywords || []);
  const [authors, setAuthors] = React.useState(md.authors && md.authors.length ? md.authors : [
    { name:'', affiliation:'', email:'', orcid:'', isCorresponding:true }
  ]);
  const [busy, setBusy] = React.useState(false);

  function save(){
    setMetadata({ ...project.metadata, title, discipline, keywords, authors });
  }

  async function suggestKeywords(){
    try{
      setBusy(true);
      const { data } = await axios.post('/api/ai/keywords', { title, discipline, abstract:'', seedKeywords:keywords });
      setKeywords(data.suggestions || []);
    } finally { setBusy(false); }
  }

  function addAuthor(){
    setAuthors(prev => [...prev, { name:'', affiliation:'', email:'', orcid:'', isCorresponding:false }]);
  }
  function removeAuthor(i){
    setAuthors(prev => prev.filter((_,idx)=>idx!==i));
  }
  function setAuthor(i, field, value){
    setAuthors(prev => prev.map((a,idx)=> idx===i ? { ...a, [field]: value } : a));
  }
  function setCorresponding(i){
    setAuthors(prev => prev.map((a,idx)=> ({ ...a, isCorresponding: idx===i })));
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
          {keywords.map((k,i)=>(
            <span key={i} className="badge" title="Click to remove" onClick={()=>setKeywords(keywords.filter((_,j)=>j!==i))} style={{cursor:'pointer'}}>
              {k} ✕
            </span>
          ))}
        </div>
        <div style={{display:'flex', gap:8, marginTop:8}}>
          <button className="btn" onClick={suggestKeywords} disabled={busy}>{busy?'Suggesting…':'Suggest Keywords'}</button>
          <button onClick={save}>Save</button>
        </div>
      </div>

      <div className="card" style={{marginTop:16}}>
        <h3>Authors & Affiliations</h3>
        <p style={{color:'#667', marginTop:0}}>Add each author with affiliation and email. Mark exactly one as corresponding.</p>

        {authors.map((a,i)=>(
          <div key={i} className="card" style={{padding:'12px'}}>
            <div className="row cols-2">
              <div>
                <label>Name</label>
                <input className="input" value={a.name} onChange={e=>setAuthor(i,'name',e.target.value)} placeholder="Full name"/>
              </div>
              <div>
                <label>Email</label>
                <input className="input" value={a.email} onChange={e=>setAuthor(i,'email',e.target.value)} placeholder="name@example.com"/>
              </div>
            </div>

            <div className="row cols-2" style={{marginTop:8}}>
              <div>
                <label>Affiliation</label>
                <input className="input" value={a.affiliation} onChange={e=>setAuthor(i,'affiliation',e.target.value)} placeholder="Dept, University, City, Country"/>
              </div>
              <div>
                <label>ORCID (optional)</label>
                <input className="input" value={a.orcid||''} onChange={e=>setAuthor(i,'orcid',e.target.value)} placeholder="0000-0000-0000-0000"/>
              </div>
            </div>

            <div style={{marginTop:8, display:'flex', gap:12, alignItems:'center'}}>
              <label><input type="radio" name="corresponding" checked={!!a.isCorresponding} onChange={()=>setCorresponding(i)} /> Corresponding author</label>
              <div style={{marginLeft:'auto'}}>
                {authors.length>1 && <button onClick={()=>removeAuthor(i)}>Remove</button>}
              </div>
            </div>
          </div>
        ))}

        <div style={{display:'flex', gap:8}}>
          <button onClick={addAuthor}>+ Add Author</button>
          <button className="btn" onClick={save}>Save Authors</button>
        </div>
      </div>
    </div>
  );
}
