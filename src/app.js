/**
 * tmP: global café map with Open Street Map, leaflet and overpass API.
 */

requirejs.config(window.requireConfig)

requirejs([
  'underscore',
  'leaflet',
  'overpass',
  'heatmap',
  'leaflet-heatmap-plugin',
  'leaflet-search',
  'autolinker'
], (_, L, OverPassLayer, HeatMap, HeatmapOverlay, LeafletSearch, Autolinker) => {

  const POSITION_LS_KEY = 'pos'
  const AREA_CACHE_KEY = 'area-cache'
  const CACHE_KEY = 'poi-cache'

  let attr_osm = 'Map data &copy; <a href="http://openstreetmap.org/">OpenStreetMap</a> contributors';
  let attr_overpass = 'POI via <a href="http://www.overpass-api.de/">Overpass API</a>';

  let cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
  let cacheMap = {}; cache.map((c) => cacheMap[c.id] = c)

  const RADIUS = 0.001

  let openStreetMapLayer = new L.TileLayer(
    'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      'opacity': 1,
      'attribution': [attr_osm, attr_overpass].join(', ')
    }
  );

  let map = new L.Map('c-map')
    .addLayer(openStreetMapLayer)
    .setView(new L.LatLng(47.48942276367029, 19.05009221670925), 14);

  // Config at: https://www.patrick-wied.at/static/heatmapjs/plugin-leaflet-layer.html
  let heatmapConfig = {
    // radius should be small ONLY if scaleRadius is true (or small radius is intended)
    // if scaleRadius is false it will be the constant radius used in pixels
    radius: RADIUS, maxOpacity: .5,
    // scales the radius based on map zoom
    scaleRadius: true,
    // if set to false the heatmap uses the global maximum for colorization
    latField: 'lat', lngField: 'lon', valueField: 'count',

    minOpacity: 0, blur: .75
  }

  const interests = {
    cafe: {
      radius: 0.0006, maxOpacity: .8, blur: 0.6,
      gradient: { '.3': '#a9973d', '.5': 'brown', '.95': 'yellow' }
    },
    library: {
      radius: 0.0008, maxOpacity: .9, blur: 0.5,
      gradient: { '.5': 'blue', '.8': 'turquoise', '.95': 'white' }
    },
    university: {
      maxOpacity: .7, radius: 0.001,
      gradient: { '.5': 'red', '.8': 'pink', '.95': 'white' }
    },
    college: {
      maxOpacity: .7, radius: 0.001,
      gradient: { '.5': 'red', '.8': 'pink', '.95': 'white' }
    }
  }

  let layers = window.layers = {}

  // Init heatmap layers.
  Object.keys(interests).map((amenity) => {
    layers[amenity] = new HeatmapOverlay(_.extend({}, heatmapConfig, interests[amenity]));
    map.addLayer(layers[amenity])
  })

  let queries = Object.keys(interests).map((amenity) => `node({{bbox}})[amenity=${amenity}];`).join('')

  /**
   * This is the layer on which the data points will be shown.
   * It also manages cache
   */
  let overPassLayer = new L.OverPassLayer({
    query: `(${queries});out qt;`,
    minZoom: 13,
    minZoomIndicatorOptions: { minZoomMessage: 'Get closer to see the heatmap: CURRENTZOOM/MINZOOMLEVEL.' },

    // This way we give a chance to the cache to load.
    noInitialRequest: true,

    // We store a cache in the LS
    loadedBounds: JSON.parse(localStorage.getItem(AREA_CACHE_KEY) || '[]'),

    beforeRequest() { loading(true) },

    onError(error) {
      loading(false)
      showError(`[${error.status}] ${error.statusText} - ${error.responseText}`, error)
    },

    /**
     * Displays the loaded data, handles errors and keeps the cache up to date.
     * @param {Object} data
     */
    onSuccess: function (data) {
      data.elements.map((e) => e.count = 1)

      if (data.elements.length > 10000) {
        showError('too much data... ' + data.elements.length)
        return;
      }

      // Filter duplicate element from the cache.
      data.elements.map((obj) => {
        if (!cacheMap[obj.id]) {
          cacheMap[obj.id] = obj
          cache.push(obj)
        }
      })

      // The heatmap and the poi circles
      showData(data.elements)

      loading(false)

      // Save cache and area bounds!
      var loadedBounds = JSON.parse(localStorage.getItem(AREA_CACHE_KEY) || '[]')
      loadedBounds = loadedBounds.concat(this._loadedBounds)
      localStorage.setItem(AREA_CACHE_KEY, JSON.stringify(loadedBounds))
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache))

      return data
    },
  });


  // These functions are used from the UI.
  window.findMe = geoFindMe
  window.eraseCacheAndReload = function () {
    localStorage.removeItem(POSITION_LS_KEY)
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(AREA_CACHE_KEY)
    location.reload()
  }

  window.showInfo = function () { document.getElementById('modal').style.display = 'block' }
  window.hideModal = function () { document.getElementById('modal').style.display = 'none' }
  window.hideToast = function () { document.getElementById('toast').style.display = 'none' }

  init()
  /**
   * Inits the bindings and puts the maps together
   */
  function init() {
    // Bind move end to show the data and save position.
    map.on('moveend', (evt) => {
      if (evt.target.getZoom() < 11) { hideLayerData() } else { showData(cache) }

      var v = { lat: map.getCenter().lat, lng: map.getCenter().lng };

      // If we do not normalize the coords, heatmap and overpass layers will break.
      v = map.wrapLatLng(v);
      v.zoom = map.getZoom()

      localStorage.setItem(POSITION_LS_KEY, JSON.stringify(v));
      location.hash = `#${v.lat},${v.lng},${v.zoom}z`
      document.getElementById('hit-count').textContent = layers['cafe']._heatmap.getData().data.length
    })

    /**
     * Simple search button and box.
     */
    map.addControl(new LeafletSearch({
      url: 'https://nominatim.openstreetmap.org/search?format=json&q={s}',
      propertyName: 'display_name',
      propertyLoc: ['lat', 'lon'],
      marker: L.circleMarker([0, 0], { radius: 30 }),
      autoCollapse: true,
      autoType: true,
      minLength: 2
    }));

    map.addLayer(overPassLayer)

    // See if there is an URL to be found.
    if (location.hash && location.hash.split(',').length === 3) {
      let lat = parseFloat(location.hash.split(',')[0].substr(1))
      let lng = parseFloat(location.hash.split(',')[1])
      let zoom = parseInt(location.hash.split(',')[2])
      map.setView(L.latLng(lat, lng), zoom, true)

    } else {
      restore(map)
    }
  }


  ///////////////////////////////////////////////////////////////////////////////////////

  /**
   * Show loading in the head nav bar
   * @param {Boolean} isLoading
   */
  function loading(isLoading) {
    if (isLoading) {
      document.getElementById('head').classList.add('loading')
    } else {
      document.getElementById('head').classList.remove('loading')
    }
  }

  /**
   * Shows the loaded data on all the layers, updates hit count.
   * @param {Array} data
   */
  function showData(data) {
    Object.keys(interests).map((amenity) => {
      let amenityList = _.filter(data, (e) => e.tags.amenity === amenity)
      layers[amenity].setData({ data: amenityList, max: 2 })
    })

    document.getElementById('hit-count').textContent = layers['cafe']._heatmap.getData().data.length

    // Little clickable dots with popup.
    addMarkersToLayer.call(overPassLayer, data)
  }

  /**
   * Restores the map from the LS.
   * @param {Leaflet} map
   */
  function restore(map) {
    try {
      let view = JSON.parse(localStorage.getItem(POSITION_LS_KEY) || '');
      map.setView(L.latLng(view.lat, view.lng), view.zoom, true);
    } catch (e) {
      // naah.
      geoFindMe()
    }
  }

  /**
   * Shows the little circles with the popups
   * @param {Array} data
   */
  function addMarkersToLayer(data, type) {
    for (let i = 0; i < data.length; i++) {
      let pos;
      let marker;
      const e = data[i];

      if (e.id in this._ids) {
        continue;
      }

      this._ids[e.id] = true;

      if (e.type === 'node') {
        pos = L.latLng(e.lat, e.lon);
      } else {
        pos = L.latLng(e.center.lat, e.center.lon);
      }

      if (this.options.markerIcon) {
        marker = L.marker(pos, { icon: this.options.markerIcon });
      } else {
        marker = L.circle(pos, 8, {
          stroke: false, fillOpacity: 0.9, fillColor: getColor(e.tags?e.tags.amenity:'')
        });
      }

      marker.bindPopup(L.popup().setContent(getPopup(e.tags)))

      this._markers.addLayer(marker)
    }
  }

  function getPopup(data) {
    let list = ''
    let name = data.name || data[Object.keys(data).find((key)=>key.indexOf('name') > -1)]
    Object.keys(data)
      .filter((n) => ['amenity', 'name'].indexOf(n) === -1)
      .map((key) => list += `<tr><td>${key}</td><td>${stringify(data[key])}</td></tr>`)
    return `<div><h3><i class="fa fa-fw fa-${getIcon(data)}"></i> <span>${name}</span></h3><table>${list}</table></div>`
  }

  function getIcon(data) {
    switch (data.amenity) {
      case 'cafe': return 'coffee'
      case 'library': return 'book-reader'
      case 'university':
      case 'college': return 'university'
    }
  }

  function getColor(amenity){
    switch (amenity) {
      case 'cafe': return '#46291566'
      case 'library': return '#0000ff77'
      case 'university':
      case 'college': return '#ff000077'
    }
  }

  function stringify(str) {
    if (_.isArray(str)) { return str.join(', ') }
    return Autolinker.link(str, { stripPrefix: true })
  }

  function showError(errorText, error) {
    console.error(errorText);
    console.error(error);
    document.getElementById('toast').style.display = 'block'
    document.getElementById('error').textContent = stripHtml(errorText || error)
  }

  function hideLayerData() {
    Object.keys(interests).map((amenity) => {
      layers[amenity].setData({ data: [], max: 2 })
    })
  }

  function geoFindMe() {
    function success(position) {
      const lat = position.coords.latitude
      const lng = position.coords.longitude
      loading(false)
      map.setView(L.latLng(lat, lng), 13, true)
    }

    function error() {
      showError('Unable to retrieve your location')
    }

    if (!navigator.geolocation) {
      showError('Geolocation is not supported by your browser')
    } else {
      loading(true)
      navigator.geolocation.getCurrentPosition(success, error);
    }
  }

  function stripHtml(html) {
    let tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }
})

