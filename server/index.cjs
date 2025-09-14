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
app.use(express.json({ limit: '1mb' }));

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


api.post('/ai/humanize', async (req, res) => {
  try {
    const { text = '', degree = 'light' } = req.body || {};
    const prompt = `Rewrite the following text to sound natural and varied (${degree} variation). Keep meaning and references intact.\n\n${text}`;
    const content = await openaiChat(
      [
        { role: 'system', content: 'You subtly vary phrasing, rhythm, and syntax while preserving meaning.' },
        { role: 'user', content: prompt }
      ],
      'gpt-4o-mini',
      0.7
    );
    res.json({ text: content });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'AI humanize failed' });
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
api.post('/ai/summarize', async (req, res) => {
  try {
    const { text = '', maxWords = 220, focus = '' } = req.body || {};
    if (!text || text.trim().length < 40) return res.json({ summary: '' });

    const systemMsg =
      'You are a domain expert summarizer. Extract the most decision-useful facts as tight bullets. Prefer concrete numbers, units, and named entities. No fluff.';

    const userMsg =
`Summarize the following into 5–10 bullet points (max ~${maxWords} words total).
If there are quantitative results, keep the numbers and units.
${focus ? `Focus on: ${focus}\n` : ''}
Text:
${text.slice(0, 8000)}
`;

    const out = await openaiChat(
      [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
      'gpt-4o-mini',
      0.3
    );
    res.json({ summary: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'AI summarize failed' });
  }
});
