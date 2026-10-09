import { h } from '../ui.js';
import { fmtDate } from '../ui.js';
import { state } from '../store.js';
import * as acronyms from './acronyms.js';
import * as workstreams from './workstreams.js';
import * as events from './events.js';
import * as links from './links.js';

export const meta = { id: 'home', title: 'Home', desc: '' };
const tools = [acronyms, workstreams, events, links];

export function render(root) {
  const next = events.upcoming().slice(0, 5);
  root.append(
    h('h1', null, state.config.appName || 'SPR Tools'),
    h('p', { class: 'lede' }, 'Everything in one place. Anything you edit is saved straight to the files in the repo.'),
    h('div', { class: 'grid' }, tools.map(t => h('a', { class: 'tile', href: '#/' + t.meta.id },
      h('span', { class: 'count', 'aria-label': `${t.count()} items` }, t.count()), h('h3', null, t.meta.title), h('p', null, t.meta.desc)))),
    h('h2', null, 'Next events'),
    h('div', { class: 'card' }, next.length ? next.map(e => h('div', { class: 'event' },
      h('div', { class: 'date-badge' }, h('b', null, fmtDate(e.date, { day: 'numeric' })), fmtDate(e.date, { month: 'short' })),
      h('div', { class: 'body' }, h('strong', null, e.title), h('div', { class: 'muted small' }, fmtDate(e.date, { weekday: 'long', day: 'numeric', month: 'long' }), e.location ? ` - ${e.location}` : '')))) :
      h('div', { class: 'empty' }, 'Nothing coming up.'),
      h('p', null, h('a', { href: '#/events' }, 'All events'))));
}
