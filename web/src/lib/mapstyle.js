// mapstyle.js — the MapLibre style for the Nirapod basemap.
//
// Everything here points at files this site serves. No sprite URL, no glyph
// CDN, no tile server: two PMTiles archives read by range request from the
// same origin. That is deliberate — a font or sprite request to a third party
// would hand that third party the visitor list for a site about who is being
// extorted in which mohalla.
//
// LABELS ARE IN THE TILES, AND THEY ARE IN ENGLISH. Both halves of that are
// deliberate:
//
//   * In the tiles, because the alternative — HTML labels positioned over the
//     canvas — updates one frame behind the map. On a pan the text visibly
//     slides against the streets underneath it, and new names appear only when
//     the map settles. Labels the engine draws are part of the same frame as
//     the roads, so there is nothing to lag.
//   * In English, because MapLibre renders one glyph per codepoint with no
//     complex-script shaping, and Bengali needs pre-base vowel reordering,
//     conjunct formation and reph. HTML was the only way to get correct Bangla
//     on the map, and it cost the smoothness above. OSM has name:en or an ASCII
//     name for 100% of places and 98% of named roads in this extract, so the
//     coverage cost is close to nothing.
//
// Bangla is not gone: the panel, the search box and the table all render it
// through the browser's own text shaper, where it is correct.
//
// Glyphs are still served from our own origin (`web/static/fonts/`), never a
// font CDN, because a font request would hand a third party the visitor list.

const C = {
  bg:        '#0f1113',
  water:     '#16232e',
  waterline: '#1d3040',
  park:      '#16241a',
  forest:    '#15221a',
  grass:     '#171f19',
  farmland:  '#15181a',
  built:     '#141719',
  school:    '#1a181f',
  hospital:  '#1f181a',
  military:  '#1b1a16',
  building:  '#242a31',
  road:      '#39424b',
  roadmajor: '#4a545f',
  roadminor: '#2b3238',
  label:     '#9aa4ad',
  halo:      '#0b0d0f',
  wardline:  '#0f1113',
  thanaline: '#5a646e',
  selected:  '#e2b714',
};

const LANDUSE_COLOR = [
  'match', ['get', 'kind'],
  'park', C.park, 'forest', C.forest, 'grass', C.grass,
  'farmland', C.farmland, 'cemetery', C.grass,
  'school', C.school, 'hospital', C.hospital, 'military', C.military,
  'industrial', C.built, 'commercial', C.built, 'residential', C.built,
  C.built,
];

/**
 * @param {object} o
 * @param {string} o.base      URL of the basemap PMTiles archive
 * @param {string} o.admin     URL of the ward/thana PMTiles archive
 * @param {string} [o.glyphs]  glyphs URL template
 * @param {boolean} [o.labels] draw place and road labels
 * @param {'bn'|'en'} [o.lang] which name to prefer on a label
 */
import { TILES } from './tiles-meta.js';

