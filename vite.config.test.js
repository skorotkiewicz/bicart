import assert from 'node:assert/strict'
import { createServer as createHTTPServer } from 'node:http'
import { test } from 'node:test'
import { createServer } from 'vite'
import configure from './vite.config.js'
import { generateArt } from './src/llm.js'

function configWith(env, command = 'serve') {
  const keys = ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY']
  const previous = keys.map((key) => process.env[key])
  try {
    for (const key of keys) process.env[key] = env[key] ?? ''
    return configure({ mode: 'test', command })
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]
      else process.env[key] = previous[index]
    })
  }
}

test('env config sets the target and bearer key but exposes only the model to the client', () => {
  const config = configWith({ LLM_BASE_URL: 'http://localhost:8000/v1/', LLM_MODEL: 'my-model', LLM_API_KEY: 'test-server-key' })
  const proxy = config.server.proxy['/llm']
  assert.equal(proxy.target, 'http://localhost:8000/v1')
  assert.equal(proxy.rewrite('/llm/chat/completions'), '/chat/completions')
  assert.deepEqual(proxy.headers, { Authorization: 'Bearer test-server-key' })
  assert.equal(config.preview.proxy, config.server.proxy)
  assert.deepEqual(config.define, { 'import.meta.env.LLM_MODEL': '"my-model"' })
  assert.equal(JSON.stringify(config.define).includes('test-server-key'), false)
})

test('blank keys omit authentication and blank models allow discovery', () => {
  const config = configWith({ LLM_BASE_URL: 'http://localhost:8000/v1' })
  assert.equal(config.server.proxy['/llm'].headers, undefined)
  assert.equal(config.define['import.meta.env.LLM_MODEL'], '""')
})

test('missing base URL stops startup but does not prevent a static build', () => {
  assert.throws(() => configWith({}), /Set LLM_BASE_URL in .env/)
  assert.deepEqual(configWith({}, 'build').server.proxy, {})
})

test('rejects invalid base URLs without exposing their contents in errors', () => {
  for (const url of ['not a URL', 'file:///etc/passwd', 'ftp://localhost/v1', 'http://user:password@localhost/v1', 'http://localhost/v1?key=value', 'http://localhost/v1#fragment']) {
    assert.throws(() => configWith({ LLM_BASE_URL: url }), /LLM_BASE_URL must be/)
  }
})

test('requests through the Vite proxy use the configured model and server-side key', async () => {
  const requests = []
  const upstream = createHTTPServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      requests.push({ path: request.url, authorization: request.headers.authorization, body: JSON.parse(body) })
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        id: 'test', object: 'chat.completion', created: 0, model: 'configured-model',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({
          name: 'Background', shapes: [{ type: 'rect', x: 0, y: 0, width: 1000, height: 1000, color: '#fff' }],
        }) }, finish_reason: 'stop' }],
      }))
    })
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  let vite
  try {
    const config = configWith({
      LLM_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
      LLM_MODEL: 'configured-model',
      LLM_API_KEY: 'test-server-key',
    })
    vite = await createServer({ ...config, configFile: false, logLevel: 'silent', server: { ...config.server, host: '127.0.0.1', port: 0 } })
    await vite.listen()
    const result = await generateArt({
      settings: { title: 'Test art', layers: 1, width: 64, height: 64 },
      baseURL: `http://127.0.0.1:${vite.httpServer.address().port}/llm`,
      modelId: JSON.parse(config.define['import.meta.env.LLM_MODEL']),
      signal: AbortSignal.timeout(10000),
      onStatus: () => {},
      onLayer: () => {},
      fetch: (url, options) => {
        const headers = new Headers(options.headers)
        headers.set('Authorization', 'Bearer browser-value')
        return fetch(url, { ...options, headers })
      },
    })
    assert.equal(result.layers.length, 1)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].path, '/v1/chat/completions')
    assert.equal(requests[0].authorization, 'Bearer test-server-key')
    assert.equal(requests[0].body.model, 'configured-model')
    assert.equal(requests[0].body.response_format.type, 'json_schema')
    assert.equal(requests[0].body.response_format.json_schema.strict, true)
    assert.equal(requests[0].body.response_format.json_schema.name, 'art_layer')
  } finally {
    await vite?.close()
    upstream.closeAllConnections()
    await new Promise((resolve) => upstream.close(resolve))
  }
})
