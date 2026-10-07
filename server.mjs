// What Do You Do? — an LLM TRPG table. Zero-dependency Node server: static UI, SSE, and
// the round engine (lib/engine.mjs) driving one GM seat and several player seats, each a
// headless call to a CLI the user is logged into (or the built-in demo bot).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Backends, killAll, BACKENDS } from './lib/backends.mjs';
import { Store } from './lib/store.mjs';
import { Engine } from './lib/engine.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOME_DIR = process.env.WDYD_HOME ? path.resolve(process.env.WDYD_HOME) : ROOT;

const DEFAULT_CFG = {
  port: 8420,
  host: '127.0.0.1',
  userName: '방장',
  demo: false, // true: only the demo bot, no CLI calls
  bins: {},
  turnTimeoutSec: 150,
  maxInFlight: 3,
  historyWindow: 40, // log lines each prompt sees
  declareMode: 'sequential', // 'sequential': AI players declare one by one and see each other / 'parallel'
  waitForUser: true, // the GM waits for the human player's declaration each round
  targetRounds: 12,
  autoPauseRounds: 8, // spectator: pause after this many rounds without a word from the human (0 = never)
  mockDelayMs: 700,
  backends: {
    claude: { model: 'sonnet' },
    codex: { model: 'gpt-6-sol', effort: 'low' },
    grok: { model: 'grok-4.7', effort: 'low' },
    agy: { model: 'gemini-3.8-flash-medium' },
  },
  gmModel: {}, // per-backend model override for the GM seat, e.g. {"claude": "opus"}
};

function loadConfig() {
  const file = process.env.WDYD_CONFIG || path.join(HOME_DIR, 'config.json');
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') console.error(`config.json을 읽지 못했어요: ${e.message}`);
  }
  const cfg = { ...DEFAULT_CFG, ...user };
  cfg.backends = { ...DEFAULT_CFG.backends };
  for (const [k, v] of Object.entries(user.backends || {})) cfg.backends[k] = { ...cfg.backends[k], ...v };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.WDYD_DEMO === '1' || process.argv.includes('--demo')) cfg.demo = true;
  return cfg;
}

const cfg = loadConfig();
const clients = new Set();
function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

const backends = new Backends(HOME_DIR, cfg);
const store = new Store(HOME_DIR);
const engine = new Engine({ backends, store, cfg, emit: broadcast });

// ---------------------------------------------------------------------------
// HTTP

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// Only same-origin page scripts may change the table (blocks drive-by POSTs from other sites).
function trustedPost(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`event: init\ndata: ${JSON.stringify({ state: engine.view(), log: engine.logTail() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (route === 'GET /api/state') return sendJson(res, 200, engine.view());
  if (route === 'GET /api/secrets') return sendJson(res, 200, engine.secrets());
  if (route === 'GET /api/log') return sendJson(res, 200, engine.logTail(5000));
  if (req.method !== 'POST') return sendJson(res, 404, { error: 'not found' });
  if (!trustedPost(req)) return sendJson(res, 403, { error: 'forbidden' });
  let body;
  try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'bad body' }); }
  let err = null;
  switch (url.pathname) {
    case '/api/campaign': engine.newCampaign(body); break;
    case '/api/post': err = engine.userPost(body.mode, body.text); break;
    case '/api/pass': err = engine.userPass(); break;
    case '/api/roll': err = engine.userRollCheck(body.id); break;
    case '/api/choose': err = engine.userChoose(body.id, body.picks, body.text); break;
    case '/api/pause': engine.setPaused(!!body.paused); break;
    default: return sendJson(res, 404, { error: 'not found' });
  }
  return sendJson(res, err ? 400 : 200, err ? { error: err } : { ok: true });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(ROOT, 'public', rel);
  if (!file.startsWith(path.join(ROOT, 'public') + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'server error' });
  }
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `포트 ${cfg.port}이(가) 이미 쓰이고 있어요. config.json의 port를 바꿔 주세요.` : e);
  process.exit(1);
});

server.listen(cfg.port, cfg.host, () => {
  const avail = backends.available();
  console.log(`\n  🎲 What Do You Do? — http://localhost:${cfg.port}\n`);
  for (const [k, b] of Object.entries(BACKENDS)) {
    if (k === 'mock') continue;
    const where = backends.bins[k] || '(CLI 없음)';
    console.log(`  ${avail[k] ? '●' : '○'} ${b.label.padEnd(8)} ${where}${cfg.demo && backends.bins[k] ? ' (데모 모드라 안 씀)' : ''}`);
  }
  if (cfg.demo) console.log('\n  데모 모드: 모든 자리를 데모봇이 맡아요.');
  console.log('\n  Ctrl+C로 끕니다.\n');
});

function shutdown() {
  killAll();
  if (engine.c) store.saveNow(engine.c);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
