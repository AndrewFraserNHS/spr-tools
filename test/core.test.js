import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, parseCsvObjects } from '../public/js/csv.js';
import { exportRows, planImport } from '../public/js/chartCsv.js';
import { COLLECTIONS } from '../server.js';

const base = {
  people: [{ id: 'p-a', name: 'Ann', role: 'Lead', email: '' }],
  workstreams: [{ id: 'ws-x', name: 'X', description: 'd', leadId: 'p-a' }],
  teams: [{ id: 'tm-1', workstreamId: 'ws-x', personId: 'p-a', role: 'Lead', fte: 1 }],
};

test('csv round-trips quotes, commas and newlines', () => {
  const rows = [['a', 'b,c', 'say "hi"', 'line1\nline2']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});
test('parseCsvObjects lower-cases headers', () => {
  assert.deepEqual(parseCsvObjects('Name,Job Title\nAnn,Boss\n'), [{ name: 'Ann', 'job title': 'Boss' }]);
});
test('export then import with no edits changes nothing', () => {
  const csv = toCsv(exportRows(base));
  const { summary, next } = planImport(base, csv);
  assert.deepEqual(summary.workstreams, { added: 0, changed: 0 });
  assert.deepEqual(summary.people, { added: 0, changed: 0 });
  assert.deepEqual(summary.teams, { added: 0, changed: 0, removed: 0 });
  assert.deepEqual(next, base);
});
test("chart export includes standalone people and unresolved team rows", () => {
  const current = {
    people: [
      ...base.people,
      { id: "p-b", name: "Bea", role: "Analyst", email: "bea@example.org" },
    ],
    workstreams: base.workstreams,
    teams: [
      ...base.teams,
      {
        id: "tm-missing",
        workstreamId: "ws-x",
        personId: "missing",
        role: "Observer",
        fte: 0.5,
      },
    ],
  };
  const rows = exportRows(current);
  assert.deepEqual(rows[2], ["X", "d", "Ann", "", "", "", "Observer", 0.5]);
  assert.deepEqual(rows[3], [
    "",
    "",
    "",
    "Bea",
    "Analyst",
    "bea@example.org",
    "",
    "",
  ]);
  const imported = planImport(base, toCsv(rows)).next;
  assert.deepEqual(
    imported.people.find((p) => p.id === "p-bea"),
    { id: "p-bea", name: "Bea", role: "Analyst", email: "bea@example.org" },
  );
  assert.deepEqual(imported.teams, base.teams);
});
test('import adds new workstream, person and membership without duplicating', () => {
  const csv = 'Workstream,Person,Job title,Team role,FTE\nY,Bob,Analyst,Member,0.5\nX,Ann,,Lead,1\n';
  const { summary, next } = planImport(base, csv);
  assert.equal(summary.workstreams.added, 1);
  assert.equal(summary.people.added, 1);
  assert.equal(summary.teams.added, 1);
  assert.equal(next.people.length, 2);
  assert.equal(next.teams.find(t => t.personId.startsWith('p-bob')).fte, 0.5);
});
test('replace mode removes unlisted members of touched workstreams only', () => {
  const csv = 'Workstream,Person\nX,\n';
  assert.equal(planImport(base, csv, { replaceTeams: true }).next.teams.length, 0);
  assert.equal(planImport(base, csv, { replaceTeams: false }).next.teams.length, 1);
});
test('import requires the Workstream column', () => {
  assert.match(planImport(base, 'Foo\nbar\n').warnings[0], /Missing required/);
});
test('server whitelists collections', () => {
  assert.ok(COLLECTIONS.includes('events') && !COLLECTIONS.includes('../package'));
});
