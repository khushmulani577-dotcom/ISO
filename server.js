import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const entry = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (entry && process.env[entry[1]] === undefined) process.env[entry[1]] = entry[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.AI_API_KEY;
const aiProvider = (process.env.AI_PROVIDER || 'openai-compatible').toLowerCase();
const aiBaseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const aiModel = process.env.AI_MODEL || (aiProvider === 'gemini' ? 'gemini-3.8-flash' : 'gpt-4o-mini');
const secureCookie = process.env.NODE_ENV === 'production';

// Fictional prototype accounts. Keep this module server-side; replace with a persistent,
// salted password-hash identity provider before deploying for real users.
const accounts = new Map([
  ['9000000001', { password: 'ISO@User01#7', name: 'User 01' }],
  ['9000000002', { password: 'ISO@User02#8', name: 'User 02' }],
  ['9000000003', { password: 'ISO@User03#9', name: 'User 03' }],
  ['9000000004', { password: 'ISO@User04#4', name: 'User 04' }],
  ['9000000005', { password: 'ISO@User05#6', name: 'User 05' }],
  ['9000000006', { password: 'ISO@User06#2', name: 'User 06' }],
  ['9000000007', { password: 'ISO@User07#5', name: 'User 07' }],
  ['9000000008', { password: 'ISO@User08#3', name: 'User 08' }],
  ['9000000009', { password: 'ISO@User09#1', name: 'User 09' }],
  ['9000000010', { password: 'ISO@User10#0', name: 'User 10' }]
]);
const sessions = new Map();
const attempts = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(data));
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => part.trim().split(/=(.*)/s)).filter(([key, value]) => key && value !== undefined));
}
function sessionUser(req) {
  const id = cookies(req).iso_session;
  const session = id && sessions.get(id);
  if (!session) return null;
  if (session.expires < Date.now()) { sessions.delete(id); return null; }
  return { id: session.userId, name: session.name };
}
function readBody(req, max = 64 * 1024) {
  return new Promise((resolveBody, reject) => {
    let data = ''; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > max) { reject(new Error('Request too large')); req.destroy(); } else data += chunk; });
    req.on('end', () => { try { resolveBody(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function same(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function publicUser(user) { return { name: user.name }; }
function originAllowed(req) {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
}
function loginKey(req) { return req.socket.remoteAddress || 'unknown'; }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/session') {
      const user = sessionUser(req);
      return user ? json(res, 200, { user: publicUser(user) }) : json(res, 401, { error: 'Unauthenticated' });
    }
    if (url.pathname.startsWith('/api/')) {
      if (!originAllowed(req)) return json(res, 403, { error: 'Request origin rejected' });
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const key = loginKey(req); const now = Date.now();
        const prior = (attempts.get(key) || []).filter((time) => now - time < 60_000);
        if (prior.length >= 12) return json(res, 429, { error: 'Access denied.' });
        prior.push(now); attempts.set(key, prior);
        const body = await readBody(req, 4096);
        const account = accounts.get(String(body.mobile || ''));
        const expected = account?.password || 'invalid-password-sentinel';
        if (!account || !same(body.password || '', expected)) return json(res, 401, { error: 'Access denied.' });
        const id = randomBytes(32).toString('base64url');
        const user = { userId: String(body.mobile), name: account.name, expires: now + 8 * 60 * 60 * 1000 };
        sessions.set(id, user);
        return json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': `iso_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie ? '; Secure' : ''}` });
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        const id = cookies(req).iso_session; if (id) sessions.delete(id);
        return json(res, 200, { ok: true }, { 'Set-Cookie': 'iso_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      const user = sessionUser(req);
      if (!user) return json(res, 401, { error: 'Your ISO session has ended. Please sign in again.' });
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        if (!apiKey) return json(res, 503, { error: 'ISO is temporarily unable to reach its intelligence service. Please try again.' });
        const body = await readBody(req, 32 * 1024);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message || message.length > 8000) return json(res, 400, { error: 'Please send a message under 8,000 characters.' });
        const history = Array.isArray(body.conversationHistory) ? body.conversationHistory.slice(-16).map((item) => ({
          role: item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : null,
          content: typeof item?.content === 'string' ? item.content.slice(0, 8000) : ''
        })).filter((item) => item.role && item.content) : [];
        const messages = [
          { role: 'system', content: 'You are ISO, a private intelligent voice assistant. Communicate naturally in English. Be intelligent, calm, clear, helpful, conversational, context-aware, and professional. Do not repeatedly introduce yourself or begin every response with “Certainly”. Be concise for simple questions and detailed for complex ones. You communicate in English only. If the user speaks or explicitly requests a response in another language, respond exactly: “ISO currently communicates in English only.”' },
          ...history,
          { role: 'user', content: message }
        ];
        let upstream;
        try {
          const request = aiProvider === 'gemini'
            ? {
                url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(aiModel)}:generateContent`,
                headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
                body: {
                  systemInstruction: { parts: [{ text: messages[0].content }] },
                  contents: messages.slice(1).map((item) => ({
                    role: item.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: item.content }]
                  })),
                  generationConfig: { temperature: 0.65 }
                }
              }
            : {
                url: `${aiBaseUrl}/chat/completions`,
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: { model: aiModel, messages, temperature: 0.65 }
              };
          upstream = await fetch(request.url, {
            method: 'POST', headers: request.headers,
            body: JSON.stringify(request.body), signal: AbortSignal.timeout(45_000)
          });
        } catch (error) {
          console.error('AI provider connection failed:', error.message);
          return json(res, 503, { error: 'ISO is temporarily unable to reach its intelligence service. Please try again.' });
        }
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          console.error(`AI provider returned ${upstream.status}:`, detail.slice(0, 500));
          return json(res, 503, { error: 'ISO is temporarily unable to reach its intelligence service. Please try again.' });
        }
        const result = await upstream.json();
        const reply = aiProvider === 'gemini'
          ? result.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
          : result.choices?.[0]?.message?.content?.trim();
        if (!reply) return json(res, 503, { error: 'ISO is temporarily unable to reach its intelligence service. Please try again.' });
        return json(res, 200, { reply });
      }
      return json(res, 404, { error: 'Not found' });
    }

    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(root, `.${normalize(requested)}`);
    if (!(file === root || file.startsWith(root + sep)) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch (error) {
    if (!res.headersSent) json(res, error.message === 'Invalid JSON' ? 400 : error.message === 'Request too large' ? 413 : 500, { error: error.message === 'Invalid JSON' ? 'Invalid JSON.' : error.message === 'Request too large' ? 'Request too large.' : 'ISO service error.' });
  }
});

server.listen(port, () => console.log(`ISO listening at http://localhost:${port}`));
for (const [id, session] of sessions) if (session.expires < Date.now()) sessions.delete(id);
