#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENDPOINT = 'https://qlever.dev/api/osm-planet'
const ZOOM = 8
const PRECISION = 5
const TYPES = { cafe: 'c', library: 'l', university: 'u', college: 'u' }
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

const QUERY = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?v (geof:centroid(?w) AS ?c) WHERE { ?o osmkey:amenity ?v . VALUES ?v { "cafe" "library" "university" "college" } ?o geo:hasGeometry/geo:asWKT ?w }`

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = argv[++i]
    else if (argv[i] === '--save') args.save = argv[++i]
    else if (argv[i] === '--date') args.date = argv[++i]
  }
  return args
}

async function fetchSnapshotDate() {
  const res = await fetch(`${ENDPOINT}?cmd=stats`)
  if (!res.ok) throw new Error(`stats ${res.status}`)
  const stats = await res.json()
  const match = JSON.stringify(stats).match(/planet-(\d{2})(\d{2})(\d{2})\.osm\.pbf/)
  return match ? `20${match[1]}-${match[2]}-${match[3]}` : null
}

async function fetchTsv() {
  console.log('querying QLever...')
  const started = Date.now()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'text/tab-separated-values',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ query: QUERY })
  })
  if (!res.ok) throw new Error(`query ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const text = await res.text()
  console.log(`got ${(text.length / 1e6).toFixed(1)}MB in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  return text
}

function tileOf(lat, lon) {
  const n = 2 ** ZOOM
  const x = Math.floor(((lon + 180) / 360) * n)
  const rad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))]
}

function round(v) {
  const f = 10 ** PRECISION
  return Math.round(v * f) / f
}

function buildTiles(tsv) {
  const tiles = new Map()
  const counts = { cafe: 0, library: 0, university: 0, college: 0 }
  const seen = new Set()
  let skipped = 0
  for (const line of tsv.split('\n')) {
    const m = line.match(/^"(\w+)"\tPOINT\(([-\d.eE]+) ([-\d.eE]+)\)/)
    if (!m) {
      if (line && !line.startsWith('?')) skipped++
      continue
    }
    const [, type, lonS, latS] = m
    const key = TYPES[type]
    if (!key) continue
    const lat = round(parseFloat(latS))
    const lon = round(parseFloat(lonS))
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85.0511) {
      skipped++
      continue
    }
    const id = `${key}${lat},${lon}`
    if (seen.has(id)) continue
    seen.add(id)
    counts[type]++
    const [x, y] = tileOf(lat, lon)
    const tileKey = `${x}/${y}`
    if (!tiles.has(tileKey)) tiles.set(tileKey, { c: [], l: [], u: [] })
    tiles.get(tileKey)[key].push(lat, lon)
  }
  return { tiles, counts, skipped }
}

function tileBitmap(tiles) {
  const n = 2 ** ZOOM
  const bits = new Uint8Array((n * n) / 8)
  for (const key of tiles.keys()) {
    const [x, y] = key.split('/').map(Number)
    const i = y * n + x
    bits[i >> 3] |= 1 << (i & 7)
  }
  return Buffer.from(bits).toString('base64')
}

async function writeOutput({ tiles, counts }, snapshot) {
  await rm(DATA_DIR, { recursive: true, force: true })
  let total = 0
  let biggest = { key: null, size: 0 }
  for (const [key, tile] of tiles) {
    for (const k of Object.keys(tile)) if (!tile[k].length) delete tile[k]
    const body = JSON.stringify(tile)
    const file = join(DATA_DIR, String(ZOOM), `${key}.json`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, body)
    total += body.length
    if (body.length > biggest.size) biggest = { key, size: body.length }
  }
  const meta = {
    snapshot,
    generated: new Date().toISOString(),
    source: 'OpenStreetMap via QLever (qlever.dev/api/osm-planet)',
    zoom: ZOOM,
    counts,
    tileCount: tiles.size,
    tiles: tileBitmap(tiles)
  }
  const metaBody = JSON.stringify(meta)
  await writeFile(join(DATA_DIR, 'meta.json'), metaBody)
  total += metaBody.length
  return { total, biggest, files: tiles.size + 1 }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let tsv
  let snapshot = args.date || null
  if (args.from) {
    tsv = await readFile(args.from, 'utf8')
    if (!snapshot) {
      try {
        snapshot = await fetchSnapshotDate()
      } catch (e) {
        console.warn(`could not fetch snapshot date: ${e.message}`)
      }
    }
  } else {
    snapshot = snapshot || (await fetchSnapshotDate())
    tsv = await fetchTsv()
    if (args.save) await writeFile(args.save, tsv)
  }
  const built = buildTiles(tsv)
  const { total, biggest, files } = await writeOutput(built, snapshot)
  console.log(`snapshot: ${snapshot}`)
  console.log(`counts: ${JSON.stringify(built.counts)} skipped: ${built.skipped}`)
  console.log(`files: ${files}, total: ${(total / 1e6).toFixed(2)}MB raw`)
  console.log(`biggest tile: ${ZOOM}/${biggest.key} ${(biggest.size / 1e3).toFixed(0)}KB`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
