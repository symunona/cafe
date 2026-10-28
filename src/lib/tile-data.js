define([], () => {

  function lon2tile(lon, zoom) {
    return Math.floor(((lon + 180) / 360) * 2 ** zoom)
  }

  function lat2tile(lat, zoom) {
    const rad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom)
  }

  function clamp(v, max) {
    return Math.max(0, Math.min(max, v))
  }

  class TileData {
    constructor(baseUrl) {
      this.baseUrl = baseUrl
      this.tiles = new Map()
      this.pending = new Map()
      this.meta = null
      this.bits = null
    }

    async init() {
      const res = await fetch(`${this.baseUrl}/meta.json`)
      if (!res.ok) throw new Error(`meta.json: ${res.status}`)
      this.meta = await res.json()
      this.bits = Uint8Array.from(atob(this.meta.tiles), (c) => c.charCodeAt(0))
      return this.meta
    }

    exists(x, y) {
      const i = y * 2 ** this.meta.zoom + x
      return (this.bits[i >> 3] & (1 << (i & 7))) !== 0
    }

    keysFor(bounds) {
      const z = this.meta.zoom
      const max = 2 ** z - 1
      const x0 = clamp(lon2tile(bounds.getWest(), z), max)
      const x1 = clamp(lon2tile(bounds.getEast(), z), max)
      const y0 = clamp(lat2tile(bounds.getNorth(), z), max)
      const y1 = clamp(lat2tile(bounds.getSouth(), z), max)
      const keys = []
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (this.exists(x, y)) keys.push(`${x}/${y}`)
        }
      }
      return keys
    }

    load(keys) {
      return Promise.all(keys.map((key) => this.loadTile(key)))
    }

    loadTile(key) {
      if (this.tiles.has(key)) return Promise.resolve(this.tiles.get(key))
      if (this.pending.has(key)) return this.pending.get(key)
      const request = fetch(`${this.baseUrl}/${this.meta.zoom}/${key}.json`)
        .then((res) => {
          if (!res.ok) throw new Error(`tile ${key}: ${res.status}`)
          return res.json()
        })
        .then((tile) => {
          this.tiles.set(key, tile)
          return tile
        })
        .finally(() => this.pending.delete(key))
      this.pending.set(key, request)
      return request
    }

    isLoaded(keys) {
      return keys.every((key) => this.tiles.has(key))
    }

    pointsIn(bounds, types) {
      const south = bounds.getSouth()
      const north = bounds.getNorth()
      const west = bounds.getWest()
      const east = bounds.getEast()
      const result = {}
      types.forEach((type) => { result[type] = [] })
      this.keysFor(bounds).forEach((key) => {
        const tile = this.tiles.get(key)
        if (!tile) return
        types.forEach((type) => {
          const coords = tile[type]
          if (!coords) return
          const out = result[type]
          for (let i = 0; i < coords.length; i += 2) {
            const lat = coords[i]
            const lon = coords[i + 1]
            if (lat >= south && lat <= north && lon >= west && lon <= east) out.push(lat, lon)
          }
        })
      })
      return result
    }
  }

  return TileData
})
