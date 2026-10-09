// Flat "workstream chart" CSV <-> people / workstreams / teams. Pure functions (no DOM) so they can be tested.
import { parseCsvObjects } from './csv.js';

export const CHART_HEADERS = [
  "Workstream",
  "Description",
  "Lead",
  "Person",
  "Company",
  "Job title",
  "Email",
  "Team role",
  "FTE",
];

export function slug(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}
export function uniqueId(prefix, name, existing) {
  const base = `${prefix}-${slug(name)}`; let id = base, n = 2;
  while (existing.has(id)) id = `${base}-${n++}`;
  existing.add(id);
  return id;
}

export function exportRows({ people, workstreams, teams }) {
  const pById = new Map(people.map(p => [p.id, p]));
  const exportedPeople = new Set();
  const rows = [CHART_HEADERS];
  for (const ws of workstreams) {
    const lead = pById.get(ws.leadId)?.name ?? '';
    const members = teams.filter(t => t.workstreamId === ws.id);
    if (!members.length)
      rows.push([ws.name, ws.description ?? "", lead, "", "", "", "", "", ""]);
    for (const t of members) {
      const p = pById.get(t.personId);
      if (p) exportedPeople.add(p.id);
      rows.push([
        ws.name,
        ws.description ?? "",
        lead,
        p?.name ?? "",
        p?.company ?? "",
        p?.role ?? "",
        p?.email ?? "",
        t.role ?? "",
        t.fte ?? "",
      ]);
    }
  }
  for (const p of people) {
    if (!exportedPeople.has(p.id))
      rows.push([
        "",
        "",
        "",
        p.name,
        p.company ?? "",
        p.role ?? "",
        p.email ?? "",
        "",
        "",
      ]);
  }
  return rows;
}

/**
 * Merge CSV text into the current data. Matching is by name (case-insensitive) so IDs stay stable.
 * Returns { next: {people, workstreams, teams}, summary, warnings }. Does not mutate `current`.
 */
export function planImport(current, csvText, { replaceTeams = false } = {}) {
  const people = structuredClone(current.people), workstreams = structuredClone(current.workstreams), teams = structuredClone(current.teams);
  const summary = { workstreams: { added: 0, changed: 0 }, people: { added: 0, changed: 0 }, teams: { added: 0, changed: 0, removed: 0 } };
  const warnings = [];
  const rows = parseCsvObjects(csvText);
  const unchanged = { next: { people, workstreams, teams }, summary, warnings };
  if (!rows.length) return { ...unchanged, warnings: ['No data rows found.'] };
  if (!('workstream' in rows[0])) return { ...unchanged, warnings: ['Missing required "Workstream" column.'] };

  const ids = new Set([...people, ...workstreams, ...teams].map(x => x.id));
  const key = s => s.trim().toLowerCase();
  const wsByName = new Map(workstreams.map(w => [key(w.name), w]));
  const pByName = new Map(people.map(p => [key(p.name), p]));
  const seenMembership = new Set();
  const changedWs = new Set(), addedWs = new Set(), changedP = new Set(), addedP = new Set();

  const ensurePerson = (name, job, email, company) => {
    let p = pByName.get(key(name));
    if (!p) {
      p = {
        id: uniqueId("p", name, ids),
        name: name.trim(),
        company: company ?? "",
        role: job || "",
        email: email || "",
      };
      people.push(p);
      pByName.set(key(name), p);
      addedP.add(p.id);
    } else {
      if (company !== undefined && p.company !== company) {
        p.company = company;
        changedP.add(p.id);
      }
      if (job && p.role !== job) {
        p.role = job;
        changedP.add(p.id);
      }
      if (email && p.email !== email) {
        p.email = email;
        changedP.add(p.id);
      }
    }
    return p;
  };

  rows.forEach((r, i) => {
    const line = i + 2;
    if (!r.workstream) {
      if (r.person) ensurePerson(r.person, r["job title"], r.email, r.company);
      else warnings.push(`Row ${line}: no workstream name, skipped.`);
      return;
    }
    let ws = wsByName.get(key(r.workstream));
    if (!ws) {
      ws = { id: uniqueId('ws', r.workstream, ids), name: r.workstream, description: '', leadId: '' };
      workstreams.push(ws); wsByName.set(key(r.workstream), ws); addedWs.add(ws.id);
    }
    if (r.description && ws.description !== r.description) { ws.description = r.description; changedWs.add(ws.id); }
    if (r.lead) {
      const lead = ensurePerson(r.lead, "", "", undefined);
      if (ws.leadId !== lead.id) { ws.leadId = lead.id; changedWs.add(ws.id); }
    }
    if (!r.person) return;
    const p = ensurePerson(r.person, r["job title"], r.email, r.company);
    let fte = r.fte === '' || r.fte === undefined ? '' : Number(r.fte);
    if (fte !== '' && (!Number.isFinite(fte) || fte < 0)) { warnings.push(`Row ${line}: invalid FTE "${r.fte}", ignored.`); fte = ''; }
    seenMembership.add(ws.id + '|' + p.id);
    const t = teams.find(x => x.workstreamId === ws.id && x.personId === p.id);
    if (!t) {
      teams.push({ id: uniqueId('tm', `${ws.id}-${p.id}`, ids), workstreamId: ws.id, personId: p.id, role: r['team role'] || '', fte });
      summary.teams.added++;
    } else {
      const role = r['team role'] || t.role;
      if (t.role !== role || (fte !== '' && t.fte !== fte)) { t.role = role; if (fte !== '') t.fte = fte; summary.teams.changed++; }
    }
  });

  let nextTeams = teams;
  if (replaceTeams) {
    const touched = new Set(rows.map(r => wsByName.get(key(r.workstream || ''))?.id).filter(Boolean));
    nextTeams = teams.filter(t => !touched.has(t.workstreamId) || seenMembership.has(t.workstreamId + '|' + t.personId));
    summary.teams.removed = teams.length - nextTeams.length;
  }
  summary.workstreams = { added: addedWs.size, changed: [...changedWs].filter(id => !addedWs.has(id)).length };
  summary.people = { added: addedP.size, changed: [...changedP].filter(id => !addedP.has(id)).length };
  return { next: { people, workstreams, teams: nextTeams }, summary, warnings };
}
