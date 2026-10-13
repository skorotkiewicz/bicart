import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

const proxy = {
  '/llm': {
    target: 'http://example.com/v1',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/llm/, ''),
  },
}

export default defineConfig({
  server: { proxy },
  preview: { proxy },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
