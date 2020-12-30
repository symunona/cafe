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
      'opacity': 1,
      'attribution': [attr_osm, attr_overpass].join(', ')
    }
  );

  let map = new L.Map('c-map')
    .addLayer(osm)
    .setView(new L.LatLng(47.48942276367029, 19.05009221670925), 14);

  map.on('moveend', (evt) => {
    if (evt.target.getZoom() < 11) {
      hideLayerData()
    } else {
      showData(cache)
    }

    var v = {
      lat: map.getCenter().lat,
      lng: map.getCenter().lng,
      zoom: map.getZoom()
    };
    localStorage.setItem(POSITION_LS_KEY, JSON.stringify(v));

    location.hash = `#${v.lat},${v.lng},${v.zoom}z`
  })

  function hideLayerData() {
    Object.keys(interests).map((amenity) => {
      layers[amenity].setData({ data: [], max: 2 })
    })
  }



  let cache = []

  let cfgGeneric = {
    // radius should be small ONLY if scaleRadius is true (or small radius is intended)
    // if scaleRadius is false it will be the constant radius used in pixels
    radius: RADIUS,
    maxOpacity: .5,
    // scales the radius based on map zoom
    scaleRadius: true,
    // if set to false the heatmap uses the global maximum for colorization
    // if activated: uses the data maximum within the current map boundaries
    //   (there will always be a red spot with useLocalExtremas true)
    // "useLocalExtrema": true,
    // which field name in your data represents the latitude - default "lat"
    latField: 'lat',
    // which field name in your data represents the longitude - default "lng"
    lngField: 'lon',
    // which field name in your data represents the data value - default "value"
    valueField: 'count',

    minOpacity: 0,
    blur: .75
  }

  const interests = {
    cafe: {
      radius: 0.0006,
      maxOpacity: .8,
      blur: 0.6,
      gradient: {
        '.3': '#a9973d',
        '.5': 'brown',
        '.95': 'yellow'
      }
    },
    library: {
      radius: 0.0008,
      maxOpacity: .9,
      blur: 0.5,
      gradient: {
        '.5': 'blue',
        '.8': 'turquoise',
        '.95': 'white'
      }
    },
    university: {
      maxOpacity: .7,
      radius: 0.001,
      gradient: {
        '.5': 'red',
        '.8': 'pink',
        '.95': 'white'
      }
    },
  }

  let layers = {}

  // Init heatmap layers.
  Object.keys(interests).map((amenity) => {
    layers[amenity] = new HeatmapOverlay(_.extend({}, cfgGeneric, interests[amenity]));
    map.addLayer(layers[amenity])
  })

  let cacheMap = {}

  let queries = Object.keys(interests).map((amenity) => `node({{bbox}})[amenity=${amenity}];`).join('')

  let opl = new L.OverPassLayer({
    query: `(${queries});out qt;`,
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

      showData(data.elements)

      return data
    },
  });

  function showData(data) {
    Object.keys(interests).map((amenity) => {
      let amenityList = _.filter(data, (e) => e.tags.amenity === amenity)
      // console.log('found', amenity, amenityList.length)
      layers[amenity].setData({ data: amenityList, max: 2 })
    })
  }

  // var searchLayer = L.layerGroup().addTo(map);
  // map.addControl( new L.Control.Search({layer: searchLayer}) );
  map.addControl(new LeafletSearch({
    url: 'https://nominatim.openstreetmap.org/search?format=json&q={s}',
    // jsonpParam: 'json_callback',
    propertyName: 'display_name',
    propertyLoc: ['lat', 'lon'],
    marker: L.circleMarker([0, 0], { radius: 30 }),
    autoCollapse: true,
    autoType: true,
    minLength: 2
  }));

  map.addLayer(opl)

  if (location.hash && location.hash.split(',').length === 3){
    let lat = parseFloat(location.hash.split(',')[0].substr(1))
    let lng = parseFloat(location.hash.split(',')[1])
    let zoom = parseInt(location.hash.split(',')[2])
    map.setView(L.latLng(lat, lng), zoom, true);
  }else{
    restore(map)
  }


  function restore(map) {
    try {
      let view = JSON.parse(localStorage.getItem(POSITION_LS_KEY) || '');
      map.setView(L.latLng(view.lat, view.lng), view.zoom, true);
    } catch (e) {
      // naah.
      geoFindMe()
    }
  }

  window.toggleInfo = function () {
    toggle(document.getElementById(status))
  }

  function toggle(elem){
    elem.style.display = window.getComputedStyle(elem).display === 'block'?'none':'block'
  }

  window.findMe = geoFindMe

  function geoFindMe() {

    function success(position) {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      map.setView(L.latLng(lat, lng), 13, true);
    }

    function error() {
      console.error('Unable to retrieve your location');
    }

    if (!navigator.geolocation) {
      // status.textContent = 'Geolocation is not supported by your browser';
    } else {
      // status.textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition(success, error);
    }
  }


})

