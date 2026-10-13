import assert from 'node:assert/strict'
import { test } from 'node:test'
import { drawArt, parseLayer, validateSettings } from './art.js'
import { generateArt } from './llm.js'
import { layerSchema } from './layer-schema.js'

const settings = { title: 'Cabin at sunset', layers: 2, width: 640, height: 480 }
const background = { type: 'rect', x: 0, y: 0, width: 1000, height: 1000, color: '#edc986' }
const first = { name: 'Sky', shapes: [background] }
const second = { name: 'Sun', shapes: [{ type: 'ellipse', x: 600, y: 300, rx: 80, ry: 100, color: '#fff', opacity: 0.8 }] }

function mockServer(outputs) {
  const requests = []
  const fetch = async (url, options) => {
    requests.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null })
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'test-model' }] })
    const output = outputs.shift()
    if (output instanceof Error) throw output
    if (output instanceof Response) return output
    return Response.json({
      id: 'test', object: 'chat.completion', created: 0, model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: typeof output === 'string' ? output : JSON.stringify(output) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    })
  }
  return { fetch, requests }
}

function options(server, overrides = {}) {
  return { settings, baseURL: 'http://local/v1', fetch: server.fetch, onStatus: () => {}, onLayer: () => {}, ...overrides }
}

test('settings trim the title and reject blank, fractional and oversized inputs', () => {
  assert.equal(validateSettings({ ...settings, title: '  Cabin  ' }).title, 'Cabin')
  for (const change of [{ title: ' ' }, { title: 'x'.repeat(201) }, { layers: 0 }, { layers: 31 }, { layers: 1.5 }, { width: 63 }, { height: 4097 }, { width: NaN }]) {
    assert.throws(() => validateSettings({ ...settings, ...change }))
  }
})

test('parses fenced JSON and keeps only supported drawing data', () => {
  const layer = parseLayer('```json\n' + JSON.stringify({ ...first, code: 'alert(1)' }) + '\n```')
  assert.equal(layer.shapes[0].opacity, 1)
  assert.equal(layer.code, undefined)
  assert.deepEqual(parseLayer(JSON.stringify(second)), second)
})

test('rejects malformed, unsafe and unbounded model output', () => {
  for (const shape of [
    { ...background, type: 'script' }, { ...background, color: 'url(http://evil)' },
    { ...background, x: '0' }, { ...background, width: -1 }, { ...background, opacity: 2 },
    { type: 'polygon', color: '#fff', points: [[0, 0], [1, 1]] },
    { type: 'polygon', color: '#fff', points: [[0, 0], [1, 1], [1001, 0]] },
    { type: 'line', color: '#fff', x1: 0, y1: 0, x2: 1, y2: 1, width: 51 },
    null,
  ]) assert.throws(() => parseLayer(JSON.stringify({ name: 'Bad', shapes: [shape] })))
  for (const text of ['not JSON', '{}', 'null', 'x'.repeat(65537), JSON.stringify({ name: 'Too many', shapes: Array(41).fill(background) })]) {
    assert.throws(() => parseLayer(text))
  }
})

test('draws validated shapes in layer order at the requested resolution', () => {
  const calls = []
  const ctx = new Proxy({}, {
    get: (_, key) => (...args) => calls.push([key, ...args]),
    set: (_, key, value) => { calls.push([key, value]); return true },
  })
  const canvas = { getContext: () => ctx }
  const details = parseLayer(JSON.stringify({ name: 'Details', shapes: [
    ...second.shapes,
    { type: 'polygon', points: [[0, 0], [500, 500], [0, 1000]], color: '#123' },
    { type: 'line', x1: 0, y1: 0, x2: 100, y2: 100, width: 2, color: '#456' },
  ] }))
  drawArt(canvas, { width: 640, height: 480, layers: [parseLayer(JSON.stringify(first)), details] })
  assert.equal(canvas.width, 640)
  assert.equal(canvas.height, 480)
  assert.deepEqual(calls.find(([name]) => name === 'scale'), ['scale', 0.64, 0.48])
  assert.deepEqual(calls.filter(([name]) => name === 'fillStyle').map((call) => call[1]), ['#ffffff', '#edc986', '#fff', '#123', '#456'])
  assert.equal(calls.filter(([name]) => name === 'ellipse').length, 1)
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 1)
  assert.equal(calls.at(-1)[0], 'restore')
  assert.throws(() => drawArt({ getContext: () => null }, { width: 64, height: 64, layers: [] }))
})

