import React from 'react';
import { useProjectState } from '../../app/state.js';

export default function Planner(){
  const { project, setPlanner } = useProjectState();
  const [sections, setSections] = React.useState(project.planner.sections);

  function toggleSkip(idx){
    const next = sections.map((s,i)=> i===idx ? { ...s, skipped:!s.skipped } : s);
    setSections(next);
    setPlanner({ sections: next });
  }
  function addSection(){
    const name = prompt('New section name?');
    if(!name) return;
    const id = name.toLowerCase().replace(/\s+/g,'-').slice(0,24);
    const next = [...sections];
    const insertAt = Math.max(1, sections.findIndex(s=>s.id==='methods')); // rough heuristic
    next.splice(insertAt, 0, { id, name, status:'todo', skipped:false });
    setSections(next);
    setPlanner({ sections: next });
    alert(`AI suggests placing "${name}" after Introduction/Methods.`);
  }

  return (
    <div className="card">
      <h2>Section Planner</h2>
      <p>Toggle sections on/off. You can add custom sections; AI will advise placement. (Drag & drop coming later.)</p>
      {sections.map((s, idx)=>(
        <div key={s.id} className="row" style={{alignItems:'center', marginBottom:8}}>
          <div style={{minWidth:180}}><strong>{s.name}</strong> {s.id==='refs' && <span className="badge">system</span>}</div>
          <div style={{color:'#667'}}>status: {s.status}</div>
          <div style={{marginLeft:'auto'}}>
            <button onClick={()=>toggleSkip(idx)}>{s.skipped?'Unskip':'Skip'}</button>
          </div>
          {s.skipped && <div className="warn" style={{marginTop:8}}>Skipping {s.name} may risk desk rejection in some journals.</div>}
        </div>
      ))}
      <button className="btn" onClick={addSection} style={{marginTop:12}}>+ Add Section</button>
    </div>
  );
}
