var requireConfig = {
    paths: {
      'underscore': '../node_modules/underscore/underscore',
      'leaflet': '../node_modules/leaflet/dist/leaflet-src',
      'heatmap': '../node_modules/heatmap.js/build/heatmap',
      'tile-data': 'lib/tile-data',
      'min-zoom-indicator': 'lib/min-zoom-indicator',
      'leaflet-heatmap-plugin': 'lib/leaflet-heatmap',
      'leaflet-search': '../node_modules/leaflet-search/dist/leaflet-search.src'
    },
    shim: {
      'leaflet': { exports: 'L' },
      'heatmap': { deps: ['leaflet'], exports: 'HeatmapOverlay' }
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
