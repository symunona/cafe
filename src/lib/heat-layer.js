define(['leaflet'], (L) => {

  const CELL = 4
  const TILE = 256
  const PAD = 64

  function palette(gradient) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const fill = ctx.createLinearGradient(0, 0, 256, 1)
    Object.keys(gradient).forEach((stop) => fill.addColorStop(+stop, gradient[stop]))
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, 256, 1)
    return ctx.getImageData(0, 0, 256, 1).data
  }

  function stamp(radius, blur) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = radius * 2
    const ctx = canvas.getContext('2d')
    const fill = ctx.createRadialGradient(radius, radius, radius * (1 - blur), radius, radius, radius)
    fill.addColorStop(0, 'rgba(0,0,0,1)')
    fill.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, radius * 2, radius * 2)
    return canvas
  }

  const HeatLayer = L.Layer.extend({
    options: {
      resolution: 1
    },

    initialize(options) {
      L.setOptions(this, options)
      this._palettes = new Map()
      this._stamps = new Map()
      this._counts = null
      this._touched = null
    },

    onAdd(map) {
      this._canvas = L.DomUtil.create('canvas', 'heat-canvas leaflet-zoom-animated')
      this._canvas.style.pointerEvents = 'none'
      this._ctx = this._canvas.getContext('2d', { willReadFrequently: true })
      this._shadow = document.createElement('canvas')
      this._shadowCtx = this._shadow.getContext('2d', { willReadFrequently: true })
      map.getPanes().overlayPane.appendChild(this._canvas)
      this._drawn = null
    },

    onRemove() {
      L.DomUtil.remove(this._canvas)
    },

    getEvents() {
      return {
        zoomanim: this._animateZoom,
        viewreset: this._place
      }
    },

    _animateZoom(e) {
      if (!this._drawn) return
      const scale = this._map.getZoomScale(e.zoom, this._drawn.zoom)
      const offset = this._map._latLngBoundsToNewLayerBounds(this._drawn.bounds, e.zoom, e.center).min
      L.DomUtil.setTransform(this._canvas, offset, scale)
    },

    _place() {
      if (!this._drawn) return
      const map = this._map
      const scale = map.getZoomScale(map.getZoom(), this._drawn.zoom)
      L.DomUtil.setTransform(this._canvas, map.latLngToLayerPoint(this._drawn.bounds.getNorthWest()), scale)
    },

    clear() {
      this._drawn = null
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height)
    },

    draw(channels) {
      const map = this._map
      const size = map.getSize()
      this._resize(size.x, size.y)
      const width = this._canvas.width
      const height = this._canvas.height

      const zoom = map.getZoom()
      const topLeft = map.containerPointToLayerPoint([0, 0])
      const origin = map.getPixelOrigin().add(topLeft)
      const output = this._ctx.createImageData(width, height)

      channels.forEach((channel) => this._drawChannel(channel, zoom, origin, width, height, output.data))

      this._ctx.putImageData(output, 0, 0)
      L.DomUtil.setPosition(this._canvas, topLeft)
      this._drawn = { zoom, bounds: map.getBounds() }
      performance.mark('heat-drawn')
    },

    _resize(width, height) {
      if (this._cssWidth === width && this._cssHeight === height) return
      const res = this.options.resolution
      this._cssWidth = width
      this._cssHeight = height
      this._canvas.width = this._shadow.width = Math.ceil(width * res)
      this._canvas.height = this._shadow.height = Math.ceil(height * res)
      this._canvas.style.width = this._canvas.width / res + 'px'
      this._canvas.style.height = this._canvas.height / res + 'px'
      this._cols = Math.ceil((width + 2 * PAD) / CELL)
      this._rows = Math.ceil((height + 2 * PAD) / CELL)
      this._counts = new Float32Array(this._cols * this._rows)
      this._touched = new Int32Array(this._cols * this._rows)
    },

    _aggregate(coords, zoom, origin) {
      const counts = this._counts
      const touched = this._touched
      const cols = this._cols
      const rows = this._rows
      const scale = TILE * 2 ** zoom
      const d = Math.PI / 180
      const left = origin.x - PAD
      const top = origin.y - PAD
      let n = 0
      for (let i = 0; i < coords.length; i += 2) {
        const sin = Math.sin(coords[i] * d)
        const x = scale * (coords[i + 1] / 360 + 0.5) - left
        const y = scale * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) - top
        const cx = Math.floor(x / CELL)
        const cy = Math.floor(y / CELL)
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue
        const idx = cy * cols + cx
        if (counts[idx] === 0) touched[n++] = idx
        counts[idx]++
      }
      return n
    },

    _drawChannel(channel, zoom, origin, width, height, out) {
      const { coords, radius, max, maxOpacity, gradient, blur } = channel
      const ctx = this._shadowCtx
      ctx.clearRect(0, 0, width, height)
      if (!coords.length) return

      const n = this._aggregate(coords, zoom, origin)
      const res = this.options.resolution
      const r = Math.max(2, Math.round(radius * res))
      const tpl = this._stamp(r, blur)
      const counts = this._counts
      const touched = this._touched
      const cols = this._cols
      const keep = 1 - 1 / Math.max(1, max)
      const step = CELL * res
      const offset = (CELL / 2 - PAD) * res - r
      let minX = width
      let minY = height
      let maxX = 0
      let maxY = 0

      for (let i = 0; i < n; i++) {
        const idx = touched[i]
        const cx = idx % cols
        const x = cx * step + offset
        const y = (idx - cx) / cols * step + offset
        const alpha = 1 - keep ** counts[idx]
        counts[idx] = 0
        ctx.globalAlpha = alpha < 0.01 ? 0.01 : alpha
        ctx.drawImage(tpl, x, y)
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }

      const x0 = Math.max(0, Math.floor(minX))
      const y0 = Math.max(0, Math.floor(minY))
      const x1 = Math.min(width, Math.ceil(maxX) + r * 2)
      const y1 = Math.min(height, Math.ceil(maxY) + r * 2)
      if (x1 <= x0 || y1 <= y0) return
      this._composite(ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, x0, y0, x1 - x0, y1 - y0, width, out,
        this._palette(gradient), Math.round(maxOpacity * 255))
    },

    _composite(shadow, x0, y0, w, h, width, out, colors, cap) {
      for (let row = 0; row < h; row++) {
        let s = row * w * 4 + 3
        let o = ((y0 + row) * width + x0) * 4
        for (let col = 0; col < w; col++, s += 4, o += 4) {
          const a = shadow[s]
          if (a === 0) continue
          const p = a * 4
          const sa = a < cap ? a : cap
          const da = out[o + 3]
          if (da === 0) {
            out[o] = colors[p]
            out[o + 1] = colors[p + 1]
            out[o + 2] = colors[p + 2]
            out[o + 3] = sa
            continue
          }
          const keep = da * (255 - sa) / 255
          const total = sa + keep
          out[o] = (colors[p] * sa + out[o] * keep) / total
          out[o + 1] = (colors[p + 1] * sa + out[o + 1] * keep) / total
          out[o + 2] = (colors[p + 2] * sa + out[o + 2] * keep) / total
          out[o + 3] = total
        }
      }
    },

    _palette(gradient) {
      if (!this._palettes.has(gradient)) this._palettes.set(gradient, palette(gradient))
      return this._palettes.get(gradient)
    },

    _stamp(radius, blur) {
      const key = radius + ':' + blur
      if (!this._stamps.has(key)) this._stamps.set(key, stamp(radius, blur))
      return this._stamps.get(key)
    }
  })

  return HeatLayer
})
