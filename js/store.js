// Single source of truth: loads every /data collection once and writes changes back through the local server.
export const NAMES = ['people', 'workstreams', 'teams', 'links', 'events', 'acronyms', 'config'];
export const state = Object.fromEntries(NAMES.map(n => [n, n === 'config' ? {} : []]));
export const status = { writable: false, loaded: false };
const listeners = new Set();
const APP_ROOT = new URL("../", import.meta.url);
const apiUrl = (path) => new URL(`api/${path}`, APP_ROOT);
const dataUrl = (name) => new URL(`data/${name}.json`, APP_ROOT);
export const onStatus = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

export async function ping() {
  try {
    status.writable = (await fetch(apiUrl("ping"), { cache: "no-store" })).ok;
  } catch {
    status.writable = false;
  }
  emit();
  return status.writable;
}

export async function load() {
  await ping();
  await Promise.all(NAMES.map(async n => {
    const res = await fetch(
      status.writable ? apiUrl(`data/${n}`) : dataUrl(n),
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`Could not load ${n}`);
    state[n] = await res.json();
  }));
  status.loaded = true;
}

async function write(name) {
  const res = await fetch(apiUrl(`data/${name}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state[name]),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Save failed (${res.status})`);
}

/** Apply `mutate` to the named collections, persist them, and roll back everything if any write fails. */
export async function commit(names, mutate) {
  names = [].concat(names);
  if (!(await ping())) throw new Error('The local server is not running, so changes cannot be saved. Start it with "npm start".');
  const snapshot = Object.fromEntries(names.map(n => [n, structuredClone(state[n])]));
  try {
    mutate();
    for (const n of names) await write(n);
  } catch (e) {
    for (const n of names) state[n] = snapshot[n];
    throw e;
  }
}

export const uid = (prefix, existing, seed = '') => {
  const base = `${prefix}-${(seed || Math.random().toString(36).slice(2, 8)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'}`;
  const taken = new Set(existing.map(x => x.id));
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
};

// Lookups
export const person = id => state.people.find(p => p.id === id);
export const workstream = id => state.workstreams.find(w => w.id === id);
export const personName = id => person(id)?.name ?? '';
export const workstreamName = id => workstream(id)?.name ?? '';
export const sortBy = (arr, fn) => [...arr].sort((a, b) => String(fn(a)).localeCompare(String(fn(b)), 'en-GB', { sensitivity: 'base' }));

// Reference counts, used to block deleting things that are still in use
export function workstreamUsage(id) {
  return {
    links: state.links.filter(l => l.workstreamId === id).length,
    events: state.events.filter(e => e.workstreamId === id).length,
    acronyms: state.acronyms.filter(a => a.workstreamId === id).length,
    members: state.teams.filter(t => t.workstreamId === id).length,
  };
}
export function personUsage(id) {
  return {
    leads: state.workstreams.filter(w => w.leadId === id).length,
    events: state.events.filter(e => (e.personIds || []).includes(id)).length,
    memberships: state.teams.filter(t => t.personId === id).length,
  };
}
