import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'LLM_')
  const baseURL = env.LLM_BASE_URL?.trim()
  if (!baseURL && command === 'serve') {
    throw new Error('Set LLM_BASE_URL in .env before starting Bicart.')
  }
  if (baseURL) {
    let url
    try {
      url = new URL(baseURL)
    } catch {
      throw new Error('LLM_BASE_URL must be a valid HTTP or HTTPS API base URL.')
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('LLM_BASE_URL must be HTTP or HTTPS without credentials, a query, or a fragment.')
    }
  }
  const apiKey = env.LLM_API_KEY?.trim()
  const proxy = baseURL ? {
    '/llm': {
      target: baseURL.replace(/\/+$/, ''),
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/llm/, ''),
      ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    },
  } : {}

  return {
    define: { 'import.meta.env.LLM_MODEL': JSON.stringify(env.LLM_MODEL?.trim() || '') },
    server: { proxy },
    preview: { proxy },
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] })
    ],
  }
})
