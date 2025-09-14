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
        { role: 'system', content: 'You are an academic writing assistant.' },
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
    const { sectionName = 'Section', tone = 'neutral', styleId = 'ieee', context = {} } = req.body || {};
    const prompt = `Write the "${sectionName}" of a journal article in ${tone} academic tone, following ${styleId} in-text citation conventions (do not output the references list). Use this context:\n${JSON.stringify(context, null, 2)}`;
    const content = await openaiChat(
      [
        { role: 'system', content: 'You are an expert academic writer who drafts clean, human-sounding prose.' },
        { role: 'user', content: prompt }
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
