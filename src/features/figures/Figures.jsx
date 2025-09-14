import React from 'react';
import { useProjectState } from '../../app/state.jsx';

export default function Figures(){
  const { project, setFigures, setTables, setSectionDraft } = useProjectState();
  const [mode, setMode] = React.useState('figure'); // figure|table
  const sections = (project.planner?.sections || []).filter(s => !s.skipped && s.id!=='refs');

  const figs = project.figures || [];
  const tabs = project.tables  || [];

  function addItem(files){
    const arr = Array.from(files || []);
    if (!arr.length) return;
    if (mode === 'figure') {
      const next = [...figs, ...arr.map(f => ({
        id: slugId(f.name),
        name: f.name,
        caption: ''
      }))];
      setFigures(next);
    } else {
      const next = [...tabs, ...arr.map(f => ({
        id: slugId(f.name),
        name: f.name,
        caption: ''
      }))];
      setTables(next);
    }
  }
  function slugId(name='item'){
    return name.toLowerCase().replace(/[^a-z0-9\-]+/g,'-').replace(/(^-+|-+$)/g,'').slice(0,32) || `item-${Date.now()}`;
  }
  function setCap(kind, id, v){
    if (kind==='figure') setFigures(figs.map(x => x.id===id ? { ...x, caption:v } : x));
    else setTables(tabs.map(x => x.id===id ? { ...x, caption:v } : x));
  }
  function copyToken(kind, id){
    const token = kind==='figure' ? `{fig:${id}}` : `{tab:${id}}`;
    navigator.clipboard.writeText(token);
    alert(`Copied ${token} — paste into any section draft.`);
  }
  function insertIntoSection(kind, id, secId){
    const token = kind==='figure' ? `{fig:${id}}` : `{tab:${id}}`;
    const prev = project.sections?.[secId]?.draft || '';
    const next = (prev ? prev + ' ' : '') + token;
    setSectionDraft(secId, next);
    alert(`Inserted ${token} into ${secId}.`);
  }

  return (
    <div className="card">
      <h2>Figures & Tables</h2>

      <div className="row cols-2" style={{alignItems:'end'}}>
        <div>
          <label>Type</label>
          <select className="input" value={mode} onChange={e=>setMode(e.target.value)}>
            <option value="figure">Figure</option>
            <option value="table">Table</option>
          </select>
        </div>
        <div>
          <label>Upload (names become IDs; you can edit captions below)</label>
          <input type="file" multiple onChange={e=>addItem(e.target.files)} />
        </div>
      </div>

      <div style={{marginTop:12}}>
        {(mode==='figure' ? figs : tabs).map((it, idx)=>(
          <div key={it.id} className="card">
            <div style={{display:'flex', gap:8, alignItems:'center'}}>
              <strong>{mode==='figure' ? 'Figure' : 'Table'} ID:</strong>
              <code>{it.id}</code>
              <span style={{color:'#667'}}>({it.name})</span>
              <div style={{marginLeft:'auto', display:'flex', gap:8}}>
                <button onClick={()=>copyToken(mode==='figure'?'figure':'table', it.id)}>Copy token</button>
                <select id={`sec-${mode}-${it.id}`} className="input" style={{width:220}}>
                  <option value="">Insert into section…</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={()=>{
                  const sel = document.getElementById(`sec-${mode}-${it.id}`);
                  if (sel?.value) insertIntoSection(mode==='figure'?'figure':'table', it.id, sel.value);
                }}>Insert</button>
              </div>
            </div>
            <label style={{marginTop:8}}>Caption</label>
            <input className="input" value={it.caption||''} onChange={e=>setCap(mode==='figure'?'figure':'table', it.id, e.target.value)} placeholder="Enter caption shown in List of Figures/Tables"/>
          </div>
        ))}
        {((mode==='figure' ? figs : tabs).length===0) && (
          <div className="warn" style={{marginTop:8}}>
            No {mode==='figure'?'figures':'tables'} yet. Upload files or create entries.
          </div>
        )}
      </div>
    </div>
  );
}
