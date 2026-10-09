# SPR Tools

An NHS-styled, installable PWA hub for day-to-day tools. No frontend build step.

## Run

```bash
npm start
```

Open http://localhost:5173 and (optionally) install it from the browser's address bar. Tests: `npm test`.

## Tools

| Tool | What it does |
| --- | --- |
| Acronyms | Instant search, A-Z filter, add/edit/delete, CSV import/export |
| Workstreams | Team chart, people x workstream matrix, edit workstreams/people/membership, one-file CSV import/export |
| Upcoming events | Editable list, workstream filter, `.ics` export |
| Useful links | Grouped by workstream > category > sub-category, editable |

## Encrypted data vault

Run `npm run protect-data` once before using or deploying. It converts the current collection files into an encrypted vault. After setup, edits are encrypted in the browser and saved by the localhost server as `data/vault.json`; plaintext collection files are removed from the repository and backed up outside it.

The encrypted payload contains these linked collections:

- people: one record per person, including the optional `reportsToId`
- workstreams: lead is a person ID
- teams: membership facts (workstream + person + role + FTE)
- links, events, acronyms: reference workstreams/people by ID
- config: shared constants (app name, suggested link categories)

Renaming a person or workstream updates every view. Deleting something still in use is blocked with an explanation.

### Shared workstream workbook

Use **Workstreams > Import / export > Download workbook** to share the data with a team. The `.xlsx` file has separate tabs for `People`, `Workstreams`, and `Alignments`, so names, job titles, descriptions, and contact details are recorded once. Alignments reference people and workstreams by name; hidden IDs preserve existing links if names change. `Reports To` is a person relationship on the `People` tab.

Import the completed workbook from the same tab. It previews changes before applying them. The optional alignment replacement checkbox removes existing alignments omitted from the workbook; people and workstreams not listed are retained.

## Offline

A service worker caches the app. If the server is stopped the app still opens (read-only, "Offline" badge).

### Data protection

Before using or deploying this version, run `npm run protect-data` in a terminal. It encrypts all data with AES-256-GCM using a passphrase-derived key, writes only ciphertext to `data/vault.json`, and moves plaintext backups outside the repository. Keep the passphrase outside source control and share it with the team through a separate secure channel. If it is lost, the data cannot be recovered without the external plaintext backup.

The app does not request the encrypted vault until someone enters the passphrase. GitHub Pages still serves the encrypted file publicly, but it does not contain readable records. Previously committed plaintext remains visible in Git history; if this repository has already been pushed somewhere others can access, history must also be purged and the exposed data treated as disclosed.

Regenerate icons with `node scripts/make-icons.mjs`.
