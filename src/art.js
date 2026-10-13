export function validateSettings({ title, layers, width, height }) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
    throw new Error('Write a title between 1 and 200 characters.')
  }
  for (const [name, value, min, max] of [
    ['Layers', layers, 1, 30],
    ['Width', width, 64, 4096],
    ['Height', height, 64, 4096],
  ]) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be a whole number between ${min} and ${max}.`)
    }
  }
  return { title: title.trim(), layers, width, height }
}

export function canContinueArt(art, settings) {
  if (!art || !settings || typeof settings.title !== 'string') return false
  const layers = Number(settings.layers)
  return settings.title.trim() === art.title && Number(settings.width) === art.width && Number(settings.height) === art.height &&
    Number.isInteger(layers) && layers > art.layers.length && layers <= 30
}

function number(value, name, min = 0, max = 1000) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid ${name} in the layer response.`)
  }
  return value
}

function color(value) {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) {
    throw new Error('Layer colors must be hex colors, like #e8b45b.')
  }
  return value
}

export function parseLayer(text) {
  if (typeof text !== 'string' || text.length > 65536) {
    throw new Error('The layer response is empty or too large.')
  }
  let layer
  try {
    layer = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    throw new Error('The model did not return valid layer JSON. Try creating the art again.')
  }
  if (!layer || typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 100 ||
    !Array.isArray(layer.shapes) || layer.shapes.length < 1 || layer.shapes.length > 40) {
    throw new Error('Each layer needs a name and between 1 and 40 shapes.')
  }
  const shapes = layer.shapes.map((shape) => {
    if (!shape || typeof shape !== 'object') throw new Error('Invalid shape in the layer response.')
    const base = { type: shape.type, color: color(shape.color), opacity: number(shape.opacity ?? 1, 'opacity', 0, 1) }
    switch (shape.type) {
      case 'rect':
        return { ...base, x: number(shape.x, 'x'), y: number(shape.y, 'y'), width: number(shape.width, 'width', 0.1), height: number(shape.height, 'height', 0.1) }
      case 'ellipse':
        return { ...base, x: number(shape.x, 'x'), y: number(shape.y, 'y'), rx: number(shape.rx, 'rx', 0.1), ry: number(shape.ry, 'ry', 0.1) }
      case 'polygon': {
        if (!Array.isArray(shape.points) || shape.points.length < 3 || shape.points.length > 32) {
          throw new Error('Polygons need between 3 and 32 points.')
        }
        const points = shape.points.map((point) => {
          if (!Array.isArray(point) || point.length !== 2) throw new Error('Invalid polygon point.')
          return [number(point[0], 'point x'), number(point[1], 'point y')]
        })
        return { ...base, points }
      }
      case 'line':
        return { ...base, x1: number(shape.x1, 'x1'), y1: number(shape.y1, 'y1'), x2: number(shape.x2, 'x2'), y2: number(shape.y2, 'y2'), width: number(shape.width, 'line width', 0.1, 50) }
      default:
        throw new Error(`Unsupported shape type: ${String(shape.type).slice(0, 40)}.`)
    }
  })
  return { name: layer.name.trim(), shapes }
}

export function drawArt(canvas, art, hiddenLayers = []) {
  canvas.width = art.width
  canvas.height = art.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw on a canvas.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, art.width, art.height)
  ctx.save()
  ctx.scale(art.width / 1000, art.height / 1000)
  for (const [index, layer] of art.layers.entries()) {
    if (hiddenLayers.includes(index)) continue
    for (const shape of layer.shapes) {
      ctx.globalAlpha = shape.opacity
      ctx.fillStyle = shape.color
      ctx.strokeStyle = shape.color
      ctx.beginPath()
      switch (shape.type) {
        case 'rect':
          ctx.fillRect(shape.x, shape.y, shape.width, shape.height)
          break
        case 'ellipse':
          ctx.ellipse(shape.x, shape.y, shape.rx, shape.ry, 0, 0, Math.PI * 2)
          ctx.fill()
          break
        case 'polygon':
          ctx.moveTo(...shape.points[0])
          for (const point of shape.points.slice(1)) ctx.lineTo(...point)
          ctx.closePath()
          ctx.fill()
          break
        case 'line':
          ctx.lineWidth = shape.width
          ctx.lineCap = 'round'
          ctx.moveTo(shape.x1, shape.y1)
          ctx.lineTo(shape.x2, shape.y2)
          ctx.stroke()
          break
      }
    }
  }
  ctx.restore()
}
