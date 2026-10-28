import { z } from "zod"
import {
  armar_paquete,
  generar_formulario,
  leer_solicitud,
  mapear_campos,
  simular_envio,
} from "./proveedor.ts"

export const herramientas = {
  proveedor_leer_solicitud: leer_solicitud,
  proveedor_mapear_campos: mapear_campos,
  proveedor_generar_formulario: generar_formulario,
  proveedor_armar_paquete: armar_paquete,
  proveedor_simular_envio: simular_envio,
}

export type NombreHerramienta = keyof typeof herramientas

export function esHerramienta(nombre: string): nombre is NombreHerramienta {
  return Object.prototype.hasOwnProperty.call(herramientas, nombre)
}

interface DefZod {
  typeName: string
  type?: z.ZodTypeAny
  innerType?: z.ZodTypeAny
  shape?: () => Record<string, z.ZodTypeAny>
}

function definicion(schema: z.ZodTypeAny): DefZod {
  return (schema as unknown as { _def: DefZod })._def
}

function aJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = definicion(schema)
  const description = schema.description
  if (def.typeName === "ZodString") return description ? { type: "string", description } : { type: "string" }
  if (def.typeName === "ZodBoolean") return description ? { type: "boolean", description } : { type: "boolean" }
  if (def.typeName === "ZodNumber") return description ? { type: "number", description } : { type: "number" }
  if (def.typeName === "ZodArray" && def.type) {
    const items = aJsonSchema(def.type)
    return description ? { type: "array", items, description } : { type: "array", items }
  }
  if (def.typeName === "ZodOptional" && def.innerType) return aJsonSchema(def.innerType)
  if (def.typeName === "ZodDefault" && def.innerType) return aJsonSchema(def.innerType)
  if (def.typeName === "ZodObject" && def.shape) {
    const forma = def.shape()
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [clave, valor] of Object.entries(forma)) {
      properties[clave] = aJsonSchema(valor)
      const nombre = definicion(valor).typeName
      if (nombre !== "ZodOptional" && nombre !== "ZodDefault") required.push(clave)
    }
    return description
      ? { type: "object", properties, required, description }
      : { type: "object", properties, required }
  }
  return { type: "string" }
}

export function esquemaParametros(args: z.ZodRawShape): Record<string, unknown> {
  return aJsonSchema(z.object(args))
}
