// LLM backends: one headless CLI call per turn, through the CLIs the user is already
// logged into (claude, codex, grok, agy). No API keys. The invocation flags follow
// Moris-kr/ai-chatroom, which runs the same four CLIs with every tool disabled or denied.
//
// "mock" is a built-in fake backend: no model at all, just canned table talk. It lets the
// table run (and the tests pass) on a machine without any CLI.

import { spawn, execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { mockReply } from './mock.mjs';

const HOME = os.homedir();
const WIN = process.platform === 'win32';
const exe = (name) => (WIN ? `${name}.exe` : name);

export const BACKENDS = {
  claude: { label: 'Claude', maker: 'Anthropic', bin: 'claude', color: '#d97757' },
  codex: { label: 'ChatGPT', maker: 'OpenAI', bin: 'codex', color: '#10a37f' },
  grok: { label: 'Grok', maker: 'xAI', bin: 'grok', color: '#8b8b8b' },
  agy: { label: 'Gemini', maker: 'Google', bin: 'agy', color: '#4f8df5' },
  mock: { label: '데모봇', maker: '로컬', bin: null, color: '#a78bfa' },
};

const GROK_TOOLS = ['run_terminal_command', 'read_file', 'search_replace', 'list_dir', 'grep', 'kill_command_or_subagent',
  'todo_write', 'get_command_or_subagent_output', 'spawn_subagent', 'scheduler_create', 'scheduler_delete', 'scheduler_list',
  'monitor', 'search_tool', 'use_tool', 'workflow', 'enter_plan_mode', 'exit_plan_mode', 'ask_user_question', 'send_feedback',
  'image_gen', 'image_edit', 'image_to_video', 'reference_to_video', 'write', 'web_fetch'].join(',');

export function onPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const f = dir && path.join(dir, name);
    try { if (f && fs.statSync(f).isFile()) return f; } catch { /* not here */ }
  }
  return null;
}

