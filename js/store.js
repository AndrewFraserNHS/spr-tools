// Single source of truth: loads every /data collection once and writes changes back through the local server.
import { openVault, sealVault } from "./vault.js";

export const NAMES = ['people', 'workstreams', 'teams', 'links', 'events', 'acronyms', 'config'];
export const state = Object.fromEntries(NAMES.map(n => [n, n === 'config' ? {} : []]));
export const status = { writable: false, loaded: false };
const listeners = new Set();
const APP_ROOT = new URL("../", import.meta.url);
const apiUrl = (path) => new URL(`api/${path}`, APP_ROOT);
const dataUrl = () => new URL("data/vault.json", APP_ROOT);
let vaultKey = null;
let vaultSalt = null;
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

export async function load(passphrase) {
  if (!passphrase) throw new Error("Enter the vault passphrase.");
  await ping();
  const res = await fetch(status.writable ? apiUrl("vault") : dataUrl(), {
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 404)
      throw new Error(
        'The encrypted vault has not been created. Run "npm run protect-data" in the project terminal first.',
      );
    throw new Error("Could not load the encrypted vault.");
  }
  let envelope;
  try {
    envelope = await res.json();
  } catch {
    throw new Error("The encrypted vault file is invalid.");
  }
  const opened = await openVault(envelope, passphrase);
  for (const name of NAMES) {
    const value = opened.data[name];
    const valid =
      name === "config"
        ? value && typeof value === "object" && !Array.isArray(value)
        : Array.isArray(value);
    if (!valid)
      throw new Error(`Encrypted data has an invalid ${name} collection.`);
  }
  for (const name of NAMES) state[name] = opened.data[name];
  vaultKey = opened.key;
  vaultSalt = opened.salt;
  status.loaded = true;
  emit();
}

export function lock() {
  for (const name of NAMES) state[name] = name === "config" ? {} : [];
  vaultKey = null;
  vaultSalt = null;
  status.loaded = false;
  status.writable = false;
  emit();
}

async function writeVault() {
  const envelope = await sealVault(
    Object.fromEntries(NAMES.map((name) => [name, state[name]])),
    vaultKey,
    vaultSalt,
  );
  const res = await fetch(apiUrl("vault"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).error ||
        `Save failed (${res.status})`,
    );
}

/** Apply `mutate` to the named collections, persist them, and roll back everything if any write fails. */
export async function commit(names, mutate) {
  names = [].concat(names);
  if (!status.loaded || !vaultKey)
    throw new Error("Unlock the data vault before editing.");
  if (!(await ping())) throw new Error('The local server is not running, so changes cannot be saved. Start it with "npm start".');
  const snapshot = Object.fromEntries(names.map(n => [n, structuredClone(state[n])]));
  try {
    mutate();
    await writeVault();
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
    reportsTo: state.people.filter(p => p.reportsToId === id).length,
    events: state.events.filter(e => (e.personIds || []).includes(id)).length,
    memberships: state.teams.filter(t => t.personId === id).length,
  };
}
