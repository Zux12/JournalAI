import React from 'react';
import axios from 'axios';
import { useProjectState } from '../../app/state.jsx';
import { applyCitations } from '../../lib/citeApply.js';
import { formatBibliographyCitedOnly, formatBibliographyWithMap } from '../../lib/refFormat.js';
import { collectFigureTableMaps, applyFigTabTokens, buildLists } from '../../lib/figApply.js';

const NUMERIC = new Set(['ieee','vancouver','ama','nature','acm','acs']);

export default function Preview(){
  const { project } = useProjectState();
  const [renumber, setRenumber] = React.useState(true);
  const [hzBusy, setHzBusy] = React.useState(false);
  const [hzMode, setHzMode] = React.useState('light');
  const order = project.planner.sections || [];

  function collectNumberMap() {
    const map = new Map(); let n = 1;
    for (const s of order.filter(x=>!x.skipped && x.id!=='refs')) {
      const raw = project.sections[s.id]?.draftRaw || '';
      const re = /\{\{cite:([^}]+)\}\}/gi; let m;
      while ((m = re.exec(raw))) {
        const keys = m[1].split(',').map(k=>k.trim().toLowerCase()).filter(Boolean);
        for (const k of keys) if (!map.has(k)) map.set(k, n++);
      }
    }
    return map;
  }

  // Build pieces with citations + figure/table tokens applied, plus refs and lists
  function buildPieces(){
    const numeric = NUMERIC.has(project.styleId);
    const numMap  = (renumber && numeric) ? collectNumberMap() : null;

    // Build figure/table number maps from first appearance across raw drafts
    const { figMap, tabMap } = collectFigureTableMaps(project.sections, project.figures, project.tables);

    const pieces = [];
    for (const s of order.filter(x=>!x.skipped && x.id!=='refs')) {
      let txt = '';
      if (numMap && project.sections[s.id]?.draftRaw) {
        txt = applyCitations(project.sections[s.id].draftRaw, project.styleId, project.references || {}, numMap).text;
      } else {
        txt = project.sections[s.id]?.draft || '';
      }
      // Apply {fig:id}/{tab:id} tokens
      txt = applyFigTabTokens(txt, figMap, tabMap);
      pieces.push({ title: s.name, text: txt });
    }

    // Bibliography
    let refsText = '';
    if (numeric && numMap && numMap.size > 0) {
      refsText = formatBibliographyWithMap(project.styleId, project.references || {}, numMap);
    } else {
      const citedSet = new Set();
      Object.values(project.sections || {}).forEach(sec => (sec?.citedKeys || []).forEach(k => citedSet.add(String(k).toLowerCase())));
      const citedKeys = Array.from(citedSet);
      refsText = formatBibliographyCitedOnly(project.styleId, project.references || {}, citedKeys);
    }

    // Lists of Figures/Tables
    const { listOfFigures, listOfTables } = buildLists(figMap, tabMap, project.figures, project.tables);

    return { pieces, refsText, listOfFigures, listOfTables };
  }

  function buildManuscriptText(){
    const { pieces, refsText, listOfFigures, listOfTables } = buildPieces();
    const body = pieces.map(p => `# ${p.title}\n\n${p.text}`).join('\n\n');

    const lof = listOfFigures?.trim() ? `\n\n# List of Figures\n\n${listOfFigures}` : '';
    const lot = listOfTables?.trim()  ? `\n\n# List of Tables\n\n${listOfTables}`   : '';
    const refs = refsText?.trim()     ? `\n\n# References\n\n${refsText}`          : '';

    return body + lof + lot + refs;
  }

  function exportAll(){
    const text = buildManuscriptText();
    const blob = new Blob([text], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='manuscript.txt'; a.click();
    URL.revokeObjectURL(url);
  }

  // Chunked humanize per section (avoids router timeout)
  async function humanizeAndDownload(){
    setHzBusy(true);
    try{
      const { pieces, refsText, listOfFigures, listOfTables } = buildPieces();

      const out = [];
      for (const p of pieces) {
        const chunk = `# ${p.title}\n\n${p.text}`;
        const { data } = await axios.post('/api/ai/humanize', { text: chunk, degree: hzMode });
        out.push((data && typeof data.text === 'string') ? data.text : chunk);
      }
      if (listOfFigures?.trim()) out.push(`\n# List of Figures\n\n${listOfFigures}`);
      if (listOfTables?.trim())  out.push(`\n# List of Tables\n\n${listOfTables}`);
      if (refsText?.trim())      out.push(`\n# References\n\n${refsText}`);

      const finalText = out.join('\n\n');
      const blob = new Blob([finalText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=`manuscript_humanized_${hzMode}.txt`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Humanize failed:', err);
      alert(`Humanize failed: ${err?.response?.data?.error || err.message}`);
    } finally {
      setHzBusy(false);
    }
  }

  const manuscript = buildManuscriptText();

  return (
    <div className="card">
      <h2>Preview & Export (clean text)</h2>

      {NUMERIC.has(project.styleId) && (
        <div style={{margin:'8px 0'}}>
          <label>
            <input type="checkbox" checked={renumber} onChange={e=>setRenumber(e.target.checked)} />
            {' '}Renumber numeric citations contiguously at export
          </label>
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
        <button onClick={humanizeAndDownload} disabled={hzBusy}>
          {hzBusy ? 'Humanizing…' : 'Humanize & Download'}
        </button>
      </div>

      <div style={{fontSize:12, color:'#667', marginTop:6}}>
        Tip: Use {`{fig:YOUR_ID}`} or {`{tab:YOUR_ID}`} inside drafts to reference items. IDs come from the Figures & Tables page.
      </div>
    </div>
  );
}
