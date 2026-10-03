// Tests für den Rechenkern. Start: node --test tests/
// - Gleichheit alt/neu: core/ muss auf den Cent dasselbe liefern wie die eingefrorene Logik von 1.1.0.
// - Abnahmewerte aus dem Konzept: nur mit echten Daten in private/current.json (nie im Repository).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../core/core.js');
const legacy = require('./legacy-logic.js');

const load = f => JSON.parse(fs.readFileSync(f, 'utf8')).docs;
const DATASETS = [['Beispieldaten', path.join(__dirname, 'fixtures', 'sample.json')]];
for (const f of ['kontoblick_import.json', 'current.json']) {
  const p = path.join(__dirname, '..', 'private', f);
  if (fs.existsSync(p)) DATASETS.push([`private/${f}`, p]);
}

const c = v => Math.round(v * 100); // Euro (alt, Gleitkomma) → Cent
const monthDocsOf = docs => Object.fromEntries(Object.entries(docs).filter(([k]) => k.startsWith('months/')).map(([k, v]) => [k.slice(7), v]));
const rawOf = docs => Object.entries(docs).filter(([k]) => k.startsWith('items/')).map(([k, v]) => ({ id: k.slice(6), ...v }));

function ctxOf(docs, cfgPatch, now) {
  const cfg = Object.assign({ flexCats: [] }, docs['config/main'] || {}, cfgPatch);
  const raw = rawOf(docs);
  return { raw, cfg, pd: K.payDay(cfg, raw, K.mk(now.getFullYear(), now.getMonth() + 1)) };
}

const CYCLE_DAYS = [undefined, 1, 15, 17, 28, 31];
const MONTHS = [];
for (let y = 2026; y <= 2027; y++) for (let m = 1; m <= 12; m++) MONTHS.push([y, m]);

for (const [name, file] of DATASETS) {
  const docs = load(file);

  test(`${name}: Monatsplan alt = neu (alle Monate, alle Gehaltstage)`, () => {
    const now = new Date(2026, 9, 3);
    let checks = 0;
    for (const cd of CYCLE_DAYS) {
      const patch = cd === undefined ? { cycleDay: undefined } : { cycleDay: cd };
      for (const [y, m] of MONTHS) {
        const L = legacy(docs, { now, cfgPatch: patch, y, m });
        const ctx = ctxOf(docs, patch, now);
        assert.equal(ctx.pd, L.payDay(), 'Gehaltstag');
        const entries = K.cycleEntries(ctx.pd, y, m, monthDocsOf(docs));
        assert.deepEqual(entries.map(e => e.id), L.S.entries.map(e => e.id), `Buchungen ${y}-${m}`);
        const actual = (monthDocsOf(docs)[K.mk(y, m)] || {}).incomeActual || {};
        const a = L.plan(y, m, L.S.entries, L.S.incomeActual), b = K.plan(ctx, y, m, entries, actual);
        for (const f of ['income', 'regular', 'oneOff', 'fixed', 'reserve', 'savings', 'flex', 'flexLeft', 'orphan', 'rest'])
          assert.equal(b[f], c(a[f]), `${f} ${y}-${m} Gehaltstag ${cd}`);
        assert.deepEqual(b.cats.map(x => [x.id, x.spent, x.planned]), a.cats.map(x => [x.id, c(x.spent), c(x.planned)]), `Kategorien ${y}-${m}`);
        checks++;
      }
    }
    assert.ok(checks >= 100);
  });

  test(`${name}: Prognose alt = neu (verschiedene Stichtage und Einstellungen)`, () => {
    const dates = ['2026-09-14', '2026-09-24', '2026-10-03', '2026-10-16', '2026-11-30', '2026-12-31'];
    for (const d of dates) for (const includeFlex of [true, false]) for (const balanceTs of [null, 450]) {
      const now = K.parseYmd(d);
      const patch = { balance: 400.37, balanceDate: d, balanceTs, includeFlex, buffer: 100 };
      const ctx = ctxOf(docs, patch, now);
      const cur = K.cycleForDate(ctx.pd, now);
      const L = legacy(docs, { now, cfgPatch: patch, y: cur.y, m: cur.m });
      const entries = K.cycleEntries(ctx.pd, cur.y, cur.m, monthDocsOf(docs));
      const actual = (monthDocsOf(docs)[K.mk(cur.y, cur.m)] || {}).incomeActual || {};
      const a = L.projection(), b = K.projection(ctx, ctx.cfg, cur.y, cur.m, entries, actual, now);
      const tag = `${d} flex=${includeFlex} ts=${balanceTs}`;
      assert.equal(K.ymd(b.end), L.ymd(a.end), `Ende ${tag}`);
      assert.equal(b.min, c(a.min), `Tiefstand ${tag}`);
      assert.equal(K.ymd(b.minAt), L.ymd(a.minAt), `Tiefstand-Datum ${tag}`);
      assert.equal(b.status, a.status, `Status ${tag}`);
      assert.equal(b.total, c(a.total), `Summe ${tag}`);
      assert.deepEqual(b.rows.map(r => [r.name, r.amount, r.bal, r.date && K.ymd(r.date)]),
        a.rows.map(r => [r.label, c(r.amount), c(r.bal), r.date && L.ymd(r.date)]), `Zeilen ${tag}`);
    }
  });

  test(`${name}: Migration auf Cent verliert nichts`, () => {
    const m = K.migrate(docs);
    assert.equal(m['config/main'].schemaVersion, K.SCHEMA);
    assert.deepEqual(Object.keys(m).sort(), [...new Set([...Object.keys(docs), 'config/main'])].sort());
    for (const [p, d] of Object.entries(docs)) {
      if (p.startsWith('months/')) for (const [i, e] of (d.entries || []).entries()) assert.equal(m[p].entries[i].amount, K.toCents(e.amount));
      if (p.startsWith('items/') && !d.versions) assert.equal(m[p].amount, K.toCents(d.amount));
    }
    assert.equal(K.migrate(m), m, 'zweite Migration ändert nichts');
  });
}

