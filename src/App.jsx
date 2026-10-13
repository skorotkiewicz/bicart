import { useEffect, useRef, useState } from 'react'
import { drawArt } from './art.js'
import { generateArt } from './llm.js'
import './App.css'

function App() {
  const canvasRef = useRef(null)
  const requestRef = useRef(null)
  const [art, setArt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ completed: 0, total: 10 })
  const [status, setStatus] = useState('Ready when you are.')
  const [error, setError] = useState('')

  useEffect(() => {
    if (art && canvasRef.current) drawArt(canvasRef.current, art)
  }, [art])

  useEffect(() => () => requestRef.current?.abort(), [])

  async function createArt(event) {
    event.preventDefault()
    if (requestRef.current) return
    const form = new FormData(event.currentTarget)
    const controller = new AbortController()
    requestRef.current = controller
    setBusy(true)
    setProgress({ completed: 0, total: Number(form.get('layers')) })
    setError('')
    let completed = 0
    try {
      const result = await generateArt({
        settings: {
          title: form.get('title'),
          layers: Number(form.get('layers')),
          width: Number(form.get('width')),
          height: Number(form.get('height')),
        },
        baseURL: `${window.location.origin}/llm`,
        signal: controller.signal,
        onStatus: setStatus,
        onLayer: (nextArt) => {
          completed = nextArt.layers.length
          setProgress({ completed, total: nextArt.total })
          setArt(nextArt)
        },
      })
      setStatus(`Finished ${completed} layers with ${result.modelId.split('/').pop()}.`)
    } catch (cause) {
      if (controller.signal.aborted) {
        setStatus(`Stopped. ${completed} new ${completed === 1 ? 'layer' : 'layers'} completed.`)
      } else {
        setError(cause.message || 'Could not reach the local LLM. Check that it is running.')
        setStatus(completed ? `Kept ${completed} completed layers. You can export them.` : 'No new layers created. Previous artwork is unchanged.')
      }
    } finally {
      requestRef.current = null
      setBusy(false)
    }
  }

  function exportPNG() {
    if (!art || !canvasRef.current) return
    setError('')
    try {
      const canvas = canvasRef.current
      drawArt(canvas, art)
      canvas.toBlob((blob) => {
        if (!blob) {
          setError('Could not encode the PNG. Try a smaller canvas.')
          return
        }
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${art.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'bicart'}.png`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/png')
    } catch (cause) {
      setError(`PNG export failed: ${cause.message}`)
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
          <p className="intro">Your local LLM draws each layer, from the first color to the final detail.</p>

          <form onSubmit={createArt}>
            <fieldset disabled={busy}>
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

          <div className="connection"><span aria-hidden="true" /> Local LLM · 192.168.0.124:8888</div>
          <p className="note">One request per layer. More layers take longer. Art stays in this tab until you export it.</p>
        </aside>

        <section className="workspace" aria-label="Artwork preview" aria-busy={busy}>
          <div className="canvas-toolbar">
            <div>
              <h2>{art ? art.title : 'Your canvas'}</h2>
              <p>{art ? `${art.width} × ${art.height} px · ${art.layers.length} / ${art.total} layers` : 'Start with a title on the left.'}</p>
            </div>
            <button className="export" type="button" disabled={!art} onClick={exportPNG}>Export PNG <span aria-hidden="true">↓</span></button>
          </div>

          <div className="canvas-stage">
            {art ? (
              <canvas ref={canvasRef} role="img" aria-label={`${art.title}, composed of ${art.layers.length} generated layers`} />
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
            {error && <p className="error" role="alert">{error}</p>}
          </div>
          {art && (
            <ol className="layer-list" aria-label="Completed layers">
              {art.layers.map((layer, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span>{layer.name}</li>)}
            </ol>
          )}
        </section>
      </div>
      <footer>Text becomes shapes. Shapes become a picture.</footer>
    </main>
  )
}

export default App
