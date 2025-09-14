import React from 'react';
import { useProjectState } from '../../app/state.jsx';

export default function Preview(){
  const { project } = useProjectState();
  const order = project.planner.sections;

  function sectionText(s){
    return project.sections[s.id]?.draft || (s.id==='refs' ? renderRefs() : '');
  }
  function renderRefs(){
    // Minimal plain-text list; styling by styleId can be added later with CSL rendering
    const items = project.references?.items || [];
    return items.map((it,i)=> `[${i+1}] ${it.author?.map(a=>`${a.family} ${a.given?.[0]||''}.`).join(' ')} ${it.title}. ${it['container-title']} (${it.issued?.['date-parts']?.[0]?.[0]||''}).`).join('\n');
  }
  function exportAll(){
    const text = order.filter(s=>!s.skipped).map(s=>`# ${s.name}\n\n${sectionText(s)}`).join('\n\n');
    download('manuscript.txt', text);
  }
  function download(name, text){
    const blob = new Blob([text], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=name; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card">
      <h2>Preview & Export (clean text)</h2>
      <div style={{whiteSpace:'pre-wrap', background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:16, maxHeight:'60vh', overflow:'auto'}}>
        {order.filter(s=>!s.skipped).map(s=>(
          <div key={s.id}>
            <h3>{s.name}</h3>
            <div>{sectionText(s)}</div>
            <hr style={{margin:'16px 0'}}/>
          </div>
        ))}
      </div>
      <div style={{marginTop:12}}>
        <button className="btn" onClick={exportAll}>Export Full Manuscript (TXT)</button>
      </div>
    </div>
  );
}
