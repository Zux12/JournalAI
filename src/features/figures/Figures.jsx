import React from 'react';
import axios from 'axios';
import { useProjectState } from '../../app/state.jsx';

export default function Figures(){
  const { project, update, setFigures, setTables, setSectionDraft, setVisualProposals, setVisualPlacements } = useProjectState();
  const [mode, setMode] = React.useState('figure'); // figure|table
  const sections = (project.planner?.sections || []).filter(s => !s.skipped && s.id!=='refs');

  const figs = project.figures || [];
  const tabs = project.tables  || [];
  const [busyCap, setBusyCap] = React.useState({}); // id -> boolean

    // Proposals from manuscript (Results/Discussion)
  const [vizBusy, setVizBusy] = React.useState(false);
  const [vizLen, setVizLen] = React.useState('medium'); // short|medium|long
  const [vizCount, setVizCount] = React.useState(3);
  const proposals = project.visualProposals || [];

  // Per-item placement suggestions
  const [placing, setPlacing] = React.useState({});     // id -> bool
  const [placements, setPlacements] = React.useState({});// id -> { placement, paragraphs }


  function slugId(name='item'){
    return name.toLowerCase().replace(/[^a-z0-9\-]+/g,'-').replace(/(^-+|-+$)/g,'').slice(0,32) || `item-${Date.now()}`;
  }

function addItem(files){
  const arr = Array.from(files || []);
  if (!arr.length) return;

  arr.forEach(async (f) => {
    const isImage = /^image\/(png|jpeg|jpg|svg\+xml)$/.test(f.type) || /\.(png|jpe?g|svg)$/i.test(f.name);
    const isCsv   = /text\/csv/.test(f.type) || /\.csv$/i.test(f.name);

    if (mode === 'figure' && isImage) {
      // 600px thumbnail
      const thumbDataUrl = await genThumb600(f);
      const next = [...(project.figures||[]), {
        id: slugId(f.name),
        name: f.name,
        caption: '',
        variables: '',
        notes: '',
        thumbDataUrl // persisted preview
      }];
      setFigures(next);
    } else if (mode === 'table' && isCsv) {
      const { columns, sampleRows } = await parseFirstRows50(f);
      const next = [...(project.tables||[]), {
        id: slugId(f.name),
        name: f.name,
        caption: '',
        variables: '',
        notes: '',
        columns,
        sampleRows
      }];
      setTables(next);
    } else {
      alert(`Unsupported file for current type.\nCurrent type: ${mode}\nFile: ${f.name}`);
    }
  });
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

  function manuscriptSections() {
    const order = (project.planner?.sections || []).filter(s=>!s.skipped && s.id!=='refs');
    return order.map(s => ({ name: s.name, id: s.id, text: project.sections?.[s.id]?.draft || '' }));
  }

  function getSectionIdByName(name){
    const s = (project.planner?.sections || []).find(x => x.name.toLowerCase() === String(name||'').toLowerCase());
    return s?.id || null;
  }

  function insertAfterAnchor(draft, anchor, insertion){
    if (!anchor) return (draft ? (draft + '\n\n' + insertion) : insertion);
    const idx = draft.indexOf(anchor);
    if (idx === -1) return (draft ? (draft + '\n\n' + insertion) : insertion);
    const cut = idx + anchor.length;
    return draft.slice(0, cut) + '\n\n' + insertion + draft.slice(cut);
  }

  function ensureUniqueId(baseId, list){
    let id = baseId;
    const exists = new Set(list.map(x => x.id));
    let n = 2;
    while (exists.has(id)) { id = `${baseId}-${n++}`; }
    return id;
  }

  async function proposeFromManuscript(){
    setVizBusy(true);
    try{
      const secs = manuscriptSections();
      const resText = (secs.find(s=>/^results$/i.test(s.name))?.text || '').slice(0,4000);
      const discText = (secs.find(s=>/^discussion$/i.test(s.name))?.text || '').slice(0,4000);
      const { data } = await axios.post('/api/ai/propose-visuals', {
        title: project.metadata?.title || '',
        discipline: project.metadata?.discipline || '',
        resultsText: resText,
        discussionText: discText,
        length: vizLen,
        maxItems: vizCount,
        allowExternal: false
      });
      setVisualProposals(Array.isArray(data?.proposals) ? data.proposals : []);

    } finally {
      setVizBusy(false);
    }
  }

  function applyProposalCreate(p){
    if (p.kind === 'table') {
      const unique = ensureUniqueId(p.id || 'table', tabs);
      setTables([...(project.tables||[]), { id: unique, name: `${unique}.csv`, caption: p.caption || '', variables: p.variables || '', notes: '' }]);
      alert(`Table placeholder created (${unique}). Use {tab:${unique}} to reference.`);
    } else {
      const unique = ensureUniqueId(p.id || 'figure', figs);
      setFigures([...(project.figures||[]), { id: unique, name: `${unique}.png`, caption: p.caption || '', variables: p.variables || '', notes: '' }]);
      alert(`Figure placeholder created (${unique}). Use {fig:${unique}} to reference.`);
    }
  }

  function applyProposalInsert(p){
    const secId = getSectionIdByName(p.placement?.section);
    if (!secId) return alert('Suggested section not found.');
    const token = p.kind === 'table' ? `{tab:${p.id}}` : `{fig:${p.id}}`;
    const existing = project.sections?.[secId]?.draft || '';
    const insertion = `${token}\n\n${(p.paragraphs && p.paragraphs[0]) || ''}`.trim();
    const next = insertAfterAnchor(existing, p.placement?.anchor, insertion);
    setSectionDraft(secId, next);
    alert(`Inserted token and paragraph into ${p.placement?.section}.`);
  }

  async function autoPlaceItem(kind, item){
    setPlacing(prev => ({ ...prev, [item.id]: true }));
    try{
      const secs = manuscriptSections();
      const { data } = await axios.post('/api/ai/place-visual', {
        title: project.metadata?.title || '',
        discipline: project.metadata?.discipline || '',
        kind,
        id: item.id,
        variables: item.variables || '',
        notes: item.notes || '',
        caption: item.caption || '',
        manuscriptSections: secs,
        length: 'medium'
      });
 if (data?.suggestion) {
  setPlacements(prev => ({ ...prev, [item.id]: data.suggestion }));
  update(p => ({
    ...p,
    visualPlacements: { ...(p.visualPlacements || {}), [item.id]: data.suggestion }
  }));
} 
 else {
  setPlacements(prev => ({ ...prev, [item.id]: null }));
  update(p => {
    const next = { ...(p.visualPlacements || {}) };
    delete next[item.id];
    return { ...p, visualPlacements: next };
  });
}

     finally {
      setPlacing(prev => ({ ...prev, [item.id]: false }));
    }
  }

async function genThumb600(file){
  // SVG: read as text and return data URL directly (no rasterize)
  if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
    const txt = await file.text();
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(txt)));
  }
  // Raster images
  const img = await new Promise((res,rej)=>{ const im = new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=URL.createObjectURL(file); });
  const scale = 600 / Math.max(img.width, img.height);
  const w = Math.round(img.width * Math.min(1, scale));
  const h = Math.round(img.height * Math.min(1, scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const url = canvas.toDataURL('image/jpeg', 0.9); // lean but sharp
  URL.revokeObjectURL(img.src);
  return url;
}

async function parseFirstRows50(file){
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length>0);
  const headers = lines[0].split(',').map(h=>h.trim());
  const rows = [];
  for (let i=1; i<lines.length && rows.length<50; i++){
    rows.push(lines[i].split(',').map(c=>c.trim()));
  }
  return { columns: headers, sampleRows: rows };
}


function applyPlacement(item, modeSel){
  const sugg = placements[item.id] || project.visualPlacements?.[item.id];
  if (!sugg) return alert('No placement suggestion yet.');
  const secId = getSectionIdByName(sugg.placement?.section);
  if (!secId) return alert('Suggested section not found.');

  const token = mode === 'table' ? `{tab:${item.id}}` : `{fig:${item.id}}`;
  const para  = (sugg.paragraphs && sugg.paragraphs[0]) ? sugg.paragraphs[0] : '';
  const existing = project.sections?.[secId]?.draft || '';

  let insertion = '';
  if (modeSel === 'token+writeup') insertion = (token + (para ? `\n\n${para}` : ''));
  else if (modeSel === 'token') insertion = token;
  else if (modeSel === 'notes') {
    // notes only → do not alter draft, append to Notes for that section (so user can approve later)
    const prevNotes = project.sections?.[secId]?.notes || '';
    const combined = prevNotes ? (prevNotes + '\n\n' + para) : para;
    setSectionNotesFor(secId, combined);
    return alert('Write-up added to Notes for this section.');
  }

  const next = insertAfterAnchor(existing, sugg.placement?.anchor, insertion);
  setSectionDraft(secId, next);
  alert('Applied placement to draft.');
}

  function setSectionNotesFor(id, notes){
  // reuse your state updater for section notes if available; fallback: inline update
  if (typeof setSectionNotes === 'function') return setSectionNotes(id, notes);
  // Fallback (if you don’t have setSectionNotes here):
  // setSectionDraft(id, (project.sections?.[id]?.draft || '') + '\n\n' + notes);
}


  
  
  return (
    <div className="card">
      <h2>Figures & Tables</h2>

      <div style={{fontSize:12, color:'#667', margin:'4px 0 8px'}}>
  Preview notes: Images use a <strong>600px thumbnail</strong> (kept small for fast previews). Allowed image formats: <strong>PNG, JPG, SVG</strong>.<br/>
  Table preview shows the <strong>first 50 rows</strong> for uploaded CSVs (for larger tables, use full export).
</div>
      

{/* Propose visuals from manuscript */}
<div className="card" style={{marginTop:8}}>
  <div style={{display:'flex', gap:12, alignItems:'end', flexWrap:'wrap'}}>
    <div>
      <label>Length</label>
      <select className="input" value={vizLen} onChange={e=>setVizLen(e.target.value)}>
        <option value="short">Short</option>
        <option value="medium">Medium</option>
        <option value="long">Long</option>
      </select>
    </div>
    <div>
      <label>Suggestions</label>
      <select className="input" value={vizCount} onChange={e=>setVizCount(Number(e.target.value)||3)}>
        <option value="3">3</option>
        <option value="5">5</option>
        <option value="7">7</option>
      </select>
    </div>
    <button className="btn" onClick={proposeFromManuscript} disabled={vizBusy}>
      {vizBusy ? 'Analyzing…' : 'Propose visuals from manuscript'}
    </button>

    <button onClick={()=>setVisualProposals([])} disabled={vizBusy}>Clear proposals</button>

  </div>

  {/* Render proposals */}
  {proposals.length > 0 && (
    <div style={{marginTop:10}}>
      {proposals.map((p,i)=>(
        <div key={i} className="card" style={{padding:'12px'}}>
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <span className="badge">{p.kind === 'table' ? 'Table' : 'Figure'}</span>
            <strong>{p.title || '(untitled)'}</strong>
            <code style={{opacity:.7}}>{p.id}</code>
            <span style={{marginLeft:'auto', color:'#667'}}>Place: {p.placement?.section || '—'} → after “{(p.placement?.anchor || '').slice(0,80)}”</span>
          </div>
          <div style={{marginTop:6, color:'#111'}}><em>Caption skeleton:</em> {p.caption || '—'}</div>
          <div style={{marginTop:6, color:'#111'}}><em>Variables:</em> {p.variables || '—'}</div>
          <div style={{marginTop:6, whiteSpace:'pre-wrap'}}>{(p.paragraphs && p.paragraphs[0]) || ''}</div>
          <div style={{display:'flex', gap:8, marginTop:8}}>
            <button onClick={()=>applyProposalCreate(p)}>Create placeholder</button>
            <button className="btn" onClick={()=>applyProposalInsert(p)}>Insert token + write-up</button>
          </div>
        </div>
      ))}
    </div>
  )}
</div>


      
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

            {/* Preview block */}
{mode==='figure' && it.thumbDataUrl && (
  <div style={{marginTop:8}}>
    <label style={{display:'block', color:'#667'}}>Preview (600px thumbnail)</label>
    <img src={it.thumbDataUrl} alt={it.name} style={{maxWidth:'600px', width:'100%', border:'1px solid #e5e7eb', borderRadius:8}} />
  </div>
)}
{mode==='table' && Array.isArray(it.sampleRows) && it.sampleRows.length > 0 && (
  <div style={{marginTop:8}}>
    <label style={{display:'block', color:'#667'}}>Preview (first 50 rows)</label>
    <div style={{overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8}}>
      <table style={{minWidth:480, borderCollapse:'collapse', fontSize:13}}>
        <thead>
          <tr>
            {(it.columns||[]).map((c,ci)=><th key={ci} style={{textAlign:'left', padding:'6px', borderBottom:'1px solid #e5e7eb'}}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {it.sampleRows.map((r,ri)=>(
            <tr key={ri} style={{borderTop:'1px solid #f1f5f9'}}>
              {r.map((cell,ci)=><td key={ci} style={{padding:'6px'}}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}


            <<div style={{display:'flex', gap:8, alignItems:'center', marginTop:8, flexWrap:'wrap'}}>
  <button onClick={()=>autoPlaceItem(mode, it)} disabled={!!placing[it.id]}>
    {placing[it.id] ? 'Analyzing placement…' : 'Auto-placement Assist'}
  </button>
  {!!placements[it.id] && (
    <>
      <span style={{color:'#667'}}>
        Suggest: {placements[it.id]?.placement?.section || '—'} → after “{(placements[it.id]?.placement?.anchor || '').slice(0,60)}…”
      </span>
      <button className="btn" onClick={()=>applyPlacement(it, 'token+writeup')}>Insert token + write-up</button>
      <button onClick={()=>applyPlacement(it, 'token')}>Just token</button>
      <button onClick={()=>applyPlacement(it, 'notes')}>Just write-up to Notes</button>
      <span style={{fontSize:12, color:'#667'}}>Default recommended: <strong>Insert token + write-up</strong></span>
    </>
  )}
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
