import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import axios from 'axios';
import { RateLimiterMemory } from 'rate-limiter-flexible';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- Basic security / logging ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));

// --- CORS allowlist ---
const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
 const corsCheck = cors({
   origin: (origin, cb) => {
     // Allow same-origin (no Origin header), and any explicitly allowed origin
     if (!origin) return cb(null, true);
     if (allowed.includes(origin)) return cb(null, true);
     // Also allow requests where the Origin matches our own host (Heroku dyno)
     return cb(new Error('CORS: Origin not allowed'), false);
   }
 });



 // --- Rate limit (per IP) only for /api ---
 const points = Number(process.env.RATE_LIMIT_RPM || 30);
 const rateLimiter = new RateLimiterMemory({ points, duration: 60 });
 const rateLimitMiddleware = async (req, res, next) => {
   try { await rateLimiter.consume(req.ip); next(); }
   catch { res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' }); }
 };

// --- Health ---
app.get('/api/health', (req, res) => res.json({ ok: true }));

// --- AI proxy routes (stubs that call OpenAI) ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

async function openaiChat(messages, model = 'gpt-4o-mini', temperature = 0.4) {
  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const resp = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model, temperature, messages },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  return resp.data?.choices?.[0]?.message?.content || '';
}

app.post('/api/ai/keywords', async (req, res) => {
  try {
    const { title = '', abstract = '', discipline = '', seedKeywords = [] } = req.body || {};
    const prompt = `Title: ${title}\nDiscipline: ${discipline}\nAbstract: ${abstract}\nSeed keywords: ${seedKeywords.join(', ')}\n\nSuggest 5–10 academically-relevant keywords (comma-separated).`;
    const content = await openaiChat([
      { role: 'system', content: 'You are an academic writing assistant.' },
      { role: 'user', content: prompt }
    ]);
    const suggestions = content.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 10);
    res.json({ suggestions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai/draft', async (req, res) => {
  try {
    const { sectionName = 'Section', tone = 'neutral', styleId = 'ieee', context = {} } = req.body || {};
    const prompt = `Write the "${sectionName}" of a journal article in ${tone} academic tone, following ${styleId} citation conventions in-text (don't format references list). Use the following context. Keep it clean text.
Context JSON:
${JSON.stringify(context, null, 2)}
`;
    const content = await openaiChat([
      { role: 'system', content: 'You are an expert academic writer who drafts clean, human-sounding prose.' },
      { role: 'user', content: prompt }
    ], 'gpt-4o-mini', 0.5);
    res.json({ text: content, tokensUsed: undefined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai/humanize', async (req, res) => {
  try {
    const { text = '', degree = 'light' } = req.body || {};
    const prompt = `Rewrite the following text to sound natural and varied (${degree} variation). Keep meaning and references intact.\n\n${text}`;
    const content = await openaiChat([
      { role: 'system', content: 'You subtly vary phrasing, rhythm, and syntax while preserving meaning.' },
      { role: 'user', content: prompt }
    ], 'gpt-4o-mini', 0.7);
    res.json({ text: content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Static serve Vite build ---
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));

// --- Boot ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on :${PORT}`);
});
