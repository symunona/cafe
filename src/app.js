requirejs.config(window.requireConfig)

requirejs([
  'leaflet',
  'heat-layer',
  'leaflet-search',
  'min-zoom-indicator',
  'tile-data'
], (L, HeatLayer, LeafletSearch, MinZoomIndicator, TileData) => {

  const POSITION_LS_KEY = 'pos'
  const MIN_ZOOM = 10
  const DOT_ZOOM = 16
  const MAX_DOTS = 3000
  const RENDER_DELAY = 120
  const DEFAULT_VIEW = { lat: 47.4975, lng: 19.0532, zoom: 14 }

  const ATTRIBUTION = [
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    'POI data <a href="https://opendatacommons.org/licenses/odbl/">ODbL</a> via <a href="https://qlever.dev">QLever</a>'
  ].join(', ')

  const interests = {
    c: {
      label: 'Café', icon: 'coffee', dot: '#7a4a24',
      radius: 0.0011, minRadius: 13, maxRadius: 45, maxOpacity: 0.85, blur: 0.9, max: 2.5,
      gradient: { 0: '#d8a46b', 0.35: '#e0913f', 0.6: '#ef7d1a', 0.8: '#f9b52c', 1: '#fff2b3' }
    },
    l: {
      label: 'Library', icon: 'book-reader', dot: '#2463b8',
      radius: 0.0011, minRadius: 12, maxRadius: 45, maxOpacity: 0.6, blur: 0.9, max: 2,
      gradient: { 0: '#7fa8e0', 0.45: '#3b7ddd', 0.8: '#4fc3e8', 1: '#e3fbff' }
    },
    u: {
      label: 'University', icon: 'university', dot: '#c0392b',
      radius: 0.0012, minRadius: 13, maxRadius: 50, maxOpacity: 0.55, blur: 0.9, max: 2,
      gradient: { 0: '#ec9a9a', 0.45: '#e74c3c', 0.8: '#ff7f7f', 1: '#ffe3e3' }
    }
  }

  const map = new L.Map('c-map', {
    maxBounds: L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180)),
    maxBoundsViscosity: 1,
    minZoom: 3,
    worldCopyJump: false,
    preferCanvas: true
  })

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: ATTRIBUTION
  }).addTo(map)

  const heat = new HeatLayer({ resolution: 0.5 }).addTo(map)

  const dotRenderer = L.canvas({ padding: 0.2 })
  const dots = L.featureGroup().addTo(map)
  const dotIndex = new Map()
  const popup = L.popup()
  dots.on('click', (e) => {
    const { opts, lat, lon } = e.layer.poi
    popup.setLatLng([lat, lon]).setContent(popupFor(opts, lat, lon)).openOn(map)
  })

  const data = new TileData('data')
  let renderToken = 0
  let renderTimer = null

  window.showInfo = () => { document.getElementById('modal').classList.add('shown') }
  window.hideModal = () => { document.getElementById('modal').classList.remove('shown') }
  window.hideToast = () => { document.getElementById('toast').style.display = 'none' }
  window.findMe = geoFindMe

  init()

  async function init() {
    map.addControl(new LeafletSearch({
      url: 'https://nominatim.openstreetmap.org/search?format=json&q={s}',
      propertyName: 'display_name',
      propertyLoc: ['lat', 'lon'],
      marker: false,
      autoCollapse: true,
      autoType: true,
      minLength: 2,
      zoom: 14
    }))
    map.addControl(new MinZoomIndicator({ minZoom: MIN_ZOOM }))

    map.on('moveend', () => {
      savePosition()
      scheduleRender()
    })
    map.on('movestart zoomstart', () => {
      renderToken++
      clearTimeout(renderTimer)
    })

    restoreView()

    loading(true)
    try {
      const meta = await data.init()
      showMeta(meta)
      render()
    } catch (e) {
      loading(false)
      showError(`Could not load map data: ${e.message}`, e)
    }
  }

  function scheduleRender() {
    clearTimeout(renderTimer)
    const token = ++renderToken
    renderTimer = setTimeout(() => render(token), RENDER_DELAY)
  }

  async function render(token = ++renderToken) {
    if (!data.meta) return
    const zoom = map.getZoom()

    if (zoom < MIN_ZOOM) {
      clearLayers()
      setHitCount('')
      loading(false)
      return
    }

    const view = map.getBounds()
    const padded = view.pad(0.25)
    const keys = data.keysFor(padded)

    if (!data.isLoaded(keys)) {
      loading(true)
      try {
        await data.load(keys)
      } catch (e) {
        showError(e.message, e)
      }
      if (token !== renderToken) return
    }
    loading(false)

    await nextFrame()
    if (token !== renderToken) return

    const types = Object.keys(interests)
    const points = data.pointsIn(view.pad(0.1), types)

    heat.draw(types.map((type) => heatChannel(type, points[type], zoom)))
    drawDots(points, zoom)
    setHitCount(countIn(points.c, view))
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve))
  }

  function heatChannel(type, coords, zoom) {
    const opts = interests[type]
    return {
      coords,
      radius: Math.round(Math.min(opts.maxRadius, Math.max(opts.minRadius, opts.radius * 2 ** zoom))),
      max: opts.max * Math.max(1, 2 ** ((14 - zoom) * 0.45)),
      maxOpacity: type === 'c' ? opts.maxOpacity : opts.maxOpacity * Math.min(1, Math.max(0.45, (zoom - 9) / 5)),
      gradient: opts.gradient,
      blur: opts.blur
    }
  }

  function drawDots(points, zoom) {
    if (zoom < DOT_ZOOM) {
      dots.clearLayers()
      dotIndex.clear()
      return
    }
    const wanted = new Set()
    Object.keys(points).forEach((type) => {
      const coords = points[type]
      for (let i = 0; i < coords.length && wanted.size < MAX_DOTS; i += 2) {
        wanted.add(`${type}:${coords[i]}:${coords[i + 1]}`)
      }
    })
    dotIndex.forEach((marker, key) => {
      if (wanted.has(key)) return
      dots.removeLayer(marker)
      dotIndex.delete(key)
    })
    wanted.forEach((key) => {
      if (dotIndex.has(key)) return
      const [type, lat, lon] = key.split(':')
      const opts = interests[type]
      const marker = L.circleMarker([+lat, +lon], {
        renderer: dotRenderer,
        radius: 4,
        stroke: true,
        color: '#fff',
        weight: 1.5,
        fillColor: opts.dot,
        fillOpacity: 0.95
      })
      marker.poi = { opts, lat: +lat, lon: +lon }
      dotIndex.set(key, marker)
      dots.addLayer(marker)
    })
  }

  function popupFor(opts, lat, lon) {
    const osm = `https://www.openstreetmap.org/query?lat=${lat}&lon=${lon}#map=19/${lat}/${lon}`
    return `<div class="poi"><h3><i class="fa fa-fw fa-${opts.icon}"></i> ${opts.label}</h3>` +
      `<a href="${osm}" target="_blank" rel="noopener">What is here? (OpenStreetMap)</a></div>`
  }

  function clearLayers() {
    heat.clear()
    dots.clearLayers()
    dotIndex.clear()
  }

  function countIn(coords, bounds) {
    let count = 0
    const south = bounds.getSouth()
    const north = bounds.getNorth()
    const west = bounds.getWest()
    const east = bounds.getEast()
    for (let i = 0; i < coords.length; i += 2) {
      if (coords[i] >= south && coords[i] <= north && coords[i + 1] >= west && coords[i + 1] <= east) count++
    }
    return count
  }

  function setHitCount(value) {
    document.getElementById('hit-count').textContent = value
  }

  function showMeta(meta) {
    const format = (n) => n.toLocaleString('en-US')
    document.getElementById('snapshot-date').textContent = meta.snapshot || 'unknown'
    document.getElementById('count-cafe').textContent = format(meta.counts.cafe)
    document.getElementById('count-library').textContent = format(meta.counts.library)
    document.getElementById('count-university').textContent = format(meta.counts.university + meta.counts.college)
  }

  function savePosition() {
    const center = map.wrapLatLng(map.getCenter())
    const view = { lat: +center.lat.toFixed(5), lng: +center.lng.toFixed(5), zoom: map.getZoom() }
    try {
      localStorage.setItem(POSITION_LS_KEY, JSON.stringify(view))
    } catch (e) {
      return
    } finally {
      history.replaceState(null, '', `#${view.lat},${view.lng},${view.zoom}z`)
    }
  }

  function restoreView() {
    const parts = location.hash.substr(1).split(',').map(parseFloat)
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      map.setView([parts[0], parts[1]], Math.round(parts[2]))
      return
    }
    const view = storedView() || DEFAULT_VIEW
    map.setView([view.lat, view.lng], view.zoom)
  }

  function storedView() {
    try {
      const view = JSON.parse(localStorage.getItem(POSITION_LS_KEY))
      return view && Number.isFinite(view.lat) && Number.isFinite(view.zoom) ? view : null
    } catch (e) {
      return null
    }
  }

  function loading(isLoading) {
    document.getElementById('head').classList.toggle('loading', isLoading)
  }

  function showError(errorText, error) {
    console.error(errorText, error)
    document.getElementById('toast').style.display = 'block'
    document.getElementById('error').textContent = errorText
  }

  function geoFindMe() {
    if (!navigator.geolocation) {
      showError('Geolocation is not supported by your browser')
      return
    }
    loading(true)
    navigator.geolocation.getCurrentPosition((position) => {
      loading(false)
      map.setView([position.coords.latitude, position.coords.longitude], 14)
    }, () => {
      loading(false)
      showError('Unable to retrieve your location')
    })
  }
})
