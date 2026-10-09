import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, parseCsvObjects } from '../public/js/csv.js';
import { exportRows, planImport } from '../public/js/chartCsv.js';
import * as XLSX from '@e965/xlsx';
import { createWorkstreamWorkbook, planWorkstreamWorkbookImport } from '../public/js/workstreamWorkbook.js';
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
test('workbook shares people, workstreams, and alignments as linked sheets', () => {
  const workbook = XLSX.read(createWorkstreamWorkbook(base, XLSX), { type: 'array' });
  assert.deepEqual(workbook.SheetNames, ['People', 'Workstreams', 'Alignments', 'Read Me']);

  const append = (sheetName, row) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    rows.push(row);
    workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  };
  append('People', ['', 'Bea', 'Analyst', '', 'Ann', '']);
  append('Workstreams', ['', 'Y', 'New stream', 'Bea', '']);
  append('Alignments', ['', 'Bea', '', 'Y', '', 'Member', 0.5]);

  const edited = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const result = planWorkstreamWorkbookImport(base, edited, { XLSX });
  const bea = result.next.people.find(person => person.name === 'Bea');
  const stream = result.next.workstreams.find(workstream => workstream.name === 'Y');
  assert.equal(bea.reportsToId, 'p-a');
  assert.equal(stream.leadId, bea.id);
  assert.deepEqual(result.next.teams.at(-1), {
    id: 'tm-ws-y-p-bea', personId: bea.id, workstreamId: stream.id, role: 'Member', fte: 0.5,
  });
});
test('workbook clears visible links and prevents reporting cycles', () => {
  const current = {
    people: [...base.people, { id: 'p-b', name: 'Bea', role: 'Analyst', email: '', reportsToId: 'p-a' }],
    workstreams: [{ ...base.workstreams[0], leadId: 'p-b' }],
    teams: base.teams,
  };
  const workbook = XLSX.read(createWorkstreamWorkbook(current, XLSX), { type: 'array' });
  const setCell = (sheetName, rowIndex, columnIndex, value) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    rows[rowIndex][columnIndex] = value;
    workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  };
  setCell('People', 1, 4, 'Bea');
  setCell('People', 2, 4, 'Ann');
  setCell('Workstreams', 1, 3, '');
  const result = planWorkstreamWorkbookImport(current, XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }), { XLSX });
  assert.equal(result.next.people.find(person => person.id === 'p-a').reportsToId, undefined);
  assert.equal(result.next.workstreams[0].leadId, '');
  assert.ok(result.warnings.some(warning => warning.includes('cycle detected')));
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
