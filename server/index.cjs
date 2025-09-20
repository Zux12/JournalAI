// server/index.cjs (CommonJS)
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();

// --- basics ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('tiny'));
app.use(express.json({ limit: '4mb' }));

// --- API router with CORS + rate limit only here ---
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsCheck = cors({
  origin: (origin, cb) => {
    // Allow same-origin/no-Origin requests (static files) and any explicitly allowed origin
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: Origin not allowed'), false);
  }
});

const points = Number(process.env.RATE_LIMIT_RPM || 30);
const rateLimiter = new RateLimiterMemory({ points, duration: 60 });
const rateLimitMiddleware = async (req, res, next) => {
  try { await rateLimiter.consume(req.ip); next(); }
  catch { res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' }); }
};

const api = express.Router();
api.use(corsCheck, rateLimitMiddleware);

// --- OpenAI helper (uses Node 22 global fetch) ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

async function openaiChat(messages, model = 'gpt-4o-mini', temperature = 0.5) {
  if (!OPENAI_API_KEY) return 'OPENAI_API_KEY missing on server.';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, temperature, messages })
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`OpenAI ${r.status}: ${txt}`);
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || '';
}

// --- API routes ---
api.get('/health', (req, res) => res.json({ ok: true }));

api.post('/ai/keywords', async (req, res) => {
  try {
    const { title = '', abstract = '', discipline = '', seedKeywords = [] } = req.body || {};
    const prompt = `Title: ${title}\nDiscipline: ${discipline}\nAbstract: ${abstract}\nSeed keywords: ${seedKeywords.join(', ')}\nSuggest 5–10 academically relevant keywords (comma-separated).`;
    const content = await openaiChat(
      [
        { role: 'system', content:  'You are an expert academic writer. STRICT RULES: ' +
 '1) NEVER invent works. 2) NEVER write (Author, Year) or [1] yourself. ' +
 '3) When a sentence uses a source, append ONLY a marker like {{cite:key1,key2}} immediately after that sentence. ' +
 '4) Use ONLY the keys provided in the refs list. ' +
 '5) Use AT LEAST four distinct keys per section; do NOT reuse the same key more than twice. ' +
 '6) If unsure, omit the marker.' },
        { role: 'user', content: prompt }
      ],
      'gpt-4o-mini',
      0.4
    );
    const suggestions = content.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 10);
    res.json({ suggestions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'AI keywords failed' });
  }
});

api.post('/ai/draft', async (req, res) => {
  try {
    const {
      sectionName = 'Section',
      tone = 'neutral',
      styleId = 'ieee',
      context = {}
    } = req.body || {};

    const refsForAI = Array.isArray(context.refs) ? context.refs : [];
    const density = String(context.citationDensity || 'normal').toLowerCase(); // normal|dense|extra|extreme
    const lengthPreset = String(context.lengthPreset || 'extended').toLowerCase(); // brief|standard|extended|comprehensive
    const paragraphs = Math.max(1, Math.min(12, Number(context.paragraphs || 4)));

    const lenMap = {
      brief:        [150, 250],
      standard:     [300, 500],
      extended:     [700, 900],
      comprehensive:[1200, 1500]
    };
    const [minW, maxW] = lenMap[lengthPreset] || lenMap.extended;

    const densityRules = {
      normal:   'Cite at least once per paragraph; no more than 2 citations per sentence.',
      dense:    'Cite 1–2 sources in most substantive sentences; vary keys across the paragraph.',
      extra:    'Cite ~2–3 sources in most substantive sentences; do not reuse the same key more than twice.',
      extreme:  'Cite ~3–4 sources in nearly every sentence where appropriate; strictly avoid reusing the same key more than twice.'
    };
    const densityText = densityRules[density] || densityRules.normal;

    const systemMsg =
      'You are an expert academic writer. STRICT RULES:\n' +
      '1) NEVER invent works. Only use refs by their provided keys.\n' +
      '2) NEVER write author-year or numeric brackets yourself.\n' +
      '3) When a sentence uses a source, append ONLY a marker like {{cite:key1,key2}} immediately after that sentence.\n' +
      '4) Use multiple distinct keys across the section; do NOT overuse one key.\n' +
      '5) If unsure, omit the marker.\n';

    const userMsg =
`Write the "${sectionName}" in a ${tone} academic tone.

Target length: ~${minW}–${maxW} words across ${paragraphs} paragraphs (±10% is fine).
Citation density: ${density} — ${densityText}
Style family: ${styleId} (FYI; the app will format citations later).

Context JSON:
${JSON.stringify({
  title: context.title,
  discipline: context.discipline,
  keywords: context.keywords,
  notes: context.sectionNotes,
  refs: refsForAI  // array of {key, author, year, title}
}, null, 2)}

Guidelines:
- Structure into ${paragraphs} coherent paragraphs; keep topic sentences clear.
- Use the provided refs by their keys with {{cite:key}} markers exactly where evidence is used.
- Do NOT output a references list; only prose with markers.
`;

    const content = await openaiChat(
      [
        { role: 'system', content: systemMsg },
        { role: 'user',    content: userMsg }
      ],
      'gpt-4o-mini',
      0.5
    );

    res.json({ text: content });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'AI draft failed' });
  }
});


