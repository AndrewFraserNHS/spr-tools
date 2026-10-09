const PEOPLE_HEADERS = ['Person ID', 'Name', 'Job Title', 'Email', 'Reports To', 'Reports To ID'];
const WORKSTREAM_HEADERS = ['Workstream ID', 'Name', 'Description', 'Lead', 'Lead ID'];
const ALIGNMENT_HEADERS = ['Alignment ID', 'Person', 'Person ID', 'Workstream', 'Workstream ID', 'Team Role', 'FTE'];

const key = value => String(value ?? '').trim().toLocaleLowerCase('en-GB');
const text = (row, field) => String(row[field] ?? '').trim();

function makeSheet(XLSX, headers, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = widths;
  sheet['!autofilter'] = { ref: sheet['!ref'] };
  sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  return sheet;
}

export function createWorkstreamWorkbook(state, XLSX = globalThis.XLSX) {
  if (!XLSX) throw new Error('The spreadsheet library is unavailable.');
  const workbook = XLSX.utils.book_new();
  const peopleById = new Map(state.people.map(person => [person.id, person]));
  const workstreamsById = new Map(state.workstreams.map(workstream => [workstream.id, workstream]));

  XLSX.utils.book_append_sheet(workbook, makeSheet(XLSX, PEOPLE_HEADERS, state.people.map(person => [
    person.id, person.name, person.role ?? '', person.email ?? '',
    peopleById.get(person.reportsToId)?.name ?? '', person.reportsToId ?? '',
  ]), [
    { wch: 14, hidden: true }, { wch: 26 }, { wch: 24 }, { wch: 30 }, { wch: 26 }, { wch: 14, hidden: true },
  ]), 'People');

  XLSX.utils.book_append_sheet(workbook, makeSheet(XLSX, WORKSTREAM_HEADERS, state.workstreams.map(workstream => [
    workstream.id, workstream.name, workstream.description ?? '',
    peopleById.get(workstream.leadId)?.name ?? '', workstream.leadId ?? '',
  ]), [
    { wch: 16, hidden: true }, { wch: 32 }, { wch: 72 }, { wch: 26 }, { wch: 14, hidden: true },
  ]), 'Workstreams');

  XLSX.utils.book_append_sheet(workbook, makeSheet(XLSX, ALIGNMENT_HEADERS, state.teams.map(team => [
    team.id,
    peopleById.get(team.personId)?.name ?? '', team.personId,
    workstreamsById.get(team.workstreamId)?.name ?? '', team.workstreamId,
    team.role ?? '', team.fte ?? '',
  ]), [
    { wch: 16, hidden: true }, { wch: 26 }, { wch: 14, hidden: true }, { wch: 32 },
    { wch: 16, hidden: true }, { wch: 22 }, { wch: 12 },
  ]), 'Alignments');

  XLSX.utils.book_append_sheet(workbook, makeSheet(XLSX,
    ['How to use this workbook', ''], [
      ['Edit facts once in People or Workstreams; use Alignments only to connect a person to a workstream.'],
      ['People: add one row per person. Reports To is a person name from this sheet.'],
      ['Workstreams: add one row per workstream. Lead is a person name from People.'],
      ['Alignments: add one row per person/workstream pairing. Use exact names from People and Workstreams.'],
      ['The hidden ID columns preserve links when names change. Leave IDs blank for new rows.'],
      ['Do not rename or remove the People, Workstreams, or Alignments tabs or their headers.'],
      ['Blank Reports To or Lead clears that relationship when the workbook is imported.'],
    ], [{ wch: 108 }, { wch: 12 }]), 'Read Me');

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
}

function readTable(workbook, XLSX, sheetName, requiredHeaders, warnings) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    warnings.push(`Missing ${sheetName} sheet.`);
    return [];
  }
  const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })[0] || [];
  const normalized = new Set(headers.map(key));
  const missing = requiredHeaders.filter(header => !normalized.has(key(header)));
  if (missing.length) {
    warnings.push(`${sheetName} is missing required columns: ${missing.join(', ')}.`);
    return [];
  }
  const columns = new Map(headers.map(header => [key(header), header]));
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, blankrows: false }).map(row =>
    Object.fromEntries(requiredHeaders.map(header => [header, row[columns.get(key(header))] ?? ''])),
  );
}

