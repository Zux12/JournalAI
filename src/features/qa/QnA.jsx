import React from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjectState } from '../../app/state.jsx';

export default function QnA(){
  const nav = useNavigate();
  const { sectionId } = useParams();
  const { project, setSectionDraft, setSectionNotes } = useProjectState();

  // All sections except the system "References"
  const all = project.planner.sections.filter(s => s.id !== 'refs');
  const active = all.filter(s => !s.skipped);

  // Pick current section: URL param -> first active -> first available
  const current = all.find(s => s.id === sectionId) || active[0] || all[0] || null;

  // If nothing to edit (all skipped), show a hint
  if (!current) {
    return (
      <div className="card">
        <h2>Guided Q&A</h2>
        <div className="warn">All sections are skipped. Go to the Section Planner to enable at least one section.</div>
      </div>
    );
  }

  // If route has no/invalid id, redirect to the chosen current section
  React.useEffect(() => {
    if (sectionId !== current.id) {
      nav(`/qa/${current.id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id]);

  const id = current.id;

  // Load persisted tone/notes/draft for this section
  const [tone, setTone]   = React.useState((project.sections[id]?.tone)  || 'neutral');
  const [notes, setNotes] = React.useState((project.sections[id]?.notes) || '');
  const draft = project.sections[id]?.draft || '';
  const [busy, setBusy] = React.useState(false);

  // When section changes, refresh local states from project
  React.useEffect(() => {
    setTone((project.sections[id]?.tone)  || 'neutral');
    setNotes((project.sections[id]?.notes) || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, project.updatedAt]);

  function onNotesChange(v){
    setNotes(v);
    setSectionNotes(id, v); // persist immediately
  }

  // Prev / Next controls among active (unskipped) sections
  const idx = active.findIndex(s => s.id === current.id);
  const prevId = idx > 0 ? active[idx - 1].id : null;
  const nextId = idx >= 0 && idx < active.length - 1 ? active[idx + 1].id : null;

  async function draftWithAI(){
    setBusy(true);
    try{
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
      setSectionDraft(id, data.text || '');
    } finally { setBusy(false); }
  }

  return (
    <div className="row cols-2">
      <div className="card">
        <div className="row" style={{gridTemplateColumns:'1fr auto auto', alignItems:'end', gap:8}}>
          <div>
            <label>Section</label>
            <select
              className="input"
              value={current.id}
              onChange={e => nav(`/qa/${e.target.value}`)}
            >
              {active.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              {/* show skipped too, but disabled */}
              {all.filter(s=>s.skipped).map(s=>(
                <option key={s.id} value={s.id} disabled>{s.name} (skipped)</option>
              ))}
            </select>
          </div>
          <button onClick={()=> prevId && nav(`/qa/${prevId}`)} disabled={!prevId}>◀ Prev</button>
          <button onClick={()=> nextId && nav(`/qa/${nextId}`)} disabled={!nextId}>Next ▶</button>
        </div>

        <h2 style={{marginTop:12}}>{current.name} — Guided Q&A</h2>

        <label>Notes / key points for this section</label>
        <textarea
          className="input"
          rows="10"
          value={notes}
          onChange={e=>onNotesChange(e.target.value)}
          placeholder="Bullet points, numbers, constraints, citations to include, etc."
        />

        <div className="row" style={{marginTop:8, gridTemplateColumns:'1fr auto auto', gap:8}}>
          <div>
            <label>Tone</label>
            <select className="input" value={tone} onChange={e=>setTone(e.target.value)}>
              <option value="neutral">Neutral Academic</option>
              <option value="concise">Concise / Minimalist</option>
              <option value="narrative">Narrative / Engaging</option>
            </select>
          </div>
          <button className="btn" onClick={draftWithAI} disabled={busy}>
            {busy ? 'Drafting…' : 'Draft with AI'}
          </button>
        </div>

        <div className="warn" style={{marginTop:12}}>
          Tip: Include numbers, units, and citations you want referenced.
        </div>
      </div>

      <div className="card">
        <h3>Live Draft</h3>
        <textarea
          className="input"
          rows="18"
          value={draft}
          onChange={e=>setSectionDraft(id, e.target.value)}
        />
      </div>
    </div>
  );
}