api.post('/ai/caption', async (req, res) => {
  try {
    const {
      kind = 'figure',          // 'figure' | 'table'
      id = '',
      filename = '',
      title = '',
      discipline = '',
      variables = '',           // e.g., "Shear rate (s⁻¹), viscosity (Pa·s), n=3"
      notes = ''                // any free text hints
    } = req.body || {};

    const sys =
      'You write concise, publication-ready captions for academic figures/tables. ' +
      'Be precise, neutral, and non-promotional. Prefer <40 words. ' +
      'Include variables/units if provided. Do not invent data. Do not cite references. ' +
      'Use a single sentence when possible.';

    const user =
`Compose a caption for a ${kind}.

Context:
- Manuscript Title: ${title || '(none)'}
- Discipline: ${discipline || '(none)'}
- ID: ${id || '(none)'}
- Filename: ${filename || '(none)'}
- Variables/Units: ${variables || '(none)'}
- Notes: ${notes || '(none)'}

Rules:
- Keep it clear and specific to what the ${kind} shows.
- Mention variables/units tersely if relevant.
- Avoid claims about performance beyond what is stated.
- No references or citations.
- Aim for ~20–40 words.`;

    const caption = await openaiChat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      'gpt-4o-mini',
      0.3
    );
    res.json({ caption: (caption || '').trim() });
  } catch (e) {
    console.error('AI caption error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'AI caption failed' });
  }
});

api.post('/ai/propose-visuals', async (req, res) => {
  try {
    const {
      title = '',
      discipline = '',
      resultsText = '',
      discussionText = '',
      length = 'medium',      // 'short'|'medium'|'long'
      maxItems = 3,
      allowExternal = false
    } = req.body || {};

    const sys = 'You are an academic visual design assistant. Output JSON ONLY.';
    const lenGuide = length === 'short' ? 'one short paragraph (~80-120 words)'
                    : length === 'long'  ? 'one long paragraph (~300-400 words)'
                    :                      'one medium paragraph (~180-250 words)';
    const user =
`Task: Propose up to ${maxItems} visuals (figures or tables) that would best support the manuscript's Results and Discussion.

Context:
- Title: ${title}
- Discipline: ${discipline}
- Results excerpt:
${(resultsText||'').slice(0,4000)}
- Discussion excerpt:
${(discussionText||'').slice(0,4000)}

Rules:
- For each proposal, choose kind: "figure" or "table".
- Suggest a concise id (kebab-case), a short title, a caption skeleton (include variables/units), and a placement suggestion:
  - placement.section: "Results" or "Discussion"
  - placement.anchor: the exact sentence or short substring AFTER which to insert
- Provide ${lenGuide} of write-up text that describes the visual (no new claims).
- Prefer visuals that map to claims already in the text. NO invented data.
- If suggesting external visuals, include "source" and "license"; ONLY if allowExternal is true.
- Do NOT modify numbers/units/citations. Do NOT output anything except JSON.

Respond with:
{ "proposals": [
  { "kind":"figure|table","id":"string","title":"string",
    "caption":"string","variables":"string",
    "placement":{"section":"Results|Discussion","anchor":"string"},
    "paragraphs":["string"]
  }
] }`;

    const content = await openaiChat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      'gpt-4o-mini',
      0.4
    );

    let json = null;
    try { json = JSON.parse(content); } catch { /* attempt to extract JSON */ 
      const m = content.match(/\{[\s\S]*\}$/); 
      json = m ? JSON.parse(m[0]) : null;
    }
    if (!json || !Array.isArray(json.proposals)) return res.json({ proposals: [] });
    res.json({ proposals: json.proposals.slice(0, maxItems) });
  } catch (e) {
    console.error('propose-visuals error:', e?.message || e);
    res.status(500).json({ error: 'propose-visuals failed' });
  }
});