export function style({
  base, admin,
  glyphs = '/fonts/{fontstack}/{range}.pbf',
  labels = true,
  lang = 'bn',
}) {
  // `name_en` is set at tile-build time: OSM's name:en, or the name itself when
  // it is already ASCII. Features without one carry no label rather than a
  // mis-shaped one. `lang` no longer selects the map's label language; it is
  // kept in the signature because the panel and the rest of the UI still switch.
  const NAME = ['get', 'name_en'];
  const AREA_NAME = ['get', 'label_en'];
  const FONT = ['Nirapod Sans Regular'];
  const s = {
    version: 8,
    name: 'Nirapod',
    glyphs,
    sources: {
      // Plain {z}/{x}/{y}.pbf, not a PMTiles archive. PMTiles reads one file
      // over HTTP range requests and no Cloudflare static host honours those:
      // a ranged GET comes back 200 with the whole archive and MapLibre paints
      // nothing. The archives are still the source of truth in web/static; the
      // build unpacks them. See scripts/explode-pmtiles.js.
      //
      // maxzoom is the deepest zoom that EXISTS, not the deepest the map goes.
      // Vector tiles overzoom, so z14 tiles keep drawing sharply at z16.
      base:  { type: 'vector', tiles: [base], attribution:
               '© OpenStreetMap contributors',
               minzoom: TILES.base.minzoom, maxzoom: TILES.base.maxzoom },
      admin: { type: 'vector', tiles: [admin], promoteId: 'id',
               attribution: 'Boundaries: geoBoundaries (CC-BY 4.0)',
               minzoom: TILES.admin.minzoom, maxzoom: TILES.admin.maxzoom },
      hazards: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      // The pin the reporter drops when saying where a hazard is. One point,
      // its own source, so nothing about the reporting flow can be confused
      // with published data.
      pin: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },

      { id: 'landuse', type: 'fill', source: 'base', 'source-layer': 'landuse',
        paint: { 'fill-color': LANDUSE_COLOR, 'fill-opacity': 0.85 } },

      { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water',
        paint: { 'fill-color': C.water } },

      { id: 'waterway', type: 'line', source: 'base', 'source-layer': 'waterway',
        paint: {
          'line-color': C.waterline,
          'line-width': ['interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'kind'], 'river', 1.2, 0.4],
            14, ['match', ['get', 'kind'], 'river', 4, 1.2]],
        } },

      { id: 'buildings', type: 'fill', source: 'base', 'source-layer': 'buildings',
        minzoom: 14, paint: { 'fill-color': C.building, 'fill-opacity': 0.9 } },

      // Roads: one layer per weight class so the visual hierarchy holds at
      // every zoom instead of every street looking the same width.
      { id: 'roads-minor', type: 'line', source: 'base', 'source-layer': 'roads',
        minzoom: 13, filter: ['in', ['get', 'kind'], ['literal', ['minor_road', 'path']]],
        paint: { 'line-color': C.roadminor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 5] } },

      { id: 'roads-medium', type: 'line', source: 'base', 'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'medium_road'],
        paint: { 'line-color': C.road,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 17, 8] } },

      { id: 'roads-major', type: 'line', source: 'base', 'source-layer': 'roads',
        filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'highway']]],
        paint: { 'line-color': C.roadmajor,
          'line-width': ['interpolate', ['linear'], ['zoom'],
            8, ['match', ['get', 'kind'], 'highway', 1.2, 0.6],
            17, ['match', ['get', 'kind'], 'highway', 14, 10]] } },

      // Choropleth. Colour is pushed per feature with setFeatureState, so
      // changing category, period or language never refetches a tile.
      // One pair of layers per geography level; `level` hides the other pair,
      // because a category published at thana level must never be drawable at
      // ward level by toggling a control.
      { id: 'ward-fill', type: 'fill', source: 'admin', 'source-layer': 'wards',
        paint: {
          'fill-color': ['coalesce', ['feature-state', 'color'], 'rgba(0,0,0,0)'],
          // `zoom` has to be the top-level input to interpolate, so the hover
          // case lives inside each stop rather than wrapping the whole thing.
          'fill-opacity': ['interpolate', ['linear'], ['zoom'],
            10, ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.66],
            15, ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.34]],
        } },

      // Below-threshold areas carry a texture, not a colour: "we are not
      // publishing this" is not a magnitude and must not read as one. The
      // pattern image is generated at runtime (see BaseMap.svelte) so no
      // sprite sheet has to be fetched.
      { id: 'ward-suppressed', type: 'fill', source: 'admin', 'source-layer': 'wards',
        paint: {
          'fill-pattern': 'hatch',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'suppressed'], false], 0.75, 0],
        } },

      { id: 'ward-line', type: 'line', source: 'admin', 'source-layer': 'wards',
        minzoom: 10,
        paint: { 'line-color': C.wardline, 'line-width': 0.6 } },

      // Thanas are large, so the same opacity that reads as a tint over a ward
      // blankets the city and hides the streets underneath. Lighter by default,
      // and it still lifts on hover so the area under the cursor is unambiguous.
      { id: 'thana-fill', type: 'fill', source: 'admin', 'source-layer': 'thanas',
        paint: {
          'fill-color': ['coalesce', ['feature-state', 'color'], 'rgba(0,0,0,0)'],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'],
            9,  ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.55],
            14, ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.30]],
        } },

      { id: 'thana-suppressed', type: 'fill', source: 'admin', 'source-layer': 'thanas',
        paint: {
          'fill-pattern': 'hatch',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'suppressed'], false], 0.75, 0],
        } },

      { id: 'thana-line', type: 'line', source: 'admin', 'source-layer': 'thanas',
        paint: { 'line-color': C.thanaline, 'line-width': 0.9, 'line-opacity': 0.55 } },

      { id: 'ward-selected', type: 'line', source: 'admin', 'source-layer': 'wards',
        paint: { 'line-color': C.selected,
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, 0] } },

      { id: 'thana-selected', type: 'line', source: 'admin', 'source-layer': 'thanas',
        paint: { 'line-color': C.selected,
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, 0] } },

      // The dropped pin, above everything: a ring plus a dot, so it reads as a
      // marker rather than as another hazard already on the map.
      { id: 'pin-ring', type: 'circle', source: 'pin',
        paint: { 'circle-radius': 13, 'circle-color': 'rgba(226,183,20,.18)',
                 'circle-stroke-color': C.selected, 'circle-stroke-width': 1.5 } },
      { id: 'pin-dot', type: 'circle', source: 'pin',
        paint: { 'circle-radius': 5, 'circle-color': C.selected,
                 'circle-stroke-color': '#17130a', 'circle-stroke-width': 1.5 } },

      // Hazards: exact points, from a GeoJSON source the page keeps updated.
      // Shape carries the state as well as colour — a hollow ring for fixed —
      // so it survives colourblindness and greyscale, same rule as the SVG.
      { id: 'hazard-halo', type: 'circle', source: 'hazards',
        filter: ['==', ['get', 'state'], 'fixed'],
        paint: { 'circle-radius': 4, 'circle-color': 'rgba(0,0,0,0)',
                 'circle-stroke-color': '#6b7280', 'circle-stroke-width': 1.6 } },

      { id: 'hazard-dot', type: 'circle', source: 'hazards',
        filter: ['!=', ['get', 'state'], 'fixed'],
        paint: {
          'circle-radius': ['match', ['get', 'state'], 'overdue', 6, 5],
          'circle-color': ['match', ['get', 'state'], 'overdue', '#d03b3b', '#fab219'],
          'circle-stroke-color': '#0f1113', 'circle-stroke-width': 1,
        } },
    ],
  };

  if (glyphs && labels) {
    s.layers.push(
      // Road names along the line, the way a street map reads. Only from z14:
      // above that they are noise, and every label costs a glyph fetch.
      { id: 'road-labels', type: 'symbol', source: 'base', 'source-layer': 'roads',
        minzoom: 14,
        filter: ['all', ['has', 'name_en'], ['!=', ['get', 'kind'], 'path']],
        layout: {
          'text-field': NAME,
          'text-font': FONT,
          'symbol-placement': 'line',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 13],
          'text-max-angle': 35,
          'symbol-spacing': 260,
          'text-padding': 2,
        },
        paint: { 'text-color': '#aeb7c0', 'text-halo-color': C.halo,
                 'text-halo-width': 1.5 } },

      // Water names, so the rivers and lakes are identifiable.
      { id: 'water-labels', type: 'symbol', source: 'base', 'source-layer': 'water',
        minzoom: 11, filter: ['has', 'name_en'],
        layout: {
          'text-field': NAME, 'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
          'text-max-width': 8,
        },
        paint: { 'text-color': '#6f8ba3', 'text-halo-color': C.halo,
                 'text-halo-width': 1.2 } },

      // Neighbourhood and area names, sized and sorted by kind so a city name
      // never competes with a mohalla and the bigger place wins a collision.
      { id: 'place-labels', type: 'symbol', source: 'base', 'source-layer': 'places',
        filter: ['has', 'name_en'],
        layout: {
          'text-field': NAME,
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'],
            9,  ['match', ['get', 'kind'], 'city', 15, 'town', 12, 10],
            15, ['match', ['get', 'kind'], 'city', 24, 'town', 19, 15]],
          'text-max-width': 7,
          'text-padding': 6,
          'symbol-sort-key': ['match', ['get', 'kind'],
            'city', 1, 'town', 2, 'suburb', 3, 'quarter', 4, 'village', 5, 6],
        },
        paint: { 'text-color': '#d7dee5', 'text-halo-color': C.halo,
                 'text-halo-width': 1.8 } },

      // Ward and thana names, in the site accent so they read as this site's
      // layer rather than as part of the borrowed basemap. `label_en` is the
      // short form: "Ward 43", not "Adabor, Ward No-43".
      // Drawn from a POINT layer, not the polygon: a polygon spanning several
      // tiles is labelled once per tile, which put two "Ward 98 (Cantonment)"
      // a few hundred metres apart. A point lands in one tile only.
      { id: 'thana-labels', type: 'symbol', source: 'admin', 'source-layer': 'thana_points',
        filter: ['has', 'label_en'],
        layout: {
          'text-field': AREA_NAME, 'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 14, 16],
          'text-max-width': 8, 'text-padding': 4,
        },
        paint: { 'text-color': '#e8d9a8', 'text-halo-color': C.halo,
                 'text-halo-width': 1.8 } },

      { id: 'ward-labels', type: 'symbol', source: 'admin', 'source-layer': 'ward_points',
        minzoom: 12, filter: ['has', 'label_en'],
        layout: {
          'text-field': AREA_NAME, 'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 14],
          'text-max-width': 8, 'text-padding': 4,
        },
        paint: { 'text-color': '#e8d9a8', 'text-halo-color': C.halo,
                 'text-halo-width': 1.6 } },
    );
  }

  return s;
}

export const MAP_COLORS = C;
