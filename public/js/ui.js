// Tiny DOM helpers: element builder, toasts, modal form/confirm dialogs, file download/pick.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = el => { el.replaceChildren(); return el; };
export const fill = (el, ...kids) => { el.replaceChildren(); append(el, kids); return el; };

export function highlight(text, query) {
  text = String(text ?? '');
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return [text.slice(0, i), h('mark', null, text.slice(i, i + query.length)), text.slice(i + query.length)];
}

export function toast(message, type = 'ok') {
  const t = h('div', { class: 'toast' + (type === 'error' ? ' error' : ''), role: type === 'error' ? 'alert' : null }, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), type === 'error' ? 7000 : 3000);
}

function dialogShell(title, body, footer) {
  const dlg = h('dialog', { 'aria-label': title }, h('div', { class: 'dlg-head' }, title), h('div', { class: 'dlg-body' }, body), h('div', { class: 'dlg-foot' }, footer));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  return dlg;
}

export function confirmDialog(message, { title = 'Are you sure?', okLabel = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    let result = false;
    const dlg = dialogShell(title, h('p', null, message), [
      h('button', { class: 'secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
      h('button', { class: danger ? 'danger' : 'primary', type: 'button', onclick: () => { result = true; dlg.close(); } }, okLabel),
    ]);
    dlg.addEventListener('close', () => resolve(result));
    dlg.showModal();
  });
}

export function infoDialog(title, body) {
  const dlg = dialogShell(title, body, [h('button', { class: 'primary', type: 'button', onclick: () => dlg.close() }, 'OK')]);
  dlg.showModal();
  return dlg;
}

/**
 * Modal form. fields: [{name,label,type,required,hint,options,datalist,step,rows}]
 * types: text|textarea|select|date|url|email|number|multi. onSubmit(values) may throw (message shown in the dialog).
 */
export function formDialog({ title, fields, values = {}, submitLabel = 'Save', onSubmit }) {
  const inputs = {};
  const errorBox = h('div', { class: 'error-summary', hidden: true, role: 'alert' });
  const form = h('form', { novalidate: true }, errorBox);
  for (const f of fields) {
    const id = 'f-' + f.name; let input;
    const val = values[f.name] ?? f.default ?? (f.type === 'multi' ? [] : '');
    if (f.type === 'textarea') input = h('textarea', { id, rows: f.rows || 3 }, val);
    else if (f.type === 'select') {
      input = h('select', { id }, (f.options || []).map(o => h('option', { value: o.value, selected: o.value === val }, o.label)));
    } else if (f.type === 'multi') {
      input = h('div', { id, style: { maxHeight: '180px', overflowY: 'auto', border: '2px solid var(--text)', padding: '8px' } },
        (f.options || []).map(o => h('label', { style: { fontWeight: 400, display: 'flex', gap: '8px', alignItems: 'center', minHeight: '32px' } },
          h('input', { type: 'checkbox', value: o.value, checked: val.includes(o.value) }), o.label)));
      if (!(f.options || []).length) input.append(h('span', { class: 'muted' }, 'Nothing to choose from yet.'));
    } else {
      input = h('input', { id, type: f.type || 'text', value: val, step: f.step, list: f.datalist ? id + '-list' : null, autocomplete: 'off' });
    }
    inputs[f.name] = input;
    form.append(h('div', { class: 'field' },
      h('label', { for: id }, f.label, f.required ? '' : ' (optional)'),
      f.hint && h('div', { class: 'hint' }, f.hint),
      input,
      f.datalist && h('datalist', { id: id + '-list' }, f.datalist.map(v => h('option', { value: v })))));
  }
  const read = () => Object.fromEntries(fields.map(f => {
    const el = inputs[f.name];
    if (f.type === 'multi') return [f.name, [...el.querySelectorAll('input:checked')].map(i => i.value)];
    if (f.type === 'number') return [f.name, el.value === '' ? '' : Number(el.value)];
    return [f.name, el.value.trim()];
  }));
  const showError = msg => { errorBox.hidden = false; errorBox.replaceChildren(h('h2', null, 'There is a problem'), h('div', null, msg)); errorBox.scrollIntoView({ block: 'nearest' }); };
  const submit = async ev => {
    ev?.preventDefault();
    const v = read();
    const missing = fields.filter(f => f.required && (Array.isArray(v[f.name]) ? !v[f.name].length : v[f.name] === ''));
    if (missing.length) return showError(`Enter ${missing.map(f => f.label.toLowerCase()).join(', ')}`);
    saveBtn.disabled = true;
    try { await onSubmit(v); dlg.close(); }
    catch (e) { showError(e.message || String(e)); }
    finally { saveBtn.disabled = false; }
  };
  const saveBtn = h('button', { class: 'primary', type: 'submit' }, submitLabel);
  form.addEventListener('submit', submit);
  const dlg = dialogShell(title, form, [h('button', { class: 'secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'), saveBtn]);
  saveBtn.setAttribute('form', 'dlg-form'); form.id = 'dlg-form';
  dlg.showModal();
  Object.values(inputs)[0]?.focus?.();
  return dlg;
}

export function download(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = '.csv') {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', async () => { const f = input.files[0]; input.remove(); resolve(f ? await f.text() : null); });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    document.body.append(input); input.click();
  });
}

/** Wraps a save: shows a success toast or an error toast. Returns true on success. */
export async function attempt(fn, okMessage) {
  try { await fn(); if (okMessage) toast(okMessage); return true; }
  catch (e) { toast(e.message || String(e), 'error'); return false; }
}

export const fmtDate = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', opts) : '';
export const todayIso = () => new Date().toLocaleDateString('en-CA');
