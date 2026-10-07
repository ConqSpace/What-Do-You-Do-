// The fact ledger: the scenario's state as a small set of facts the server keeps, instead
// of the GM's free-text memory. The GM proposes changes (assert / retract / reveal); the
// server checks them against a fixed vocabulary and a few hard constraints, applies what
// is valid and hands back what it refused. Every fact records who knows it, and each
// player's prompt only gets the facts their character knows.
//
//   위치(노라, 제3부두)          a fact: predicate(arg, arg)
//   시계(의식) = 2/6             a clock: value / max
//   known: 'gm' | 'all' | ['p1', 'user']

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

// '위치(노라, 제3부두)' → {p, args}; '시계(의식) = 2/6' → {p, args, value, max}.
// The last argument keeps any commas (free text like 비밀/단서 contents).
export function parseFact(text) {
  const m = norm(text).match(/^([^\s(]+)\s*\((.*)\)\s*(?:=\s*(\d+)\s*(?:\/\s*(\d+))?)?$/);
  if (!m) return null;
  const [, p, inner, value, max] = m;
  const def = P[p];
  const parts = inner.split(/\s*,\s*/);
  const n = def ? def.arity[1] : parts.length;
  const args = parts.length > n ? [...parts.slice(0, n - 1), parts.slice(n - 1).join(', ')] : parts;
  const f = { p, args: args.map(norm).filter((a, i) => a || i === 0) };
  if (value !== undefined) f.value = Number(value);
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
    return this.list.find((f) => keyOf(f) === k) || null;
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
        let value = Math.max(0, Math.round(f.value ?? cur?.value ?? 0));
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

    this.s.rejected = rejected.slice(0, 20);
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

export const FACT_GUIDE = `## 사실 장부 (서버가 관리)
세계의 상태는 사실 장부에 담는다. 장부는 서버가 들고 있고, 너는 바뀐 것만 facts로 제안한다. 서버가 검사해서 반영하고, 거절된 건 다음 턴에 이유와 함께 알려 준다.
- 쓸 수 있는 술어:
${PREDICATES.map((p) => `  · ${P[p].hint}`).join('\n')}
- 위치는 한 곳뿐이라 새 위치를 assert하면 옛 위치는 자동으로 지워진다. 소유도 물건마다 주인 하나. 시계는 "시계(의식) = 3"처럼 값만 바꾸면 된다.
- 사실마다 누가 아는지가 붙는다. 기본은 비밀(너만 앎). 플레이어 캐릭터가 보거나 들어서 알게 된 사실은 to로 알려라: "all"(모두), 또는 ["p1", "user"]처럼 캐릭터 키. 이미 있는 사실을 알게 되면 reveal.
- 플레이어 캐릭터는 자기가 아는 사실과 자기에게 온 귓속말만 프롬프트로 받는다. 한 캐릭터만 알아차린 것은 서술 대신 whispers로 그 캐릭터에게만 전해라.
- 장부의 사실과 모순되는 서술을 하지 마. 바꿔야 하면 먼저 facts로 바꿔라.
- 단서도 장부에 단서(이름, 내용)로 둔다. 캐릭터가 단서를 알게 되면 to로 알려라. 그 캐릭터의 단서 수첩에 들어가고, 모르는 캐릭터에게는 보이지 않는다.
- 시나리오의 뼈대(인물, 장소, 비밀, 단서, 시계, 관계, 목표)는 장부에, 장부에 담기 어려운 연출 아이디어만 gm_notes에.`;

export const FACTS_FIELD = `"facts": {"assert": ["위치(노라, 제3창고)", {"fact": "단서(장부, 실종자 6명 모두 야간 하역 인부)", "to": "all"}], "retract": ["f12"], "reveal": [{"fact": "f7", "to": ["p1"]}]},
  "whispers": [{"to": "캐릭터 키", "text": "그 캐릭터만 알게 되는 것"}]`;
