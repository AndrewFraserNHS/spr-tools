# SPR Tools

An NHS-styled, installable PWA hub for day-to-day tools. No dependencies, no build step.

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

## Data = the repo

All edits are written straight to `data/*.json` by the tiny local server (`server.js`, localhost only), so changes show up in `git diff`.

Single source of truth, linked by ID so nothing is entered twice:

- `people.json` - one record per person
- `workstreams.json` - lead is a person ID
- `teams.json` - the only place team membership lives (workstream + person + role + FTE)
- `links.json`, `events.json`, `acronyms.json` - reference workstreams/people by ID
- `config.json` - shared constants (app name, suggested link categories)

Renaming a person or workstream updates every view. Deleting something still in use is blocked with an explanation.

### Shared workstream workbook

Use **Workstreams > Import / export > Download workbook** to share the data with a team. The `.xlsx` file has separate tabs for `People`, `Workstreams`, and `Alignments`, so names, job titles, descriptions, and contact details are recorded once. Alignments reference people and workstreams by name; hidden IDs preserve existing links if names change. `Reports To` is a person relationship on the `People` tab.

Import the completed workbook from the same tab. It previews changes before applying them. The optional alignment replacement checkbox removes existing alignments omitted from the workbook; people and workstreams not listed are retained.

## Offline

A service worker caches the app. If the server is stopped the app still opens (read-only, "Offline" badge).

Regenerate icons with `node scripts/make-icons.mjs`.
