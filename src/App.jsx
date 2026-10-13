import { useEffect, useRef, useState } from 'react'
import { drawArt, validateSettings } from './art.js'
import { createSVG, exportProject, importProject, MAX_PROJECT_BYTES } from './files.js'
import { generateArt } from './llm.js'
import './App.css'

function App() {
  const canvasRef = useRef(null)
  const requestRef = useRef(null)
  const formRef = useRef(null)
  const menuRef = useRef(null)
  const fileRef = useRef(null)
  const [art, setArt] = useState(null)
  const [hiddenLayers, setHiddenLayers] = useState([])
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ completed: 0, total: 10 })
  const [status, setStatus] = useState('Ready when you are.')
  const [error, setError] = useState('')
  const retry = progress.retry ?? (art && art.layers.length < art.total && error.startsWith(`Layer ${art.layers.length + 1}:`)
    ? {
      settings: { title: art.title, layers: art.total, width: art.width, height: art.height },
      previousLayers: art.layers,
      retryFeedback: error.slice(0, 500),
      message: error,
    }
    : null)

  useEffect(() => {
    if (art && canvasRef.current) drawArt(canvasRef.current, art, hiddenLayers)
  }, [art, hiddenLayers])

  useEffect(() => () => requestRef.current?.abort(), [])

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) menuRef.current.open = false
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [])

  async function createArt(event) {
    event.preventDefault()
    if (requestRef.current || importing) return
    const form = new FormData(event.currentTarget)
    try {
      const settings = validateSettings({
        title: form.get('title'),
        layers: Number(form.get('layers')),
        width: Number(form.get('width')),
        height: Number(form.get('height')),
      })
      await runGeneration(settings)
    } catch (cause) {
      if (retry && !progress.retry) setProgress({ ...progress, retry })
      setError(cause.message)
    }
  }

  async function runGeneration(settings, previousLayers = [], retryFeedback = '') {
    if (requestRef.current || importing) return
    for (const [name, value] of Object.entries(settings)) formRef.current.elements.namedItem(name).value = value
    const controller = new AbortController()
    requestRef.current = controller
    setBusy(true)
    setProgress({ completed: previousLayers.length, total: settings.layers })
    setError('')
    let layers = previousLayers
    let completed = layers.length
    try {
      const result = await generateArt({
        settings,
        previousLayers,
        retryFeedback,
        baseURL: `${window.location.origin}/llm`,
        modelId: import.meta.env.LLM_MODEL,
        signal: controller.signal,
        onStatus: setStatus,
        onLayer: (nextArt) => {
          layers = nextArt.layers
          completed = layers.length
          if (completed === 1) setHiddenLayers([])
          setProgress({ completed, total: nextArt.total })
          setArt(nextArt)
        },
      })
      setStatus(`Finished ${completed} layers with ${result.modelId.split('/').pop()}.`)
    } catch (cause) {
      if (controller.signal.aborted) {
        setStatus(`Stopped. ${completed} of ${settings.layers} layers completed.`)
      } else {
        const message = cause.message || 'Could not reach the LLM. Check your .env settings.'
        setProgress({
          completed,
          total: settings.layers,
          retry: { settings, previousLayers: layers, retryFeedback: cause.retryFeedback || message.slice(0, 500), message },
        })
        setStatus(completed ? `Kept ${completed} completed layers. You can export them.` : 'No new layers created. Previous artwork is unchanged.')
      }
    } finally {
      requestRef.current = null
      setBusy(false)
    }
  }

  function download(blob, extension) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${art.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'bicart'}.${extension}`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function exportArt(format) {
    menuRef.current.open = false
    if (!art) return
    if (retry && !progress.retry) setProgress({ ...progress, retry })
    setError('')
    try {
      if (format === 'svg') {
        download(new Blob([createSVG(art, hiddenLayers)], { type: 'image/svg+xml' }), 'svg')
      } else if (format === 'json') {
        download(new Blob([exportProject(art, hiddenLayers)], { type: 'application/json' }), 'json')
      } else {
        const canvas = canvasRef.current
        drawArt(canvas, art, hiddenLayers)
        canvas.toBlob((blob) => {
          if (!blob) {
            setError('Could not encode the PNG. Try a smaller canvas.')
            return
          }
          download(blob, 'png')
        }, 'image/png')
      }
    } catch (cause) {
      setError(`${format.toUpperCase()} export failed: ${cause.message}`)
    }
  }

  async function importJSON(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || requestRef.current || importing) return
    setImporting(true)
    if (retry && !progress.retry) setProgress({ ...progress, retry })
    setError('')
    setStatus('Reading JSON project…')
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Project files must be no larger than 4 MB.')
      const project = importProject(await file.text())
      if (art && !window.confirm('Replace the current artwork? Export JSON first if you need to keep it.')) {
        setStatus('Import canceled. Current artwork is unchanged.')
        return
      }
      setProgress({ completed: project.art.layers.length, total: project.art.total })
      setArt(project.art)
      setHiddenLayers(project.hiddenLayers)
      for (const [name, value] of Object.entries({ title: project.art.title, layers: project.art.total, width: project.art.width, height: project.art.height })) {
        formRef.current.elements.namedItem(name).value = value
      }
      setStatus('Imported JSON project.')
    } catch (cause) {
      setError(`JSON import failed: ${cause.message}`)
      setStatus('Import failed. Current artwork is unchanged.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <main>
      <header className="masthead">
        <a className="brand" href="/" aria-label="Bicart home"><span aria-hidden="true">▧</span> bicart</a>
        <span className="tagline">A little art, one layer at a time.</span>
      </header>

      <div className="studio">
        <aside className="settings">
          <p className="eyebrow">Your next picture</p>
          <h1>Give it a title.<br />See what unfolds.</h1>
          <p className="intro">Your LLM draws each layer, from the first color to the final detail.</p>

          <form ref={formRef} onSubmit={createArt}>
            <fieldset disabled={busy || importing}>
              <label htmlFor="title">Art title</label>
              <input id="title" name="title" placeholder="A small cabin under the northern lights" required maxLength={200} autoComplete="off" />

              <label htmlFor="layers">Layers <span>1 to 30</span></label>
              <input id="layers" name="layers" type="number" min="1" max="30" step="1" defaultValue="10" required />

              <div className="dimensions">
                <div>
                  <label htmlFor="width">Width <span>px</span></label>
                  <input id="width" name="width" type="number" min="64" max="4096" step="1" defaultValue="1024" required />
                </div>
                <div>
                  <label htmlFor="height">Height <span>px</span></label>
                  <input id="height" name="height" type="number" min="64" max="4096" step="1" defaultValue="1024" required />
                </div>
              </div>
              <button className="primary" type="submit">Create art <span aria-hidden="true">↗</span></button>
            </fieldset>
            {busy && <button className="stop" type="button" onClick={() => requestRef.current?.abort()}>Stop drawing</button>}
          </form>

          <div className="connection"><span aria-hidden="true" /> LLM configured in .env</div>
          <p className="note">One request per layer. More layers take longer. Art stays in this tab until you export it.</p>
        </aside>

        <section className="workspace" aria-label="Artwork preview" aria-busy={busy || importing}>
          <div className="canvas-toolbar">
            <div>
              <h2>{art ? art.title : 'Your canvas'}</h2>
              <p>{art ? `${art.width} × ${art.height} px · ${art.layers.length} / ${art.total} layers` : 'Start with a title on the left.'}</p>
            </div>
            <details
              ref={menuRef}
              className="export-menu"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.currentTarget.open = false
                  event.currentTarget.querySelector('summary').focus()
                }
              }}
            >
              <summary className="export">Export <span aria-hidden="true">⌄</span></summary>
              <div className="export-options" role="group" aria-label="Artwork file actions">
                <button type="button" disabled={!art} onClick={() => exportArt('png')}>Export PNG</button>
                <button type="button" disabled={!art} onClick={() => exportArt('svg')}>Export SVG</button>
                <button type="button" disabled={!art} onClick={() => exportArt('json')}>Export JSON</button>
                <button type="button" className="import-action" disabled={busy || importing} onClick={() => {
                  menuRef.current.open = false
                  fileRef.current.click()
                }}>Import JSON</button>
              </div>
            </details>
            <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Import JSON project" hidden disabled={busy || importing} onChange={importJSON} />
          </div>

          <div className="canvas-stage">
            {art ? (
              <canvas ref={canvasRef} role="img" aria-label={`${art.title}, ${art.layers.length - hiddenLayers.length} visible layers of ${art.layers.length}`} />
            ) : (
              <div className="blank-canvas">
                <span className="canvas-mark" aria-hidden="true">▧</span>
                <p>Nothing here. Yet.</p>
                <span>Your first layer is a title away.</span>
              </div>
            )}
          </div>

          <div className="progress-area">
            <p role="status" aria-live="polite">{busy && <span className="working-dot" aria-hidden="true" />}{status}</p>
            {busy && <progress aria-label="Completed layers" max={progress.total} value={progress.completed} />}
            {error && error !== retry?.message && <p className="error" role="alert">{error}</p>}
            {retry && (
              <p className="error" role="alert">
                {retry.message}{' '}
                <button className="retry-button" type="button" disabled={busy || importing}
                  aria-label={`Retry layer ${retry.previousLayers.length + 1}`}
                  onClick={() => runGeneration(retry.settings, retry.previousLayers, retry.retryFeedback)}>(try again)</button>
              </p>
            )}
          </div>
          {art && (
            <ol className="layer-list" aria-label="Completed layers">
              {art.layers.map((layer, index) => (
                <li key={index}>
                  <button
                    type="button"
                    aria-label={`Layer ${index + 1}: ${layer.name}`}
                    aria-pressed={!hiddenLayers.includes(index)}
                    onClick={() => setHiddenLayers((hidden) => hidden.includes(index)
                      ? hidden.filter((layerIndex) => layerIndex !== index)
                      : [...hidden, index])}
                  >
                    <span className="layer-number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="layer-name">{layer.name}</span>
                    <span className="layer-action">{hiddenLayers.includes(index) ? 'Show' : 'Hide'}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <footer>Text becomes shapes. Shapes become a picture.</footer>
    </main>
  )
}

export default App
