/* Kontoblick-Rechenkern: reine Funktionen, kein DOM, keine Seiteneffekte.
 *
 * Beträge werden intern in Cent gerechnet. Monatsanteile jährlicher Posten
 * (z. B. 44,90 € / 12) sind keine ganzen Cent: Sie werden erst summiert und
 * das Ergebnis am Ende auf ganze Cent gerundet. So stimmen alle Summen auf den
 * Cent mit der bisherigen App überein.
 *
 * Läuft im Browser (window.KBCore) und in Node (require) für die Tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Datum ---------- */
  const pad = n => String(n).padStart(2, '0');
  const mk = (y, m) => `${y}-${pad(m)}`;
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [a, b, c] = s.split('-').map(Number); return new Date(a, b - 1, c); };
  const dim = (y, m) => new Date(y, m, 0).getDate();
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dayDiff = (a, b) => Math.round((b - a) / 864e5);

  /* ---------- Geld ---------- */
  const toCents = v => Math.round((+v || 0) * 100);
  const round = c => Math.round(c);
  const sum = a => a.reduce((s, v) => s + (+v || 0), 0);

  const INTERVAL = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };
  const months = it => INTERVAL[it.interval || 'monthly'];
  const isMonthly = it => (it.interval || 'monthly') === 'monthly';
  const isInc = e => e.kind === 'income';

  /* ---------- Versionen: Änderungen gelten ab einem Monat ---------- */
  // vfrom = ab welchem Monat eine Version gilt (nicht das Feld from = „Gilt ab“ des Postens)
  const vf = v => v.vfrom || '0000-00';
  function resolve(doc, key) {
    if (!doc.versions) return doc;
    let v = null;
    for (const x of doc.versions) if (vf(x) <= key) v = x;
    if (!v || v.removed) return null;
    const { vfrom, removed, ...f } = v;
    return { id: doc.id, ...f, _since: vf(v) };
  }
  const itemsAt = (raw, key) => (raw || []).map(d => resolve(d, key)).filter(Boolean);
  function catVersions(cfg) {
    return cfg.catVersions && cfg.catVersions.length ? cfg.catVersions : [{ from: '0000-00', cats: cfg.flexCats }];
  }
  function catsAt(cfg, key) {
    const vs = catVersions(cfg);
    let v = vs[0];
    for (const x of vs) if (x.from <= key) v = x;
    return v.cats || [];
  }

  /* ---------- Fälligkeiten ---------- */
  const perMonthCents = it => toCents(it.amount) / months(it); // kann Bruchteile von Cent haben
  function active(it, y, m) {
    if (it.paused) return false;
    const k = mk(y, m);
    if (it.from && k < it.from) return false;
    if (it.until && k > it.until) return false;
    return true;
  }
  function hits(it, m) {
    const n = months(it);
    if (n === 1) return true;
    return (((m - (it.month || 1)) % n) + n) % n === 0;
  }
  function occ(it, y, m) {
    if (!active(it, y, m) || !hits(it, m)) return null;
    return { it, y, m, date: it.day ? new Date(y, m - 1, Math.min(it.day, dim(y, m))) : null };
  }
  const monthOcc = (raw, y, m) => itemsAt(raw, mk(y, m)).map(it => occ(it, y, m)).filter(Boolean);
  function occBetween(raw, a, b) {
    const out = [];
    let y = a.getFullYear(), m = a.getMonth() + 1;
    const end = mk(b.getFullYear(), b.getMonth() + 1);
    while (mk(y, m) <= end) {
      for (const o of monthOcc(raw, y, m)) if (o.date && o.date >= a && o.date <= b) out.push(o);
      if (++m > 12) { m = 1; y++; }
    }
    return out.sort((p, q) => p.date - q.date || (p.it.kind === 'income') - (q.it.kind === 'income'));
  }
  function nextCancel(it, from) {
    if (!it.cancelDay || !it.cancelMonth) return null;
    let d = new Date(from.getFullYear(), it.cancelMonth - 1, it.cancelDay);
    if (d < from) d = new Date(from.getFullYear() + 1, it.cancelMonth - 1, it.cancelDay);
    return d;
  }

  /* ---------- Gehaltszeitraum ---------- */
  // Gehaltstag: Einstellung „Standard-Gehaltstag“, sonst der Tag der größten monatlichen Einnahme.
  function payDay(cfg, raw, nowKey) {
    const c = +cfg.cycleDay;
    if (c >= 1 && c <= 31) return c;
    const inc = itemsAt(raw, nowKey)
      .filter(i => i.kind === 'income' && !i.paused && i.day && isMonthly(i))
      .sort((a, b) => b.amount - a.amount)[0];
    return inc ? inc.day : 1;
  }
  function cycleOf(pd, y, m) {
    const start = new Date(y, m - 1, Math.min(pd, dim(y, m)));
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    const end = addDays(new Date(ny, nm - 1, Math.min(pd, dim(ny, nm))), -1);
    return { start, end, keys: pd === 1 ? [mk(y, m)] : [mk(y, m), mk(ny, nm)] };
  }
  function cycleForDate(pd, d) {
    const y = d.getFullYear(), m = d.getMonth() + 1;
    if (d >= cycleOf(pd, y, m).start) return { y, m };
    return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  }
  // Buchungen eines Zeitraums aus den Monatsdokumenten {"2026-09": {entries:[...]}, ...}
  function cycleEntries(pd, y, m, monthDocs) {
    const c = cycleOf(pd, y, m), a = ymd(c.start), b = ymd(c.end), out = [];
    for (const k of c.keys) for (const e of ((monthDocs[k] || {}).entries || [])) if (e.date >= a && e.date <= b) out.push(e);
    return out;
  }

  /* ---------- Monatsplan ---------- */
  function incomeOfCents(it, actual) {
    const a = actual && actual[it.id];
    return typeof a === 'number' ? toCents(a) : perMonthCents(it);
  }
  // Ergebnis in ganzen Cent. Felder wie bisher: income, regular, oneOff, fixed, reserve, savings,
  // flex, flexLeft, rest, cats[{...kategorie, spent, planned}], orphan.
  function plan(ctx, y, m, allEntries, actual) {
    const key = mk(y, m);
    const its = itemsAt(ctx.raw, key).filter(it => active(it, y, m));
    const entries = allEntries.filter(e => !isInc(e));
    const oneOff = sum(allEntries.filter(isInc).map(e => toCents(e.amount)));
    const regular = sum(its.filter(i => i.kind === 'income').map(i => incomeOfCents(i, actual)));
    const fixed = sum(its.filter(i => i.kind === 'expense' && isMonthly(i)).map(perMonthCents));
    const reserve = sum(its.filter(i => i.kind === 'expense' && !isMonthly(i)).map(perMonthCents));
    const savings = sum(its.filter(i => i.kind === 'saving').map(perMonthCents));
    const fc = catsAt(ctx.cfg, key), ids = new Set(fc.map(x => x.id));
    const cats = fc.map(x => {
      const budget = toCents(x.budget);
      const spent = sum(entries.filter(e => e.cat === x.id).map(e => toCents(e.amount)));
      return { ...x, budgetCents: budget, spent, planned: Math.max(budget, spent) };
    });
    const orphan = sum(entries.filter(e => !ids.has(e.cat)).map(e => toCents(e.amount)));
    const flex = sum(cats.map(x => x.planned)) + orphan;
    const flexLeft = sum(cats.map(x => Math.max(0, x.budgetCents - x.spent)));
    const income = regular + oneOff;
    return {
      income: round(income), regular: round(regular), oneOff, fixed: round(fixed), reserve: round(reserve),
      savings: round(savings), flex, flexLeft, cats, orphan,
      rest: round(income - fixed - reserve - flex - savings),
    };
  }

  /* ---------- Prognose: reicht das Geld bis zum Gehaltstag? ---------- */
  // opts: {balance (Euro), balanceDate, balanceTs, includeFlex, buffer (Euro)}
  // Liefert Zeilen in Cent: zuerst flexible Ausgaben pro Kategorie (date null), dann Abbuchungen
  // und einmalige Einnahmen bis einschließlich Gehaltstag.
  function projection(ctx, opts, y, m, entries, actual, today) {
    if (opts.balance == null || isNaN(opts.balance)) return null;
    const pd = ctx.pd;
    const start = opts.balanceDate ? parseYmd(opts.balanceDate) : today;
    const sc = cycleForDate(pd, start), end = addDays(cycleOf(pd, sc.y, sc.m).end, 1);
    const ev = occBetween(ctx.raw, addDays(start, 1), end).filter(o => o.it.kind !== 'income');
    let bal = toCents(opts.balance), min = bal, minAt = start;
    const rows = [];
    const p = plan(ctx, y, m, entries, actual);
    const after = e => !isInc(e) && (opts.balanceTs && e.ts ? e.ts > opts.balanceTs : e.date > ymd(start));
    for (const x of p.cats) {
      const goal = x.budgetCents;
      const afterSpent = sum(entries.filter(e => e.cat === x.id && after(e)).map(e => toCents(e.amount)));
      const open = opts.includeFlex && goal ? Math.max(0, goal - x.spent) : 0;
      if (afterSpent + open <= 0) continue;
      bal -= afterSpent + open;
      rows.push({ type: 'category', id: x.id, name: x.name, goal, spent: x.spent, afterSpent, open, date: null, amount: -(afterSpent + open), bal });
      if (bal < min) { min = bal; minAt = start; }
    }
    const steps = ev.map(o => ({ type: 'debit', id: o.it.id, name: o.it.name, date: o.date, amount: -toCents(o.it.amount) }));
    for (const e of entries) if (isInc(e)) {
      const d = parseYmd(e.date);
      if (d > start && d <= end) steps.push({ type: 'oneoff', id: e.id, name: e.note || 'Einmalige Einnahme', date: d, amount: toCents(e.amount) });
    }
    steps.sort((a, b) => a.date - b.date || a.amount - b.amount);
    for (const s of steps) { bal += s.amount; rows.push({ ...s, bal }); if (bal < min) { min = bal; minAt = s.date; } }
    const status = min < 0 ? 'bad' : min < toCents(opts.buffer || 0) ? 'warn' : 'good';
    return { start, end, rows, min, minAt, status, total: sum(ev.map(o => toCents(o.it.amount))) };
  }

  /* ---------- Speicherformat-Migration (Schema 2: Beträge in Cent) ----------
   * Wird mit Phase 1 aktiviert. Bis dahin speichert die App weiter in Euro.
   * Pfade bleiben gleich, IDs bleiben gleich (Verweise dürfen nicht brechen).
   */
  const SCHEMA = 2;
  const centsFields = it => {
    const o = { ...it };
    if ('amount' in o) o.amount = toCents(o.amount);
    return o;
  };
  function migrate(docs) {
    const cfg0 = docs['config/main'] || {};
    if ((cfg0.schemaVersion || 1) >= SCHEMA) return docs;
    const out = {};
    for (const [path, doc] of Object.entries(docs)) {
      if (path.startsWith('items/')) {
        out[path] = doc.versions ? { ...doc, versions: doc.versions.map(v => (v.removed ? v : centsFields(v))) } : centsFields(doc);
      } else if (path.startsWith('months/')) {
        const actual = Object.fromEntries(Object.entries(doc.incomeActual || {}).map(([k, v]) => [k, toCents(v)]));
        out[path] = { ...doc, entries: (doc.entries || []).map(centsFields), incomeActual: actual };
      } else if (path === 'config/main') {
        const cats = cs => (cs || []).map(c => ({ ...c, budget: toCents(c.budget) }));
        out[path] = {
          ...doc,
          schemaVersion: SCHEMA,
          balance: doc.balance == null ? null : toCents(doc.balance),
          buffer: toCents(doc.buffer == null ? 100 : doc.buffer),
          flexCats: cats(doc.flexCats),
          catVersions: doc.catVersions ? doc.catVersions.map(v => ({ ...v, cats: cats(v.cats) })) : doc.catVersions,
        };
      } else out[path] = doc;
    }
    if (!out['config/main']) out['config/main'] = { schemaVersion: SCHEMA };
    return out;
  }

  return {
    pad, mk, ymd, parseYmd, dim, addDays, dayDiff, toCents, sum, INTERVAL,
    resolve, itemsAt, catVersions, catsAt,
    perMonthCents, active, hits, occ, monthOcc, occBetween, nextCancel,
    payDay, cycleOf, cycleForDate, cycleEntries,
    incomeOfCents, plan, projection,
    SCHEMA, migrate,
  };
});