function uniqueId(prefix, name, ids) {
  const slug = key(name).normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  const base = `${prefix}-${slug}`;
  let id = base, suffix = 2;
  while (ids.has(id)) id = `${base}-${suffix++}`;
  ids.add(id);
  return id;
}

export function planWorkstreamWorkbookImport(current, content, { replaceAlignments = false, XLSX = globalThis.XLSX } = {}) {
  if (!XLSX) throw new Error('The spreadsheet library is unavailable.');
  const people = structuredClone(current.people);
  const workstreams = structuredClone(current.workstreams);
  let teams = structuredClone(current.teams);
  const warnings = [];
    let workbook;
    try {
      workbook = XLSX.read(content, { type: 'array' });
    } catch (error) {
      return { next: { people, workstreams, teams }, warnings: [`Could not read workbook: ${error.message}`], summary: null };
    }
  const peopleRows = readTable(workbook, XLSX, 'People', PEOPLE_HEADERS, warnings);
  const workstreamRows = readTable(workbook, XLSX, 'Workstreams', WORKSTREAM_HEADERS, warnings);
  const alignmentRows = readTable(workbook, XLSX, 'Alignments', ALIGNMENT_HEADERS, warnings);
  if (warnings.some(warning => warning.startsWith('Missing ') || warning.includes('is missing required columns'))) {
    return { next: { people, workstreams, teams }, warnings, summary: null };
  }

  const ids = new Set([...people, ...workstreams, ...teams].map(record => record.id));
  const peopleById = new Map(people.map(person => [person.id, person]));
  const peopleByName = new Map(people.map(person => [key(person.name), person]));
  const managerRows = new Map();
  let peopleAdded = 0, peopleChanged = 0, workstreamsAdded = 0, workstreamsChanged = 0;
  let alignmentsAdded = 0, alignmentsChanged = 0;

  for (const [index, row] of peopleRows.entries()) {
    const name = text(row, 'Name');
    if (!name) { warnings.push(`People row ${index + 2}: Name is required; skipped.`); continue; }
    const suppliedId = text(row, 'Person ID');
    let person = (suppliedId && peopleById.get(suppliedId)) || peopleByName.get(key(name));
    if (!person) {
      if (suppliedId && ids.has(suppliedId)) {
        warnings.push(`People row ${index + 2}: Person ID "${suppliedId}" is already in use; skipped.`);
        continue;
      }
      person = { id: suppliedId || uniqueId('p', name, ids), name };
      if (suppliedId) ids.add(suppliedId);
      people.push(person);
      peopleById.set(person.id, person);
      peopleAdded++;
    } else if (person.name !== name || person.role !== text(row, 'Job Title') || person.email !== text(row, 'Email')) {
      peopleChanged++;
    }
    peopleByName.delete(key(person.name));
    person.name = name;
    person.role = text(row, 'Job Title');
    person.email = text(row, 'Email');
    peopleByName.set(key(name), person);
    managerRows.set(person.id, { name: text(row, 'Reports To'), id: text(row, 'Reports To ID'), row: index + 2 });
  }

  for (const [personId, manager] of managerRows) {
    const person = peopleById.get(personId);
    const target = manager.name && (peopleByName.get(key(manager.name)) || (manager.id && peopleById.get(manager.id)));
    if (!manager.name) {
      delete person.reportsToId;
    } else if (!target) {
      warnings.push(`People row ${manager.row}: Reports To "${manager.name || manager.id}" was not found.`);
    } else if (target.id === person.id) {
      warnings.push(`People row ${manager.row}: a person cannot report to themselves.`);
    } else {
      person.reportsToId = target.id;
    }
  }
  for (const person of people) {
    const seen = new Set();
    let cursor = person;
    while (cursor?.reportsToId) {
      if (seen.has(cursor.id)) {
        warnings.push(`Reporting relationship cycle detected at "${cursor.name}"; that Reports To link was cleared.`);
        delete cursor.reportsToId;
        break;
      }
      seen.add(cursor.id);
      cursor = peopleById.get(cursor.reportsToId);
    }
  }

  const workstreamsById = new Map(workstreams.map(workstream => [workstream.id, workstream]));
  const workstreamsByName = new Map(workstreams.map(workstream => [key(workstream.name), workstream]));
  const leadRows = new Map();
  for (const [index, row] of workstreamRows.entries()) {
    const name = text(row, 'Name');
    if (!name) { warnings.push(`Workstreams row ${index + 2}: Name is required; skipped.`); continue; }
    const suppliedId = text(row, 'Workstream ID');
    let workstream = (suppliedId && workstreamsById.get(suppliedId)) || workstreamsByName.get(key(name));
    if (!workstream) {
      if (suppliedId && ids.has(suppliedId)) {
        warnings.push(`Workstreams row ${index + 2}: Workstream ID "${suppliedId}" is already in use; skipped.`);
        continue;
      }
      workstream = { id: suppliedId || uniqueId('ws', name, ids), name, description: '', leadId: '' };
      if (suppliedId) ids.add(suppliedId);
      workstreams.push(workstream);
      workstreamsById.set(workstream.id, workstream);
      workstreamsAdded++;
    } else if (workstream.name !== name || workstream.description !== text(row, 'Description')) {
      workstreamsChanged++;
    }
    workstreamsByName.delete(key(workstream.name));
    workstream.name = name;
    workstream.description = text(row, 'Description');
    workstreamsByName.set(key(name), workstream);
    leadRows.set(workstream.id, { name: text(row, 'Lead'), id: text(row, 'Lead ID'), row: index + 2 });
  }

  for (const [workstreamId, lead] of leadRows) {
    const workstream = workstreamsById.get(workstreamId);
    const target = lead.name && (peopleByName.get(key(lead.name)) || (lead.id && peopleById.get(lead.id)));
    if (!lead.name) {
      workstream.leadId = '';
    } else if (!target) {
      warnings.push(`Workstreams row ${lead.row}: Lead "${lead.name || lead.id}" was not found.`);
    } else {
      workstream.leadId = target.id;
    }
  }

  const teamsById = new Map(teams.map(team => [team.id, team]));
  const seenTeamIds = new Set();
  for (const [index, row] of alignmentRows.entries()) {
    const personName = text(row, 'Person'), workstreamName = text(row, 'Workstream');
    const person = personName && (peopleByName.get(key(personName)) || peopleById.get(text(row, 'Person ID')));
    const workstream = workstreamName && (workstreamsByName.get(key(workstreamName)) || workstreamsById.get(text(row, 'Workstream ID')));
    if (!person || !workstream) {
      warnings.push(`Alignments row ${index + 2}: Person or Workstream was not found; skipped.`);
      continue;
    }
    const suppliedId = text(row, 'Alignment ID');
    let team = (suppliedId && teamsById.get(suppliedId)) || teams.find(item => item.personId === person.id && item.workstreamId === workstream.id);
    if (!team) {
      if (suppliedId && ids.has(suppliedId)) {
        warnings.push(`Alignments row ${index + 2}: Alignment ID "${suppliedId}" is already in use; skipped.`);
        continue;
      }
      team = { id: suppliedId || uniqueId('tm', `${workstream.id}-${person.id}`, ids) };
      if (suppliedId) ids.add(suppliedId);
      teams.push(team);
      teamsById.set(team.id, team);
      alignmentsAdded++;
    } else if (team.personId !== person.id || team.workstreamId !== workstream.id || team.role !== text(row, 'Team Role') || String(team.fte ?? '') !== String(row.FTE ?? '')) {
      alignmentsChanged++;
    }
    team.personId = person.id;
    team.workstreamId = workstream.id;
    team.role = text(row, 'Team Role');
    const fte = row.FTE === '' || row.FTE == null ? '' : Number(row.FTE);
    if (fte !== '' && (!Number.isFinite(fte) || fte < 0)) {
      warnings.push(`Alignments row ${index + 2}: invalid FTE "${row.FTE}"; skipped.`);
      continue;
    }
    team.fte = fte;
    seenTeamIds.add(team.id);
  }

  if (replaceAlignments) teams = teams.filter(team => seenTeamIds.has(team.id));
  return {
    next: { people, workstreams, teams },
    warnings,
    summary: { people: { added: peopleAdded, changed: peopleChanged }, workstreams: { added: workstreamsAdded, changed: workstreamsChanged }, alignments: { added: alignmentsAdded, changed: alignmentsChanged, removed: replaceAlignments ? current.teams.length + alignmentsAdded - teams.length : 0 } },
  };
}