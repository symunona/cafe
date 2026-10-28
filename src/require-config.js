var requireConfig = {
    paths: {
      'underscore': '../node_modules/underscore/underscore',
      'leaflet': '../node_modules/leaflet/dist/leaflet-src',
      'tile-data': 'lib/tile-data',
      'min-zoom-indicator': 'lib/min-zoom-indicator',
      'heat-layer': 'lib/heat-layer',
      'leaflet-search': '../node_modules/leaflet-search/dist/leaflet-search.src'
    },
    shim: {
      'leaflet': { exports: 'L' }
    }
  }


// If we are in the window environment add it to the global scope.
if (typeof window === 'object') {
    window.requireConfig = requireConfig;
}

// If we use it from node (i.e. grunt) export the config.
if (typeof module === 'object') {
    module.exports = requireConfig; // eslint-disable-line
}
