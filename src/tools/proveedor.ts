import { z } from "zod"
import { registrar } from "../log.ts"
import { ErrorHerramienta, esCasoValido, leerSolicitud } from "./io.ts"
import { mapearCampos } from "./mapeo.ts"
import { armarPaquete, generarFormulario, simularEnvio } from "./salida.ts"
import type { ToolCtx } from "./tipos.ts"

const itemMapeo = z.object({ etiqueta: z.string().min(1) }).passthrough()
const casoArg = z.string().min(1).describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/")

function mensajeZod(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const ruta = issue.path.join(".")
      return ruta ? `${ruta}: ${issue.message}` : issue.message
    })
    .join("; ")
}

function casoDe(data: object): string | null {
  const registro = data as Record<string, unknown>
  const caso = registro.caso
  return typeof caso === "string" && esCasoValido(caso) ? caso : null
}

export function resumir(nombre: string, data: unknown): string {
  if (typeof data !== "object" || data === null) return "operacion completada"
  const registro = data as Record<string, unknown>
  if (nombre.endsWith("leer_solicitud")) {
    const campos = Array.isArray(registro.campos) ? registro.campos.length : 0
    const soportes = Array.isArray(registro.soportes) ? registro.soportes.length : 0
    return `${String(registro.pais)} ${String(registro.formato)} ${campos} campos ${soportes} soportes`
  }
  if (nombre.endsWith("mapear_campos")) {
    const llenos = Array.isArray(registro.llenos) ? registro.llenos.length : 0
    const faltantes = Array.isArray(registro.faltantes) ? registro.faltantes.length : 0
    const confirmar = Array.isArray(registro.requiere_confirmacion) ? registro.requiere_confirmacion.length : 0
    return `${llenos} llenos, ${faltantes} faltantes, ${confirmar} por confirmar`
  }
  if (nombre.endsWith("generar_formulario")) {
    const aviso = typeof registro.aviso === "string" && registro.aviso ? ` ${registro.aviso}` : ""
    return `${String(registro.formato)} ${String(registro.ruta)}${aviso}`
  }
  if (nombre.endsWith("armar_paquete")) {
    return `listo_para_firma=${String(registro.listo_para_firma)} ${String(registro.ruta)}`
  }
  if (nombre.endsWith("simular_envio")) return `escrito ${String(registro.ruta)}`
  return "operacion completada"
}

function herramienta<S extends z.ZodRawShape>(def: {
  nombre: string
  description: string
  args: S
  run: (args: z.infer<z.ZodObject<S>>, ctx: ToolCtx) => Promise<unknown>
}) {
  const esquema = z.object(def.args)
  return {
    description: def.description,
    args: def.args,
    async execute(args: unknown, ctx: ToolCtx): Promise<string> {
      try {
        const parsed = esquema.safeParse(args)
        if (!parsed.success) {
          const error = `Argumentos inválidos. ${mensajeZod(parsed.error)}`
          await registrar(ctx.directory, null, def.nombre, false, error)
          return JSON.stringify({ ok: false, error })
        }
        const caso = casoDe(parsed.data)
        try {
          const data = await def.run(parsed.data, ctx)
          await registrar(ctx.directory, caso, def.nombre, true, resumir(def.nombre, data))
          return JSON.stringify({ ok: true, data })
        } catch (error) {
          const mensaje = error instanceof ErrorHerramienta ? error.message : "No fue posible completar la operación."
          await registrar(ctx.directory, caso, def.nombre, false, mensaje)
          return JSON.stringify({ ok: false, error: mensaje })
        }
      } catch {
        return JSON.stringify({ ok: false, error: "No fue posible completar la operación." })
      }
    },
  }
}

export const leer_solicitud = herramienta({
  nombre: "proveedor_leer_solicitud",
  description: "Lee el país, el cliente, el formato, los campos y los soportes exigidos de un caso.",
  args: { caso: casoArg },
  run: (args, ctx) => leerSolicitud(ctx.directory, args.caso),
})

export const mapear_campos = herramienta({
  nombre: "proveedor_mapear_campos",
  description: "Cruza las etiquetas del caso con el glosario y el maestro y clasifica cada campo sin inventar valores.",
  args: {
    caso: casoArg,
    campos: z.array(z.string().min(1)).describe("Etiquetas de la plantilla. Un arreglo vacío usa todas las de la plantilla."),
  },
  run: (args, ctx) => mapearCampos(ctx.directory, args.caso, args.campos),
})

export const generar_formulario = herramienta({
  nombre: "proveedor_generar_formulario",
  description: "Escribe el formulario del caso en Excel, PDF o un markdown de portal usando solo el maestro.",
  args: {
    caso: casoArg,
    mapeo: z
      .object({
        llenos: z.array(itemMapeo).describe("Campos llenos devueltos por el mapeo"),
        faltantes: z.array(itemMapeo).describe("Campos faltantes devueltos por el mapeo"),
        requiere_confirmacion: z.array(itemMapeo).describe("Campos que requieren confirmación"),
      })
      .describe("Objeto data devuelto por proveedor_mapear_campos"),
  },
  run: (args, ctx) => generarFormulario(ctx.directory, args.caso, args.mapeo),
})

export const armar_paquete = herramienta({
  nombre: "proveedor_armar_paquete",
  description: "Crea el paquete de firma con formulario, soportes, checklist y borrador de correo.",
  args: { caso: casoArg },
  run: (args, ctx) => armarPaquete(ctx.directory, args.caso),
})

export const simular_envio = herramienta({
  nombre: "proveedor_simular_envio",
  description: "Escribe el archivo de envío simulado únicamente si el usuario ya confirmó.",
  args: {
    caso: casoArg,
    confirmado: z.boolean().describe("true solo si el usuario confirmo el envio en el mensaje inmediatamente anterior"),
  },
  run: (args, ctx) => simularEnvio(ctx.directory, args.caso, args.confirmado, ctx),
})
