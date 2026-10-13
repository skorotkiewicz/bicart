# Bicart

A small local-LLM art creator. Enter a title, choose a layer count and canvas size, then export the finished canvas as PNG.

## Run

Dependencies are already installed in this checkout.

```sh
bun run dev
```

Open the URL Vite prints. The LLM must be running at `http://192.168.0.124:8888/` with OpenAI-compatible `/v1/models` and `/v1/chat/completions` endpoints. Bicart discovers the first available model automatically.

If dependencies need reinstalling, allow the required eight-hour download timeout:

```sh
timeout 28800s bun install
```

## Use

- Title: 1 to 200 characters.
- Layers: 1 to 30, default 10. Each layer makes one sequential LLM request.
- Width and height: 64 to 4096 pixels each, default 1024 × 1024.
- Watch completed layers appear, or stop drawing at any time.
- Export PNG also works for a partially completed picture.

The model returns JSON rectangles, ellipses, polygons, and lines, not generated photographs. Each request includes the title and the completed layers. Responses are validated before drawing. Model output is never executed as JavaScript or inserted as HTML. Invalid output stops the run and keeps completed layers. There are no automatic retries.

Artwork stays in memory. Reloading the page loses it, so export before leaving. A new run replaces the previous picture only after its first layer succeeds.

## Local connection

`ai` and `@ai-sdk/openai-compatible` make the generation calls. Vite proxies `/llm` to `http://192.168.0.124:8888/v1` during development and preview, avoiding browser CORS restrictions. Change the fixed target in `vite.config.js` to use another local server, and update the connection label in `src/App.jsx`.

```sh
bun run test
bun run lint
bun run build
bun run preview
```

A static production host also needs a same-origin `/llm` reverse proxy to the LLM's `/v1` API. The build alone does not provide a backend. Keep this app local: exposing its proxy to the internet gives visitors access to your LLM server. No API key is configured for this local endpoint.