test('visibility skips layers by index and can be restored without changing artwork', () => {
  const colors = []
  const ctx = new Proxy({}, {
    get: () => () => {},
    set: (_, key, value) => { if (key === 'fillStyle') colors.push(value); return true },
  })
  const canvas = { getContext: () => ctx }
  const art = { width: 640, height: 480, layers: [parseLayer(JSON.stringify(first)), { ...second, name: first.name }] }
  const original = JSON.stringify(art)
  for (const [hidden, expected] of [
    [[], ['#ffffff', '#edc986', '#fff']],
    [[1], ['#ffffff', '#edc986']],
    [[0], ['#ffffff', '#fff']],
    [[0, 1], ['#ffffff']],
    [[], ['#ffffff', '#edc986', '#fff']],
  ]) {
    colors.length = 0
    drawArt(canvas, art, hidden)
    assert.deepEqual(colors, expected)
    assert.equal(JSON.stringify(art), original)
  }
})

test('asks the SDK once per layer and supplies prior geometry', async () => {
  const server = mockServer([first, second])
  const snapshots = []
  const result = await generateArt(options(server, { onLayer: (art) => snapshots.push(art) }))
  assert.equal(result.modelId, 'test-model')
  assert.equal(server.requests.length, 3)
  assert.equal(snapshots[0].layers.length, 1)
  assert.equal(snapshots[1].layers.length, 2)
  assert.equal(snapshots[1].width, 640)
  for (const request of server.requests.slice(1)) {
    assert.deepEqual(request.body.response_format, {
      type: 'json_schema',
      json_schema: { name: 'art_layer', strict: true, schema: await layerSchema.jsonSchema },
    })
  }
  const body = server.requests[2].body
  const prompt = JSON.parse(body.messages.find((message) => message.role === 'user').content)
  assert.equal(prompt.currentLayer, 2)
  assert.deepEqual(prompt.previousLayers, [parseLayer(JSON.stringify(first))])
})

test('stopping prevents the next layer request', async () => {
  const server = mockServer([first, second])
  const controller = new AbortController()
  await assert.rejects(generateArt(options(server, { signal: controller.signal, onLayer: () => controller.abort() })), { name: 'AbortError' })
  assert.equal(server.requests.length, 2)
})

test('a failed layer keeps earlier snapshots and is not retried', async () => {
  const server = mockServer([first, 'broken JSON'])
  const snapshots = []
  await assert.rejects(generateArt(options(server, { onLayer: (art) => snapshots.push(art) })), /Layer 2:.*could not parse/)
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].layers.length, 1)
  assert.equal(server.requests.length, 3)
})

test('requires the first layer to provide an opaque background', async () => {
  await assert.rejects(generateArt(options(mockServer([second]))), /opaque full-canvas/)
})

test('rejects invalid settings before sending data and reports missing models', async () => {
  const server = mockServer([])
  await assert.rejects(generateArt(options(server, { settings: { ...settings, title: '' } })))
  assert.equal(server.requests.length, 0)
  await assert.rejects(generateArt(options(server, { fetch: async () => Response.json({ data: [] }) })), /no model IDs/)
  await assert.rejects(generateArt(options(server, { fetch: async () => new Response('', { status: 503 }) })), /HTTP 503/)
})

test('uses the configured model without calling the models endpoint', async () => {
  const server = mockServer([first, second])
  const result = await generateArt(options(server, { modelId: '  configured-model  ' }))
  assert.equal(result.modelId, 'configured-model')
  assert.equal(server.requests.length, 2)
  for (const request of server.requests) {
    assert.equal(request.url, 'http://local/v1/chat/completions')
    assert.equal(request.body.model, 'configured-model')
  }
})

test('rejects a non-string model before sending requests', async () => {
  const server = mockServer([])
  await assert.rejects(generateArt(options(server, { modelId: 123 })), /model ID must be a string/)
  assert.equal(server.requests.length, 0)
})

test('the schema defines strict shape variants and normalizes validated layer data', async () => {
  const schema = await layerSchema.jsonSchema
  assert.deepEqual(schema.required, ['name', 'shapes'])
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.shapes.maxItems, 40)
  const variants = schema.properties.shapes.items.anyOf
  assert.deepEqual(variants.map((variant) => variant.properties.type.enum[0]), ['rect', 'ellipse', 'polygon', 'line'])
  for (const variant of variants) {
    assert.equal(variant.additionalProperties, false)
    assert.deepEqual(variant.required, Object.keys(variant.properties))
    assert.equal(variant.properties.opacity.maximum, 1)
  }
  const result = layerSchema.validate({ ...first, name: ' Sky ', ignored: 'not drawing data' })
  assert.equal(result.success, true)
  assert.deepEqual(result.value, parseLayer(JSON.stringify(first)))
})

test('schema-invalid JSON stops the run and keeps completed layers', async () => {
  for (const invalid of [
    { name: 'Unsafe', shapes: [{ ...background, type: 'script' }] },
    { name: 'Unsafe', shapes: [{ ...background, color: 'url(http://evil)' }] },
    { name: 'Out of bounds', shapes: [{ ...background, x: 1001 }] },
    { name: 'Empty', shapes: [] },
  ]) {
    const server = mockServer([first, invalid])
    const snapshots = []
    await assert.rejects(generateArt(options(server, { onLayer: (art) => snapshots.push(art) })), /Layer 2:.*did not match schema/)
    assert.equal(snapshots.length, 1)
    assert.equal(snapshots[0].layers.length, 1)
    assert.equal(server.requests.length, 3)
  }
})

