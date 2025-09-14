import React from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjectState } from '../../app/state.jsx';
import { fetchByDOI, fetchByPMID, fetchByArXiv } from '../../lib/refs.js';
import { mergeReferences, formatInText } from '../../lib/refFormat.js';

function parseCitationTokens(raw) {
  // Accept comma/space/semicolon separated; allow bare DOI, "doi:...", pmid:123, arxiv:2301.12345
  const t = String(raw || '').trim();
  if (!t) return [];
  return t.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}
async function resolveTokenToCSL(token) {
  const low = token.toLowerCase();
  if (low.startsWith('doi:') || low.startsWith('10.')) return await fetchByDOI(low.replace(/^doi:/,''));
  if (low.startsWith('pmid:')) return await fetchByPMID(low.replace(/^pmid:/,''));
  if (low.startsWith('arxiv:')) return await fetchByArXiv(low.replace(/^arxiv:/,''));
  // heuristics
  if (/^10\.\d{4,9}\//.test(token)) return await fetchByDOI(token);
  if (/^\d{6,}$/.test(token)) return await fetchByPMID(token);
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(token)) return await fetchByArXiv(token);
  // fall back to minimal stub
  return { type:'article-journal', title: token, author:[{ family:'Unknown', given:'' }], issued:{'date-parts':[[new Date().getFullYear()]]}, id: token };
}

export default function QnA(){
  const nav = useNavigate();
  const { sectionId } = useParams();
  const { project, setSectionDraft, setSectionNotes, update } = useProjectState();

  const all = project.planner.sections.filter(s => s.id !== 'refs');
  const active = all.filter(s => !s.skipped);
  const current = all.find(s => s.id === sectionId) || active[0] || all[0] || null;

  React.useEffect(() => {
    if (!current) return;
    if (sectionId !== current.id) nav(`/qa/${current.id}`, { replace: true });
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
  const [tone, setTone]   = React.useState((project.sections[id]?.tone)  || 'neutral');
  const [notes, setNotes] = React.useState((project.sections[id]?.notes) || '');
  const [cites, setCites] = React.useState((project.sections[id]?.cites) || ''); // NEW
  const draft = project.sections[id]?.draft || '';
  const [busy, setBusy] = React.useState(false);

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

  // Prev/Next among active
  const idx = active.findIndex(s => s.id === current.id);
  const prevId = idx > 0 ? active[idx - 1].id : null;
  const nextId = idx >= 0 && idx < active.length - 1 ? active[idx + 1].id : null;

  async function draftWithAI(){
    setBusy(true);
    try{
      // 1) Resolve citations to CSL-JSON and merge into project references
      const tokens = parseCitationTokens(cites);
      const newRefs = [];
      for (const t of tokens) {
        try { newRefs.push(await resolveTokenToCSL(t)); } catch(e){ console.warn('Failed ref', t, e); }
      }
      // Merge into project state and capture the keys used
      let keysUsed = [];
      update(p => {
        const merged = mergeReferences(p.references, newRefs);
        keysUsed = (newRefs || []).map(r => (r.DOI ? `doi:${String(r.DOI).toLowerCase()}` : (r.id || r.title || '')).toLowerCase());
        return { ...p, references: merged };
      });

      // 2) Ask AI to draft the section from notes
      const { data } = await axios.post('/api/ai/draft', {
        sectionName: current.name,
        tone,
        styleId: project.styleId,
        context: {
          title: project.metadata.title,
          discipline: project.metadata.discipline,
          keywords: project.metadata.keywords,
          sectionNotes: notes
        }
      });
      let text = data.text || '';

      // 3) Post-insert in-text citations at the end of the first paragraph (or end of text)
      if (keysUsed.length) {
        const intext = formatInText(project.styleId, (project.references || {}), keysUsed);
        if (intext) {
          const parts = text.split('\n').filter(Boolean);
          if (parts.length) parts[0] = parts[0].trim().replace(/\s*$/, '') + ' ' + intext;
          text = parts.join('\n') || (text + ' ' + intext);
        }
      }

      setSectionDraft(id, text);
    } finally { setBusy(false); }
  }

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
        <textarea className="input" rows="8" value={notes} onChange={e=>onNotesChange(e.target.value)} placeholder="Bullet points, numbers, constraints, citations to include, etc."/>

        <div style={{marginTop:10}}>
          <label>Citations for this section (DOI / PMID / arXiv, separated by comma)</label>
          <input className="input" value={cites} onChange={e=>onCitesChange(e.target.value)} placeholder="e.g., 10.1038/nmeth.4823, pmid:12345678, arxiv:2401.01234"/>
          <div className="warn" style={{marginTop:6}}>We’ll fetch metadata, add to References, and insert the in-text citation using your chosen style.</div>
        </div>

        <div className="row" style={{marginTop:12, gridTemplateColumns:'1fr auto', gap:8}}>
          <div>
            <label>Tone</label>
            <select className="input" value={tone} onChange={e=>setTone(e.target.value)}>
              <option value="neutral">Neutral Academic</option>
              <option value="concise">Concise / Minimalist</option>
              <option value="narrative">Narrative / Engaging</option>
            </select>
          </div>
          <button className="btn" onClick={draftWithAI} disabled={busy}>{busy ? 'Drafting…' : 'Draft with AI'}</button>
        </div>
      </div>

      <div className="card">
        <h3>Live Draft</h3>
        <textarea className="input" rows="18" value={draft} onChange={e=>setSectionDraft(id, e.target.value)} />
      </div>
    </div>
  );
}
