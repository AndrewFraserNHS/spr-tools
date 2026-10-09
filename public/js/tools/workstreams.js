import { state, commit, uid, sortBy, person, workstream, personName, workstreamName, workstreamUsage, personUsage } from '../store.js';
import { h, clear, fill, formDialog, confirmDialog, attempt, toast, download, pickFile, infoDialog } from '../ui.js';
import { toCsv } from '../csv.js';
import { exportRows, planImport } from '../chartCsv.js';

export const meta = { id: 'workstreams', title: 'Workstreams', desc: 'Workstreams and who is in each team. Import or export as CSV.' };
export const count = () => state.workstreams.length;

const COLOURS = ['#005eb8', '#007f3b', '#330072', '#ed8b00', '#00a499', '#ae2573', '#425563', '#006747'];
export const colourFor = id => workstream(id)?.colour || COLOURS[Math.max(0, state.workstreams.findIndex(w => w.id === id)) % COLOURS.length];
const fteText = f => (f === '' || f == null ? '' : `${f} FTE`);

export function render(root) {
  let tab = 'teams';
  const body = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const TABS = [['teams', 'Team chart'], ['matrix', 'Matrix'], ['workstreams', 'Workstreams'], ['people', 'People'], ['csv', 'Import / export']];

  const personOptions = () => [{ value: '', label: '- None -' }, ...sortBy(state.people, p => p.name).map(p => ({ value: p.id, label: p.name }))];
  const done = msg => () => { toast(msg); paint(); };

  // ---- editors
  const editWs = item => formDialog({
    title: item ? 'Edit workstream' : 'Add workstream', values: item || {},
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'leadId', label: 'Lead', type: 'select', options: personOptions() },
    ],
    onSubmit: v => {
      if (state.workstreams.some(w => w.id !== item?.id && w.name.toLowerCase() === v.name.toLowerCase())) throw new Error('A workstream with that name already exists');
      return commit('workstreams', () => {
        if (item) Object.assign(state.workstreams.find(w => w.id === item.id), v);
        else state.workstreams.push({ id: uid('ws', state.workstreams, v.name), ...v });
      }).then(done(item ? 'Workstream updated' : 'Workstream added'));
    },
  });
  const deleteWs = async item => {
    const u = workstreamUsage(item.id);
    const blockers = ['links', 'events', 'acronyms'].filter(k => u[k]).map(k => `${u[k]} ${k}`);
    if (blockers.length) return infoDialog('Cannot delete workstream', h('p', null, `"${item.name}" is still used by ${blockers.join(', ')}. Move or delete those first.`));
    if (!await confirmDialog(`Delete "${item.name}"${u.members ? ` and its ${u.members} team membership(s)` : ''}?`, { title: 'Delete workstream', okLabel: 'Delete', danger: true })) return;
    if (await attempt(() => commit(['workstreams', 'teams'], () => {
      state.workstreams = state.workstreams.filter(w => w.id !== item.id);
      state.teams = state.teams.filter(t => t.workstreamId !== item.id);
    }), 'Workstream deleted')) paint();
  };
  const editPerson = item => formDialog({
    title: item ? 'Edit person' : 'Add person', values: item || {},
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'role', label: 'Job title' },
      { name: 'email', label: 'Email', type: 'email' },
    ],
    onSubmit: v => {
      if (state.people.some(p => p.id !== item?.id && p.name.toLowerCase() === v.name.toLowerCase())) throw new Error('A person with that name already exists');
      return commit('people', () => {
        if (item) Object.assign(state.people.find(p => p.id === item.id), v);
        else state.people.push({ id: uid('p', state.people, v.name), ...v });
      }).then(done(item ? 'Person updated' : 'Person added'));
    },
  });
  const deletePerson = async item => {
    const u = personUsage(item.id);
    const blockers = [u.leads && `leads ${u.leads} workstream(s)`, u.events && `is on ${u.events} event(s)`].filter(Boolean);
    if (blockers.length) return infoDialog('Cannot delete person', h('p', null, `${item.name} ${blockers.join(' and ')}. Reassign those first.`));
    if (!await confirmDialog(`Delete ${item.name}${u.memberships ? ` and ${u.memberships} team membership(s)` : ''}?`, { title: 'Delete person', okLabel: 'Delete', danger: true })) return;
    if (await attempt(() => commit(['people', 'teams'], () => {
      state.people = state.people.filter(p => p.id !== item.id);
      state.teams = state.teams.filter(t => t.personId !== item.id);
    }), 'Person deleted')) paint();
  };
  const editMember = (ws, item) => formDialog({
    title: item ? 'Edit team member' : `Add to ${ws.name}`, values: item || { workstreamId: ws.id },
    fields: [
      { name: 'personId', label: 'Person', type: 'select', required: true, options: [{ value: '', label: '- Choose -' }, ...personOptions().slice(1)] },
      { name: 'role', label: 'Role in this team' },
      { name: 'fte', label: 'FTE', type: 'number', step: '0.1', hint: 'e.g. 0.5 for half-time' },
    ],
    onSubmit: v => {
      if (state.teams.some(t => t.id !== item?.id && t.workstreamId === ws.id && t.personId === v.personId)) throw new Error('That person is already in this team');
      return commit('teams', () => {
        if (item) Object.assign(state.teams.find(t => t.id === item.id), v);
        else state.teams.push({ id: uid('tm', state.teams, ws.id + '-' + v.personId), workstreamId: ws.id, ...v });
      }).then(done(item ? 'Member updated' : 'Member added'));
    },
  });
  const removeMember = async t => {
    if (!await confirmDialog(`Remove ${personName(t.personId)} from ${workstreamName(t.workstreamId)}?`, { okLabel: 'Remove', danger: true })) return;
    if (await attempt(() => commit('teams', () => { state.teams = state.teams.filter(x => x.id !== t.id); }), 'Member removed')) paint();
  };

  // ---- views
  const teamChart = () => state.workstreams.length ? h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' } },
    sortBy(state.workstreams, w => w.name).map(ws => {
      const members = state.teams.filter(t => t.workstreamId === ws.id);
      const total = members.reduce((s, t) => s + (Number(t.fte) || 0), 0);
      return h('section', { class: 'card ws-card', style: { borderLeftColor: colourFor(ws.id), marginBottom: 0 } },
        h('h3', null, ws.name),
        ws.description && h('p', { class: 'muted small', style: { margin: '0 0 8px' } }, ws.description),
        personName(ws.leadId) && h('div', { class: 'small' }, 'Lead: ', h('strong', null, personName(ws.leadId))),
        h('div', { style: { marginTop: '8px' } }, members.length ? sortBy(members, t => personName(t.personId)).map(t => h('div', { class: 'person-row' },
          h('div', null, h('strong', null, personName(t.personId)), h('div', { class: 'muted small' }, [t.role, person(t.personId)?.role].filter(Boolean).join(' - '))),
          h('div', { style: { whiteSpace: 'nowrap', textAlign: 'right' } }, h('span', { class: 'small muted' }, fteText(t.fte)), h('br'),
            h('button', { class: 'link', type: 'button', onclick: () => editMember(ws, t) }, 'Edit'),
            h('button', { class: 'link danger', type: 'button', onclick: () => removeMember(t) }, 'Remove')))) : h('p', { class: 'muted small' }, 'No team members yet.')),
        h('div', { class: 'toolbar', style: { marginBottom: 0 } },
          h('button', { class: 'secondary', type: 'button', onclick: () => editMember(ws, null) }, 'Add member'),
          h('span', { class: 'spacer' }), members.length > 0 && h('span', { class: 'small muted' }, `${members.length} people, ${Math.round(total * 100) / 100} FTE`)));
    })) : h('div', { class: 'card empty' }, 'No workstreams yet.');

  const matrix = () => {
    const ws = sortBy(state.workstreams, w => w.name);
    return h('div', { class: 'table-wrap' }, h('table', { class: 'matrix' },
      h('thead', null, h('tr', null, h('th', null, 'Person'), ws.map(w => h('th', null, h('span', { style: { color: colourFor(w.id) } }, '■ '), w.name)), h('th', { class: 'num' }, 'Total FTE'))),
      h('tbody', null, sortBy(state.people, p => p.name).map(p => {
        const ms = state.teams.filter(t => t.personId === p.id);
        const total = ms.reduce((s, t) => s + (Number(t.fte) || 0), 0);
        return h('tr', null, h('td', null, h('strong', null, p.name), h('div', { class: 'muted small' }, p.role)),
          ws.map(w => { const t = ms.find(x => x.workstreamId === w.id); return h('td', null, t ? [t.role || '✓', t.fte !== '' && t.fte != null ? h('div', { class: 'muted small' }, fteText(t.fte)) : null] : ''); }),
          h('td', { class: 'num' }, total ? Math.round(total * 100) / 100 : ''));
      }))));
  };

  const table = (cols, rows, onEdit, onDelete, onAdd, addLabel) => h('div', null,
    h('div', { class: 'toolbar' }, h('button', { type: 'button', onclick: onAdd }, addLabel)),
    rows.length ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, [...cols, ''].map(c => h('th', null, c)))),
      h('tbody', null, rows.map(r => h('tr', null, r.cells.map(c => h('td', null, c)), h('td', { class: 'actions' },
        h('button', { class: 'link', type: 'button', onclick: () => onEdit(r.item) }, 'Edit'),
        h('button', { class: 'link danger', type: 'button', onclick: () => onDelete(r.item) }, 'Delete'))))))) : h('div', { class: 'card empty' }, 'Nothing here yet.'));

  const csvTab = () => h('div', { class: 'card' },
    h('h2', { style: { marginTop: 0 } }, 'Workstream chart CSV'),
    h('p', null, 'One file holds workstreams, people and team makeup. Columns: ', h('code', null, 'Workstream, Description, Lead, Person, Job title, Email, Team role, FTE'),
      '. A workstream with no person is created without a team. People and workstreams are matched by name, so existing records are updated rather than duplicated.'),
    h('div', { class: 'toolbar' },
      h('button', { class: 'primary', type: 'button', onclick: () => download('workstream-chart.csv', toCsv(exportRows(state))) }, 'Export CSV'),
      h('button', { class: 'secondary', type: 'button', onclick: importFlow }, 'Import CSV...')));

  async function importFlow() {
    const text = await pickFile(); if (text == null) return;
    const replaceBox = h('input', { type: 'checkbox', id: 'replace' });
    const out = h('div');
    const dlg = infoDialog('Import preview', h('div', null, out,
      h('label', { style: { fontWeight: 400, display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' } }, replaceBox,
        'Remove team members not listed in the file (for workstreams in the file)')));
    let plan;
    const refresh = () => {
      plan = planImport(state, text, { replaceTeams: replaceBox.checked });
      const s = plan.summary;
      fill(out, 
        h('ul', null,
          h('li', null, h('span', { class: 'diff-add' }, `${s.workstreams.added} new`), ', ', h('span', { class: 'diff-chg' }, `${s.workstreams.changed} changed`), ' workstreams'),
          h('li', null, h('span', { class: 'diff-add' }, `${s.people.added} new`), ', ', h('span', { class: 'diff-chg' }, `${s.people.changed} changed`), ' people'),
          h('li', null, h('span', { class: 'diff-add' }, `${s.teams.added} new`), ', ', h('span', { class: 'diff-chg' }, `${s.teams.changed} changed`), ', ', h('span', { class: 'diff-del' }, `${s.teams.removed} removed`), ' memberships')),
        plan.warnings.length ? h('div', { class: 'error-summary' }, h('h2', null, 'Warnings'), h('ul', null, plan.warnings.slice(0, 10).map(w => h('li', null, w)))) : null);
      apply.disabled = plan.warnings.some(w => /Missing required|No data rows/.test(w));
    };
    const apply = h('button', { class: 'primary', type: 'button', onclick: async () => {
      dlg.close();
      if (await attempt(() => commit(['people', 'workstreams', 'teams'], () => Object.assign(state, plan.next)), 'Import complete')) paint();
    } }, 'Apply import');
    replaceBox.addEventListener('change', refresh);
    dlg.querySelector('.dlg-foot').prepend(apply);
    refresh();
  }

  function paint() {
    clear(tabs).append(...TABS.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': tab === id, onclick: () => { tab = id; paint(); } }, label)));
    const views = {
      teams: teamChart, matrix,
      workstreams: () => table(['Name', 'Description', 'Lead', 'Members'], sortBy(state.workstreams, w => w.name).map(w => ({ item: w, cells: [h('strong', null, w.name), w.description, personName(w.leadId), String(workstreamUsage(w.id).members)] })), editWs, deleteWs, () => editWs(null), 'Add workstream'),
      people: () => table(['Name', 'Job title', 'Email', 'Teams'], sortBy(state.people, p => p.name).map(p => ({ item: p, cells: [h('strong', null, p.name), p.role, p.email, state.teams.filter(t => t.personId === p.id).map(t => h('span', { class: 'chip' }, workstreamName(t.workstreamId)))] })), editPerson, deletePerson, () => editPerson(null), 'Add person'),
      csv: csvTab,
    };
    clear(body).append(views[tab]());
  }

  root.append(h('h1', null, meta.title), h('p', { class: 'lede' }, meta.desc), tabs, body);
  paint();
}