api.post('/ai/place-visual', async (req, res) => {
  try {
    const {
      title = '',
      discipline = '',
      kind = 'figure',    // 'figure' | 'table'
      id = '',
      variables = '',
      notes = '',
      caption = '',
      manuscriptSections = [], // [{name, text}]
      length = 'medium'        // 'short'|'medium'|'long'
    } = req.body || {};

    const sys = 'You are an academic visual placement assistant. Output JSON ONLY.';
    const lenGuide = length === 'short' ? 'one short paragraph (~80-120 words)'
                    : length === 'long'  ? 'one long paragraph (~300-400 words)'
                    :                      'one medium paragraph (~180-250 words)';

    const user =
`Task: Suggest the best placement for a ${kind} with id "${id}" in the manuscript and draft ${lenGuide} describing it.

Context:
- Manuscript title: ${title}
- Discipline: ${discipline}
- Visual meta:
  - variables/units: ${variables}
  - notes: ${notes}
  - caption: ${caption}

Sections:
${manuscriptSections.map(s => `### ${s.name}\n${(s.text||'').slice(0,2000)}`).join('\n\n')}

Rules:
- placement.section must be the section name as provided.
- placement.anchor must be the exact sentence or a short snippet AFTER which the token should be inserted.
- Provide one paragraph describing the visual in neutral academic tone. No invented data. Do not modify numbers/units/citations.
- Output JSON ONLY:
{ "suggestion": {
    "placement": {"section":"name","anchor":"string"},
    "paragraphs": ["string"]
  }
} `;

    const content = await openaiChat(
      [{ role:'system', content: sys }, { role:'user', content: user }],
      'gpt-4o-mini',
      0.4
    );

    let json = null;
    try { json = JSON.parse(content); } catch { 
      const m = content.match(/\{[\s\S]*\}$/); 
      json = m ? JSON.parse(m[0]) : null;
    }
    if (!json || !json.suggestion) return res.json({ suggestion: null });
    res.json({ suggestion: json.suggestion });
  } catch (e) {
    console.error('place-visual error:', e?.message || e);
    res.status(500).json({ error: 'place-visual failed' });
  }
});



// ---- DOCX Export (markdown-ish headings) ----
api.post('/export/docx', async (req, res) => {
  try {

    const { content = '', filename = 'manuscript.docx', figMedia = {}, tabData = {} } = req.body || {};

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'No content provided' });
    }

const {
  Document, Packer, Paragraph, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ImageRun
} = require('docx');




function parseMarkdownTable(mdLines) {
  // mdLines: array of lines between our markers [[AI-TABLEMD START ...]] and [[AI-TABLEMD END ...]]
  // Expect GitHub-style pipes. We'll ignore non-table lines defensively.
  const rows = mdLines
    .map(l => l.trim())
    .filter(l => l.startsWith('|') && l.endsWith('|'));

  if (rows.length < 2) return { headers: [], body: [] };

  const header = rows[0].slice(1, -1).split('|').map(s => s.trim());
  const sep = rows[1]; // | --- | --- |
  const dataRows = rows.slice(2).map(r => r.slice(1, -1).split('|').map(s => s.trim()));

  return { headers: header, body: dataRows };
}


function makeDocxTableFromDataset(ds){
  const headers = Array.isArray(ds?.columns) ? ds.columns : [];
  const body    = Array.isArray(ds?.rows)    ? ds.rows    : [];
  const headerRow = headers.length
    ? new TableRow({
        children: headers.map(h => new TableCell({ children: [ new Paragraph(String(h)) ] }))
      })
    : null;
  const bodyRows = body.map(r =>
    new TableRow({
      children: r.map(cell => new TableCell({ children: [ new Paragraph(String(cell ?? '')) ] }))
    })
  );
  const rows = headerRow ? [headerRow, ...bodyRows] : bodyRows;
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}


    
function makeDocxTable({ headers, body }) {
  // Build header row (if present)
  const headerRow = headers.length
    ? new TableRow({
        children: headers.map(h =>
          new TableCell({
            children: [ new Paragraph(h) ],
          })
        )
      })
    : null;

  const bodyRows = body.map(r =>
    new TableRow({
      children: r.map(cell =>
        new TableCell({ children: [ new Paragraph(cell) ] })
      )
    })
  );

  const rows = headerRow ? [headerRow, ...bodyRows] : bodyRows;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows
  });
}


function dataUrlToBuffer(durl){
  try {
    const m = durl.match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/i);
    if (!m) return null;
    return Buffer.from(m[3], 'base64');
  } catch { return null; }
}

function imageParasForToken(tokenId){
  const meta = figMedia[tokenId];
  if (!meta || !meta.dataUrl) return null;             // no media, skip
  const buf = dataUrlToBuffer(meta.dataUrl);
  if (!buf) return null;                               // unsupported format (e.g., SVG) or bad data URL

  // Default size (px). You can tune this later or derive ratio if you add width/height.
  const width = 480;
  const height = 360;

  const img = new ImageRun({
    data: buf,
    transformation: { width, height }
  });

  const pImg = new Paragraph({ children: [img], alignment: AlignmentType.CENTER });
  const cap  = meta.caption ? meta.caption : `Figure: ${tokenId}`;
  const pCap = new Paragraph({ text: cap, alignment: AlignmentType.CENTER });

  return [pImg, pCap];
}

    
    // Simple markdown-ish parse: "# " → H1, "## " → H2, otherwise normal para
// Parse text into DOCX elements (H1/H2/H3, paragraphs, and real tables from [[AI-TABLEMD ...]] blocks)
const lines = String(content).split(/\r?\n/);
const children = [];

for (let i = 0; i < lines.length; i++) {
  let raw = lines[i];
  let line = raw.replace(/\s+$/, '');

  if (!line.trim()) {
    children.push(new Paragraph(''));
    continue;
  }

  // Table block start?
  const mdStart = line.match(/^\s*\[\[AI-TABLEMD START (fig|tab):([^\]]+)\]\]\s*$/);
  if (mdStart) {
    // Collect lines until END marker
    const bodyLines = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const endMatch = lines[j].match(/^\s*\[\[AI-TABLEMD END (fig|tab):([^\]]+)\]\]\s*$/);
      if (endMatch) break;
      bodyLines.push(lines[j]);
    }
    // Convert to DOCX Table
    const parsed = parseMarkdownTable(bodyLines);
    const table = makeDocxTable(parsed);
    children.push(table);
    i = j; // jump to end marker line; loop will i++ to next line
    continue;
  }

  // Figure token on its own line?  {fig:ID}
  const figTok = line.match(/^\s*\{fig:([a-z0-9\-_]+)\}\s*$/i);
  if (figTok) {
    const id = figTok[1];
    const paras = imageParasForToken(id);
    if (paras) {
      children.push(...paras);
    } else {
      // fallback: leave a placeholder paragraph if no media found
      children.push(new Paragraph({ text: `[Missing figure: ${id}]`, alignment: AlignmentType.CENTER }));
    }
    continue;
  }


    // Table token on its own line?  {tab:ID}
  const tabTok = line.match(/^\s*\{tab:([a-z0-9\-_]+)\}\s*$/i);
  if (tabTok) {
    const id = tabTok[1];
    const ds = tabData[id];
    if (ds) {
      const table = makeDocxTableFromDataset(ds);
      children.push(table);
      // Optional caption
      if (ds.caption) {
        children.push(new Paragraph({ text: ds.caption, alignment: AlignmentType.CENTER }));
      }
    } else {
      // fallback: keep placeholder if we have no dataset
      children.push(new Paragraph({ text: `[Table: ${id}]`, alignment: AlignmentType.CENTER }));
    }
    continue;
  }


  
  // Headings H1/H2/H3
  if (line.startsWith('### ')) {
    children.push(new Paragraph({
      text: line.slice(4),
      heading: HeadingLevel.HEADING_3,
      alignment: AlignmentType.JUSTIFIED
    }));
    continue;
  }
  if (line.startsWith('## ')) {
    children.push(new Paragraph({
      text: line.slice(3),
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.JUSTIFIED
    }));
    continue;
  }
  if (line.startsWith('# ')) {
    children.push(new Paragraph({
      text: line.slice(2),
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.JUSTIFIED
    }));
    continue;
  }

  // Normal paragraph
  children.push(new Paragraph({ text: line, alignment: AlignmentType.JUSTIFIED }));
}

const doc = new Document({
  sections: [{ properties: {}, children }]
});


    const buffer = await Packer.toBuffer(doc);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    return res.send(buffer);
  } catch (e) {
    console.error('DOCX export error:', e?.message || e);
    res.status(500).json({ error: 'DOCX export failed' });
  }
});





api.post('/ai/generate-tables', async (req, res) => {
  try {
    const {
      title = '',
      discipline = '',
      manuscriptSections = [],   // [{ name, text }]
      count = 2,                 // number of tables to propose
      length = 'medium'          // 'short'|'medium'|'long'
    } = req.body || {};

    const n = Math.max(1, Math.min(Number(count) || 2, 5));
    const len = String(length || 'medium').toLowerCase();

    const sys = 'You are an academic table design assistant. Output JSON ONLY. No prose.';
    const lenGuide = len === 'short' ? 'one short paragraph (~80-120 words)'
                   : len === 'long'  ? 'one long paragraph (~300-400 words)'
                   :                   'one medium paragraph (~180-250 words)';

    const safeSections = Array.isArray(manuscriptSections) ? manuscriptSections : [];
    const sectionBlock = safeSections.map(s => {
      const nm = (s?.name || '').toString().slice(0, 100);
      const tx = (s?.text || '').toString().slice(0, 1200);
      return `### ${nm}\n${tx}`;
    }).join('\n\n');

    const user =
`Task: Propose ${n} distinct data tables suitable for the Results or Discussion of this manuscript. Tables must be non-overlapping in topic.

Context:
- Title: ${title}
- Discipline: ${discipline}
- Sections (excerpts):
${sectionBlock}

For each proposed table:
- Must be UNIQUE in topic vs other proposals.
- Provide a kebab-case id (e.g., "qds-lod-comparison"), a short title, a caption (mention variables/units).
- Provide columns array (max 8 columns), and rows (max ~20 rows) with plausible, logical values consistent with the text.
- If counts/samples/time are natural, pick sensible sizes (e.g., n=3–10; times in mins/hours; realistic magnitudes).
- Provide placement: section name ("Results"|"Discussion") and an anchor sentence (exact or short substring) AFTER which to insert the token.
- Provide ${lenGuide} of write-up text to accompany the table (neutral, no invented claims).
- Provide exactly two supporting citations as identifiers in an array "citations": each item must be a DOI (e.g., "10.xxxx/..."), a PMID ("pmid:12345678"), or an arXiv id ("arxiv:2401.01234"). Do not format author names; only identifiers.
- If you cannot find suitable citations, leave "citations":[]



STRICT RULES:
- NO invented citations or references.
- Preserve meaning from context; do not contradict the manuscript.
- Output JSON ONLY with this shape:
{
  "tables": [
    { "id":"string","title":"string","caption":"string","variables":"string",
      "columns":["col1","col2",...],
      "rows":[ ["r1c1","r1c2",...], ["r2c1","r2c2",...] ],
      "placement":{"section":"Results|Discussion","anchor":"string"},
     "paragraph": "string",
     "citations": ["doi:...","pmid:..."]
    }
  ]
}`;

    // ---- Call AI
    let content = '';
    try {
      content = await openaiChat(
        [{ role: 'system', content: sys }, { role: 'user', content: user }],
        'gpt-4o-mini',
        0.4
      );
    } catch (e) {
      console.error('generate-tables: openai error:', e?.response?.status, e?.response?.data || e);
      return res.json({ tables: [], error: 'ai-failed' });
    }

    // ---- Parse JSON robustly
    const tryParse = (txt) => {
      try { return JSON.parse(txt); } catch { return null; }
    };

    let json = tryParse(content);
    if (!json) {
      // Try to extract JSON in a code fence ```json ... ```
      const fence = content.match(/```json([\s\S]*?)```/i);
      if (fence) json = tryParse(fence[1]);
    }
    if (!json) {
      // Try to grab from first { to last }
      const m = content.match(/\{[\s\S]*\}$/);
      if (m) json = tryParse(m[0]);
    }

    if (!json || !Array.isArray(json.tables)) {
      console.warn('generate-tables: no JSON tables parsed. Raw head:', String(content).slice(0, 180));
      return res.json({ tables: [] });
    }

    // ---- Light caps on size
    const tables = json.tables.slice(0, n).map(t => ({
      id: (t?.id || '').toString().trim().slice(0, 64) || 'table',
      title: (t?.title || '').toString().slice(0, 200),
      caption: (t?.caption || '').toString().slice(0, 800),
      variables: (t?.variables || '').toString().slice(0, 400),
      columns: Array.isArray(t?.columns) ? t.columns.slice(0, 8).map(c => String(c||'').slice(0,120)) : [],
      rows: Array.isArray(t?.rows) ? t.rows.slice(0, 20).map(r => Array.isArray(r) ? r.map(c=>String(c??'').slice(0,200)) : []) : [],
      placement: {
        section: (t?.placement?.section || '').toString().slice(0, 100),
        anchor: (t?.placement?.anchor || '').toString().slice(0, 400)
      },
      paragraph: (t?.paragraph || '').toString().slice(0, 1200),
      citations: Array.isArray(t?.citations) ? t.citations.slice(0,2).map(x=>String(x||'').slice(0,200)) : []
    }));

    return res.json({ tables });
  } catch (e) {
    console.error('generate-tables error:', e?.message || e);
    // Return a friendly JSON instead of 500, so the UI doesn’t break
    return res.json({ tables: [], error: 'server-failed' });
  }
});




