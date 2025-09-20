import React from 'react';
import axios from 'axios';
import { useProjectState } from '../../app/state.jsx';
import { applyCitations } from '../../lib/citeApply.js';
import { formatBibliographyCitedOnly, formatBibliographyWithMap } from '../../lib/refFormat.js';
import { collectFigureTableMaps, applyFigTabTokens, buildLists } from '../../lib/figApply.js';
import { formatCSLBibliography } from '../../lib/csl.js';

const NUMERIC = new Set(['ieee','vancouver','ama','nature','acm','acs']);






export default function Preview(){
  const { project, update } = useProjectState();
    // Download/Load project (JSON)
  const fileRef = React.useRef(null);
  const [showProjectHelp, setShowProjectHelp] = React.useState(false);

  const [renumber, setRenumber] = React.useState(true);
  const [useCSL, setUseCSL] = React.useState(true);
  const [hzBusy, setHzBusy] = React.useState(false);
  const [hzMode, setHzMode] = React.useState('light'); // light|medium
  const [groundedMode, setGroundedMode] = React.useState(false); // Grounded (use sources) toggle
  const [showGroundedHelp, setShowGroundedHelp] = React.useState(false);
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

function buildFigMedia(){
  const map = {};
  (project.figures || []).forEach(f => {
    // We embed the 600px thumbnail if available; caption is included.
    if (f.thumbDataUrl) {
      map[f.id] = { dataUrl: f.thumbDataUrl, caption: f.caption || '' };
    }
  });
  return map;
}

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
 
  async function buildPieces({ forDocx = false } = {}){

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
if (!forDocx) {
  // In Preview/TXT we render "Figure N"/"Table M"
  txt = applyFigTabTokens(txt, figMap, tabMap);
}
// Always hide write-up markers from what the user sees/exports
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


  async function buildManuscriptText(forDocx = false){
  
    const fm = buildFrontMatter();
    const { pieces, refsSimple, refsCSL, listOfFigures, listOfTables } = await buildPieces({ forDocx });

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


  // Split text into [{type:'text'|'cit', val:string}] keeping citations separate
function splitByCitations(text=''){
  const parts = [];
  const re = /(\[(?:\d+(?:–\d+)?(?:,\s*\d+(?:–\d+)?)*)\]|\((?:[^()]*\d{4}[a-z]?)(?:;[^()]*\d{4}[a-z]?)*\))/g;
  let last = 0;
  const s = String(text);
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ type:'text', val:s.slice(last, m.index) });
    parts.push({ type:'cit',  val:m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ type:'text', val:s.slice(last) });
  return parts;
}

// Humanize only non-citation spans, stitch citations back
async function humanizePreserveCitations(original, level){
  const parts = splitByCitations(original);
  const out = [];
  for (const p of parts) {
    if (p.type === 'cit') {
      out.push(p.val); // keep citations exactly
    } else if (p.type === 'text' && p.val.trim()) {
      try {
        const { data } = await axios.post('/api/ai/humanize', {
          text: p.val,
          level
        });
        const h = (data && typeof data.text === 'string') ? data.text : p.val;
        out.push(h);
      } catch {
        out.push(p.val); // on error, keep original span
      }
    } else {
      out.push(p.val); // empty or spacing span
    }
  }
  return out.join('');
}

  

  
  // TXT humanize (chunked)
async function humanizeAndDownload(){
  setHmOpen(true); setHmForDocx(false); setHmCancel(false); setHmShowDetails(true);
  try{
    setHmStage('Preparing');
    const fm = buildFrontMatter();
    const { pieces, refsSimple, refsCSL, listOfFigures, listOfTables } = await buildPieces();

    const chosen = sectionsForScope();
    const details = chosen.map(s => ({ id: s.name, name: s.name, status: 'pending', reason: '' }));
    setHmDetails(details);
    setHmTotal(chosen.length);

    const out = [fm];

    // Build a quick lookup from all pieces by section name (title)
    const piecesByTitle = new Map(pieces.map(p => [p.title, p.text]));

    setHmStage('Humanizing');
    for (let i = 0; i < chosen.length; i++) {
      if (hmCancel) break;
      const sec = chosen[i];
     setHmIndex(i);
setHmDetails(prev => prev.map(d =>
  d.id === sec.name ? { ...d, status: 'humanizing', reason: '' } : d
));

// define original BEFORE try/catch
const original = piecesByTitle.get(sec.name) || '';
const sigBefore = countsSignature(original);

// protect cites, then send to AI
// 1) Fast path: placeholder method
const prot = protectCitationsText(original);
let used = original;
let ok = false;
let reason = '';

try{
  const ctx = groundedMode ? buildGroundingContextForSection(sec.name) : '';
  const { data } = await axios.post('/api/ai/humanize', {
    text: `# ${sec.name}\n\n${prot.text}`,
    level: humanizeLevel,
    context: ctx
  });

  const raw = (data && typeof data.text==='string')
    ? data.text.replace(/^#\s*[^ \n]+\s*\n+/, '')
    : original;
  const humanized = restoreCitationsText(raw, prot.placeholders);

  const sigAfter = countsSignature(humanized);
  ok = (sigBefore === sigAfter);
  used = ok ? humanized : original;
  reason = ok ? '' : buildFallbackReason(sigBefore, sigAfter);
} catch {
  ok = false;
  used = original;
  reason = 'ai-error';
}

// 2) If fast path failed, fallback to segmentation (humanize-only-text)
if (!ok) {
  try{
    const salvaged = await humanizePreserveCitations(original, humanizeLevel);
    const sigAfter2 = countsSignature(salvaged);
    if (sigBefore === sigAfter2) {
      used = salvaged;
      ok = true;
      reason = '';
    }
  } catch { /* keep original & reason as-is */ }
}

// 3) Cadence Polisher (only when ok). Protect tokens & cites so counts stay identical.
if (ok) {
  const sigUsed = countsSignature(used);
  const tokProt = protectTokensText(used);
  const citProt2 = protectCitationsText(tokProt.text);
  const polished = polishCadence(citProt2.text, i, sec.name); // section-aware polishing
  const restored = restoreCitationsText(polished, citProt2.placeholders);
  const withTokens = restoreTokensText(restored, tokProt.placeholders);

  // sanity: if protected counts changed, keep unpolished
  if (countsSignature(withTokens) === sigUsed) {
    used = withTokens;
  }
}

// Finalize
out.push(`# ${sec.name}\n\n${used}`);
setHmDetails(prev => prev.map(d =>
  d.id === sec.name
    ? { ...d, status: ok ? 'done' : 'fallback', reason: ok ? '' : reason }
    : d
));



    }

    // Add the untouched sections (outside scope) in original form, preserving order
    const untouched = pieces.filter(p => !chosen.find(c => c.name === p.title));
    for (const p of untouched) out.push(`# ${p.title}\n\n${p.text}`);

    setHmStage('Assembling');
    const refsText = (useCSL && (refsCSL || '').trim()) ? refsCSL : refsSimple;
    if ((listOfFigures || '').trim()) out.push(`\n# List of Figures\n\n${listOfFigures}`);
    if ((listOfTables || '').trim())  out.push(`\n# List of Tables\n\n${listOfTables}`);
    if ((refsText || '').trim())      out.push(`\n# References\n\n${refsText}`);

    const finalText = out.join('\n\n');

    // Download TXT
    const blob = new Blob([finalText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `manuscript_humanized_${humanizeLevel}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

// Parse "f|t|c" into numbers
function parseSig(sig='0|0|0'){
  const [f,t,c] = String(sig).split('|').map(n=>parseInt(n||'0',10));
  return { figs: isNaN(f)?0:f, tabs: isNaN(t)?0:t, cites: isNaN(c)?0:c };
}

// Build a readable reason when the post-check fails
function buildFallbackReason(sigBefore, sigAfter){
  const a = parseSig(sigBefore);
  const b = parseSig(sigAfter);
  const diffs = [];
  if (a.figs !== b.figs) diffs.push(`fig tokens ${a.figs}→${b.figs}`);
  if (a.tabs !== b.tabs) diffs.push(`tab tokens ${a.tabs}→${b.tabs}`);
  if (a.cites !== b.cites) diffs.push(`citations ${a.cites}→${b.cites}`);
  return diffs.length ? `protected counts changed: ${diffs.join(', ')}` : 'post-check failed';
}

// --- Protect tokens (fig/tab) like we do for cites ---
function protectTokensText(text=''){
  const placeholders = [];
  let i = 0;
  // match {fig:ID} or {tab:ID}
  const re = /(\{(?:fig|tab):[a-z0-9\-_]+\})/gi;
  const out = String(text).replace(re, (m) => {
    const tag = `[[TOK${i++}]]`;
    placeholders.push({ tag, val: m });
    return tag;
  });
  return { text: out, placeholders };
}
function restoreTokensText(text='', placeholders=[]){
  let out = String(text);
  for (const p of placeholders) out = out.replaceAll(p.tag, p.val);
  return out;
}

// --- Cadence Polisher: small, safe, style-only changes (no facts/citations/tokens) ---
function polishCadence(text = '', seed = 0, sectionName = '') {
  // Section-aware: do NOT force openers in Introduction/Methods/Conclusion
  const sec = String(sectionName || '').toLowerCase();
  const allowOpeners = !(sec === 'introduction' || sec === 'methods' || sec === 'conclusion');

  // Safe openers (no colons); use sparingly
  const openerPool = ['Notably,', 'Importantly,', 'In practice,', 'We observe that', 'Two observations follow.'];
  const badOpenersRE = /^(Additionally|Furthermore|Moreover|However|In conclusion|In essence|In summary|Overall|To wrap things up)\b[:,]?/i;

  // seeded picker for deterministic variety
  const pick = (arr, idx = 0) => arr[(seed + idx) % arr.length];

  // Helpers
  const maybeSwapOpener = (s, idx) => {
    if (!allowOpeners) return s;               // disabled in Intro/Methods/Conclusion
    if (idx % 2 === 0) return s;               // apply at most to every other paragraph
    const trimmed = s.trimStart();
    if (badOpenersRE.test(trimmed)) {
      const chosen = pick(openerPool, idx);
      return trimmed.replace(badOpenersRE, chosen);  // replace only the opener token
    }
    return s;
  };

  const dashifyWhich = (s) => {
    // at most one dash per paragraph; avoid e.g./i.e. ranges
    if (s.includes('—') || /\b(e\.g\.|i\.e\.)/i.test(s)) return s;
    return s.replace(/, which/, ' — which');
  };

  const tidyPunct = (s) => {
    return s
      .replace(/:\s*,/g, ': ')      // " :,"
      .replace(/,\s*,/g, ', ')      // ",,"
      .replace(/\s{2,}/g, ' ')      // double spaces
      .replace(/\s+([,.:;])/g, '$1'); // space before punctuation
  };

  // Conservative de-template replacements (no facts touched)
  const softenIntensifiers = (s) => s
    .replace(/\bimportance becomes critical\b/gi, 'is critical')
    .replace(/\bnecessity(?:\s+of [^,]+)? becomes critical\b/gi, 'is critical');

  // Table phrasing: rotate verbs (shows/compares/summarizes/reports)
  const tableVerbify = (s, idx) => s.replace(
    /\bTable\s+(\d+)\s+(?:provides(?:\s+a)?\s+(?:comparison|comparative\s+analysis)|illustrates|shows)\b/gi,
    (_m, n) => `Table ${n} ${pick(['compares', 'shows', 'summarizes', 'reports'], idx)}`
  );

  // Discussion staple phrasing softener
  const discussionSoft = (s) => s
    .replace(/\bManaging oil and gas assets through integrity management\b/gi, 'Managing oil and gas assets via integrity programs');

  // Gentle nominalization softener
  const liteDenominal = (s) => s.replace(/\bwhich encompasses\b/gi, 'encompassing');

  // Redundancy trimmer: remove duplicate tokens & repeated phrase second time
  const tidyRedundancy = (s) => {
    // the the -> the
    s = s.replace(/\b(\w+)\s+\1\b/gi, '$1');
    // "aging infrastructure" → second occurrence becomes "these assets"
    let aiCount = 0;
    s = s.replace(/aging infrastructure/gi, () => (++aiCount === 1 ? 'aging infrastructure' : 'these assets'));
    return s;
  };

  const paras = String(text).split(/\n{2,}/);
  const out = paras.map((p, idx) => {
    let s = p;

    // 1) opener (very limited)
    s = maybeSwapOpener(s, idx);

    // 2) targeted phrasing tweaks
    s = softenIntensifiers(s);
    s = tableVerbify(s, idx);
    if (sec === 'discussion') s = discussionSoft(s);
    s = liteDenominal(s);

    // 3) tiny rhythm change (once)
    s = dashifyWhich(s);

    // 4) redundancy + punctuation tidy
    s = tidyRedundancy(s);
    s = tidyPunct(s);

    return s;
  });

  return out.join('\n\n');
}





// Protect inline citations by replacing them with placeholders [[CIT0]], [[CIT1]], ...
function protectCitationsText(text=''){
  const placeholders = [];
  let i = 0;
  const re = /(\[(?:\d+(?:–\d+)?(?:,\s*\d+(?:–\d+)?)*)\]|\((?:[^()]*\d{4}[a-z]?)(?:;[^()]*\d{4}[a-z]?)*\))/g;
  const out = String(text).replace(re, (m) => {
    const tag = `[[CIT${i++}]]`;
    placeholders.push({ tag, val: m });
    return tag;
  });
  return { text: out, placeholders };
}

function restoreCitationsText(text='', placeholders=[]){
  let out = String(text);
  for (const p of placeholders) {
    // Replace all occurrences of this placeholder (should be 1:1)
    out = out.replaceAll(p.tag, p.val);
  }
  return out;
}

  
  
  // DOCX (non-humanized)
  async function exportDocx(){
    try{

      const text = await buildManuscriptText(true); // keep {fig:ID} tokens for the server to embed images
const { data } = await axios.post(
  '/api/export/docx',
  { content: text, filename: 'manuscript.docx', figMedia: buildFigMedia() },
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
    const { pieces, refsSimple, refsCSL, listOfFigures, listOfTables } = await buildPieces({ forDocx: true });

    const chosen = sectionsForScope();
    const details = chosen.map(s => ({ id: s.name, name: s.name, status: 'pending', reason: '' }));
    setHmDetails(details);
    setHmTotal(chosen.length);

    const out = [fm];
    const piecesByTitle = new Map(pieces.map(p => [p.title, p.text]));

    setHmStage('Humanizing');
    for (let i = 0; i < chosen.length; i++) {
      if (hmCancel) break;
      const sec = chosen[i];
setHmIndex(i);
setHmDetails(prev => prev.map(d =>
  d.id === sec.name ? { ...d, status: 'humanizing', reason: '' } : d
));

// define original BEFORE try/catch
const original = piecesByTitle.get(sec.name) || '';
const sigBefore = countsSignature(original);

// protect cites, then send to AI
// 1) Fast path: placeholder method
const prot = protectCitationsText(original);
let used = original;
let ok = false;
let reason = '';

try{
  const ctx = groundedMode ? buildGroundingContextForSection(sec.name) : '';
  const { data } = await axios.post('/api/ai/humanize', {
    text: `# ${sec.name}\n\n${prot.text}`,
    level: humanizeLevel,
    context: ctx
  });

  const raw = (data && typeof data.text==='string')
    ? data.text.replace(/^#\s*[^ \n]+\s*\n+/, '')
    : original;
  const humanized = restoreCitationsText(raw, prot.placeholders);

  const sigAfter = countsSignature(humanized);
  ok = (sigBefore === sigAfter);
  used = ok ? humanized : original;
  reason = ok ? '' : buildFallbackReason(sigBefore, sigAfter);
} catch {
  ok = false;
  used = original;
  reason = 'ai-error';
}

// 2) If fast path failed, fallback to segmentation (humanize-only-text)
if (!ok) {
  try{
    const salvaged = await humanizePreserveCitations(original, humanizeLevel);
    const sigAfter2 = countsSignature(salvaged);
    if (sigBefore === sigAfter2) {
      used = salvaged;
      ok = true;
      reason = '';
    }
  } catch { /* keep original & reason as-is */ }
}

// 3) Cadence Polisher (only when ok). Protect tokens & cites so counts stay identical.
if (ok) {
  const sigUsed = countsSignature(used);
  const tokProt = protectTokensText(used);
  const citProt2 = protectCitationsText(tokProt.text);
  const polished = polishCadence(citProt2.text, i, sec.name); // section-aware polishing
  const restored = restoreCitationsText(polished, citProt2.placeholders);
  const withTokens = restoreTokensText(restored, tokProt.placeholders);

  // sanity: if protected counts changed, keep unpolished
  if (countsSignature(withTokens) === sigUsed) {
    used = withTokens;
  }
}

// Finalize
out.push(`# ${sec.name}\n\n${used}`);
setHmDetails(prev => prev.map(d =>
  d.id === sec.name
    ? { ...d, status: ok ? 'done' : 'fallback', reason: ok ? '' : reason }
    : d
));



    }

    // untouched sections in original form
    const untouched = pieces.filter(p => !chosen.find(c => c.name === p.title));
    for (const p of untouched) out.push(`# ${p.title}\n\n${p.text}`);

    setHmStage('Assembling');
    const refsText = (useCSL && (refsCSL || '').trim()) ? refsCSL : refsSimple;
    if ((listOfFigures || '').trim()) out.push(`\n# List of Figures\n\n${listOfFigures}`);
    if ((listOfTables || '').trim())  out.push(`\n# List of Tables\n\n${listOfTables}`);
    if ((refsText || '').trim())      out.push(`\n# References\n\n${refsText}`);

    const finalText = out.join('\n\n');

    setHmStage('Generating');
    const { data } = await axios.post(
      '/api/export/docx',
      { content: finalText, filename: `manuscript_humanized_${humanizeLevel}.docx`, figMedia: buildFigMedia() },
      { responseType: 'arraybuffer' }
    );

    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `manuscript_humanized_${humanizeLevel}.docx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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


  const details = chosen.map(s => ({ id:s.name, name:s.name, status:'pending', reason:'' }));

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


  const details = chosen.map(s => ({ id:s.name, name:s.name, status:'pending', reason:'' }));


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


function downloadProjectJson(){
  try{
    const safe = { ...project, updatedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `journalai_project_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  } catch (e) {
    alert('Failed to save project.');
    console.error(e);
  }
}

function openProjectPicker(){
  fileRef.current?.click();
}

async function handleProjectUpload(evt){
  try{
    const file = evt.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const loaded = JSON.parse(text);

    // Confirm replace
    const ok = confirm('Load this project file? This will replace the current project in memory.');
    if (!ok) return;

    // Minimal normalization: prefer loaded values, keep any missing keys from current project
    // (Prevents crashes if old exports lack new fields)
    const merged = {
      ...project,           // keep current defaults for any new fields
      ...loaded,            // prefer loaded content
      updatedAt: new Date().toISOString(),
    };

    // Replace the whole project using the provider's updater
    update(() => merged);

    alert('Project loaded.');
  } catch (e) {
    alert('Invalid or corrupted project file.');
    console.error(e);
  } finally {
    // reset input so picking the same file again will fire the change event
    if (evt?.target) evt.target.value = '';
  }
}

  

function slugifyTitle(t=''){
  const s = String(t).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0, 60); // cap length
  return s || null;
}
function tsStamp(){
  const d = new Date();
  const pad = (n)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadProjectJson(){
  try{
    const safe = { ...project, updatedAt: new Date().toISOString() };
    const base = slugifyTitle(project?.metadata?.title) || `journalai_project_${tsStamp()}`;
    const name = `${base}.json`;
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  } catch (e) {
    alert('Failed to save project.');
    console.error(e);
  }
}

function openProjectPicker(){
  fileRef.current?.click();
}

async function handleProjectUpload(evt){
  try{
    const file = evt.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const loaded = JSON.parse(text);

    const ok = confirm('Load this project file? This replaces the current project in memory (unsaved work will be lost).');
    if (!ok) return;

    // Shallow merge so missing/new fields don’t crash older files
    const merged = {
      ...project,
      ...loaded,
      updatedAt: new Date().toISOString(),
    };
    update(()=> merged);

    alert('Project loaded.');
  } catch (e) {
    alert('Invalid or corrupted project file.');
    console.error(e);
  } finally {
    if (evt?.target) evt.target.value = '';
  }
}


function buildGroundingContextForSection(sectionName){
  // Pull text from Sources and (optionally) generated tables to anchor the rewrite
  const chunks = [];

  // 1) Sources text (trimmed)
  (project.sources || []).forEach(s => {
    if (s?.text) {
      // take the first ~400 chars of each source to keep it small
      chunks.push(String(s.text).slice(0, 400));
    }
  });

  // 2) Generated table previews (a few rows) to inject concrete numbers
  (project.generatedTableProposals || []).forEach(t => {
    if (t?.columns && t?.rows && t.rows.length) {
      const header = `Table: ${t.title || t.id}`;
      const firstRow = t.rows[0].join(' | ');
      chunks.push(`${header}\n${(t.columns || []).join(' | ')}\n${firstRow}`);
    }
  });

  // 3) Current section’s own draft (a small excerpt) to keep local coherence
  const sId = (project.planner?.sections || []).find(x => x.name === sectionName)?.id;
  if (sId) {
    const local = (project.sections?.[sId]?.draft || '').slice(0, 300);
    if (local) chunks.push(local);
  }

  // Keep total under ~2k chars
  const joined = chunks.join('\n---\n').slice(0, 2000);
  return joined;
}

  
  
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

  
<div style={{display:'flex', gap:12, alignItems:'center', marginTop:6, flexWrap:'wrap'}}>
  <label>
    <input
      type="checkbox"
      checked={groundedMode}
      onChange={e=>setGroundedMode(e.target.checked)}
    />
    {' '}Grounded + Natural Cadence
  </label>
  <a
    href="#"
    onClick={(e)=>{ e.preventDefault(); setShowGroundedHelp(true); }}
    style={{fontSize:12}}
    title="What is Grounded + Natural Cadence?"
  >
    ℹ️ What is this?
  </a>
  <span style={{fontSize:12, color:'#667'}}>
    Uses sources/tables to anchor wording and varies sentence rhythm to avoid boilerplate.
  </span>
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

  


  
</div>


      
      <div style={{marginTop:12, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
        <button className="btn" onClick={exportAll}>Export Full Manuscript (TXT)</button>
      
        <button onClick={humanizeAndDownload} disabled={hzBusy}>
          {hzBusy ? 'Humanizing…' : 'Humanize & Download (TXT)'}
        </button>
        <button onClick={exportDocx}>Download DOCX</button>
        <button onClick={humanizeAndDownloadDocx}>Humanize & Download (DOCX)</button>
        <button onClick={downloadProjectJson}>Download Project (.json)</button>
        <button onClick={openProjectPicker}>Load Project (.json)</button>
          <a href="#" onClick={(e)=>{e.preventDefault(); setShowProjectHelp(true);}} style={{marginLeft:'auto', fontSize:12}}>
    ℹ️ About project files
  </a>
      </div>

      <input
  type="file"
  accept="application/json"
  ref={fileRef}
  onChange={handleProjectUpload}
  style={{ display:'none' }}
/>


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

{showProjectHelp && (
  <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
               display:'flex', alignItems:'center', justifyContent:'center', zIndex:120}}>
    <div className="card" style={{width:'min(720px, 92vw)'}}>
      <h3>About project files (.json)</h3>
      <div style={{fontSize:14, color:'#111', lineHeight:1.45}}>
        <p><strong>Download Project (.json)</strong> saves your entire manuscript state to a single file you can keep or share.</p>
        <ul style={{margin:'6px 0 8px 18px'}}>
          <li>Included: metadata, sections, drafts, references, proposals &amp; placements, figures/tables library, 600px image thumbnails, CSV 50-row previews, and toggles.</li>
          <li>Not included: original full-resolution images; full CSVs beyond 50 rows.</li>
        </ul>
        <p><strong>Load Project (.json)</strong> replaces your current in-browser project with the file you pick. Keep backups if you’re unsure.</p>
        <p><strong>Collaborate</strong>: share the .json. Your teammate can load it, continue editing, and download a new .json with their updates.</p>
        <p><em>Filename</em>: we use a safe version of your Title (truncated) — for example:
          <code style={{marginLeft:6, background:'#f1f5f9', padding:'2px 6px', borderRadius:6}}>
            {slugifyTitle(project?.metadata?.title) || 'journalai_project'}_{tsStamp()}.json
          </code>
        </p>
        <p style={{color:'#667', marginTop:6}}>
          Privacy note: Downloads happen locally in your browser — nothing is uploaded to a server.
        </p>
      </div>
      <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:12}}>
        <button onClick={()=>setShowProjectHelp(false)}>Close</button>
      </div>
    </div>
  </div>
)}

      
{showGroundedHelp && (
  <div style={{
    position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
    display:'flex', alignItems:'center', justifyContent:'center', zIndex:120
  }}>
    <div className="card" style={{width:'min(720px, 92vw)'}}>
      <h3>Grounded + Natural Cadence</h3>
      <div style={{fontSize:14, color:'#111', lineHeight:1.45}}>
        <p><strong>What it does:</strong></p>
        <ul style={{margin:'6px 0 8px 18px'}}>
          <li><strong>Grounded:</strong> passes short evidence snippets (from your PDFs and generated tables) so rewrites stay anchored to real numbers, units, and terminology.</li>
          <li><strong>Natural Cadence:</strong> encourages varied sentence lengths (some short, a few long), rotates paragraph openers, and allows sparse em-dashes/parentheticals to reduce boilerplate rhythm.</li>
        </ul>
        <p><strong>Preserved exactly:</strong> citations, {`{fig:}/{tab:`} tokens, and all numbers/units (they’re protected and post-checked).</p>
        <p><strong>What it does not do:</strong> invent results or citations, move or insert tokens, or copy long source passages (snippets are brief and for context only).</p>
        <p><strong>When to use:</strong> Results/Discussion or any paragraph that benefits from concrete values and more natural academic cadence.</p>
        <p style={{color:'#667', marginTop:6}}>
          Note: If you have few Sources/Tables, Grounded still works but its effect is smaller because there’s less evidence to anchor.
        </p>
      </div>
      <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:12}}>
        <button onClick={()=>setShowGroundedHelp(false)}>Close</button>
      </div>
    </div>
  </div>
)}



      
      
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
  <tr>
    <th align="left">Section</th>
    <th align="left">Status</th>
    <th align="left">Reason</th>
  </tr>
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
                <td style={{padding:'4px 6px', color:'#667'}}>{d.reason || '—'}</td>

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