test('Beispieldaten: konkrete Werte', () => {
  const docs = load(DATASETS[0][1]);
  const now = new Date(2026, 9, 3);
  const ctx = ctxOf(docs, {}, now);
  assert.equal(ctx.pd, 15);
  const cy = K.cycleOf(15, 2026, 9);
  assert.equal(K.ymd(cy.start), '2026-09-15');
  assert.equal(K.ymd(cy.end), '2026-10-14');
  const entries = K.cycleEntries(15, 2026, 9, monthDocsOf(docs));
  const p = K.plan(ctx, 2026, 9, entries, { lohn: 2234.56 });
  // Lohn tatsächlich 2.234,56 + Nebenjob 333,33/3 + Steuer 120 (25.09.) + Verkauf 50 (12.10.) = 2.515,67
  assert.equal(p.income, 251567);
  // Kategorien der Version vor Oktober. Essen-Ziel 300: gebucht 33,33 + 410,20 = 443,53 → zählt 443,53.
  // Tanken-Ziel 150,50: gebucht 70,01 + 88,88 = 158,89 → über dem Ziel, zählt 158,89.
  assert.deepEqual(p.cats.map(x => [x.id, x.spent, x.planned]), [['essen', 44353, 44353], ['tanken', 15889, 15889]]);
  // Ohne passende Kategorie zählen weiter mit: gelöschte Kategorie 5,55 € und „Freizeit“ 19,99 €
  // (Freizeit gibt es erst in der Kategorie-Version ab Oktober, der Zeitraum gehört zu September).
  assert.equal(p.orphan, 555 + 1999);
});

test('Gehaltszeitraum über den Jahreswechsel und am Monatsende', () => {
  assert.deepEqual([K.cycleOf(17, 2026, 12)].map(c => [K.ymd(c.start), K.ymd(c.end)]), [['2026-12-17', '2027-01-16']]);
  assert.deepEqual([K.cycleOf(31, 2027, 1)].map(c => [K.ymd(c.start), K.ymd(c.end)]), [['2027-01-31', '2027-02-27']]);
  assert.deepEqual(K.cycleForDate(17, new Date(2026, 9, 5)), { y: 2026, m: 9 });
  assert.deepEqual(K.cycleForDate(17, new Date(2027, 0, 3)), { y: 2026, m: 12 });
});

// Abnahmewerte aus dem Konzept „Kontoblick 2.0“ (Phase 0). Brauchen den aktuellen Datenstand.
const CURRENT = path.join(__dirname, '..', 'private', 'current.json');
test('Abnahme: Übrig 482,02 € im Zeitraum 17.09.–16.10.', { skip: !fs.existsSync(CURRENT) && 'private/current.json fehlt' }, () => {
  const docs = load(CURRENT);
  const now = new Date(2026, 9, 3);
  const ctx = ctxOf(docs, {}, now);
  const cy = K.cycleOf(ctx.pd, 2026, 9);
  assert.equal(`${K.ymd(cy.start)}–${K.ymd(cy.end)}`, '2026-09-17–2026-10-16');
  const entries = K.cycleEntries(ctx.pd, 2026, 9, monthDocsOf(docs));
  const actual = (monthDocsOf(docs)['2026-09'] || {}).incomeActual || {};
  assert.equal(K.plan(ctx, 2026, 9, entries, actual).rest, 48202);
});
test('Abnahme: Prognose am 17.10. −14,92 € bei Kontostand 400 €', { skip: !fs.existsSync(CURRENT) && 'private/current.json fehlt' }, () => {
  const docs = load(CURRENT);
  const cfg = docs['config/main'] || {};
  const now = cfg.balanceDate ? K.parseYmd(cfg.balanceDate) : new Date(2026, 9, 3);
  const ctx = ctxOf(docs, { balance: 400 }, now);
  const cur = K.cycleForDate(ctx.pd, now);
  const entries = K.cycleEntries(ctx.pd, cur.y, cur.m, monthDocsOf(docs));
  const actual = (monthDocsOf(docs)[K.mk(cur.y, cur.m)] || {}).incomeActual || {};
  const pr = K.projection(ctx, ctx.cfg, cur.y, cur.m, entries, actual, now);
  assert.equal(K.ymd(pr.end), '2026-10-17');
  assert.equal(pr.rows[pr.rows.length - 1].bal, -1492);
});
