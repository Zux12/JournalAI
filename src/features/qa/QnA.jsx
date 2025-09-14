import React from 'react';
import axios from 'axios';
import { useProjectState } from '../../app/state.js';
import { useParams } from 'react-router-dom';

export default function QnA(){
  const { sectionId } = useParams();
  const { project, setSectionDraft } = useProjectState();
  const current = (project.planner.sections.find(s=>s.id===sectionId) || project.planner.sections[0]);
  const id = current.id;
  const [tone, setTone] = React.useState('neutral');
  const [notes, setNotes] = React.useState('');
  const draft = (project.sections[id]?.draft) || '';
  const [busy, setBusy] = React.useState(false);

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
        <h2>{current.name} — Guided Q&A</h2>
        <label>Notes / key points for this section</label>
        <textarea className="input" rows="10" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Bullet points, numbers, constraints, etc."/>
        <div className="row" style={{marginTop:8, gridTemplateColumns:'1fr auto auto', gap:8}}>
          <div>
            <label>Tone</label>
            <select className="input" value={tone} onChange={e=>setTone(e.target.value)}>
              <option value="neutral">Neutral Academic</option>
              <option value="concise">Concise/Minimalist</option>
              <option value="narrative">Narrative/Engaging</option>
            </select>
          </div>
          <button className="btn" onClick={draftWithAI} disabled={busy}>{busy?'Drafting…':'Draft with AI'}</button>
        </div>
        <div className="warn" style={{marginTop:12}}>Tip: Include numbers, units, and citations you want referenced.</div>
      </div>
      <div className="card">
        <h3>Live Draft</h3>
        <textarea className="input" rows="18" value={draft} onChange={e=>setSectionDraft(id, e.target.value)}/>
      </div>
    </div>
  );
}