function newestUnder(root, ...rest) {
  if (!root || !fs.existsSync(root)) return null;
  const hits = fs.readdirSync(root).map((d) => path.join(root, d, ...rest)).filter((f) => fs.existsSync(f));
  return hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

// Several Claude Code installs can coexist; use whichever reports the highest version.
function newestClaude(cands) {
  const cmp = (a, b) => {
    for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
    return 0;
  };
  let best = null, bestVer = null;
  for (const f of new Set(cands.filter((c) => c && fs.existsSync(c)))) {
    let ver;
    try {
      const out = execFileSync(f, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
      ver = (out.match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
    } catch { continue; }
    if (!bestVer || cmp(ver, bestVer) > 0) { best = f; bestVer = ver; }
  }
  return best;
}

// config.json "bins" ({claude, codex, grok, agy}: full paths) wins over PATH lookup.
export function resolveBins(overrides = {}) {
  const npmRoot = WIN ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'npm', 'node_modules') : null;
  const first = (...c) => c.find((f) => f && fs.existsSync(f)) || null;
  return {
    claude: overrides.claude || newestClaude([
      onPath(exe('claude')),
      path.join(HOME, '.local', 'bin', exe('claude')),
      npmRoot && path.join(npmRoot, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    ]),
    codex: overrides.codex || first(
      onPath(exe('codex')),
      WIN ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')
        : path.join(HOME, '.local', 'bin', 'codex'),
      WIN && newestUnder(path.join(HOME, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin'), 'codex.exe'),
      npmRoot && newestUnder(path.join(npmRoot, '@openai', 'codex', 'vendor'), 'codex', 'codex.exe'),
    ),
    grok: overrides.grok || first(onPath(exe('grok')), path.join(HOME, '.grok', 'bin', exe('grok'))),
    agy: overrides.agy || first(
      onPath(exe('agy')),
      WIN ? path.join(HOME, 'AppData', 'Local', 'agy', 'bin', 'agy.exe') : path.join(HOME, '.local', 'bin', 'agy'),
    ),
  };
}

export function killTree(pid) {
  if (!pid) return;
  if (WIN) { execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {}); return; }
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

const running = new Set();

export function run(cmd, args, { input, cwd, timeoutMs = 150000, env } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = [], err = [];
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true, detached: !WIN, env: env ? { ...process.env, ...env } : process.env });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e), ms: 0 });
      return;
    }
    running.add(child);
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => err.push(Buffer.from(String(e))));
    child.on('close', (code) => {
      clearTimeout(timer);
      running.delete(child);
      resolve({
        code: timedOut ? -2 : code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        ms: Date.now() - t0,
        timedOut,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

export function killAll() {
  for (const c of running) killTree(c.pid);
}

export class Backends {
  constructor(root, cfg) {
    this.root = root;
    this.cfg = cfg;
    this.bins = resolveBins(cfg.bins || {});
    this.agySessions = {};
  }

  available() {
    const out = {};
    for (const id of Object.keys(BACKENDS)) out[id] = id === 'mock' ? true : !!this.bins[id];
    if (this.cfg.demo) for (const id of Object.keys(out)) out[id] = id === 'mock';
    return out;
  }

  // Each seat gets its own empty working folder; CLIs that may read their cwd find nothing there.
  cwd(key) {
    const d = path.join(this.root, 'data', 'cwd', key);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  log(key, line) {
    const d = path.join(this.root, 'data', 'logs');
    fs.mkdirSync(d, { recursive: true });
    fs.appendFileSync(path.join(d, `${key}.log`), `${new Date().toISOString()} ${line}\n`);
  }

  // One turn. seat: {key, backend, model?, effort?}. brief = system prompt, turn = this
  // turn's context. ctx = structured view of the same turn (used only by the mock).
  async chat(seat, kind, brief, turn, ctx = {}) {
    const backend = seat.backend;
    if (backend === 'mock') {
      // Table talk is a short prompt for one line: it comes back sooner, as with a real CLI.
      const ms = (this.cfg.mockDelayMs ?? 700) * (kind === 'talk' ? 0.4 : 1);
      await new Promise((r) => setTimeout(r, ms * (0.5 + Math.random())));
      return { ok: true, text: JSON.stringify(mockReply(kind, ctx)), ms };
    }
    const bin = this.bins[backend];
    if (!bin) return { ok: false, text: '', detail: `${backend} CLI를 찾지 못했어요` };
    const defaults = this.cfg.backends?.[backend] || {};
    const a = { ...defaults, ...(seat.model ? { model: seat.model } : {}), ...(seat.effort ? { effort: seat.effort } : {}) };
    const timeoutMs = (this.cfg.turnTimeoutSec || 150) * 1000;
    const cwd = this.cwd(seat.key);
    let r, text;
    switch (backend) {
      case 'claude': {
        const sysFile = path.join(cwd, 'system.md');
        fs.writeFileSync(sysFile, brief);
        const args = ['-p', '--model', a.model || 'sonnet', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
          '--setting-sources', '', '--system-prompt-file', sysFile];
        if (a.effort) args.push('--effort', a.effort);
        r = await run(bin, args, { input: turn, cwd, timeoutMs });
        text = r.stdout;
        break;
      }
      case 'codex': {
        const outFile = path.join(cwd, `reply-${crypto.randomUUID()}.txt`);
        const args = ['exec', '-m', a.model, '-c', `model_reasoning_effort="${a.effort || 'low'}"`,
          '--skip-git-repo-check', '--ignore-user-config', '--ephemeral', '-s', 'read-only',
          '--disable', 'shell_tool', '--disable', 'computer_use', '--disable', 'browser_use', '--disable', 'apps',
          '-c', 'web_search="disabled"', '-c', 'windows.sandbox="unelevated"', '--color', 'never', '-o', outFile, '-'];
        r = await run(bin, args, { input: `${brief}\n\n=====\n\n${turn}`, cwd, timeoutMs });
        try { text = fs.readFileSync(outFile, 'utf8'); fs.rmSync(outFile); } catch { text = ''; }
        break;
      }
      case 'grok': {
        const pf = path.join(cwd, 'prompt.txt');
        fs.writeFileSync(pf, `${brief}\n\n=====\n\n${turn}`);
        const args = ['--prompt-file', pf, '-m', a.model, '--effort', a.effort || 'low',
          '--disallowed-tools', GROK_TOOLS, '--permission-mode', 'dontAsk',
          '--output-format', 'plain', '--no-subagents', '--disable-web-search', '--cwd', cwd];
        r = await run(bin, args, { cwd, timeoutMs, env: { GROK_WEB_FETCH: 'false' } });
        text = r.stdout;
        break;
      }
      case 'agy': {
        // Reuse one agy conversation for a few turns so the user's agy history does not
        // fill up with one conversation per table turn.
        const s = (this.agySessions[seat.key] ??= { id: null, n: 0 });
        if (s.id && s.n >= (a.rotate || 4)) { s.id = null; s.n = 0; }
        const tmp = path.join(this.root, 'data', 'tmp', 'agy');
        fs.mkdirSync(tmp, { recursive: true });
        const args = ['--model', a.model, '--output-format', 'json', '--print-timeout', `${Math.round(timeoutMs / 1000)}s`];
        if (s.id) args.push('--conversation', s.id);
        args.push('-p', `${brief}\n\n=====\n\n${turn}`);
        r = await run(bin, args, { cwd, timeoutMs: timeoutMs + 10000, env: { TEMP: tmp, TMP: tmp, TMPDIR: tmp } });
        text = '';
        try {
          const j = JSON.parse(r.stdout);
          text = j.response || '';
          if (j.conversation_id) { if (s.id !== j.conversation_id) { s.id = j.conversation_id; s.n = 0; } s.n++; }
          if (j.status && j.status !== 'SUCCESS') r.stderr += `\nstatus=${j.status}`;
        } catch { text = r.stdout; s.id = null; s.n = 0; }
        break;
      }
      default:
        throw new Error(`unknown backend ${backend}`);
    }
    const ok = r.code === 0 && !!text?.trim();
    const detail = ok ? '' : `exit=${r.code}${r.timedOut ? ' (timeout)' : ''} ${r.stderr.slice(-600)}`;
    this.log(seat.key, `${kind} ${backend} ${r.ms}ms ${ok ? 'ok' : `FAIL ${detail}`}`);
    return { ok, text: text || '', ms: r.ms, detail };
  }
}