test('servers without schema support fail without retries or plain-text fallback', async () => {
  const server = mockServer([Response.json({ error: { message: 'json_schema is not supported' } }, { status: 400 })])
  const snapshots = []
  await assert.rejects(generateArt(options(server, { onLayer: (art) => snapshots.push(art) })), /Layer 1:.*json_schema is not supported/)
  assert.equal(snapshots.length, 0)
  assert.equal(server.requests.length, 2)
})

function savedLayers() {
  return [parseLayer(JSON.stringify(first)), ...Array.from({ length: 7 }, (_, index) => ({ ...parseLayer(JSON.stringify(second)), name: `Saved ${index + 2}` }))]
}

function requestPrompt(request) {
  return JSON.parse(request.body.messages.find((message) => message.role === 'user').content)
}

test('resumes at layer 9 without regenerating earlier layers and sends feedback only once', async () => {
  const previousLayers = savedLayers()
  const original = JSON.stringify(previousLayers)
  const server = mockServer([second, second])
  const snapshots = []
  const feedback = 'Generation coordination is unavailable. '.repeat(30)
  const result = await generateArt(options(server, {
    settings: { ...settings, layers: 10 }, modelId: 'configured-model', previousLayers, retryFeedback: feedback,
    onLayer: (art) => snapshots.push(art),
  }))
  assert.equal(server.requests.length, 2)
  assert.deepEqual(snapshots.map((art) => art.layers.length), [9, 10])
  assert.deepEqual(result.layers.slice(0, 8), previousLayers)
  assert.equal(JSON.stringify(previousLayers), original)
  const ninth = requestPrompt(server.requests[0])
  const tenth = requestPrompt(server.requests[1])
  assert.equal(ninth.currentLayer, 9)
  assert.equal(ninth.totalLayers, 10)
  assert.deepEqual(ninth.previousLayers, previousLayers)
  assert.equal(ninth.retryFeedback, feedback.slice(0, 500))
  assert.equal(tenth.currentLayer, 10)
  assert.equal(tenth.previousLayers.length, 9)
  assert.equal(tenth.retryFeedback, undefined)
})

test('a later failure can resume from the most recent completed layer', async () => {
  const failedServer = mockServer([second, Response.json({ error: { message: 'Generation coordination is unavailable' } }, { status: 503 })])
  let latest
  let failure
  await assert.rejects(generateArt(options(failedServer, {
    settings: { ...settings, layers: 10 }, modelId: 'configured-model', previousLayers: savedLayers(),
    onLayer: (art) => { latest = art },
  })), (error) => { failure = error; return /Layer 10: Generation coordination is unavailable/.test(error.message) })
  assert.equal(latest.layers.length, 9)
  const retryServer = mockServer([second])
  const result = await generateArt(options(retryServer, {
    settings: { ...settings, layers: 10 }, modelId: 'configured-model', previousLayers: latest.layers, retryFeedback: failure.retryFeedback,
  }))
  assert.equal(retryServer.requests.length, 1)
  assert.equal(requestPrompt(retryServer.requests[0]).currentLayer, 10)
  assert.equal(requestPrompt(retryServer.requests[0]).retryFeedback, 'Generation coordination is unavailable')
  assert.equal(result.layers.length, 10)
})

test('schema failures expose the drawing error as a short retry note', async () => {
  const server = mockServer([first, { ...second, shapes: [{ ...second.shapes[0], x: 1001 }] }])
  await assert.rejects(generateArt(options(server)), (error) => {
    assert.match(error.message, /Layer 2:.*did not match schema/)
    assert.equal(error.retryFeedback, 'Invalid x in the layer response.')
    return true
  })
})

test('resume inputs are validated before making requests', async () => {
  for (const overrides of [
    { previousLayers: null }, { previousLayers: 'not layers' },
    { previousLayers: [first, second] }, { previousLayers: [{}] },
    { retryFeedback: { message: 'not a string' } },
  ]) {
    const server = mockServer([])
    await assert.rejects(generateArt(options(server, overrides)))
    assert.equal(server.requests.length, 0)
  }
})

test('stopping a resumed run prevents later requests and preserves saved layers', async () => {
  const previousLayers = savedLayers()
  const server = mockServer([second, second])
  const controller = new AbortController()
  await assert.rejects(generateArt(options(server, {
    settings: { ...settings, layers: 10 }, modelId: 'configured-model', previousLayers,
    signal: controller.signal, onLayer: () => controller.abort(),
  })), { name: 'AbortError' })
  assert.equal(server.requests.length, 1)
  assert.equal(previousLayers.length, 8)
})
