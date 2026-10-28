import type { Config } from "../config.ts"
import { cargarInstrucciones } from "../integridad.ts"
import type { LlmAdapter, LlmToolCall } from "../llm/adapter.ts"
import { redactarClave } from "../redactar.ts"
import { guardarSesion, type Sesion, type VistaTool } from "../session.ts"
import { cargarMaestro } from "../tools/io.ts"
import { ocultarDatosBancarios } from "../tools/mapeo.ts"
import { esHerramienta, esquemaParametros, herramientas } from "../tools/registry.ts"
import { resumir } from "../tools/proveedor.ts"
import type { ToolCtx } from "../tools/tipos.ts"

export interface RespuestaChat {
  sessionId: string
  reply: string
  toolCalls: VistaTool[]
  needsConfirmation: boolean
}

function esAfirmacion(mensaje: string): boolean {
  return /^(s[ií]|ok|dale|env[ií]a(?:lo)?|enviar|confirmo|confirmado|adelante|procede|autorizo|de acuerdo|apruebo)\b/i.test(
    mensaje.trim(),
  )
}

function esNegacion(mensaje: string): boolean {
  return /^(no|nop|cancela|cancelar|deten(?:te)?|mejor no|no env)/i.test(mensaje.trim())
}

function argsRegistro(valor: unknown): Record<string, unknown> {
  if (typeof valor === "object" && valor !== null && !Array.isArray(valor)) {
    return valor as Record<string, unknown>
  }
  return {}
}

function casoDeLlamadas(calls: VistaTool[]): string | null {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const llamada = calls[i]
    const caso = llamada?.args.caso
    if (typeof caso === "string" && caso.length > 0) return caso
  }
  return null
}

function mensajeProveedor(error: unknown): string {
  if (error instanceof Error && error.message === "TIMEOUT_LLM") {
    return "El modelo tardó demasiado en responder. La sesión sigue activa; puedes reintentar."
  }
  const texto = error instanceof Error ? error.message : "El modelo no pudo responder."
  const limpio = redactarClave(texto).replace(/\s+/g, " ").slice(0, 400)
  if (/Falta (GEMINI_API_KEY|OPENROUTER_API_KEY)|API key|api key|UNAUTHENTICATED|permission denied/i.test(limpio)) {
    return "No pude autenticar con el modelo. Revisa OPENROUTER_API_KEY en el archivo .env del servidor. La sesión sigue activa."
  }
  return `El modelo no pudo completar este turno. ${limpio} La sesión sigue activa.`
}

async function ejecutarHerramienta(call: LlmToolCall, ctx: ToolCtx): Promise<string> {
  if (!esHerramienta(call.name)) {
    return JSON.stringify({ ok: false, error: `No existe la herramienta ${call.name}.` })
  }
  try {
    return await herramientas[call.name].execute(call.args, ctx)
  } catch {
    return JSON.stringify({ ok: false, error: "No fue posible completar la operación." })
  }
}

function vistaDe(call: LlmToolCall, resultado: string): VistaTool {
  let ok = false
  let resumen = "sin resultado"
  try {
    const parsed = JSON.parse(resultado) as { ok?: boolean; error?: string; data?: unknown }
    ok = parsed.ok === true
    if (ok) resumen = resumir(call.name, parsed.data)
    else resumen = typeof parsed.error === "string" ? parsed.error : "La herramienta no pudo completar la operación."
  } catch {
    resumen = "La herramienta devolvió una respuesta ilegible."
  }
  return { name: call.name, args: argsRegistro(call.args), ok, resumen, resultado }
}

function resumenTope(calls: VistaTool[]): string {
  const lineas = calls.map((call) => `- ${call.name}: ${call.resumen}`)
  return [
    "Llegué al tope de iteraciones de este turno. Esto es lo que dejaron las herramientas:",
    lineas.length > 0 ? lineas.join("\n") : "- No hubo llamadas completas.",
    "Puedes pedirme que continúe con lo que falta.",
  ].join("\n")
}

async function vigilarRespuesta(directory: string, reply: string, fuentes: string): Promise<string> {
  try {
    const maestro = await cargarMaestro(directory)
    const nit = maestro.nit
    if (typeof nit === "string" && nit.length > 5 && reply.includes(nit) && !fuentes.includes(nit)) {
      return "No puedo afirmar datos del maestro que no hayan salido de una herramienta. Indica el caso a procesar."
    }
    return ocultarDatosBancarios(reply, maestro)
  } catch {
    return reply
  }
}

