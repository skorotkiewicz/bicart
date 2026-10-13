# Bicart

A small LLM art creator. Enter a title, choose a layer count and canvas size, then export PNG, SVG, or a layered JSON project.

## Run

Dependencies are already installed in this checkout. Create your private configuration:

```sh
cp .env.example .env
```

Fill in these fields in `.env`:

```dotenv
LLM_BASE_URL=
LLM_MODEL=
LLM_API_KEY=
```

`LLM_BASE_URL` is required. Set it to your OpenAI-compatible API base URL, including `/v1` if your server requires it. Set `LLM_MODEL` to the model ID, or leave it blank to discover the first model from `/models`. Leave `LLM_API_KEY` blank for servers without authentication.

```sh
bun run dev
```

Open the URL Vite prints. Restart Vite after editing `.env`. Model changes also require rebuilding a production bundle.

If dependencies need reinstalling, allow the required eight-hour download timeout:

```sh
timeout 28800s bun install
```

## Use

- Title: 1 to 200 characters.
- Layers: 1 to 30, default 10. Each layer makes one sequential LLM request.
- Width and height: 64 to 4096 pixels each, default 1024 × 1024.
- Watch completed layers appear, or stop drawing at any time.
- Use Hide/Show on each completed layer. Visibility affects the preview, PNG, and SVG; hidden layers are kept and remain part of the LLM composition context. New artwork starts with every layer visible.
- Open the Export dropdown for PNG, SVG, Export JSON, or Import JSON. All export formats work with partially completed artwork.
- SVG keeps shapes in named layer groups and preserves hidden layers without rendering them.
- JSON saves every layer, visibility settings, title, canvas size, and the requested layer count. Import restores these settings and validates the entire file before replacing the picture.
- JSON import accepts Bicart version 1 projects up to 4 MB, asks before replacing existing artwork, and is unavailable during generation.

The model returns JSON rectangles, ellipses, polygons, and lines, not generated photographs. Each request includes the title, completed layers, and a JSON Schema defining the supported shapes and bounds. AI SDK's `Output.object()` returns validated layer data; the drawing validator and first-layer background check still run before rendering. Model output is never executed as JavaScript or inserted as HTML. Invalid output stops the run and keeps completed layers. There are no automatic retries.

Artwork stays in memory. Reloading the page loses it, so export JSON before leaving if you want to restore the layers later. PNG and SVG exports do not import back into Bicart. A new run replaces the previous picture only after its first layer succeeds.

## LLM connection

`ai` and `@ai-sdk/openai-compatible` make the generation calls. Vite proxies `/llm` to `LLM_BASE_URL` during development and preview, avoiding browser CORS restrictions. The proxy adds `LLM_API_KEY` as a bearer token server-side. Only `LLM_MODEL` is explicitly exposed to the client. Do not prefix the API key with `VITE_`, which would expose it in the browser bundle. Private env files are ignored by Git; `.env.example` is the shareable template.

The configured LLM server must support `response_format: json_schema`. Bicart requests strict structured output for every layer and does not silently fall back to plain text. Unsupported schema requests stop the run while keeping completed layers. The schema constrains drawing data, not the art style.

```sh
bun run test
bun run lint
bun run build
bun run preview
```

A static production host also needs a same-origin `/llm` reverse proxy to the configured API base URL, with bearer authentication when required. The build alone does not provide a backend. Keep this app local: exposing its proxy to the internet gives visitors access to your LLM using your server-side credentials.
