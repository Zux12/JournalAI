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
  const [hzMode, setHzMode] = React.useState('light'); // light|medium
  const order = project.planner.sections || [];
  const [humanizeLevel, setHumanizeLevel] = React.useState('light'); // 'proofread'|'light'|'medium'|'heavy'|'extreme'|'ultra'
const [scope, setScope] = React.useState('entire');                // 'entire'|'selected'|'abstract'|'intro-discussion'|'conclusion'
const [scopeSelected, setScopeSelected] = React.useState([]);       // section IDs when 'selected'

// Restore last-used preferences on load
React.useEffect(()=>{
  try{
    const raw = localStorage.getItem('journalai.prefs');
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.humanizeLevel) setHumanizeLevel(p.humanizeLevel);
    if (p.scope) setScope(p.scope);
    if (Array.isArray(p.scopeSelected)) setScopeSelected(p.scopeSelected);
    if (typeof p.useCSL === 'boolean') setUseCSL(p.useCSL);
    if (typeof p.renumber === 'boolean') setRenumber(p.renumber);
  }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// Persist preferences when they change
React.useEffect(()=>{
  const data = {
    humanizeLevel,
    scope,
    scopeSelected,
    useCSL,
    renumber
  };
  try{ localStorage.setItem('journalai.prefs', JSON.stringify(data)); }catch{}
}, [humanizeLevel, scope, scopeSelected, useCSL, renumber]);

  
const [hmOpen, setHmOpen] = React.useState(false);
const [hmForDocx, setHmForDocx] = React.useState(false);
const [hmCancel, setHmCancel] = React.useState(false);
const [hmStage, setHmStage] = React.useState('');     // 'Preparing' | 'Humanizing' | 'Assembling' | 'Generating'
const [hmIndex, setHmIndex] = React.useState(0);      // current section index (0-based)
const [hmTotal, setHmTotal] = React.useState(0);      // total sections to process
const [hmDetails, setHmDetails] = React.useState([]); // [{id,name,status}] status: pending/humanizing/done/fallback
const [hmShowDetails, setHmShowDetails] = React.useState(true);


  // ---------- Front matter ----------
  function buildFrontMatter(){
    const md = project.metadata || {};
    const title = md.title || 'Untitled Manuscript';

    // affiliations map
    const affils = [];
    const affIndex = new Map();
    (md.authors || []).forEach(a => {
      const aff = (a.affiliation || '').trim();
      if (aff && !affIndex.has(aff)) {
        affIndex.set(aff, affils.length + 1);
        affils.push(aff);
      }
    });

    const authorsLine = (md.authors || []).length
      ? 'Authors: ' + md.authors.map(a => {
          const aff = (a.affiliation || '').trim();
          const nums = (aff && affIndex.has(aff)) ? [affIndex.get(aff)] : [];
          const tag = nums.length ? ` [${nums.join(',')}]` : '';
          const star = a.isCorresponding ? '*' : '';
          return `${a.name || 'Author'}${tag}${star}`;
        }).join(', ')
      : '';

    const affilBlock = affils.length ? affils.map((aff,i)=>`[${i+1}] ${aff}`).join('\n') : '';

    const corr = (md.authors || []).find(a => a.isCorresponding) || (md.authors || [])[0];
    const corrLine = corr && corr.email ? `Correspondence: ${corr.name || 'Corresponding Author'} <${corr.email}>` : '';

    return [
      `# ${title}`,
      authorsLine,
      affilBlock,
      corrLine
    ].filter(Boolean).join('\n') + '\n';
  }

  // ---------- Citations numbering ----------
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


// Remove AI block markers from text (so exports stay clean).
function stripAiWriteupMarkers(text=''){
  return String(text)
    .replace(/\[\[AI-WRITEUP START (fig|tab):[^\]]+\]\]\s*/g, '')
    .replace(/\s*\[\[AI-WRITEUP END (fig|tab):[^\]]+\]\]/g, '');
}

  
  // ---------- Build sections + refs ----------
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
      // append keywords under Abstract
      if (/^abstract$/i.test(s.name) && (project.metadata?.keywords || []).length) {
        txt = (txt || '') + `\n\nKeywords: ${(project.metadata.keywords || []).join('; ')}`;
      }
      txt = applyFigTabTokens(txt, figMap, tabMap);
      txt = stripAiWriteupMarkers(txt);

      pieces.push({ title: s.name, text: txt });
    }

    // simple formatter fallback
    let refsSimple = '';
    if (numeric && numMap && numMap.size > 0) {
      refsSimple = formatBibliographyWithMap(project.styleId, project.references || {}, numMap);
    } else {
      const citedSet = new Set();
      Object.values(project.sections || {}).forEach(sec => (sec?.citedKeys || []).forEach(k => citedSet.add(String(k).toLowerCase())));
      refsSimple = formatBibliographyCitedOnly(project.styleId, project.references || {}, Array.from(citedSet));
    }

    // exact CSL bibliography (optional)
    let refsCSL = '';
    try {
      if (useCSL) {
        const all = (project.references?.items || []);
        if (numeric && numMap && numMap.size > 0) {
          const byKey = new Map(all.map(it => [(it._key || it.id || it.DOI || it.title || '').toLowerCase(), it]));
          const ordered = Array.from(numMap.entries()).sort((a,b)=>a[1]-b[1]).map(([k]) => byKey.get(k)).filter(Boolean);
          if (ordered.length) {
            const biblio = await formatCSLBibliography(project.styleId, ordered);
            refsCSL = biblio.split(/\r?\n/).map((line, i) => `[${i+1}] ${line}`).join('\n');
          }
        } else {
          const orderKeys = collectCitedKeysOrder();
          const byKey = new Map(all.map(it => [(it._key || it.id || it.DOI || it.title || '').toLowerCase(), it]));
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

  // TXT export
  function exportAll(){
    (async () => {
      const text = await buildManuscriptText();
      const blob = new Blob([text], {type:'text/plain'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download='manuscript.txt'; a.click();
      URL.revokeObjectURL(url);
    })();
  }

  // TXT humanize (chunked)
 async function humanizeAndDownload(){
  setHmOpen(true); setHmForDocx(false); setHmCancel(false); setHmShowDetails(true);
  try{
    setHmStage('Preparing');
    const fm = buildFrontMatter();
    const { pieces, refsSimple, refsCSL, listOfFigures, listOfTables } = await buildPieces();

    const chosen = sectionsForScope(); // chosen subset (objects with title,text)
    const details = chosen.map(s => ({ id:s.name, name:s.name, status:'pending' }));
    setHmDetails(details);
    setHmTotal(chosen.length);

    const out = [fm];

    // Build a quick lookup from all pieces by title
    const piecesByTitle = new Map(pieces.map(p => [p.title, p.text]));

    setHmStage('Humanizing');
    for (let i = 0; i < chosen.length; i++) {
      if (hmCancel) break;
      const sec = chosen[i];
      setHmIndex(i);
      setHmDetails(prev => prev.map(d => d.id===sec.name ? { ...d, status:'humanizing' } : d));

      const original = piecesByTitle.get(sec.name) || '';
      const sigBefore = countsSignature(original);
      try{
        const { data } = await axios.post('/api/ai/humanize', { text: `# ${sec.name}\n\n${original}`, level: humanizeLevel });
        const humanized = (data && typeof data.text==='string') ? data.text.replace(/^#\s*[^ \n]+\s*\n+/,'') : original;
        const sigAfter = countsSignature(humanized);
        const safe = (sigBefore === sigAfter);
        out.push(`# ${sec.name}\n\n${safe ? humanized : original}`);
        setHmDetails(prev => prev.map(d => d.id===sec.name ? { ...d, status: safe?'done':'fallback' } : d));
      } catch (e) {
        out.push(`# ${sec.name}\n\n${original}`);
        setHmDetails(prev => prev.map(d => d.id===sec.name ? { ...d, status:'fallback' } : d));
      }
    }

    // Add the untouched sections (outside scope) in original form, preserving order
    const untouched = pieces.filter(p => !chosen.find(c => c.name===p.title));
    for (const p of untouched) out.push(`# ${p.title}\n\n${p.text}`);

    setHmStage('Assembling');
    const refsText = (useCSL && (refsCSL||'').trim()) ? refsCSL : refsSimple;
    if ((listOfFigures||'').trim()) out.push(`\n# List of Figures\n\n${listOfFigures}`);
    if ((listOfTables||'').trim())  out.push(`\n# List of Tables\n\n${listOfTables}`);
    if ((refsText||'').trim())      out.push(`\n# References\n\n${refsText}`);

    const finalText = out.join('\n\n');

    // Download TXT
    const blob = new Blob([finalText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`manuscript_humanized_${humanizeLevel}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  } finally {
    setHmStage('Done');
  }
}



  function sectionsForScope(){
  const secs = order.filter(x=>!x.skipped && x.id!=='refs');
  if (scope === 'entire') return secs;
  if (scope === 'selected' && scopeSelected.length) {
    const set = new Set(scopeSelected);
    return secs.filter(s => set.has(s.id));
  }
  if (scope === 'abstract') return secs.filter(s => /^abstract$/i.test(s.name));
  if (scope === 'intro-discussion') return secs.filter(s => /^(introduction|discussion)$/i.test(s.name));
  if (scope === 'conclusion') return secs.filter(s => /^conclusion$/i.test(s.name));
  return secs;
}

function countsSignature(txt=''){
  const figs = (txt.match(/\{fig:/g) || []).length;
  const tabs = (txt.match(/\{tab:/g) || []).length;
  const cites = (txt.match(/\[[0-9]/g) || []).length + (txt.match(/\(\w[^)]*\d{4}/g) || []).length;
  return `${figs}|${tabs}|${cites}`;
}

  
  // DOCX (non-humanized)
  async function exportDocx(){
    try{
      const text = await buildManuscriptText();
      const { data } = await axios.post(
        '/api/export/docx',
        { content: text, filename: 'manuscript.docx' },
        { responseType: 'arraybuffer' }
      );
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'manuscript.docx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('DOCX export failed:', err);
      alert(`DOCX export failed: ${err?.response?.data?.error || err.message}`);
    }
  }

  // DOCX humanize (chunked)
async function humanizeAndDownloadDocx(){
  setHmOpen(true); setHmForDocx(true); setHmCancel(false); setHmShowDetails(true);
  try{
    setHmStage('Preparing');
    const fm = buildFrontMatter();
    const { pieces, refsSimple, refsCSL, listOfFigures, listOfTables } = await buildPieces();

    const chosen = sectionsForScope();
    const details = chosen.map(s => ({ id:s.name, name:s.name, status:'pending' }));
    setHmDetails(details);
    setHmTotal(chosen.length);

    const out = [fm];
    const piecesByTitle = new Map(pieces.map(p => [p.title, p.text]));

    setHmStage('Humanizing');
    for (let i = 0; i < chosen.length; i++) {
      if (hmCancel) break;
      const sec = chosen[i];
      setHmIndex(i);
      setHmDetails(prev => prev.map(d => d.id===sec.name ? { ...d, status:'humanizing' } : d));

      const original = piecesByTitle.get(sec.name) || '';
      const sigBefore = countsSignature(original);
      try{
        const { data } = await axios.post('/api/ai/humanize', { text: `# ${sec.name}\n\n${original}`, level: humanizeLevel });
        const humanized = (data && typeof data.text==='string') ? data.text.replace(/^#\s*[^ \n]+\s*\n+/,'') : original;
        const sigAfter = countsSignature(humanized);
        const safe = (sigBefore === sigAfter);
        out.push(`# ${sec.name}\n\n${safe ? humanized : original}`);
        setHmDetails(prev => prev.map(d => d.id===sec.name ? { ...d, status: safe?'done':'fallback' } : d));
      } catch (e) {
        out.push(`# ${sec.name}\n\n${original}`);
        setHmDetails(prev => prev.map(d => d.id===sec.name ? { ...d, status:'fallback' } : d));
      }
    }

    // untouched sections in original form
    const untouched = pieces.filter(p => !chosen.find(c => c.name===p.title));
    for (const p of untouched) out.push(`# ${p.title}\n\n${p.text}`);

    setHmStage('Assembling');
    const refsText = (useCSL && (refsCSL||'').trim()) ? refsCSL : refsSimple;
    if ((listOfFigures||'').trim()) out.push(`\n# List of Figures\n\n${listOfFigures}`);
    if ((listOfTables||'').trim())  out.push(`\n# List of Tables\n\n${listOfTables}`);
    if ((refsText||'').trim())      out.push(`\n# References\n\n${refsText}`);

    const finalText = out.join('\n\n');

    setHmStage('Generating');
    const { data } = await axios.post(
      '/api/export/docx',
      { content: finalText, filename: `manuscript_humanized_${humanizeLevel}.docx` },
      { responseType: 'arraybuffer' }
    );
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `manuscript_humanized_${humanizeLevel}.docx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  } finally {
    setHmStage('Done');
  }
}

async function retryFailedTxt(){
  const names = failedNames();
  if (!names.length) return;
  // Re-run the same TXT flow but limit “chosen” to the failed names
  setHmCancel(false);
  setHmStage('Preparing');
  const fm = buildFrontMatter();
  const { pieces, refsSimple, refsCSL, listOfFigures, listOfTables } = await buildPieces();
  const byTitle = new Map(pieces.map(p => [p.title, p.text]));
  const chosen = pieces.filter(p => names.includes(p.title));

  const details = chosen.map(s => ({ id:s.title, name:s.title, status:'pending' }));
  setHmDetails(details);
  setHmTotal(chosen.length);

  const out = [fm];
  setHmStage('Humanizing');
  for (let i=0; i<chosen.length; i++){
    if (hmCancel) break;
    const sec = chosen[i];
    setHmIndex(i);
    setHmDetails(prev => prev.map(d => d.id===sec.title ? { ...d, status:'humanizing' } : d));
    const original = byTitle.get(sec.title) || '';
    const sigBefore = countsSignature(original);
    try{
      const { data } = await axios.post('/api/ai/humanize', { text: `# ${sec.title}\n\n${original}`, level: humanizeLevel });
      const humanized = (data && typeof data.text==='string') ? data.text.replace(/^#\s*[^ \n]+\s*\n+/,'') : original;
      const sigAfter = countsSignature(humanized);
      const safe = (sigBefore === sigAfter);
      out.push(`# ${sec.title}\n\n${safe ? humanized : original}`);
      setHmDetails(prev => prev.map(d => d.id===sec.title ? { ...d, status: safe?'done':'fallback' } : d));
    } catch {
      out.push(`# ${sec.title}\n\n${original}`);
      setHmDetails(prev => prev.map(d => d.id===sec.title ? { ...d, status:'fallback' } : d));
    }
  }
  // stitch the rest (original order)
  const rest = pieces.filter(p => !names.includes(p.title));
  for (const p of rest) out.push(`# ${p.title}\n\n${p.text}`);

  setHmStage('Assembling');
  const refsText = (useCSL && (refsCSL||'').trim()) ? refsCSL : refsSimple;
  if ((listOfFigures||'').trim()) out.push(`\n# List of Figures\n\n${listOfFigures}`);
  if ((listOfTables||'').trim())  out.push(`\n# List of Tables\n\n${listOfTables}`);
  if ((refsText||'').trim())      out.push(`\n# References\n\n${refsText}`);

  const finalText = out.join('\n\n');
  const blob = new Blob([finalText], { type:'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`manuscript_humanized_${humanizeLevel}.txt`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);

  setHmStage('Done');
}

async function retryFailedDocx(){
  const names = failedNames();
  if (!names.length) return;
  setHmCancel(false);
  setHmStage('Preparing');
  const fm = buildFrontMatter();
  const { pieces, refsSimple, refsCSL, listOfFigures, listOfTables } = await buildPieces();
  const byTitle = new Map(pieces.map(p => [p.title, p.text]));
  const chosen = pieces.filter(p => names.includes(p.title));

  const details = chosen.map(s => ({ id:s.title, name:s.title, status:'pending' }));
  setHmDetails(details);
  setHmTotal(chosen.length);

  const out = [fm];
  setHmStage('Humanizing');
  for (let i=0; i<chosen.length; i++){
    if (hmCancel) break;
    const sec = chosen[i];
    setHmIndex(i);
    setHmDetails(prev => prev.map(d => d.id===sec.title ? { ...d, status:'humanizing' } : d));
    const original = byTitle.get(sec.title) || '';
    const sigBefore = countsSignature(original);
    try{
      const { data } = await axios.post('/api/ai/humanize', { text: `# ${sec.title}\n\n${original}`, level: humanizeLevel });
      const humanized = (data && typeof data.text==='string') ? data.text.replace(/^#\s*[^ \n]+\s*\n+/,'') : original;
      const sigAfter = countsSignature(humanized);
      const safe = (sigBefore === sigAfter);
      out.push(`# ${sec.title}\n\n${safe ? humanized : original}`);
      setHmDetails(prev => prev.map(d => d.id===sec.title ? { ...d, status: safe?'done':'fallback' } : d));
    } catch {
      out.push(`# ${sec.title}\n\n${original}`);
      setHmDetails(prev => prev.map(d => d.id===sec.title ? { ...d, status:'fallback' } : d));
    }
  }
  // stitch the rest (original order)
  const rest = pieces.filter(p => !names.includes(p.title));
  for (const p of rest) out.push(`# ${p.title}\n\n${p.text}`);

  setHmStage('Assembling');
  const refsText = (useCSL && (refsCSL||'').trim()) ? refsCSL : refsSimple;
  if ((listOfFigures||'').trim()) out.push(`\n# List of Figures\n\n${listOfFigures}`);
  if ((listOfTables||'').trim())  out.push(`\n# List of Tables\n\n${listOfTables}`);
  if ((refsText||'').trim())      out.push(`\n# References\n\n${refsText}`);

  setHmStage('Generating');
  const { data } = await axios.post(
    '/api/export/docx',
    { content: out.join('\n\n'), filename: `manuscript_humanized_${humanizeLevel}.docx` },
    { responseType: 'arraybuffer' }
  );
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `manuscript_humanized_${humanizeLevel}.docx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);

  setHmStage('Done');
}


  
  function failedNames() {
  return hmDetails.filter(d => d.status === 'fallback').map(d => d.name);
}

// --- Submission checklist helpers (place above the "async preview text" state) ---
function checklistForSection(name, text, level='light'){
  const t = String(text || '');
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  const sentences = (t.match(/[.!?](\s|$)/g) || []).length;
  const cites = ((t.match(/\[(?:\d+(?:–\d+)?(?:,\s*\d+(?:–\d+)?)*)\]/g) || []).length)
              + ((t.match(/\([^)]+\d{4}[a-z]?(?:;[^)]*\d{4}[a-z]?)*\)/g) || []).length);
  const hasFig = /\{fig:|Figure\s+\d/.test(t);
  const hasTab = /\{tab:|Table\s+\d/.test(t);

  // expected citations per ~150 words, by level
  const per150 = { proofread:0.4, light:0.7, medium:1.2, heavy:1.6, extreme:2.1, ultra:2.4 }[String(level).toLowerCase()] ?? 0.7;
  const expected = Math.max(1, Math.round((words/150) * per150));

  const warnings = [];
  if (words < 120) warnings.push('Short (<120 words)');
  if (cites < expected) warnings.push(`Low citation density (${cites}/${expected})`);
  if (/^introduction$/i.test(name) && cites < 2) warnings.push('Intro typically needs ≥2 citations');
  if (/results/i.test(name) && !(hasFig || hasTab)) warnings.push('Results: add a figure or table reference');

  return { words, sentences, cites, hasFig, hasTab, warnings };
}

function buildChecklistData(){
  // use current drafts shown in Preview
  const rows = [];
  for (const s of order.filter(x=>!x.skipped && x.id!=='refs')) {
    const txt = project.sections[s.id]?.draft || '';
    rows.push({ section: s.name, ...checklistForSection(s.name, txt, humanizeLevel) });
  }
  return rows;
}

  
  
  // async preview text
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

<div style={{display:'flex', gap:12, flexWrap:'wrap', marginTop:12}}>
  <div>
    <label>Humanize level</label>
    <select className="input" value={humanizeLevel} onChange={e=>setHumanizeLevel(e.target.value)}>
      <option value="proofread">Proofread only</option>
      <option value="light">Light</option>
      <option value="medium">Medium</option>
      <option value="heavy">Heavy</option>
      <option value="extreme">Extreme</option>
      <option value="ultra">Ultra</option>
    </select>
  </div>
  <div>
    <label>Scope</label>
    <select className="input" value={scope} onChange={e=>setScope(e.target.value)}>
      <option value="entire">Entire manuscript</option>
      <option value="selected">Selected sections…</option>
      <option value="abstract">Abstract only</option>
      <option value="intro-discussion">Intro + Discussion</option>
      <option value="conclusion">Conclusion only</option>
    </select>
  </div>
  {scope === 'selected' && (
    <div>
      <label>Pick sections</label>
      <select multiple className="input" style={{minWidth:220, minHeight:80}}
        value={scopeSelected}
        onChange={e=>{
          const opts = Array.from(e.target.selectedOptions).map(o=>o.value);
          setScopeSelected(opts);
        }}>
        {order.filter(x=>!x.skipped && x.id!=='refs').map(s=>(<option key={s.id} value={s.id}>{s.name}</option>))}
      </select>
    </div>
  )}
  <div style={{alignSelf:'end', fontSize:12, color:'#667'}}>
    <a href="#" onClick={e=>{e.preventDefault(); alert(
      'Humanize levels:\n' +
      '• Proofread: grammar/punctuation only, no paraphrase.\n' +
      '• Light: small paraphrases, better flow.\n' +
      '• Medium: moderate paraphrase, keep structure.\n' +
      '• Heavy: sentence-level rewrite, same paragraph.\n' +
      '• Extreme: strong per-paragraph rewrite.\n' +
      '• Ultra: max fluency per paragraph, tokens/numbers intact.'
    );}}>ℹ️ What these mean</a>
  </div>
</div>


      
      <div style={{marginTop:12, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
        <button className="btn" onClick={exportAll}>Export Full Manuscript (TXT)</button>
      
        <button onClick={humanizeAndDownload} disabled={hzBusy}>
          {hzBusy ? 'Humanizing…' : 'Humanize & Download (TXT)'}
        </button>
        <button onClick={exportDocx}>Download DOCX</button>
        <button onClick={humanizeAndDownloadDocx}>Humanize & Download (DOCX)</button>

      </div>

     <div style={{fontSize:12, color:'#667', marginTop:6}}>
  Tip: DOCX is the non-humanized version. Use “Humanize & Download (TXT)” if you want a lighter rewrite.
</div>

{/* Submission checklist */}
<div className="card" style={{marginTop:12}}>
  <h3>Submission checklist</h3>
  <div style={{overflowX:'auto'}}>
    <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
      <thead>
        <tr style={{textAlign:'left'}}>
          <th style={{padding:'6px'}}>Section</th>
          <th style={{padding:'6px'}}>Words</th>
          <th style={{padding:'6px'}}>Cites</th>
          <th style={{padding:'6px'}}>Fig/Tab</th>
          <th style={{padding:'6px'}}>Warnings</th>
        </tr>
      </thead>
      <tbody>
        {buildChecklistData().map((r,i)=>(
          <tr key={i} style={{borderTop:'1px solid #e5e7eb'}}>
            <td style={{padding:'6px'}}>{r.section}</td>
            <td style={{padding:'6px'}}>{r.words}</td>
            <td style={{padding:'6px'}}>{r.cites}</td>
            <td style={{padding:'6px'}}>{(r.hasFig?'Fig ':'')+(r.hasTab?'Tab':'') || '—'}</td>
            <td style={{padding:'6px', color:r.warnings.length? '#b45309':'#2563eb'}}>
              {r.warnings.length ? r.warnings.join(' • ') : 'Looks good'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>

      
{hmOpen && (
  <div style={{
    position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
    display:'flex', alignItems:'center', justifyContent:'center', zIndex:100
  }}>
    <div className="card" style={{width:'min(720px, 92vw)'}}>
      <h3>{hmForDocx ? 'Humanize & Download (DOCX)' : 'Humanize & Download (TXT)'}</h3>
      <div style={{color:'#667', marginTop:4}}>
        {hmStage || 'Preparing'} {hmStage==='Humanizing' ? `(${hmIndex+1}/${hmTotal})` : ''}
      </div>
      <div style={{height:10, background:'#eee', borderRadius:8, overflow:'hidden', marginTop:8}}>
        <div style={{
          height:'100%',
          width:`${hmTotal ? Math.round(((hmStage==='Humanizing'? hmIndex : hmTotal)/Math.max(1, hmTotal))*100) : 5}%`,
          background:'linear-gradient(90deg,#93c5fd,#3b82f6)'
        }} />
      </div>
  <div style={{display:'flex', gap:8, marginTop:10, alignItems:'center'}}>
  <button onClick={()=>setHmCancel(true)}>Cancel</button>

  {/* Show retry only when run is Done and there were fallbacks */}
  {hmStage === 'Done' && hmDetails.some(d=>d.status==='fallback') && (
    <button onClick={()=> (hmForDocx ? retryFailedDocx() : retryFailedTxt())}>
      Retry failed ({hmDetails.filter(d=>d.status==='fallback').length})
    </button>
  )}

  <div style={{marginLeft:'auto', display:'flex', gap:8, alignItems:'center'}}>
  <label>
    <input
      type="checkbox"
      checked={hmShowDetails}
      onChange={(e)=>setHmShowDetails(e.target.checked)}
    /> Details
  </label>
  <button onClick={()=>setHmOpen(false)}>Close</button>
</div>

</div>
{hmShowDetails && (
      <div style={{maxHeight:'30vh', overflow:'auto', marginTop:10}}>
        <table style={{width:'100%', fontSize:13, borderCollapse:'collapse'}}>
          <thead>
            <tr><th align="left">Section</th><th align="left">Status</th></tr>
          </thead>
          <tbody>
            {hmDetails.map((d,i)=>(
              <tr key={i}>
                <td style={{padding:'4px 6px'}}>{d.name}</td>
                <td style={{padding:'4px 6px', color:
                  d.status==='done' ? '#166534' :
                  d.status==='fallback' ? '#b45309' :
                  d.status==='humanizing' ? '#1d4ed8' : '#334155'
                }}>{d.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  )}
    </div>
  </div>
)}

</div> // <-- close the outer <div className="card">

  );
}



