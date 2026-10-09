import { state, commit, uid, sortBy, workstreamName } from '../store.js';
import { h, clear, highlight, formDialog, confirmDialog, attempt, download, pickFile, toast, infoDialog } from '../ui.js';
import { toCsv, parseCsvObjects } from '../csv.js';

export const meta = { id: 'acronyms', title: 'Acronyms', desc: 'Searchable list of acronyms and what they mean.' };
export const count = () => state.acronyms.length;

const fields = () => [
  { name: 'short', label: 'Acronym', required: true },
  { name: 'long', label: 'Meaning', required: true },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'workstreamId', label: 'Workstream', type: 'select', options: [{ value: '', label: '- None -' }, ...sortBy(state.workstreams, w => w.name).map(w => ({ value: w.id, label: w.name }))] },
];

export function render(root) {
  let query = '', letter = '';
  const list = h('div');
  const input = h('input', { type: 'search', id: 'acr-q', placeholder: 'Search acronyms, meanings or descriptions', 'aria-label': 'Search acronyms', oninput: e => { query = e.target.value.trim(); paint(); } });
  const az = h('div', { class: 'az', role: 'group', 'aria-label': 'Filter by first letter' });

  const edit = item => formDialog({
    title: item ? 'Edit acronym' : 'Add acronym', fields: fields(), values: item || {},
    onSubmit: v => commit('acronyms', () => {
      if (item) Object.assign(state.acronyms.find(a => a.id === item.id), v);
      else state.acronyms.push({ id: uid('ac', state.acronyms, v.short + '-' + v.long.slice(0, 12)), ...v });
    }).then(() => { toast(item ? 'Acronym updated' : 'Acronym added'); paint(); }),
  });
  const remove = async item => {
    if (!await confirmDialog(`Delete ${item.short} (${item.long})?`, { title: 'Delete acronym', okLabel: 'Delete', danger: true })) return;
    if (await attempt(() => commit('acronyms', () => { state.acronyms = state.acronyms.filter(a => a.id !== item.id); }), 'Acronym deleted')) paint();
  };

  const exportCsv = () => download('acronyms.csv', toCsv([['Acronym', 'Meaning', 'Description', 'Workstream'],
    ...sortBy(state.acronyms, a => a.short).map(a => [a.short, a.long, a.description || '', workstreamName(a.workstreamId)])]));

  const importCsv = async () => {
    const text = await pickFile(); if (text == null) return;
    const rows = parseCsvObjects(text);
    if (!rows.length || !('acronym' in rows[0]) || !('meaning' in rows[0])) return toast('CSV needs "Acronym" and "Meaning" columns', 'error');
    const wsByName = new Map(state.workstreams.map(w => [w.name.toLowerCase(), w.id]));
    const key = (s, l) => `${s}|${l}`.toLowerCase();
    const warnings = []; let added = 0, changed = 0;
    const next = structuredClone(state.acronyms);
    const byKey = new Map(next.map(a => [key(a.short, a.long), a]));
    rows.forEach((r, i) => {
      if (!r.acronym || !r.meaning) { warnings.push(`Row ${i + 2}: missing acronym or meaning, skipped.`); return; }
      let wsId = '';
      if (r.workstream) { wsId = wsByName.get(r.workstream.toLowerCase()) || ''; if (!wsId) warnings.push(`Row ${i + 2}: workstream "${r.workstream}" not found, left blank.`); }
      const hit = byKey.get(key(r.acronym, r.meaning));
      if (hit) {
        if ((r.description && hit.description !== r.description) || (wsId && hit.workstreamId !== wsId)) { hit.description = r.description || hit.description; hit.workstreamId = wsId || hit.workstreamId; changed++; }
      } else {
        const item = { id: uid('ac', next, r.acronym + '-' + r.meaning.slice(0, 12)), short: r.acronym, long: r.meaning, description: r.description || '', workstreamId: wsId };
        next.push(item); byKey.set(key(r.acronym, r.meaning), item); added++;
      }
    });
    const dlg = infoDialog('Import acronyms', h('div', null,
      h('p', null, `${added} to add, ${changed} to update, ${rows.length - added - changed} unchanged.`),
      warnings.length ? h('ul', null, warnings.slice(0, 10).map(w => h('li', null, w))) : null));
    const ok = h('button', { class: 'primary', type: 'button', disabled: !added && !changed, onclick: async () => {
      dlg.close();
      if (await attempt(() => commit('acronyms', () => { state.acronyms = next; }), 'Import complete')) paint();
    } }, 'Apply import');
    dlg.querySelector('.dlg-foot').prepend(ok);
  };

  function paint() {
    const q = query.toLowerCase();
    const all = sortBy(state.acronyms, a => a.short);
    const letters = [...new Set(all.map(a => (a.short[0] || '').toUpperCase()))].sort();
    clear(az).append(h('button', { type: 'button', 'aria-pressed': letter === '', onclick: () => { letter = ''; paint(); } }, 'All'),
      ...letters.map(l => h('button', { type: 'button', 'aria-pressed': letter === l, onclick: () => { letter = l; paint(); } }, l)));
    const rows = all.filter(a => (!letter || a.short.toUpperCase().startsWith(letter)) &&
      (!q || [a.short, a.long, a.description].some(s => (s || '').toLowerCase().includes(q))));
    clear(list).append(rows.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Acronym', 'Meaning', 'Description', 'Workstream', ''].map(t => h('th', null, t)))),
      h('tbody', null, rows.map(a => h('tr', null,
        h('td', null, h('strong', null, highlight(a.short, query))),
        h('td', null, highlight(a.long, query)),
        h('td', { class: 'muted' }, highlight(a.description, query)),
        h('td', null, workstreamName(a.workstreamId) && h('span', { class: 'chip' }, workstreamName(a.workstreamId))),
        h('td', { class: 'actions' },
          h('button', { class: 'link', type: 'button', onclick: () => edit(a) }, 'Edit', h('span', { class: 'visually-hidden' }, ' ' + a.short)),
          h('button', { class: 'link danger', type: 'button', onclick: () => remove(a) }, 'Delete')))))))
      : h('div', { class: 'card empty' }, state.acronyms.length ? 'No acronyms match your search.' : 'No acronyms yet. Add one to get started.'),
      h('p', { class: 'muted small' }, `Showing ${rows.length} of ${all.length}`));
  }

  root.append(h('h1', null, meta.title), h('p', { class: 'lede' }, meta.desc),
    h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, input),
      h('button', { type: 'button', onclick: () => edit(null) }, 'Add acronym'),
      h('button', { class: 'secondary', type: 'button', onclick: importCsv }, 'Import CSV'),
      h('button', { class: 'secondary', type: 'button', onclick: exportCsv }, 'Export CSV')),
    az, list);
  paint();
  input.focus();
}
