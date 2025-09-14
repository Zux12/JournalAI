import React from 'react';
import { useProjectState } from '../../app/state.jsx';
import { applyCitations } from '../../lib/citeApply.js';
import { formatBibliographyCitedOnly, formatBibliographyWithMap } from '../../lib/refFormat.js';
import axios from 'axios';



const NUMERIC = new Set(['ieee','vancouver','ama','nature','acm','acs']);

export default function Preview(){
  const { project } = useProjectState();
  const [renumber, setRenumber] = React.useState(true); // default ON
  const [hzBusy, setHzBusy] = React.useState(false);
const [hzMode, setHzMode] = React.useState('light'); // light|medium

  const order = project.planner.sections || [];

  function collectNumberMap() {
    // Build first-appearance order from raw drafts ({{cite:...}})
    const map = new Map(); // keyLower -> number
    let n = 1;
    for (const s of order.filter(x=>!x.skipped && x.id!=='refs')) {
      const raw = project.sections[s.id]?.draftRaw || '';
      const re = /\{\{cite:([^}]+)\}\}/gi;
      let m;
      while ((m = re.exec(raw))) {
        const keys = m[1].split(',').map(k=>k.trim().toLowerCase()).filter(Boolean);
        for (const k of keys) {
          if (!map.has(k)) map.set(k, n++);
        }
      }
    }
    return map;
  }

  function buildBodyAndRefs(){
    const numeric = NUMERIC.has(project.styleId);
    const numMap = (renumber && numeric) ? collectNumberMap() : null;

    // 1) Body
    const parts = [];
    for (const s of order.filter(x=>!x.skipped && x.id!=='refs')) {
      let txt = '';
      if (numMap && project.sections[s.id]?.draftRaw) {
        // Re-apply with contiguous numbering
        txt = applyCitations(project.sections[s.id].draftRaw, project.styleId, project.references || {}, numMap).text;
      } else {
        // Use already formatted draft
        txt = project.sections[s.id]?.draft || '';
      }
      parts.push(`# ${s.name}\n\n${txt}`);
    }
    const body = parts.join('\n\n');

    // 2) References block
    let refsText = '';
    if (numeric && numMap && numMap.size > 0) {
      refsText = formatBibliographyWithMap(project.styleId, project.references || {}, numMap);
    } else {
      // cited-only fallback (author-date, or numeric without renumber)
      const citedSet = new Set();
      Object.values(project.sections || {}).forEach(sec => (sec?.citedKeys || []).forEach(k => citedSet.add(String(k).toLowerCase())));
      const citedKeys = Array.from(citedSet);
      const block = formatBibliographyCitedOnly(project.styleId, project.references || {}, citedKeys);
      refsText = block;
    }

    const withRefs = refsText?.trim() ? `${body}\n\n# References\n\n${refsText}` : body;
    return withRefs;
  }

  function exportAll(){
    const text = buildBodyAndRefs();
    const blob = new Blob([text], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='manuscript.txt'; a.click();
    URL.revokeObjectURL(url);
  }

  async function humanizeAndDownload(){
  try{
    setHzBusy(true);
    const text = buildBodyAndRefs();
    const { data } = await axios.post('/api/ai/humanize', { text, degree: hzMode });
    const blob = new Blob([data.text || text], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`manuscript_humanized_${hzMode}.txt`; a.click();
    URL.revokeObjectURL(url);
  } finally { setHzBusy(false); }
}

  
  const manuscript = buildBodyAndRefs();

  return (
    <div className="card">
      <h2>Preview & Export (clean text)</h2>
      {NUMERIC.has(project.styleId) && (
        <div style={{margin:'8px 0'}}>
          <label><input type="checkbox" checked={renumber} onChange={e=>setRenumber(e.target.checked)} /> Renumber numeric citations contiguously at export</label>
        </div>
      )}
      <div style={{whiteSpace:'pre-wrap', background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:16, maxHeight:'60vh', overflow:'auto'}}>
        {manuscript}
      </div>

<div style={{marginTop:12, display:'flex', gap:8, alignItems:'center'}}>
  <button className="btn" onClick={exportAll}>Export Full Manuscript (TXT)</button>
  <label style={{marginLeft:8}}>
    Humanize:
    <select className="input" style={{width:150, marginLeft:6}} value={hzMode} onChange={e=>setHzMode(e.target.value)}>
      <option value="light">Light</option>
      <option value="medium">Medium</option>
    </select>
  </label>
  <button onClick={humanizeAndDownload} disabled={hzBusy}>{hzBusy ? 'Humanizing…' : 'Humanize & Download'}</button>
</div>

      
    </div>
  );
}
