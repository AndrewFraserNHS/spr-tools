import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from "node:crypto";
import { parseCsv, toCsv, parseCsvObjects } from '../public/js/csv.js';
import { exportRows, planImport } from '../public/js/chartCsv.js';
import * as XLSX from '@e965/xlsx';
import { createWorkstreamWorkbook, planWorkstreamWorkbookImport } from '../public/js/workstreamWorkbook.js';
import { createVault, openVault } from "../public/js/vault.js";
import { COLLECTIONS, createServer, isVaultEnvelope } from "../server.js";

globalThis.crypto ??= webcrypto;

const base = {
  people: [
    {
      id: "p-a",
      name: "Ann",
      company: "Northwind Health",
      role: "Lead",
      email: "",
    },
  ],
  workstreams: [{ id: "ws-x", name: "X", description: "d", leadId: "p-a" }],
  teams: [
    { id: "tm-1", workstreamId: "ws-x", personId: "p-a", role: "Lead", fte: 1 },
  ],
};

test('csv round-trips quotes, commas and newlines', () => {
  const rows = [['a', 'b,c', 'say "hi"', 'line1\nline2']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});
test('parseCsvObjects lower-cases headers', () => {
  assert.deepEqual(parseCsvObjects('Name,Job Title\nAnn,Boss\n'), [{ name: 'Ann', 'job title': 'Boss' }]);
});
test("vault encrypts data and rejects wrong passphrases or tampering", async () => {
  const passphrase = "correct horse battery staple";
  const vault = await createVault({ people: base.people }, passphrase);
  assert.equal(JSON.stringify(vault).includes("Ann"), false);
  assert.deepEqual((await openVault(vault, passphrase)).data, {
    people: base.people,
  });
  assert.equal(isVaultEnvelope(vault), true);
  await assert.rejects(
    openVault(vault, "not the passphrase"),
    /Incorrect passphrase/,
  );
  const modified = {
    ...vault,
    ciphertext: `${vault.ciphertext[0] === "A" ? "B" : "A"}${vault.ciphertext.slice(1)}`,
  };
  await assert.rejects(openVault(modified, passphrase), /Incorrect passphrase/);
});
test('export then import with no edits changes nothing', () => {
  const csv = toCsv(exportRows(base));
  const { summary, next } = planImport(base, csv);
  assert.deepEqual(summary.workstreams, { added: 0, changed: 0 });
  assert.deepEqual(summary.people, { added: 0, changed: 0 });
  assert.deepEqual(summary.teams, { added: 0, changed: 0, removed: 0 });
  assert.deepEqual(next, base);
});
test("chart CSV includes and imports Company while accepting older headers", () => {
  const rows = exportRows(base);
  assert.deepEqual(rows[1], [
    "X",
    "d",
    "Ann",
    "Ann",
    "Northwind Health",
    "Lead",
    "",
    "Lead",
    1,
  ]);
  const imported = planImport(
    { people: [], workstreams: [], teams: [] },
    toCsv(rows),
  ).next;
  assert.equal(imported.people[0].company, "Northwind Health");

  const oldCsv = "Workstream,Person,Job title\nX,Bob,Analyst\n";
  assert.equal(
    planImport({ people: [], workstreams: [], teams: [] }, oldCsv).next
      .people[0].company,
    "",
  );
  assert.equal(
    planImport(base, oldCsv.replace("Bob", "Ann")).next.people[0].company,
    "Northwind Health",
  );
  const blankCompanyCsv = "Workstream,Person,Company\nX,Ann,\n";
  assert.equal(planImport(base, blankCompanyCsv).next.people[0].company, "");
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
  append("People", ["", "Bea", "Acme Health", "Analyst", "", "Ann", ""]);
  append('Workstreams', ['', 'Y', 'New stream', 'Bea', '']);
  append('Alignments', ['', 'Bea', '', 'Y', '', 'Member', 0.5]);

  const edited = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const result = planWorkstreamWorkbookImport(base, edited, { XLSX });
  const bea = result.next.people.find(person => person.name === 'Bea');
  const stream = result.next.workstreams.find(workstream => workstream.name === 'Y');
  assert.equal(bea.reportsToId, 'p-a');
  assert.equal(bea.company, "Acme Health");
  assert.equal(stream.leadId, bea.id);
  assert.deepEqual(result.next.teams.at(-1), {
    id: 'tm-ws-y-p-bea', personId: bea.id, workstreamId: stream.id, role: 'Member', fte: 0.5,
  });
});
test("legacy workbooks without Company preserve existing company values", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [
        "Person ID",
        "Name",
        "Job Title",
        "Email",
        "Reports To",
        "Reports To ID",
      ],
      ["p-a", "Ann", "Lead", "", "", ""],
    ]),
    "People",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Workstream ID", "Name", "Description", "Lead", "Lead ID"],
      ["ws-x", "X", "d", "Ann", "p-a"],
    ]),
    "Workstreams",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [
        "Alignment ID",
        "Person",
        "Person ID",
        "Workstream",
        "Workstream ID",
        "Team Role",
        "FTE",
      ],
      ["tm-1", "Ann", "p-a", "X", "ws-x", "Lead", 1],
    ]),
    "Alignments",
  );
  const content = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  assert.equal(
    planWorkstreamWorkbookImport(base, content, { XLSX }).next.people[0]
      .company,
    "Northwind Health",
  );
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
  setCell("People", 1, 5, "Bea");
  setCell("People", 2, 5, "Ann");
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
      {
        id: "p-b",
        name: "Bea",
        company: "",
        role: "Analyst",
        email: "bea@example.org",
      },
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
  assert.deepEqual(rows[2], ["X", "d", "Ann", "", "", "", "", "Observer", 0.5]);
  assert.deepEqual(rows[3], [
    "",
    "",
    "",
    "Bea",
    "",
    "Analyst",
    "bea@example.org",
    "",
    "",
  ]);
  const imported = planImport(base, toCsv(rows)).next;
  assert.deepEqual(
    imported.people.find((p) => p.id === "p-bea"),
    {
      id: "p-bea",
      name: "Bea",
      company: "",
      role: "Analyst",
      email: "bea@example.org",
    },
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
test("server exposes no plaintext collection API and rejects plaintext vault writes", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/api/data/people`)).status, 404);
  const response = await fetch(`${url}/api/vault`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ people: base.people }),
  });
  assert.equal(response.status, 400);
  assert.equal(isVaultEnvelope({ people: base.people }), false);
});
