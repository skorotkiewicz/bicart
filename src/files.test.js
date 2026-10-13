import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLayer } from './art.js'
import { createSVG, exportProject, importProject, MAX_PROJECT_BYTES } from './files.js'

const art = {
  title: 'Night & rain', width: 640, height: 320, total: 10,
  layers: [
    parseLayer(JSON.stringify({ name: 'Sky', shapes: [{ type: 'rect', x: 0, y: 0, width: 1000, height: 1000, color: '#123' }] })),
    parseLayer(JSON.stringify({ name: 'Details', shapes: [
      { type: 'ellipse', x: 200, y: 300, rx: 50, ry: 100, color: '#fff', opacity: 0.5 },
      { type: 'polygon', points: [[0, 0], [100, 100], [0, 100]], color: '#456' },
      { type: 'line', x1: 100, y1: 200, x2: 500, y2: 600, width: 4, color: '#789' },
    ] })),
  ],
}

function project(overrides = {}) {
  return JSON.stringify({ version: 1, ...art, hiddenLayers: [1], ...overrides })
}

test('JSON round trips all layers, dimensions, partial progress and visibility', () => {
  const serialized = exportProject(art, [1])
  assert.equal(JSON.parse(serialized).version, 1)
  assert.deepEqual(importProject(serialized), { art, hiddenLayers: [1] })
  assert.deepEqual(importProject(exportProject(art)), { art, hiddenLayers: [] })
})

test('omitted visibility defaults to showing all layers', () => {
  assert.deepEqual(importProject(JSON.stringify({ version: 1, ...art })).hiddenLayers, [])
})

test('rejects malformed JSON, unsupported versions and oversized UTF-8 files', () => {
  assert.throws(() => importProject('broken JSON'), /not valid JSON/)
  for (const text of ['null', '{}', project({ version: 2 }), project({ version: '1' })]) {
    assert.throws(() => importProject(text), /version 1 project/)
  }
  assert.throws(() => importProject('x'.repeat(MAX_PROJECT_BYTES + 1)), /4 MB/)
  assert.throws(() => importProject('é'.repeat(MAX_PROJECT_BYTES / 2 + 1)), /4 MB/)
})

test('rejects invalid metadata, unsafe shapes and invalid visibility indexes', () => {
  for (const overrides of [
    { title: '' }, { width: 4097 }, { height: 63 }, { total: 1 }, { total: 1.5 },
    { layers: [] }, { layers: null }, { layers: Array(31).fill(art.layers[0]) },
    { layers: [{ name: 'Unsafe', shapes: [{ type: 'script', color: '#fff' }] }] },
    { layers: [{ name: 'Unsafe', shapes: [{ ...art.layers[0].shapes[0], color: '#fff" onload="alert(1)' }] }] },
    { hiddenLayers: null }, { hiddenLayers: '1' }, { hiddenLayers: [1, 1] },
    { hiddenLayers: [2] }, { hiddenLayers: [-1] }, { hiddenLayers: [0.5] }, { hiddenLayers: ['1'] },
  ]) assert.throws(() => importProject(project(overrides)))
})

test('imports only validated drawing properties', () => {
  const data = JSON.parse(project())
  data.unused = 'not artwork'
  data.layers[0].script = 'alert(1)'
  data.layers[0].shapes[0].onload = 'alert(1)'
  assert.deepEqual(importProject(JSON.stringify(data)), { art, hiddenLayers: [1] })
})

test('SVG preserves shape order, non-square scaling, opacity and hidden layer groups', () => {
  const svg = createSVG(art, [1])
  assert.match(svg, /width="640" height="320" viewBox="0 0 640 320"/)
  assert.match(svg, /<rect width="640" height="320" fill="#ffffff"\/>/)
  assert.match(svg, /transform="scale\(0\.64 0\.32\)"/)
  assert.match(svg, /<g id="layer-1">/)
  assert.match(svg, /<g id="layer-2" display="none">/)
  assert.match(svg, /<ellipse cx="200" cy="300" rx="50" ry="100" fill="#fff" opacity="0\.5"\/>/)
  assert.match(svg, /<polygon points="0,0 100,100 0,100"/)
  assert.match(svg, /<line x1="100" y1="200" x2="500" y2="600" stroke="#789" stroke-width="4" stroke-linecap="round" opacity="1"\/>/)
  assert.ok(svg.indexOf('<ellipse') < svg.indexOf('<polygon'))
  assert.ok(svg.indexOf('<polygon') < svg.indexOf('<line'))
  assert.equal((createSVG(art, [0, 1]).match(/display="none"/g) || []).length, 2)
  assert.equal(createSVG(art).includes('display="none"'), false)
})

test('SVG escapes metadata and removes invalid XML control characters', () => {
  const svg = createSVG({
    ...art, title: '<script>"&\'\u0000</script>',
    layers: [{ ...art.layers[0], name: '<image href="evil"/>' }],
  })
  assert.match(svg, /&lt;script&gt;&quot;&amp;&apos;&lt;\/script&gt;/)
  assert.match(svg, /&lt;image href=&quot;evil&quot;\/&gt;/)
  assert.equal(svg.includes('<script>'), false)
  assert.equal(svg.includes('<image'), false)
  assert.equal(svg.includes('\u0000'), false)
})

test('SVG rejects unsupported shape types rather than silently dropping them', () => {
  assert.throws(() => createSVG({ ...art, layers: [{ name: 'Unsafe', shapes: [{ type: 'script' }] }] }), /Unsupported shape/)
})
