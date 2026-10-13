import { jsonSchema } from 'ai'
import { parseLayer } from './art.js'

const coordinate = { type: 'number', minimum: 0, maximum: 1000 }
const dimension = { type: 'number', minimum: 0.1, maximum: 1000 }

function shape(type, fields) {
  const properties = {
    type: { type: 'string', enum: [type] },
    ...fields,
    color: { type: 'string', pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' },
    opacity: { type: 'number', minimum: 0, maximum: 1 },
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

export const layerSchema = jsonSchema({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    shapes: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        anyOf: [
          shape('rect', { x: coordinate, y: coordinate, width: dimension, height: dimension }),
          shape('ellipse', { x: coordinate, y: coordinate, rx: dimension, ry: dimension }),
          shape('polygon', {
            points: {
              type: 'array',
              minItems: 3,
              maxItems: 32,
              items: { type: 'array', items: coordinate, minItems: 2, maxItems: 2 },
            },
          }),
          shape('line', {
            x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate,
            width: { type: 'number', minimum: 0.1, maximum: 50 },
          }),
        ],
      },
    },
  },
  required: ['name', 'shapes'],
  additionalProperties: false,
}, {
  validate(value) {
    try {
      return { success: true, value: parseLayer(JSON.stringify(value)) }
    } catch (error) {
      return { success: false, error }
    }
  },
})
