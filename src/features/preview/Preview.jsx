import React from 'react';
import { useProjectState } from '../../app/state.jsx';
import { formatBibliographyCitedOnly } from '../../lib/refFormat.js';

export default function Preview(){
  const { project } = useProjectState();
  const order = project.planner.sections || [];

  function sectionText(s){
    return project.sections[s.id]?.draft || '';
  }

  function buildManuscriptText(){
  const body = (project.planner.sections || [])
    .filter(s => !s.skipped && s.id !== 'refs')
    .map(s => `# ${s.name}\n\n${project.sections[s.id]?.draft || ''}`)
    .join('\n\n');

  // Collect cited keys from all sections
  const citedSet = new Set();
  Object.values(project.sections || {}).forEach(sec => {
    (sec?.citedKeys || []).forEach(k => citedSet.add(String(k).toLowerCase()));
  });
  const citedKeys = Array.from(citedSet);

  const refsBlock = formatBibliographyCitedOnly(project.styleId, project.references || {}, citedKeys);
  const refsText = refsBlock?.trim()
    ? `\n\n# References\n\n${refsBlock}`
    : ''; // if nothing cited, omit the block

  return body + refsText;
}


  function exportAll(){
    const text = buildManuscriptText();
    download('manuscript.txt', text);
  }

  function download(name, text){
    const blob = new Blob([text], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=name; a.click();
    URL.revokeObjectURL(url);
  }

  const manuscript = buildManuscriptText();

  return (
    <div className="card">
      <h2>Preview & Export (clean text)</h2>
      <div style={{whiteSpace:'pre-wrap', background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:16, maxHeight:'60vh', overflow:'auto'}}>
        {manuscript}
      </div>
      <div style={{marginTop:12}}>
        <button className="btn" onClick={exportAll}>Export Full Manuscript (TXT)</button>
      </div>
    </div>
  );
}
