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
        { role: 'system', content: 'You are an expert academic writer. NEVER invent citations. Do not add bracketed citations yourself; the app will insert them.' },
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

    // We pass the model a compact list of refs: [{key, author, year, title}]
    const refsForAI = Array.isArray(context.refs) ? context.refs : [];
    const density = context.citationDensity === 'dense' ? 'dense' : 'normal';

    const systemMsg =
      'You are an expert academic writer. NEVER invent citations. ' +
      'Use ONLY the provided refs list (with their keys). ' +
      'When a sentence draws on a source, append a marker like {{cite:key1,key2}} ' +
      '(do NOT format the citation yourself). ' +
      'If uncertain, omit the marker. Keep prose human and academic.';

    const userMsg =
`Write the "${sectionName}" section in a ${tone} academic tone.
Style family: ${styleId} (for info only; the app will format).
Citation density: ${density} (dense = cite most substantive sentences; normal = 1–2 per paragraph).
Context JSON:
${JSON.stringify({
  title: context.title,
  discipline: context.discipline,
  keywords: context.keywords,
  notes: context.sectionNotes,
  refs: refsForAI   // [{ key, author, year, title }]
}, null, 2)}
Guidelines:
- Use the refs keys in {{cite:...}} right after the sentence(s) they support.
- Prefer 1–2 refs per sentence for "dense", fewer for "normal".
- Do not fabricate new works or keys.
- No reference list; just prose with markers.
`;

    const content = await openaiChat(
      [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
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
