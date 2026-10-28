define(['leaflet'], (L) => {

  const MinZoomIndicator = L.Control.extend({
    options: {
      position: 'topright',
      minZoom: 10,
      message: 'Zoom in to see the heatmap: CURRENTZOOM/MINZOOMLEVEL'
    },

    onAdd(map) {
      this._container = L.DomUtil.create('div', 'leaflet-control-minZoomIndicator')
      L.DomEvent.on(this._container, 'click', this._zoomIn, this)
      map.on('zoomend moveend', this._update, this)
      this._update()
      return this._container
    },

    onRemove(map) {
      map.off('zoomend moveend', this._update, this)
    },

    _zoomIn(event) {
      L.DomEvent.stop(event)
      this._map.setZoom(this.options.minZoom)
    },

    _update() {
      const zoom = this._map.getZoom()
      this._container.textContent = this.options.message
        .replace(/CURRENTZOOM/, zoom)
        .replace(/MINZOOMLEVEL/, this.options.minZoom)
      this._container.style.display = zoom >= this.options.minZoom ? 'none' : 'block'
    }
  })

  return MinZoomIndicator
})
