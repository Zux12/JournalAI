import React from 'react';
import axios from 'axios';
import { useProjectState } from '../../app/state.jsx';
import { applyCitations } from '../../lib/citeApply.js';
import { formatBibliographyCitedOnly, formatBibliographyWithMap } from '../../lib/refFormat.js';
import { collectFigureTableMaps, applyFigTabTokens, buildLists } from '../../lib/figApply.js';
import { formatCSLBibliography } from '../../lib/csl.js';

const NUMERIC = new Set(['ieee','vancouver','ama','nature','acm','acs']);

export default function Preview(){
  const { project } = useProjectState();
  const [renumber, setRenumber] = React.useState(true);
  const [useCSL, setUseCSL] = React.useState(true);
  const [hzBusy, setHzBusy] = React.useState(false);
  const [hzMode, setHzMode] = React.useState('light');
  const order = project.planner.sections || [];

  // ------- Front matter helpers -------
  function buildFrontMatter(){
    const md = project.metadata || {};
    const title = md.title || 'Untitled Manuscript';

    // Collect affiliations and map to [1], [2], ...
    const affils = [];
    const affIndex = new Map(); // aff -> number
    (md.authors || []).forEach(a => {
      const aff = (a.affiliation || '').trim();
      if (aff && !affIndex.has(aff)) {
        affIndex.set(aff, affils.length + 1);
        affils.push(aff);
      }
    });

    // Authors line: Name [n][m]*  (asterisk for corresponding)
    const authorsLine = (md.authors || []).length
      ? 'Authors: ' + md.authors.map(a => {
          const nums = [];
          const aff = (a.affiliation || '').trim();
          if (aff && affIndex.has(aff)) nums.push(affIndex.get(aff));
          const tag = nums.length ? ` [${nums.join(',')}]` : '';
          const star = a.isCorresponding ? '*' : '';
          return `${a.name || 'Author'}${tag}${star}`;
        }).join(', ')
      : '';

    const affilBlock = affils.length
      ? affils.map((aff,i)=>`[${i+1}] ${aff}`).join('\n')
      : '';

    // Corresponding author line
    const corr = (md.authors || []).find(a => a.isCorresponding) || (md.authors || [])[0];
    const corrLine = corr && corr.email
      ? `Correspondence: ${corr.name || 'Corresponding Author'} <${corr.email}>`
      : '';

    // Title as H1 so DOCX exporter renders heading
    const parts = [
      `# ${title}`,
      authorsLine,
      affilBlock,
      corrLine
    ].filter(Boolean);

    return parts.join('\n') + '\n';
  }

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

  function collectCitedKeysOrder() {
    const seen = new Set();
    const orderKeys = [];
    for (const s of order.filter(x=>!x.skipped && x.id!=='refs')) {
      const raw = project.sections[s.id]?.draftRaw || '';
      const re = /\{\{cite:([^}]+)\}\}/gi; let m;
      while ((m = re.exec(raw))) {
        const keys = m[1].split(',').map(k=>k.trim().toLowerCase()).filter(Boolean);
        for (const k of keys) if (!seen.has(k)) { seen.add(k); orderKeys.push(k); }
      }
    }
    if (!orderKeys.length) {
      Object.values(project.sections || {}).forEach(sec => (sec?.citedKeys || []).forEach(k => {
        if (!seen.has(k)) { seen.add(k); orderKeys.push(String(k).toLowerCase()); }
      }));
    }
    return orderKeys;
  }

  async function buildPieces(){
    const numeric = NUMERIC.has(project.styleId);
    const numMap  = (renumber && numeric) ? collectNumberMap() : null;

    const { figMap, tabMap } = collectFigureTableMaps(project.sections, project.figures, project.tables);

    const pieces = [];
    for (const s of order.filter(x=>!x.skipped && x.id!=='refs')) {
      let txt = '';
      if (numMap && project.sections[s.id]?.draftRaw) {
        txt = applyCitations(project.sections[s.id].draftRaw, project.styleId, project.references || {}, numMap).text;
      } else {
        txt = project.sections[s.id]?.draft || '';
      }
      // Add Keywords after Abstract
      if (/^abstract$/i.test(s.name) && (project.metadata?.keywords || []).length) {
        const keyline = `\n\nKeywords: ${(project.metadata.keywords || []).join('; ')}`;
        txt = (txt || '') + keyline;
      }
      txt = applyFigTabTokens(txt, figMap, tabMap);
      pieces.push({ title: s.name, text: txt });
    }

    // Simple formatter as fallback
    let refsSimple = '';
    if (numeric && numMap && numMap.size > 0) {
      refsSimple = formatBibliographyWithMap(project.styleId, project.references || {}, numMap);
    } else {
      const citedSet = new Set();
      Object.values(project.sections || {}).forEach(sec => (sec?.citedKeys || []).forEach(k => citedSet.add(String(k).toLowerCase())));
      const citedKeys = Array.from(citedSet);
      refsSimple = formatBibliographyCitedOnly(project.styleId, project.references || {}, citedKeys);
    }

    // CSL exact bibliography (optional)
    let refsCSL = '';
    try {
      if (useCSL) {
        const all = (project.references?.items || []);
        if (numeric && numMap && numMap.size > 0) {
          const byKey = new Map(all.map(it => {
            const key = (it._key || it.id || it.DOI || it.title || '').toLowerCase();
            return [key, it];
          }));
          const ordered = Array.from(numMap.entries())
            .sort((a,b)=>a[1]-b[1])
            .map(([k]) => byKey.get(k))
            .filter(Boolean);
          if (ordered.length) {
            const biblio = await formatCSLBibliography(project.styleId, ordered);
            refsCSL = biblio.split(/\r?\n/).map((line, i) => `[${i+1}] ${line}`).join('\n');
          }
        } else {
          const orderKeys = collectCitedKeysOrder();
          const byKey = new Map(all.map(it => {
            const key = (it._key || it.id || it.DOI || it.title || '').toLowerCase();
            return [key, it];
          }));
          const ordered = orderKeys.map(k => byKey.get(k)).filter(Boolean);
          if (ordered.length) refsCSL = await formatCSLBibliography(project.styleId, ordered);
        }
      }
    } catch (e) {
      console.warn('CSL bibliography failed:', e?.message || e);
    }

    const { listOfFigures, listOfTables } = buildLists(figMap, tabMap, project.figures, project.tables);

    return { pieces, refsSimple, refsCSL, listOfFigures, listOfTables };
  }

  async function buildManuscriptText(){
    const fm = buildFrontMatter();
    const { pieces, refsSimple, refsCSL, listOfFigures, listOfTables } = await buildPieces();
    const body = pieces.map(p => `# ${p.title}\n\n${p.text}`).join('\n\n');

    const lof = listOfFigures?.trim() ? `\n\n# List of Figures\n\n${listOfFigures}` : '';
    const lot = listOfTables?.trim()  ? `\n\n# List of Tables\n\n${listOfTables}`   : '';

    const refsText = (useCSL && refsCSL?.trim()) ? refsCSL : refsSimple;
    const refs = refsText?.trim() ? `\n\n# References\n\n${refsText}` : '';

    return fm + '\n' + body + lof + lot + refs;
  }

  function exportAll(){
    (async () => {
      const text = await buildManuscriptText();
      const blob = new Blob([text], {type:'text/plain'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download='manuscript.txt'; a.click();
      URL.revokeObjectURL(url);
    })();
  }

  async function exportDocx(){
  try{
    const text = await buildManuscriptText(); // already includes renumber/CSL/lists
    const { data } = await axios.post(
      '/api/export/docx',
      { content: text, filename: 'manuscript.docx' },
      { responseType: 'arraybuffer' }
    );
    const blob = new Blob([data], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'manuscript.docx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('DOCX export failed:', err);
    alert(`DOCX export failed: ${err?.response?.data?.error || err.message}`);
  }
}

  async function humanizeAndDownload(){
    setHzBusy(true);
    try{
      const fm = buildFrontMatter();
      const { pieces, refsSimple, refsCSL, listOfFigures, listOfTables } = await buildPieces();
      const out = [fm];

      for (const p of pieces) {
        const chunk = `# ${p.title}\n\n${p.text}`;
        const { data } = await axios.post('/api/ai/humanize', { text: chunk, degree: hzMode });
        out.push((data && typeof data.text === 'string') ? data.text : chunk);
      }

      const refsText = (useCSL && refsCSL?.trim()) ? refsCSL : refsSimple;
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

  const [preview, setPreview] = React.useState('');
  React.useEffect(() => {
    let ok = true;
    (async () => {
      const text = await buildManuscriptText();
      if (ok) setPreview(text);
    })();
    return ()=>{ ok = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.updatedAt, renumber, useCSL]);

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

      <div style={{margin:'8px 0'}}>
        <label>
          <input type="checkbox" checked={useCSL} onChange={e=>setUseCSL(e.target.checked)} />
          {' '}Use exact CSL bibliography (publisher-accurate punctuation)
        </label>
      </div>

      <div style={{whiteSpace:'pre-wrap', background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:16, maxHeight:'60vh', overflow:'auto'}}>
        {preview}
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
        Tip: Fill Authors/Affiliations/Emails in <em>Metadata</em>. Keywords appear under Abstract automatically.
      </div>
    </div>
  );
}
