import React from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjectState } from '../../app/state.jsx';
import { fetchByDOI, fetchByPMID, fetchByArXiv, searchCrossrefDiverse, extractDois } from '../../lib/refs.js';
import { mergeReferences, ensureRefIds, formatInText } from '../../lib/refFormat.js';
import { applyCitations } from '../../lib/citeApply.js';
import { convertAuthorYearToMarkers } from '../../lib/citeSanitize.js';
import { computeSectionStats } from '../../lib/sectionCheck.js';

function parseCitationTokens(raw) {
  const t = String(raw || '').trim();
  if (!t) return [];
  return t.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}
function detectIdsFromText(str){
  const text = String(str || '');
  const tokens = new Set();
  const doiRe = /\b10\.\d{4,9}\/[^\s"'<>()]+/gi; let m;
  while ((m = doiRe.exec(text))) tokens.add(m[0].replace(/[).,;]+$/, ''));
  const pmidTagRe = /\bpmid[:\s]*([0-9]{6,9})\b/gi;
  while ((m = pmidTagRe.exec(text))) tokens.add(`pmid:${m[1]}`);
  const arxivRe = /\barxiv[:\s]*([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)\b/gi;
  while ((m = arxivRe.exec(text))) tokens.add(`arxiv:${m[1]}`);
  const arxivOld = /\barxiv[:\s]*([a-z\-]+(?:\.[a-z\-]+)?\/[0-9]{7}(?:v\d+)?)\b/gi;
  while ((m = arxivOld.exec(text))) tokens.add(`arxiv:${m[1]}`);
  return Array.from(tokens);
}
async function resolveTokenToCSL(token) {
  const low = token.toLowerCase();
  if (low.startsWith('doi:') || low.startsWith('10.')) return await fetchByDOI(low.replace(/^doi:/,''));
  if (low.startsWith('pmid:')) return await fetchByPMID(low.replace(/^pmid:/,''));
  if (low.startsWith('arxiv:')) return await fetchByArXiv(low.replace(/^arxiv:/,''));
  if (/^10\.\d{4,9}\//.test(token)) return await fetchByDOI(token);
  if (/^\d{6,9}$/.test(token)) return await fetchByPMID(token);
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(token)) return await fetchByArXiv(token);
  return { type:'article-journal', title: token, author:[{ family:'Unknown', given:'' }], issued:{ 'date-parts': [[ new Date().getFullYear() ]] }, id: token };
}
function toAIRefStub(entry) {
  const author = entry?.author?.[0];
  const authorName = author?.family || author?.literal || 'Author';
  const year = entry?.issued?.['date-parts']?.[0]?.[0] || '';
  return { key: entry._key, author: authorName, year, title: String(entry.title || '').slice(0, 160) };
}

export default function QnA(){
  const nav = useNavigate();
  const { sectionId } = useParams();
  const { project, setSectionDraft, setSectionDraftRaw, setSectionNotes, setSectionCitedKeys, update } = useProjectState();

  const all = project.planner.sections.filter(s => s.id !== 'refs');
  const active = all.filter(s => !s.skipped);
  const current = all.find(s => s.id === sectionId) || active[0] || all[0] || null;

  React.useEffect(() => {
    if (current && sectionId !== current.id) nav(`/qa/${current.id}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) {
    return (
      <div className="card">
        <h2>Guided Q&A</h2>
        <div className="warn">All sections are skipped. Enable at least one section in the planner.</div>
      </div>
    );
  }

  const id = current.id;
  const [tone, setTone]         = React.useState((project.sections[id]?.tone)  || 'neutral');
  const [notes, setNotes]       = React.useState((project.sections[id]?.notes) || '');
  const [cites, setCites]       = React.useState((project.sections[id]?.cites) || '');
  const [density, setDensity]   = React.useState('dense');         // normal|dense|extra|extreme
  const [lengthPreset, setLen]  = React.useState('extended');      // brief|standard|extended|comprehensive
  const [paragraphs, setParas]  = React.useState(4);
  const draft = project.sections[id]?.draft || '';
  const [busy, setBusy] = React.useState(false);

  // Review modal state
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [suggested, setSuggested] = React.useState([]); // CSL-JSON
  const [selectedKeys, setSelectedKeys] = React.useState([]); // _key list
  const confirmedRefBuffer = React.useRef([]); // pending confirmed refs for accept/skip

  React.useEffect(() => {
    setTone((project.sections[id]?.tone)  || 'neutral');
    setNotes((project.sections[id]?.notes) || '');
    setCites((project.sections[id]?.cites) || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, project.updatedAt]);

  function onNotesChange(v){ setNotes(v); setSectionNotes(id, v); }
  function onCitesChange(v){
    setCites(v);
    update(p => ({ ...p, sections: { ...p.sections, [id]: { ...(p.sections[id]||{}), cites: v } } }));
  }

  const idx = active.findIndex(s => s.id === current.id);
  const prevId = idx > 0 ? active[idx - 1].id : null;
  const nextId = idx >= 0 && idx < active.length - 1 ? active[idx + 1].id : null;

  // === Draft flow with Review Modal ===
  async function startDraftFlow(){
    setBusy(true);
    try{
      // density knobs
      const cfgByDensity = {
        normal:  { rowsRecent:5,  rowsOld:3,  aiCap:10, sourceCap:8  },
        dense:   { rowsRecent:8,  rowsOld:5,  aiCap:12, sourceCap:10 },
        extra:   { rowsRecent:12, rowsOld:8,  aiCap:16, sourceCap:14 },
        extreme: { rowsRecent:16, rowsOld:12, aiCap:20, sourceCap:20 }
      };
      const cfg = cfgByDensity[density] || cfgByDensity.dense;

      // 1) Resolve manual+detected tokens
      const manual = parseCitationTokens(cites);
      const detected = detectIdsFromText(notes);
      const tokens = Array.from(new Set([...manual, ...detected]));
      const confirmed = [];
      for (const t of tokens) { try { confirmed.push(await resolveTokenToCSL(t)); } catch{} }

      // 2) Mine DOIs from Sources
      const sourceDois = new Set();
      (project.sources || []).forEach(s => extractDois(s.text).forEach(d => sourceDois.add(d)));
      for (const d of Array.from(sourceDois).slice(0, cfg.sourceCap)) { try { confirmed.push(await resolveTokenToCSL(d)); } catch {} }

      // 3) Crossref diverse suggestions (to be reviewed)
      let suggestions = [];
      try {
        const q = [project.metadata.title||'', project.metadata.discipline||'', current.name||'', String(notes).slice(0,160)]
          .filter(Boolean).join(' ');
        suggestions = await searchCrossrefDiverse(q, cfg.rowsRecent, cfg.rowsOld);
      } catch {}

      // If there are suggestions, open review modal
      confirmedRefBuffer.current = confirmed;
      if (suggestions.length) {
        // ensure _key for selection
        const withKeys = ensureRefIds(suggestions);
        setSuggested(withKeys);
        setSelectedKeys(withKeys.map(r => r._key)); // default: all selected
        setReviewOpen(true);
      } else {
        // Proceed directly
        await proceedDraft(confirmed, []);
      }
    } finally {
      setBusy(false);
    }
  }

  async function proceedDraft(confirmedRefs, selectedSuggestionKeys){
    // Merge refs
    let refsAfter = null;
    update(p => {
      const selectedSuggestions = (suggested || []).filter(r => selectedSuggestionKeys.includes(r._key));
      const merged = mergeReferences(p.references, [...confirmedRefs, ...selectedSuggestions]);
      refsAfter = merged;
      return { ...p, references: merged };
    });

    // Build diverse AI list
    const cfgByDensity = { normal:10, dense:12, extra:16, extreme:20 };
    const cap = cfgByDensity[density] || 12;
    const allItems = ensureRefIds(refsAfter.items || []);
    const recentBatch = allItems.slice(-32);
    const uniq = [];
    const seen = new Set(); // firstAuthor|year
    for (const it of recentBatch) {
      const fam = (it.author?.[0]?.family || it.author?.[0]?.literal || 'Author').toLowerCase();
      const yr = String(it?.issued?.['date-parts']?.[0]?.[0] || it?.issued?.year || '');
      const k = fam + '|' + yr;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(it);
      if (uniq.length >= cap) break;
    }
    const aiRefs = uniq.map(toAIRefStub);

    // Ask AI
    const { data } = await axios.post('/api/ai/draft', {
      sectionName: current.name,
      tone,
      styleId: project.styleId,
      context: {
        title: project.metadata.title,
        discipline: project.metadata.discipline,
        keywords: project.metadata.keywords,
        sectionNotes: notes,
        refs: aiRefs,
        citationDensity: density,
        lengthPreset,
        paragraphs
      }
    });
    let aiText = data.text || '';

    // Convert any stray (Author, Year) → markers, then apply citations
    const sanitized = convertAuthorYearToMarkers(aiText, refsAfter);
    setSectionDraftRaw(id, sanitized.text);
    const { text: finalText, citedKeys } = applyCitations(sanitized.text, project.styleId, refsAfter);
    setSectionDraft(id, finalText);
    setSectionCitedKeys(id, citedKeys);

    setReviewOpen(false);
  }

  // Manual insert at cursor
  const draftRef = React.useRef(null);
  const [showInsert, setShowInsert] = React.useState(false);
  const [pickKeys, setPickKeys] = React.useState([]);
  const items = ensureRefIds(project.references?.items || []);
  function togglePick(k){ setPickKeys(prev => prev.includes(k) ? prev.filter(x=>x!==k) : [...prev, k]); }
  function insertAtCursor(textarea, snippet){
    const el = textarea;
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after  = el.value.slice(end);
    el.value = before + snippet + after;
    const caret = start + snippet.length;
    el.setSelectionRange(caret, caret);
    return el.value;
  }
  function insertSelectedCitations(){
    if (!pickKeys.length) return;
    const inText = formatInText(project.styleId, project.references || {}, pickKeys);
    const nextVal = insertAtCursor(draftRef.current, (inText ? ` ${inText}` : ''));
    setSectionDraft(id, nextVal);
    setSectionCitedKeys(id, Array.from(new Set([...(project.sections[id]?.citedKeys || []), ...pickKeys.map(k=>k.toLowerCase())])));
    setShowInsert(false);
    setPickKeys([]);
  }
  function exportSection(){
    const blob = new Blob([draft || ''], { type:'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`${current.name.replace(/\s+/g,'_')}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  // Stats/checklist
  const stats = computeSectionStats(draft, project.styleId, density, current.name);

  return (
    <div className="row cols-2">
      <div className="card">
        <div className="row" style={{gridTemplateColumns:'1fr auto auto', alignItems:'end', gap:8}}>
          <div>
            <label>Section</label>
            <select className="input" value={current.id} onChange={e => nav(`/qa/${e.target.value}`)}>
              {active.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              {all.filter(s=>s.skipped).map(s => <option key={s.id} value={s.id} disabled>{s.name} (skipped)</option>)}
            </select>
          </div>
          <button onClick={()=> prevId && nav(`/qa/${prevId}`)} disabled={!prevId}>◀ Prev</button>
          <button onClick={()=> nextId && nav(`/qa/${nextId}`)} disabled={!nextId}>Next ▶</button>
        </div>

        <h2 style={{marginTop:12}}>{current.name} — Guided Q&A</h2>

        <label>Notes / key points for this section</label>
        <textarea className="input" rows="8" value={notes} onChange={e=>onNotesChange(e.target.value)} placeholder="Paste bullets, numbers, and references (DOIs/PMIDs/arXiv) if you have them."/>

        <div style={{marginTop:10}}>
          <label>(Optional) Citations for this section</label>
          <input className="input" value={cites} onChange={e=>onCitesChange(e.target.value)} placeholder="e.g., 10.1038/nmeth.4823, pmid:12345678, arxiv:2401.01234"/>
        </div>

        <div className="row" style={{marginTop:12, gridTemplateColumns:'1fr 1fr 1fr auto auto', gap:8}}>
          <div>
            <label>Tone</label>
            <select className="input" value={tone} onChange={e=>setTone(e.target.value)}>
              <option value="neutral">Neutral Academic</option>
              <option value="concise">Concise / Minimalist</option>
              <option value="narrative">Narrative / Engaging</option>
            </select>
          </div>
          <div>
            <label>Citation density</label>
            <select className="input" value={density} onChange={e=>setDensity(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="dense">Dense</option>
              <option value="extra">Extra Dense</option>
              <option value="extreme">Extreme</option>
            </select>
          </div>
          <div>
            <label>Section length</label>
            <select className="input" value={lengthPreset} onChange={e=>setLen(e.target.value)}>
              <option value="brief">Brief (150–250)</option>
              <option value="standard">Standard (300–500)</option>
              <option value="extended">Extended (700–900)</option>
              <option value="comprehensive">Comprehensive (1200–1500)</option>
            </select>
          </div>
          <button className="btn" onClick={startDraftFlow} disabled={busy}>{busy ? 'Drafting…' : 'Draft with AI'}</button>
          <button onClick={exportSection} disabled={!draft}>Export This Section</button>
        </div>

        <div className="warn" style={{marginTop:12}}>
          AI inserts inline citations where sources are used. You can also manually insert citations at the cursor.
        </div>

        {/* Manual insert citations */}
        <div style={{marginTop:12}}>
          <button onClick={()=>setShowInsert(v=>!v)}>➕ Insert citation at cursor</button>
          {showInsert && (
            <div className="card" style={{marginTop:8}}>
              <div style={{maxHeight:180, overflow:'auto'}}>
                {items.length === 0 && <div style={{color:'#667'}}>No references yet—draft once or add DOIs on the References screen.</div>}
                {items.map(it=>{
                  const fam = (it.author?.[0]?.family || it.author?.[0]?.literal || 'Author');
                  const yr = it?.issued?.['date-parts']?.[0]?.[0] || '';
                  const label = `${fam} ${yr} — ${String(it.title||'').slice(0,80)}`;
                  return (
                    <label key={it._key} style={{display:'block', padding:'4px 0'}}>
                      <input type="checkbox" checked={pickKeys.includes(it._key)} onChange={()=>togglePick(it._key)} />
                      <span style={{marginLeft:8}}>{label}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{display:'flex', gap:8, marginTop:8}}>
                <button className="btn" onClick={insertSelectedCitations} disabled={!pickKeys.length}>Insert</button>
                <button onClick={()=>{ setShowInsert(false); setPickKeys([]); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Live Draft</h3>
        <textarea ref={draftRef} className="input" rows="18" value={draft} onChange={e=>setSectionDraft(id, e.target.value)} />
        {/* Stats / checklist */}
        <div style={{marginTop:8, fontSize:12}}>
          <div style={{color:'#111'}}>Words: {stats.words} • Sentences: {stats.sentences} • Inline citations: {stats.cites} (target ≈ {stats.expected})</div>
          {stats.warnings.length>0 && (
            <ul style={{margin:'6px 0 0 16px', color:'#b7791f'}}>
              {stats.warnings.map((w,i)=><li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      </div>

      {/* Review Modal */}
      {reviewOpen && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:50
        }}>
          <div className="card" style={{width:'min(720px, 92vw)'}}>
            <h3>Review suggested references</h3>
            <p style={{color:'#667'}}>Uncheck any suggestions you don’t want to include for this section. Confirmed/Detected refs are already included.</p>
            <div style={{maxHeight:'40vh', overflow:'auto', marginTop:8}}>
              {suggested.map(it=>{
                const fam = (it.author?.[0]?.family || it.author?.[0]?.literal || 'Author');
                const yr  = it?.issued?.['date-parts']?.[0]?.[0] || '';
                const title = String(it.title||'').slice(0,120);
                const checked = selectedKeys.includes(it._key);
                return (
                  <label key={it._key} style={{display:'block', padding:'6px 0'}}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={()=>setSelectedKeys(prev => checked ? prev.filter(k=>k!==it._key) : [...prev, it._key])}
                    />
                    <span style={{marginLeft:8}}><strong>{fam} {yr}</strong> — {title}</span>
                  </label>
                );
              })}
              {suggested.length===0 && <div style={{color:'#667'}}>No suggestions.</div>}
            </div>
            <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:12}}>
              <button onClick={() => { setReviewOpen(false); proceedDraft(confirmedRefBuffer.current, []); }}>Skip</button>
              <button className="btn" onClick={() => { const keys = [...selectedKeys]; setReviewOpen(false); proceedDraft(confirmedRefBuffer.current, keys); }}>Accept Selected</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
