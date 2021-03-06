/**
 * Super simple building and bundling.
 * @param {*} grunt
 */

const requireConfig = require('./src/require-config.js')
const _ = require('underscore')

module.exports = function (grunt) {
    grunt.loadNpmTasks('grunt-processhtml')
    grunt.loadNpmTasks('grunt-contrib-uglify-es')
    grunt.loadNpmTasks('grunt-contrib-requirejs')
    grunt.loadNpmTasks('grunt-contrib-cssmin')

    grunt.registerTask('default', ['requirejs', 'uglify', 'cssmin', 'processhtml'])

    grunt.initConfig({
        rootDir: __dirname,

        requirejs: {
            app: {
                options: _.extend(requireConfig, {
                    baseUrl: 'src/',
                    generateSourceMaps: true,
                    // namespace: 'CoffeeMap',
                    preserveLicenseComments: false,
                    out: 'js/bundle.js',
                    name: 'app',
                    include: ['../node_modules/requirejs/require'],

                    // The optimization is done by the uglify module, because the requirejs module has a hardcoded, and
                    //  hardly configurable uglify component.
                    optimize: 'none'
                })
            }
        },

        uglify: {
            app: {
                options: {
                    banner: '/* Cafe Map */\n',
                    sourceMapIn: 'js/bundle.js.map',
                    includeSources: false,
                    sourceMap: true,
                    output: {ascii_only: true}
                },
                files: {
                    'js/bundle.min.js': ['js/bundle.js']
                }
            }
        },

        processhtml: {
            app: {
                files: {
                    'index.html': 'index_dev.html'
                }
            }
        },

        cssmin: {
            vendor: {
                options: {
                    // This property replaces the "url('imagepath')"
                    // styled attributes to the correct relative paths.
                    rebase: true
                },
                files: {'css/bundle.min.css': [
                    'css/normalize.css',
                    'css/style.css',
                    'node_modules/leaflet/dist/leaflet.css',
                    'node_modules/leaflet-overpass-layer/dist/OverPassLayer.css',
                    'node_modules/leaflet-search/dist/leaflet-search.src.css'
                ]}
            }
        }
    })
}