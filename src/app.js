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
  'leaflet-search'
], (_, L, OverPassLayer, HeatMap, HeatmapOverlay, LeafletSearch) => {

  const POSITION_LS_KEY = 'pos'

  let attr_osm = 'Map data &copy; <a href="http://openstreetmap.org/">OpenStreetMap</a> contributors';
  let attr_overpass = 'POI via <a href="http://www.overpass-api.de/">Overpass API</a>';

  const RADIUS = 0.001

  let osm = new L.TileLayer(
    'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      'opacity': 0.7,
      'attribution': [attr_osm, attr_overpass].join(', ')
    }
  );

  let map = new L.Map('c-map')
    .addLayer(osm)
    .setView(new L.LatLng(47.48942276367029, 19.05009221670925), 14);

  let cache = []

  let cfg = {
    // radius should be small ONLY if scaleRadius is true (or small radius is intended)
    // if scaleRadius is false it will be the constant radius used in pixels
    "radius": RADIUS,
    "maxOpacity": .5,
    // scales the radius based on map zoom
    "scaleRadius": true,
    // if set to false the heatmap uses the global maximum for colorization
    // if activated: uses the data maximum within the current map boundaries
    //   (there will always be a red spot with useLocalExtremas true)
    // "useLocalExtrema": true,
    // which field name in your data represents the latitude - default "lat"
    latField: 'lat',
    // which field name in your data represents the longitude - default "lng"
    lngField: 'lon',
    // which field name in your data represents the data value - default "value"
    valueField: 'count'
  };


  let heatmapLayer = new HeatmapOverlay(cfg);

  // const types = [
  //   {value: '[amenity=cafe]', text: 'Café' },
  //   {value: '[amenity=library]', text: 'Library' },
  //   {value: '[amenity=college]', text: 'College' }
  // ]

  let searchFor = '[amenity=cafe]'

  let cacheMap = {}

  let opl = new L.OverPassLayer({
    // 'query': '(node({{bbox}})[amenity=cafe];node({{bbox}})[amenity=library];);out qt;',
    query: `(node({{bbox}})${searchFor};);out qt;`,
    // minZoomIndicatorEnabled: false,
    minZoom: 13,
    minZoomIndicatorOptions: { minZoomMessage: 'Get closer to see the heatmap: CURRENTZOOM/MINZOOMLEVEL.' },
    onSuccess: function (data) {
      data.elements.map((e) => e.count = 1)
      // console.log('yeah', data.elements)
      document.getElementById('hit-count').textContent = `(${data.elements.length})`
      if (data.elements.length > 10000) {
        console.error('too much data...', data.elements.length)
        return;
      }

      // Do not show an element twice.
      data.elements.map((obj) => {
        if (!cacheMap[obj.id]) {
          cacheMap[obj.id] = obj
          cache.push(obj)
        }
      })
      heatmapLayer.setData({ data: cache, max: 2 });
      return data
    },
  });

  var searchLayer = L.layerGroup().addTo(map);
  map.addControl( new L.Control.Search({layer: searchLayer}) );

  map.addLayer(opl)

  map.addLayer(heatmapLayer)

  restore(map)

  map.on('moveend', (evt) => {
    if (evt.target.getZoom() < 11) {
      heatmapLayer.setData({ data: [], max: 2 });
    } else {
      heatmapLayer.setData({ data: cache, max: 2 });
    }

    var view = {
      lat: map.getCenter().lat,
      lng: map.getCenter().lng,
      zoom: map.getZoom()
    };
    localStorage.setItem(POSITION_LS_KEY, JSON.stringify(view));
  })

  function restore(map) {
    try {
      let view = JSON.parse(localStorage.getItem(POSITION_LS_KEY) || '');
      map.setView(L.latLng(view.lat, view.lng), view.zoom, true);
    } catch (e) {
      // naah.
      geoFindMe()
    }
  }

  window.findMe = geoFindMe

  function geoFindMe() {

    function success(position) {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      console.warn(position)

      map.setView(L.latLng(lat, lng), 13, true);
    }

    function error() {
      status.textContent = 'Unable to retrieve your location';
    }

    if (!navigator.geolocation) {
      status.textContent = 'Geolocation is not supported by your browser';
    } else {
      status.textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition(success, error);
    }

  }


})

