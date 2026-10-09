import { load, onStatus, status, ping } from './store.js';
import { h, clear } from './ui.js';
import * as home from './tools/home.js';
import * as acronyms from './tools/acronyms.js';
import * as workstreams from './tools/workstreams.js';
import * as events from './tools/events.js';
import * as links from './tools/links.js';

export const tools = [acronyms, workstreams, events, links];
const routes = [home, ...tools];
const main = document.getElementById('main');
const nav = document.getElementById('nav');
const statusEl = document.getElementById('status');

function renderStatus() {
  statusEl.textContent = status.writable ? '' : 'Offline - read only';
  statusEl.className = 'status' + (status.writable ? '' : ' offline');
}

function route() {
  const id = location.hash.replace(/^#\/?/, '').split('/')[0] || 'home';
  const tool = routes.find(t => t.meta.id === id) || home;
  document.title = (tool === home ? '' : tool.meta.title + ' - ') + 'SPR Tools';
  clear(nav).append(...[home, ...tools].map(t => h('a', { href: t === home ? '#/' : '#/' + t.meta.id, 'aria-current': t === tool ? 'page' : null }, t.meta.title)));
  clear(main);
  tool.render(main);
  main.focus({ preventScroll: true });
}

onStatus(renderStatus);
window.addEventListener('hashchange', route);
window.addEventListener('focus', ping);
window.addEventListener('online', ping);

try {
  await load();
  renderStatus();
  route();
} catch (e) {
  main.replaceChildren(h('div', { class: 'card' }, h('h1', null, 'Cannot load data'), h('p', null, 'Start the local server with ', h('code', null, 'npm start'), ' and reload.'), h('p', { class: 'muted' }, e.message)));
}

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
