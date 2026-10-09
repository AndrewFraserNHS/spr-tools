import { state, commit, uid, sortBy, workstreamName, workstream } from '../store.js';
import { h, fill, highlight, formDialog, confirmDialog, attempt, toast } from '../ui.js';

export const meta = { id: 'links', title: 'Useful links', desc: 'Links grouped by workstream, category and sub-category.' };
export const count = () => state.links.length;

const distinct = key => [...new Set([...state.links.map(l => l[key]), ...(key === 'category' ? state.config.linkCategories || [] : [])].filter(Boolean))].sort();

export function render(root) {
  let query = '', wsFilter = '';
  const list = h('div');
  const wsOptions = [{ value: '', label: '- General (no workstream) -' }, ...sortBy(state.workstreams, w => w.name).map(w => ({ value: w.id, label: w.name }))];

  const edit = item => formDialog({
    title: item ? 'Edit link' : 'Add link', values: item || { workstreamId: wsFilter !== '__none' ? wsFilter : '' },
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'href', label: 'Web address', type: 'url', required: true, hint: 'Include https://' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'workstreamId', label: 'Workstream', type: 'select', options: wsOptions },
      { name: 'category', label: 'Category', datalist: distinct('category'), hint: 'Pick an existing one or type a new one' },
      { name: 'subCategory', label: 'Sub-category', datalist: distinct('subCategory') },
    ],
    onSubmit: v => {
      if (!/^https?:\/\//i.test(v.href)) throw new Error('Web address must start with http:// or https://');
      return commit('links', () => {
        if (item) Object.assign(state.links.find(l => l.id === item.id), v);
        else state.links.push({ id: uid('ln', state.links, v.name), ...v });
      }).then(() => { toast(item ? 'Link updated' : 'Link added'); paint(); });
    },
  });
  const remove = async item => {
    if (!await confirmDialog(`Delete "${item.name}"?`, { title: 'Delete link', okLabel: 'Delete', danger: true })) return;
    if (await attempt(() => commit('links', () => { state.links = state.links.filter(l => l.id !== item.id); }), 'Link deleted')) paint();
  };

  const wsSelect = h('select', { id: 'lnk-ws', 'aria-label': 'Filter by workstream', onchange: e => { wsFilter = e.target.value; paint(); } },
    h('option', { value: '' }, 'All workstreams'), h('option', { value: '__none' }, 'General (no workstream)'),
    sortBy(state.workstreams, w => w.name).map(w => h('option', { value: w.id }, w.name)));
  const input = h('input', { type: 'search', placeholder: 'Search links', 'aria-label': 'Search links', oninput: e => { query = e.target.value.trim(); paint(); } });

  function paint() {
    const q = query.toLowerCase();
    const rows = state.links.filter(l =>
      (!wsFilter || (wsFilter === '__none' ? !workstream(l.workstreamId) : l.workstreamId === wsFilter)) &&
      (!q || [l.name, l.description, l.category, l.subCategory, workstreamName(l.workstreamId)].some(s => (s || '').toLowerCase().includes(q))));
    // workstream -> category -> subCategory
    const groups = new Map();
    for (const l of rows) {
      const wsKey = workstream(l.workstreamId) ? l.workstreamId : '';
      const cat = l.category || 'Uncategorised', sub = l.subCategory || '';
      if (!groups.has(wsKey)) groups.set(wsKey, new Map());
      const cm = groups.get(wsKey); if (!cm.has(cat)) cm.set(cat, new Map());
      const sm = cm.get(cat); if (!sm.has(sub)) sm.set(sub, []);
      sm.get(sub).push(l);
    }
    const wsKeys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : workstreamName(a).localeCompare(workstreamName(b))));
    fill(list, rows.length ? wsKeys.map(k => h('section', { class: 'card' },
      h('h2', { style: { marginTop: 0 } }, k ? workstreamName(k) : 'General'),
      [...groups.get(k)].sort(([a], [b]) => a.localeCompare(b)).map(([cat, subs]) => h('div', null,
        h('h3', null, cat),
        [...subs].sort(([a], [b]) => a.localeCompare(b)).map(([sub, items]) => h('div', { style: { margin: '0 0 12px 12px' } },
          sub && h('div', { class: 'muted', style: { fontWeight: 700, fontSize: '.9rem' } }, sub),
          sortBy(items, l => l.name).map(l => h('div', { class: 'person-row' },
            h('div', null, h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, highlight(l.name, query)),
              l.description && h('div', { class: 'muted small' }, highlight(l.description, query))),
            h('div', { style: { whiteSpace: 'nowrap' } },
              h('button', { class: 'link', type: 'button', onclick: () => edit(l) }, 'Edit'),
              h('button', { class: 'link danger', type: 'button', onclick: () => remove(l) }, 'Delete'))))))))))
      : h('div', { class: 'card empty' }, state.links.length ? 'No links match.' : 'No links yet. Add one to get started.'));
  }

  root.append(h('h1', null, meta.title), h('p', { class: 'lede' }, meta.desc),
    h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, input), wsSelect, h('button', { type: 'button', onclick: () => edit(null) }, 'Add link')), list);
  paint();
}