export async function turno(entrada: {
  directory: string
  sesion: Sesion
  message: string
  adapter: LlmAdapter
  config: Config
}): Promise<RespuestaChat> {
  const { directory, sesion, adapter, config } = entrada
  const message = entrada.message.trim()
  const confirma = sesion.esperandoConfirmacion && esAfirmacion(message) && !esNegacion(message)
  if (esNegacion(message)) sesion.esperandoConfirmacion = false

  sesion.messages.push({ role: "user", content: message })
  sesion.llm.push({ role: "user", content: message })

  const ctx: ToolCtx = {
    directory,
    sessionId: sesion.id,
    confirmacionExplicita: confirma,
  }
  const specs = Object.entries(herramientas).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: esquemaParametros(tool.args),
  }))
  const toolCalls: VistaTool[] = []
  let reply = ""

  let sistema = ""
  try {
    sistema = await cargarInstrucciones(directory)
  } catch {
    reply = "No pude leer las instrucciones del agente. La sesión sigue activa."
  }

  if (!reply && sesion.tokensUsados >= config.maxTokensSesion) {
    reply = "Esta sesión llegó al tope de tokens configurado. Abre una sesión nueva para seguir."
  }

  if (!reply) {
    for (let i = 0; i < config.maxIteraciones; i += 1) {
      let respuesta
      try {
        respuesta = await adapter.enviar(sistema, sesion.llm, specs)
      } catch (error) {
        reply = mensajeProveedor(error)
        break
      }
      sesion.tokensUsados += respuesta.tokens
      if (respuesta.toolCalls.length === 0) {
        reply = respuesta.text.trim() || "No obtuve una respuesta del modelo."
        sesion.llm.push({ role: "assistant", content: reply, raw: respuesta.raw })
        break
      }
      sesion.llm.push({
        role: "assistant",
        content: respuesta.text,
        toolCalls: respuesta.toolCalls,
        raw: respuesta.raw,
      })
      for (const call of respuesta.toolCalls) {
        const resultado = await ejecutarHerramienta(call, ctx)
        const vista = vistaDe(call, resultado)
        toolCalls.push(vista)
        sesion.llm.push({
          role: "tool",
          content: resultado,
          toolName: call.name,
          toolCallId: call.id,
        })
      }
      if (i === config.maxIteraciones - 1) {
        reply = resumenTope(toolCalls)
        sesion.llm.push({ role: "assistant", content: reply })
      }
    }
  }

  if (!reply) reply = resumenTope(toolCalls)
  const fuentes = sesion.llm
    .filter((item) => item.role === "tool")
    .map((item) => item.content)
    .join("\n")
  reply = await vigilarRespuesta(directory, reply, fuentes)

  const armo = toolCalls.some((call) => call.name === "proveedor_armar_paquete" && call.ok)
  const envio = toolCalls.some((call) => call.name === "proveedor_simular_envio" && call.ok)
  const caso = casoDeLlamadas(toolCalls) ?? "indicado"
  if (armo && !envio && !reply.includes("¿Confirmas el envío simulado")) {
    reply = `${reply.trim()}\n\n¿Confirmas el envío simulado del caso "${caso}"? Responde "envía" para generar únicamente el archivo ENVIO-SIMULADO.md.`
  }
  if (envio && !reply.includes("ENVIO-SIMULADO")) {
    reply = `${reply.trim()}\n\nQuedó escrito ENVIO-SIMULADO.md. No se envió nada al cliente.`
  }

  sesion.esperandoConfirmacion = (armo && !envio) || reply.includes("¿Confirmas el envío simulado")
  sesion.needsConfirmation = sesion.esperandoConfirmacion
  if (envio) {
    sesion.esperandoConfirmacion = false
    sesion.needsConfirmation = false
  }

  sesion.messages.push({ role: "assistant", content: reply, toolCalls })
  try {
    await guardarSesion(directory, sesion)
  } catch {
    // La sesión permanece en memoria aunque no se pueda escribir el archivo.
  }

  return {
    sessionId: sesion.id,
    reply,
    toolCalls,
    needsConfirmation: sesion.needsConfirmation,
  }
}