app.use('/api', api);

// --- Static (no CORS here) ---
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));

// --- hardening ---
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); });
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server on :${PORT}`));


// ---summarize ---
api.post('/ai/humanize', async (req, res) => {
  try {
    // --- strip chatty scaffolding from AI replies ---
    function sanitizeChattyScaffolding(s=''){
      let out = String(s);

      // Drop obviously chatty lines
      const badLine = /^(Of course|Sure|Certainly|I can|I'd be happy to|Please provide|As an AI|Here is|Let me|Great!|Thanks for|No problem)/i;
      out = out.split(/\r?\n/).filter(line => !badLine.test(line.trim())).join('\n');

      // Remove "Here's …:" without any content after it
      out = out.replace(/Here(?:’|')s[^:]*:\s*$/i, '');

      // Trim extra spaces
      out = out.replace(/\s{2,}/g, ' ').trim();
      return out;
    }

    const {
      text = '',
      degree = 'light',        // backward-compat: 'light' | 'medium'
      level = null,            // 'proofread' | 'light' | 'medium' | 'heavy' | 'extreme' | 'ultra'
      context = ''             // optional grounding context from client
    } = req.body || {};

    if (!text || text.trim().length < 20) {
      return res.json({ text }); // nothing to do
    }

    const mode = String(level || degree || 'light').toLowerCase();

    // Map levels to concise instructions
    const modeRules = {
      'proofread':
        'Proofread only. Fix grammar, punctuation, minor clarity. NO paraphrasing. Keep sentence order and boundaries. ' +
        'NEVER change numbers/units, citations, or tokens like {fig:..}/{tab:..}.',
      'light':
        'Light paraphrase. Improve rhythm/flow. Keep sentence structure mostly intact. ' +
        'Do NOT change numbers/units or tokens {fig:..}/{tab:..}. Do NOT add/move citations.',
      'medium':
        'Moderate paraphrase. Merge/split some sentences. Improve transitions. ' +
        'Preserve facts, numbers/units, citations, and tokens {fig:..}/{tab:..}.',
      'heavy':
        'Heavy sentence-level rewrite for clarity. May reorder sentences WITHIN the paragraph only. ' +
        'Preserve paragraph boundaries, facts, numbers/units, citations, and tokens {fig:..}/{tab:..}.',
      'extreme':
        'Strong rewrite within each paragraph for maximum clarity/conciseness. Keep paragraph boundaries. ' +
        'NEVER alter numbers/units, citations, or tokens {fig:..}/{tab:..}.',
      'ultra':
        'Maximum fluency per paragraph. Compress redundancies and polish style. Keep paragraph boundaries. ' +
        'Absolutely preserve numbers/units, citations, and tokens {fig:..}/{tab:..}.'
    };
    const rules = modeRules[mode] || modeRules['light'];

    // NEW: define ctx and systemMsg (were missing)
    const ctx = String(context || '').slice(0, 6000);

    const systemMsg =
      'You are a precise academic editor. Your output must preserve meaning, factual content, all numbers/units, ' +
      'citations (e.g., [1] or (Author, 2020)), and tokens like {fig:ID}/{tab:ID}. Do not invent facts or citations. ' +
      'Prefer wording that stays grounded in the evidence snippets when provided.';

    const cadenceHints = ctx ? (
      'Natural cadence:\n' +
      '- Vary sentence lengths (include some short ≤12-word sentences and a few long >35-word sentences per section).\n' +
      '- Rotate paragraph openers (e.g., “Notably,” “In practical terms,” “We observed,” “Two observations follow.”).\n' +
      '- Allow sparse em-dashes/parentheticals (≤1 per paragraph). Avoid boilerplate openers (e.g., “In recent years,” “It is worth noting”).\n'
    ) : '';

    const userMsg =
`Edit the following section according to these rules:
${rules}
${cadenceHints}

${ctx ? `EVIDENCE SNIPPETS (for context; do not quote verbatim unless necessary):
${ctx}

` : ''}TEXT:
${text.slice(0, 12000)}`;

    let out = await openaiChat(
      [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
      'gpt-4o-mini',
      mode === 'proofread' ? 0.1 : mode === 'light' ? 0.3 : mode === 'medium' ? 0.5 : 0.6
    );

    // sanitize chatty scaffolding before returning to client
    out = sanitizeChattyScaffolding(out || '');
    return res.json({ text: out });
  } catch (e) {
    console.error('AI humanize error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'AI humanize failed' });
  }
});


