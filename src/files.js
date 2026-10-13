import { parseLayer, validateSettings } from './art.js'

export const MAX_PROJECT_BYTES = 4 * 1024 * 1024

export function exportProject(art, hiddenLayers = []) {
  return JSON.stringify({ version: 1, ...art, hiddenLayers }, null, 2)
}

export function importProject(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) {
    throw new Error('Project files must be no larger than 4 MB.')
  }
  let project
  try {
    project = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  if (!project || project.version !== 1 || !Array.isArray(project.layers) ||
    project.layers.length < 1 || project.layers.length > 30) {
    throw new Error('Expected a Bicart version 1 project with 1 to 30 layers.')
  }
  const settings = validateSettings({ title: project.title, width: project.width, height: project.height, layers: project.total })
  if (project.layers.length > settings.layers) throw new Error('The completed layer count exceeds the total layer count.')
  const layers = project.layers.map((layer, index) => {
    try {
      return parseLayer(JSON.stringify(layer))
    } catch (error) {
      throw new Error(`Layer ${index + 1}: ${error.message}`)
    }
  })
  const hiddenLayers = project.hiddenLayers === undefined ? [] : project.hiddenLayers
  if (!Array.isArray(hiddenLayers) || hiddenLayers.some((index) => !Number.isInteger(index) || index < 0 || index >= layers.length) ||
    new Set(hiddenLayers).size !== hiddenLayers.length) {
    throw new Error('Hidden layers must be unique, valid layer indexes.')
  }
  return {
    art: { title: settings.title, width: settings.width, height: settings.height, total: settings.layers, layers },
    hiddenLayers: [...hiddenLayers],
  }
}

function escapeXML(text) {
  // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these characters.
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
}

export function createSVG(art, hiddenLayers = []) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${art.width}" height="${art.height}" viewBox="0 0 ${art.width} ${art.height}">`,
    `<title>${escapeXML(art.title)}</title>`,
    `<rect width="${art.width}" height="${art.height}" fill="#ffffff"/>`,
    `<g transform="scale(${art.width / 1000} ${art.height / 1000})">`,
  ]
  for (const [index, layer] of art.layers.entries()) {
    parts.push(`<g id="layer-${index + 1}"${hiddenLayers.includes(index) ? ' display="none"' : ''}>`, `<title>${escapeXML(layer.name)}</title>`)
    for (const shape of layer.shapes) {
      const fill = `fill="${shape.color}" opacity="${shape.opacity}"`
      switch (shape.type) {
        case 'rect':
          parts.push(`<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" ${fill}/>`)
          break
        case 'ellipse':
          parts.push(`<ellipse cx="${shape.x}" cy="${shape.y}" rx="${shape.rx}" ry="${shape.ry}" ${fill}/>`)
          break
        case 'polygon':
          parts.push(`<polygon points="${shape.points.map((point) => point.join(',')).join(' ')}" ${fill}/>`)
          break
        case 'line':
          parts.push(`<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${shape.color}" stroke-width="${shape.width}" stroke-linecap="round" opacity="${shape.opacity}"/>`)
          break
        default:
          throw new Error('Unsupported shape in SVG export.')
      }
    }
    parts.push('</g>')
  }
  parts.push('</g>', '</svg>')
  return parts.join('\n')
}
