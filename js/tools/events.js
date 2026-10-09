import { state, commit, uid, sortBy, workstreamName, workstream, personName } from '../store.js';
import { h, fill, formDialog, confirmDialog, attempt, toast, fmtDate, todayIso, download } from '../ui.js';

export const meta = { id: 'events', title: 'Upcoming events', desc: 'Dates for your diary. Changes are saved to data/events.json.' };
export const upcoming = () => state.events.filter(e => (e.endDate || e.date) >= todayIso()).sort((a, b) => a.date.localeCompare(b.date));
export const count = () => upcoming().length;

export function render(root) {
  let wsFilter = '', showPast = false;
  const list = h('div', { class: 'card' });

  const edit = item => formDialog({
    title: item ? 'Edit event' : 'Add event', values: item || {},
    fields: [
      { name: 'title', label: 'Title', required: true },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'endDate', label: 'End date', type: 'date', hint: 'Leave blank for a single-day event' },
      { name: 'workstreamId', label: 'Workstream', type: 'select', options: [{ value: '', label: '- None -' }, ...sortBy(state.workstreams, w => w.name).map(w => ({ value: w.id, label: w.name }))] },
      { name: 'location', label: 'Location' },
      { name: 'personIds', label: 'People involved', type: 'multi', options: sortBy(state.people, p => p.name).map(p => ({ value: p.id, label: p.name })) },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onSubmit: v => {
      if (v.endDate && v.endDate < v.date) throw new Error('End date cannot be before the start date');
      return commit('events', () => {
        if (item) Object.assign(state.events.find(e => e.id === item.id), v);
        else state.events.push({ id: uid('ev', state.events, v.title), ...v });
      }).then(() => { toast(item ? 'Event updated' : 'Event added'); paint(); });
    },
  });
  const remove = async item => {
    if (!await confirmDialog(`Delete "${item.title}"?`, { title: 'Delete event', okLabel: 'Delete', danger: true })) return;
    if (await attempt(() => commit('events', () => { state.events = state.events.filter(e => e.id !== item.id); }), 'Event deleted')) paint();
  };

  const exportIcs = () => {
    const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
    const esc = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const day = iso => iso.replace(/-/g, '');
    const plusOne = iso => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA').replace(/-/g, ''); };
    const body = upcoming().map(e => ['BEGIN:VEVENT', `UID:${e.id}@spr-tools`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(e.date)}`,
      `DTEND;VALUE=DATE:${plusOne(e.endDate || e.date)}`, `SUMMARY:${esc(e.title)}`, e.location && `LOCATION:${esc(e.location)}`,
      e.notes && `DESCRIPTION:${esc(e.notes)}`, 'END:VEVENT'].filter(Boolean).join('\r\n'));
    download('events.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//spr-tools//EN', ...body, 'END:VCALENDAR'].join('\r\n') + '\r\n', 'text/calendar');
  };

  const item = (e, past) => {
    const [d, m] = fmtDate(e.date, { day: 'numeric', month: 'short' }).split(' ');
    return h('div', { class: 'event' + (past ? ' past' : '') },
      h('div', { class: 'date-badge' }, h('b', null, d), m),
      h('div', { class: 'body' },
        h('h3', null, e.title),
        h('div', { class: 'muted small' }, fmtDate(e.date) + (e.endDate ? ` to ${fmtDate(e.endDate)}` : ''), e.location ? ` - ${e.location}` : ''),
        workstream(e.workstreamId) && h('span', { class: 'chip' }, workstreamName(e.workstreamId)),
        (e.personIds || []).filter(personName).map(id => h('span', { class: 'chip' }, personName(id))),
        e.notes && h('div', { class: 'small' }, e.notes)),
      h('div', { style: { whiteSpace: 'nowrap' } },
        h('button', { class: 'link', type: 'button', onclick: () => edit(e) }, 'Edit'),
        h('button', { class: 'link danger', type: 'button', onclick: () => remove(e) }, 'Delete')));
  };

  function paint() {
    const match = e => !wsFilter || e.workstreamId === wsFilter;
    const up = upcoming().filter(match);
    const past = state.events.filter(e => (e.endDate || e.date) < todayIso() && match(e)).sort((a, b) => b.date.localeCompare(a.date));
    fill(list, 
      up.length ? up.map(e => item(e, false)) : h('div', { class: 'empty' }, 'No upcoming events.'),
      past.length > 0 && h('div', { style: { marginTop: '16px' } },
        h('button', { class: 'secondary', type: 'button', onclick: () => { showPast = !showPast; paint(); } }, `${showPast ? 'Hide' : 'Show'} ${past.length} past event${past.length > 1 ? 's' : ''}`),
        showPast && past.map(e => item(e, true))));
  }

  root.append(h('h1', null, meta.title), h('p', { class: 'lede' }, meta.desc),
    h('div', { class: 'toolbar' },
      h('select', { 'aria-label': 'Filter by workstream', onchange: e => { wsFilter = e.target.value; paint(); } },
        h('option', { value: '' }, 'All workstreams'), sortBy(state.workstreams, w => w.name).map(w => h('option', { value: w.id }, w.name))),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', onclick: () => edit(null) }, 'Add event'),
      h('button', { class: 'secondary', type: 'button', onclick: exportIcs }, 'Export calendar (.ics)')),
    list);
  paint();
}
