# cafe
Do you know where the cafés are?

Simple hipster district finder.

[cafe.tmpx.space](https://cafe.tmpx.space)

## Data

POIs come from a static OpenStreetMap snapshot in `data/` (zoom 8 tiles + `meta.json`).
Refresh it manually with `npm run pull-data` (queries [QLever](https://qlever.dev)),
or rebuild tiles from a saved TSV with `node scripts/pull-data.mjs --from all.tsv`.
