import React from 'react';
import axios from 'axios';
import { useProjectState } from '../../app/state.jsx';

export default function Figures(){
  const { project, setFigures, setTables, setSectionDraft } = useProjectState();
  const [mode, setMode] = React.useState('figure'); // figure|table
  const sections = (project.planner?.sections || []).filter(s => !s.skipped && s.id!=='refs');

  const figs = project.figures || [];
  const tabs = project.tables  || [];
  const [busyCap, setBusyCap] = React.useState({}); // id -> boolean

  function slugId(name='item'){
    return name.toLowerCase().replace(/[^a-z0-9\-]+/g,'-').replace(/(^-+|-+$)/g,'').slice(0,32) || `item-${Date.now()}`;
  }

  function addItem(files){
    const arr = Array.from(files || []);
    if (!arr.length) return;
    if (mode === 'figure') {
      const next = [...figs, ...arr.map(f => ({
        id: slugId(f.name),
        name: f.name,
        caption: '',
        variables: '',
        notes: ''
      }))];
      setFigures(next);
    } else {
      const next = [...tabs, ...arr.map(f => ({
        id: slugId(f.name),
        name: f.name,
        caption: '',
        variables: '',
        notes: ''
      }))];
      setTables(next);
    }
  }

  function setField(kind, id, field, value){
    if (kind==='figure') {
      setFigures((project.figures||[]).map(x => x.id===id ? { ...x, [field]: value } : x));
    } else {
      setTables((project.tables||[]).map(x => x.id===id ? { ...x, [field]: value } : x));
    }
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

  async function aiCaption(kind, it){
    try{
      setBusyCap(prev => ({ ...prev, [it.id]: true }));
      const { data } = await axios.post('/api/ai/caption', {
        kind,
        id: it.id,
        filename: it.name,
        title: project.metadata?.title || '',
        discipline: project.metadata?.discipline || '',
        variables: it.variables || '',
        notes: it.notes || ''
      });
      const cap = (data?.caption || '').trim();
      if (!cap) return;
      setField(kind, it.id, 'caption', cap);
    } catch (e) {
      alert('AI Caption failed.');
    } finally {
      setBusyCap(prev => ({ ...prev, [it.id]: false }));
    }
  }

  const list = mode==='figure' ? figs : tabs;

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
        {list.map((it)=>(
          <div key={it.id} className="card">
            <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
              <strong>{mode==='figure' ? 'Figure' : 'Table'} ID:</strong>
              <code>{it.id}</code>
              <span style={{color:'#667'}}>({it.name})</span>
              <div style={{marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap'}}>
                <button onClick={()=>copyToken(mode, it.id)}>Copy token</button>
                <select id={`sec-${mode}-${it.id}`} className="input" style={{width:220}}>
                  <option value="">Insert into section…</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={()=>{
                  const sel = document.getElementById(`sec-${mode}-${it.id}`);
                  if (sel?.value) insertIntoSection(mode, it.id, sel.value);
                }}>Insert</button>
              </div>
            </div>

            <div className="row cols-2" style={{marginTop:8}}>
              <div>
                <label>Variables / Units (optional)</label>
                <input
                  className="input"
                  value={it.variables || ''}
                  onChange={e=>setField(mode, it.id, 'variables', e.target.value)}
                  placeholder="e.g., Shear rate (s⁻¹), viscosity (Pa·s), n=3"
                />
              </div>
              <div>
                <label>Notes for AI (optional)</label>
                <input
                  className="input"
                  value={it.notes || ''}
                  onChange={e=>setField(mode, it.id, 'notes', e.target.value)}
                  placeholder="What the figure/table shows; context"
                />
              </div>
            </div>

            <label style={{marginTop:8}}>Caption</label>
            <div className="row cols-2" style={{alignItems:'start'}}>
              <textarea
                className="input"
                rows="2"
                value={it.caption || ''}
                onChange={e=>setField(mode, it.id, 'caption', e.target.value)}
                placeholder="Enter caption or use AI Caption"
              />
              <button
                className="btn"
                onClick={()=>aiCaption(mode, it)}
                disabled={!!busyCap[it.id]}
              >
                {busyCap[it.id] ? 'Writing…' : 'AI Caption'}
              </button>
            </div>
          </div>
        ))}
        {list.length===0 && (
          <div className="warn" style={{marginTop:8}}>
            No {mode==='figure'?'figures':'tables'} yet. Upload files or create entries, then use “AI Caption”.
          </div>
        )}
      </div>
    </div>
  );
}
