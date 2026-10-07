// The fact ledger: the scenario's state as a small set of facts the server keeps, instead
// of the GM's free-text memory. The GM proposes changes (assert / retract / reveal); the
// server checks them against a fixed vocabulary and a few hard constraints, applies what
// is valid and hands back what it refused. Every fact records who knows it, and each
// player's prompt only gets the facts their character knows.
//
//   위치(노라, 제3부두)          a fact: predicate(arg, arg)
//   시계(의식) = 2/6             a clock: value / max
//   known: 'gm' | 'all' | ['p1', 'user']
//
// Rules sit next to the facts: when every condition holds, the server applies the rule's
// facts and tells the GM it happened (an ending rule tells the GM to close the story).
//   {name: '의식 시작', when: ['시계(의식) >= 6'], then: ['사건(의식, 종바위 동굴에서 의식이 시작된다)']}
//   {name: '봉인', when: ['상태(검은 조각상, 바다에 가라앉음)', 'not 사망(노라)'], ending: true}
// Conditions: a fact pattern (?변수 binds, _ matches anything, fewer arguments match a
// prefix), 'not …', '시계(이름) >= n', '라운드 >= n', '안다(누군가|모두|캐릭터|?변수, 패턴)'.

const P = {
  인물: { arity: [1, 2], hint: '인물(이름, 한 줄 설명)' },
  장소: { arity: [1, 2], hint: '장소(이름, 한 줄 설명)' },
  물건: { arity: [1, 2], hint: '물건(이름, 한 줄 설명)' },
  위치: { arity: [2, 2], unique: [0], hint: '위치(인물|물건, 장소) — 한 곳에만 있다' },
  소유: { arity: [2, 2], unique: [1], hint: '소유(인물, 물건) — 물건마다 주인은 하나' },
  상태: { arity: [2, 2], hint: '상태(대상, 상태) — 예: 상태(톰, 실종)' },
  사망: { arity: [1, 1], permanent: true, hint: '사망(인물) — 되돌릴 수 없다' },
  관계: { arity: [3, 3], hint: '관계(A, B, 관계) — 예: 관계(말로우, 코너, 매수)' },
  목표: { arity: [2, 2], hint: '목표(인물, 원하는 것)' },
  비밀: { arity: [2, 2], hint: '비밀(대상, 숨겨진 내용)' },
  단서: { arity: [2, 2], hint: '단서(이름, 내용)' },
  사건: { arity: [2, 2], hint: '사건(이름, 일어난 일)' },
  진실: { arity: [1, 1], hint: '진실(세계에 대한 숨은 사실 한 문장)' },
  시계: { arity: [1, 1], clock: true, hint: '시계(이름) = 현재/최대 — 다가오는 위협' },
};
export const PREDICATES = Object.keys(P);
export const MAX_FACTS = 200;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// '위치(노라, 제3부두)' → {p, args}; '시계(의식) = 2/6' → {p, args, value, max};
// '시계(의식) = +1' → {p, args, delta}.
// The last argument keeps any commas (free text like 비밀/단서 contents).
export function parseFact(text) {
  const m = norm(text).match(/^([^\s(]+)\s*\((.*)\)\s*(?:=\s*([+-]?\d+)\s*(?:\/\s*(\d+))?)?$/);
  if (!m) return null;
  const [, p, inner, value, max] = m;
  const def = P[p];
  const parts = inner.split(/\s*,\s*/);
  const n = def ? def.arity[1] : parts.length;
  const args = parts.length > n ? [...parts.slice(0, n - 1), parts.slice(n - 1).join(', ')] : parts;
  const f = { p, args: args.map(norm).filter((a, i) => a || i === 0) };
  if (value !== undefined && /^[+-]/.test(value)) f.delta = Number(value);
  else if (value !== undefined) f.value = Number(value);
  if (max !== undefined) f.max = Number(max);
  return f;
}

export function formatFact(f) {
  const base = `${f.p}(${f.args.join(', ')})`;
  return f.value === undefined ? base : `${base} = ${f.value}${f.max !== undefined ? `/${f.max}` : ''}`;
}

const keyOf = (f) => `${f.p}(${f.args.join('|')})`;

export function knows(f, who) {
  if (f.known === 'all') return true;
  if (!who || who === 'gm') return true;
  return Array.isArray(f.known) && f.known.includes(who);
}

function widen(a, b) {
  if (a === 'all' || b === 'all') return 'all';
  const list = [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
  return list.length ? list : 'gm';
}

function normKnown(to, validWho) {
  if (to === 'all' || to === '모두') return 'all';
  const list = (Array.isArray(to) ? to : to ? [to] : []).map((x) => validWho(x)).filter(Boolean);
  return list.length ? [...new Set(list)] : 'gm';
}

// The ledger lives in the campaign as plain JSON: {list: [fact], next, rejected: [...]}.
export class Ledger {
  constructor(store) {
    this.s = store;
    this.s.list ??= [];
    this.s.next ??= 1;
    this.s.rejected ??= [];
  }

  get list() { return this.s.list; }

  find(ref) {
    const r = norm(typeof ref === 'object' ? ref?.fact ?? ref?.id ?? '' : ref);
    const id = r.match(/^\[?f(\d+)\]?$/i);
    if (id) return this.list.find((f) => f.id === Number(id[1])) || null;
    const parsed = parseFact(r);
    if (!parsed) return null;
    const k = keyOf(parsed);
    const exact = this.list.find((f) => keyOf(f) === k);
    if (exact) return exact;
    // '단서(장부)' finds '단서(장부, 실종자 명단)' when only one fact starts that way.
    const prefix = this.list.filter((f) => unify({ p: parsed.p, args: parsed.args }, f, {}).length);
    return prefix.length === 1 ? prefix[0] : null;
  }

  // ops: {assert: [text | {fact, to}], retract: [text | id], reveal: [{fact, to}]}
  // validWho(x) → a character key or null. Returns {applied: [...notes], rejected: [...],
  // learned: [{fact, who: 'all' | [keys]}]} (who newly knows which fact, for clue notices).
  apply(ops, { round = 0, validWho = () => null } = {}) {
    const applied = [], rejected = [];
    const before = new Map(this.list.map((f) => [f.id, f.known]));
    const reject = (op, why) => rejected.push({ op: typeof op === 'string' ? op : JSON.stringify(op), why });
    if (Array.isArray(ops)) ops = { assert: ops };
    if (!ops || typeof ops !== 'object') return { applied, rejected, learned: [] };

    for (const op of (Array.isArray(ops.retract) ? ops.retract : []).slice(0, 30)) {
      const f = this.find(op);
      if (!f) { reject(op, '없는 사실'); continue; }
      if (P[f.p]?.permanent) { reject(op, `${f.p}은(는) 되돌릴 수 없어요 (되살아났다면 상태(대상, 부활)로)`); continue; }
      this.s.list = this.list.filter((x) => x !== f);
      applied.push(`- ${formatFact(f)}`);
    }

    for (const op of (Array.isArray(ops.assert) ? ops.assert : []).slice(0, 40)) {
      const text = typeof op === 'string' ? op : op?.fact;
      const f = parseFact(text);
      if (!f) { reject(op, '형식이 아니에요. 술어(인자, 인자)'); continue; }
      const def = P[f.p];
      if (!def) { reject(op, `모르는 술어 ${f.p} (쓸 수 있는 것: ${PREDICATES.join(', ')})`); continue; }
      if (f.args.length < def.arity[0] || f.args.length > def.arity[1] || f.args.some((a) => !a)) { reject(op, `인자 개수가 맞지 않아요: ${def.hint}`); continue; }
      const known = normKnown(typeof op === 'object' ? op.to : undefined, validWho);

      if (def.clock) {
        const cur = this.list.find((x) => x.p === f.p && x.args[0] === f.args[0]);
        const max = Math.max(1, Math.min(20, f.max ?? cur?.max ?? 6));
        let value = Math.max(0, Math.round(f.delta !== undefined ? (cur?.value ?? 0) + f.delta : f.value ?? cur?.value ?? 0));
        if (value > max) { value = max; applied.push(`! ${f.args[0]} 시계는 최대 ${max}`); }
        if (cur) {
          if (cur.value === value && cur.max === max) continue;
          applied.push(`~ ${formatFact(cur)} → ${value}/${max}`);
          Object.assign(cur, { value, max, round, known: widen(cur.known, known) });
        } else {
          this.add({ p: f.p, args: f.args, value, max, known, round });
          applied.push(`+ ${f.p}(${f.args[0]}) = ${value}/${max}`);
        }
        continue;
      }

      const k = keyOf(f);
      const same = this.list.find((x) => keyOf(x) === k);
      if (same) {
        // Re-asserting a fact can only widen who knows it.
        const w = widen(same.known, known);
        if (JSON.stringify(w) !== JSON.stringify(same.known)) { same.known = w; applied.push(`👁 ${formatFact(same)}`); }
        continue;
      }
      // Functional predicates: the new fact replaces the old one (someone moved, an item changed hands).
      if (def.unique) {
        const clash = this.list.find((x) => x.p === f.p && def.unique.every((i) => x.args[i] === f.args[i]));
        if (clash) {
          this.s.list = this.list.filter((x) => x !== clash);
          applied.push(`~ ${formatFact(clash)} → ${formatFact(f)}`);
          this.add({ ...f, known, round });
          continue;
        }
      }
      if (this.list.length >= MAX_FACTS) { reject(op, `사실 장부가 가득 찼어요 (${MAX_FACTS}개). 지난 사실을 retract 하세요`); continue; }
      this.add({ ...f, known, round });
      applied.push(`+ ${formatFact(f)}`);
    }

    for (const op of (Array.isArray(ops.reveal) ? ops.reveal : []).slice(0, 30)) {
      const f = this.find(op);
      if (!f) { reject(op, '없는 사실'); continue; }
      const w = widen(f.known, normKnown(op?.to ?? 'all', validWho));
      if (JSON.stringify(w) === JSON.stringify(f.known)) continue;
      f.known = w;
      applied.push(`👁 ${formatFact(f)} → ${w === 'all' ? '모두' : w.join(', ')}`);
    }

    const learned = [];
    for (const f of this.list) {
      const prev = before.get(f.id) ?? 'gm';
      if (f.known === 'all') { if (prev !== 'all') learned.push({ fact: f, who: 'all' }); continue; }
      if (prev === 'all' || !Array.isArray(f.known)) continue;
      const fresh = f.known.filter((k) => !(Array.isArray(prev) && prev.includes(k)));
      if (fresh.length) learned.push({ fact: f, who: fresh });
    }
    return { applied, rejected, learned };
  }

  add(f) {
    this.list.push({ id: this.s.next++, ...f });
  }

  // Refused GM changes, shown in the GM's next prompt.
  setRejected(list) { this.s.rejected = (list || []).slice(0, 20); }

  // ---------------------------------------------------------------------------
  // Rules

  get rules() { return (this.s.rules ??= []); }
  get triggered() { return (this.s.triggered ??= []); }

  // list: [{name, when, then, ending, repeat, note}]; remove: [names].
  setRules({ add = [], remove = [] } = {}) {
    const added = [], rejected = [];
    for (const n of (Array.isArray(remove) ? remove : [remove]).filter(Boolean)) {
      const r = this.rules.find((x) => x.name === norm(n) || `r${x.id}` === norm(n));
      if (r) { this.s.rules = this.rules.filter((x) => x !== r); added.push(`- 규칙 ${r.name}`); } else rejected.push({ op: `규칙 삭제 ${n}`, why: '없는 규칙' });
    }
    for (const raw of (Array.isArray(add) ? add : []).slice(0, 20)) {
      const name = norm(raw?.name).slice(0, 60);
      const when = (Array.isArray(raw?.when) ? raw.when : raw?.when ? [raw.when] : []).map(norm).filter(Boolean).slice(0, 8);
      const then = (Array.isArray(raw?.then) ? raw.then : raw?.then ? [raw.then] : []).map(norm).filter(Boolean).slice(0, 8);
      const op = JSON.stringify(raw).slice(0, 200);
      if (!name || !when.length) { rejected.push({ op, why: '규칙에는 name과 when이 필요해요' }); continue; }
      const conds = when.map(parseCond);
      const bad = when.find((w, i) => !conds[i]);
      if (bad) { rejected.push({ op, why: `조건을 못 읽었어요: ${bad}` }); continue; }
      if (conds.every((c) => c.neg)) { rejected.push({ op, why: '부정이 아닌 조건이 하나는 있어야 해요' }); continue; }
      const bound = new Set(conds.filter((c) => !c.neg).flatMap(varsOf));
      const badThen = then.find((t) => { const f = parseFact(t.replace(/^-\s*/, '')); return !f || !P[f.p]; });
      if (badThen) { rejected.push({ op, why: `결과를 못 읽었어요(술어(인자) 형식): ${badThen}` }); continue; }
      const loose = [...then.join(' ').matchAll(/\?[^\s,()]+/g)].map((m) => m[0]).find((v) => !bound.has(v));
      if (loose) { rejected.push({ op, why: `결과의 ${loose}가 조건에서 묶이지 않았어요` }); continue; }
      if (!then.length && raw?.ending !== true && !norm(raw?.note)) { rejected.push({ op, why: 'then, note, ending 중 하나는 있어야 해요' }); continue; }
      const rule = { name, when, then, ending: raw?.ending === true, repeat: raw?.repeat === true, note: norm(raw?.note).slice(0, 200), fired: {} };
      const old = this.rules.find((x) => x.name === name);
      if (old) Object.assign(old, rule, { id: old.id });
      else this.rules.push({ id: this.s.next++, ...rule });
      added.push(`${old ? '~' : '+'} 규칙 ${name}`);
      if (this.rules.length > 40) this.rules.shift();
    }
    return { added, rejected };
  }

  // ctx: {round, players: [keys], validWho}. Each condition's own truth, for display.
  condTruth(rule, ctx) {
    return rule.when.map((w) => {
      const c = parseCond(w);
      const ok = c && (c.neg ? this.match({ ...c, neg: false }, {}, ctx).length === 0 : this.match(c, {}, ctx).length > 0);
      return { text: w, ok: !!ok, now: c?.kind === 'clock' ? this.clockValue(c.name) : undefined };
    });
  }

  solve(rule, ctx) {
    const conds = rule.when.map(parseCond).filter(Boolean);
    let sols = [{}];
    for (const c of conds.filter((x) => !x.neg)) {
      sols = sols.flatMap((b) => this.match(c, b, ctx));
      if (!sols.length) return [];
    }
    return sols.filter((b) => conds.filter((x) => x.neg).every((c) => this.match({ ...c, neg: false }, b, ctx).length === 0)).slice(0, 10);
  }

  clockValue(name) {
    return this.list.find((f) => f.p === '시계' && f.args[0] === name)?.value ?? 0;
  }

  match(c, b, ctx) {
    // Round conditions only count once play has started (round 0 is campaign prep).
    if (c.kind === 'round') return (ctx.round ?? 0) >= 1 && cmp(c.mod ? ctx.round % c.mod : ctx.round, c.op, c.n) ? [b] : [];
    if (c.kind === 'clock') return cmp(this.clockValue(c.name), c.op, c.n) ? [b] : [];
    if (c.kind === 'knows') {
      const players = ctx.players || [];
      let who = c.who;
      if (who.startsWith('?') && b[who]) who = b[who];
      const knowers = (f) => (f.known === 'all' ? players : Array.isArray(f.known) ? f.known.filter((k) => players.includes(k)) : []);
      const out = [];
      for (const f of this.list) {
        for (const nb of unify(c.pat, f, b)) {
          const ks = knowers(f);
          if (who === '누군가') { if (ks.length) out.push(nb); } else if (who === '모두') { if (players.length && players.every((k) => ks.includes(k))) out.push(nb); } else if (who.startsWith('?')) {
            for (const k of ks) out.push({ ...nb, [who]: k });
          } else {
            const k = ctx.validWho?.(who) || who;
            if (ks.includes(k)) out.push(nb);
          }
        }
      }
      return out;
    }
    return this.list.flatMap((f) => unify(c, f, b));
  }

  // Fires every rule whose conditions hold (once per binding; repeat rules once per round),
  // chaining until nothing new fires. Returns [{rule, applied, rejected, learned}].
  runRules(ctx) {
    const out = [];
    for (let pass = 0; pass < 8; pass++) {
      let any = false;
      for (const rule of [...this.rules]) {
        for (const b of this.solve(rule, ctx)) {
          const key = JSON.stringify(Object.entries(b).sort());
          if (rule.fired[key] !== undefined && (!rule.repeat || rule.fired[key] === ctx.round)) continue;
          rule.fired[key] = ctx.round ?? 0;
          any = true;
          const sub = (t) => t.replace(/\?[^\s,()]+/g, (v) => b[v] ?? v);
          const ops = { assert: rule.then.filter((t) => !t.startsWith('-')).map(sub), retract: rule.then.filter((t) => t.startsWith('-')).map((t) => sub(t.replace(/^-\s*/, ''))) };
          const res = this.apply(ops, ctx);
          const note = rule.note ? sub(rule.note) : '';
          this.triggered.push({ id: this.s.next++, rule: rule.name, ending: rule.ending, note, binding: b, round: ctx.round ?? 0, changes: res.applied });
          out.push({ rule, binding: b, ...res, note });
        }
      }
      if (!any) break;
    }
    if (this.triggered.length > 20) this.triggered.splice(0, this.triggered.length - 20);
    return out;
  }

  // The GM has narrated what was pending; drop those notices.
  ack(ids) { this.s.triggered = this.triggered.filter((t) => !ids.includes(t.id)); }

  visibleTo(who) {
    return this.list.filter((f) => knows(f, who));
  }

  // Lines for a prompt. withIds/withKnown for the GM.
  lines(facts, { withIds = false, withKnown = false, names = (k) => k } = {}) {
    const order = new Map(PREDICATES.map((p, i) => [p, i]));
    return [...facts]
      .sort((a, b) => (order.get(a.p) ?? 99) - (order.get(b.p) ?? 99) || a.id - b.id)
      .map((f) => `${withIds ? `[f${f.id}] ` : ''}${formatFact(f)}${withKnown ? ` {${f.known === 'all' ? '모두' : f.known === 'gm' ? '비밀' : f.known.map(names).join(', ')}}` : ''}`);
  }
}

const CMP = /^(>=|<=|==|!=|>|<|=)$/;
function cmp(a, op, n) {
  switch (op) {
    case '>=': return a >= n;
    case '<=': return a <= n;
    case '>': return a > n;
    case '<': return a < n;
    case '!=': return a !== n;
    default: return a === n;
  }
}

// One rule condition → {kind: 'fact'|'clock'|'round'|'knows', neg, …} or null.
export function parseCond(text) {
  let t = norm(text);
  let neg = false;
  const n = t.match(/^(?:not\s+|¬\s*|!\s*|아님\s+)(.+)$/i);
  if (n) { neg = true; t = n[1]; }
  let m = t.match(/^라운드\s*(>=|<=|==|!=|>|<|=)\s*(\d+)$/);
  if (m) return { kind: 'round', op: m[1], n: Number(m[2]), neg };
  m = t.match(/^라운드\s*%\s*(\d+)\s*(==|=|!=)\s*(\d+)$/);
  if (m && Number(m[1]) > 0) return { kind: 'round', mod: Number(m[1]), op: m[2], n: Number(m[3]), neg };
  m = t.match(/^시계\(\s*([^)]+?)\s*\)\s*(>=|<=|==|!=|>|<|=)\s*(\d+)$/);
  if (m && CMP.test(m[2])) return { kind: 'clock', name: m[1], op: m[2], n: Number(m[3]), neg };
  m = t.match(/^안다\(\s*([^,]+?)\s*,\s*(.+)\)$/);
  if (m) {
    const pat = parseFact(m[2]);
    return pat && P[pat.p] ? { kind: 'knows', who: m[1], pat, neg } : null;
  }
  const f = parseFact(t);
  if (!f || !P[f.p] || f.value !== undefined || f.delta !== undefined) return null;
  return { kind: 'fact', p: f.p, args: f.args, neg };
}

function varsOf(c) {
  const args = c.kind === 'fact' ? c.args : c.kind === 'knows' ? [c.who, ...c.pat.args] : [];
  return args.filter((a) => a.startsWith('?'));
}

// Pattern {p, args} against a fact, extending bindings b. A pattern with fewer arguments
// matches on the ones it has.
function unify(pat, f, b) {
  if (pat.p !== f.p || pat.args.length > f.args.length) return [];
  const nb = { ...b };
  for (let i = 0; i < pat.args.length; i++) {
    const a = pat.args[i];
    if (a === '_' || a === '*') continue;
    if (a.startsWith('?')) {
      if (nb[a] === undefined) nb[a] = f.args[i];
      else if (nb[a] !== f.args[i]) return [];
    } else if (a !== f.args[i]) return [];
  }
  return [nb];
}

export const FACT_GUIDE = `## 사실 장부 (서버가 관리)
세계의 상태는 사실 장부에 담는다. 장부는 서버가 들고 있고, 너는 바뀐 것만 facts로 제안한다. 서버가 검사해서 반영하고, 거절된 건 다음 턴에 이유와 함께 알려 준다.
- 쓸 수 있는 술어:
${PREDICATES.map((p) => `  · ${P[p].hint}`).join('\n')}
- 위치는 한 곳뿐이라 새 위치를 assert하면 옛 위치는 자동으로 지워진다. 소유도 물건마다 주인 하나. 시계는 "시계(의식) = 3"처럼 값만 바꾸면 된다.
- 사실마다 누가 아는지가 붙는다. 기본은 비밀(너만 앎). 플레이어 캐릭터가 보거나 들어서 알게 된 사실은 to로 알려라: "all"(모두), 또는 ["p1", "user"]처럼 캐릭터 키. 이미 있는 사실을 알게 되면 reveal.
- 플레이어 캐릭터는 자기가 아는 사실과 자기에게 온 귓속말만 프롬프트로 받는다. 한 캐릭터만 알아차린 것은 서술 대신 whispers로 그 캐릭터에게만 전해라.
- 장부의 사실과 모순되는 서술을 하지 마. 바꿔야 하면 먼저 facts로 바꿔라.
- 단서도 장부에 단서(이름, 내용)로 둔다. 캐릭터가 단서를 알게 되면 to로 알려라. 그 캐릭터의 단서 수첩에 들어가고, 모르는 캐릭터에게는 보이지 않는다.
- 시나리오의 뼈대(인물, 장소, 비밀, 단서, 시계, 관계, 목표)는 장부에, 장부에 담기 어려운 연출 아이디어만 gm_notes에.

## 규칙 (서버가 판정)
장부 위에 "조건이 모두 성립하면 생기는 일"을 규칙으로 걸어 둔다. 서버가 장부가 바뀔 때마다 검사해서, 성립하면 then의 사실을 장부에 반영하고 너에게 "방금 발동한 규칙"으로 알려 준다. 그러면 그 일을 서술에 반영해.
- when(모두 성립해야 함): 사실 패턴 "위치(노라, 종바위 동굴)", 변수 "사망(?누구)", 아무거나 "_", 부정 "not 사망(노라)", 시계 비교 "시계(의식) >= 6", "라운드 >= 8", 주기 "라운드 % 2 == 0", 앎 "안다(누군가, 단서(장부))" / "안다(모두, 단서(문양))" / "안다(p1, 비밀(말로우))". 인자를 덜 쓰면 앞쪽만 맞춘다.
- then: 장부에 넣을 사실들. "-위치(노라, 부두)"처럼 앞에 -를 붙이면 지운다. "시계(의식) = +1"은 1 올린다. when의 변수를 쓸 수 있다.
- "ending": true인 규칙은 결말 조건이다. 발동하면 그 결말로 이야기를 맺어라. 좋은 결말·나쁜 결말을 둘 이상 걸어 둬.
- "repeat": true면 조건이 성립하는 동안 라운드마다 한 번씩 다시 발동한다(예: 라운드마다 시계 +1).
- "note"는 발동했을 때 너에게 보여 줄 연출 메모.
- 위협 시계에는 단계별 트리거를 걸어 둬(예: 3이면 새 실종자, 6이면 의식 시작). 규칙은 플레이어에게 보이지 않는다.
- 시계는 저절로 움직이지 않는다. 위협이 진행될 때마다(실패한 판정, 흘려보낸 시간, 무시한 징조, 밀어붙였다 실패) facts에 "시계(의식) = +1"처럼 올려라. 시계가 멈춰 있으면 규칙도 발동하지 않고 이야기가 결말로 가지 못한다.`;

export const RULES_FIELD = `"rules": {"add": [{"name": "의식 시작", "when": ["시계(의식) >= 6"], "then": ["사건(의식, 종바위 동굴에서 의식이 시작된다)"], "note": "종소리가 쉬지 않고 울린다"}], "remove": ["규칙 이름"]}`;

export const FACTS_FIELD = `"facts": {"assert": ["위치(노라, 제3창고)", {"fact": "단서(장부, 실종자 6명 모두 야간 하역 인부)", "to": "all"}], "retract": ["f12"], "reveal": [{"fact": "f7", "to": ["p1"]}]},
  "whispers": [{"to": "캐릭터 키", "text": "그 캐릭터만 알게 되는 것"}]`;
