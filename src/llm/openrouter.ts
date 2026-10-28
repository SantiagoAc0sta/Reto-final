import type { Config } from "../config.ts"
import { redactarClave } from "../redactar.ts"
import type { LlmAdapter, LlmMessage, LlmResponse, LlmToolCall, ToolSpec } from "./adapter.ts"

interface MensajeOpenRouter {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface RespuestaOpenRouter {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id?: string
        function?: { name?: string; arguments?: string | Record<string, unknown> }
      }>
    }
  }>
  usage?: { total_tokens?: number }
  error?: { message?: string } | string
}

function mensajes(sistema: string, historial: LlmMessage[]): MensajeOpenRouter[] {
  const salida: MensajeOpenRouter[] = [{ role: "system", content: sistema }]
  for (const mensaje of historial) {
    if (mensaje.role === "user") {
      salida.push({ role: "user", content: mensaje.content })
      continue
    }
    if (mensaje.role === "tool") {
      salida.push({
        role: "tool",
        content: mensaje.content,
        tool_call_id: mensaje.toolCallId ?? "tool",
      })
      continue
    }
    if (mensaje.toolCalls && mensaje.toolCalls.length > 0) {
      salida.push({
        role: "assistant",
        content: mensaje.content || null,
        tool_calls: mensaje.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      })
      continue
    }
    salida.push({ role: "assistant", content: mensaje.content || " " })
  }
  return salida
}

function argsDe(valor: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (typeof valor === "object" && valor !== null && !Array.isArray(valor)) return valor
  if (typeof valor !== "string" || valor.trim() === "") return {}
  try {
    const parsed = JSON.parse(valor) as unknown
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }
  return {}
}

function llamadas(respuesta: RespuestaOpenRouter): LlmToolCall[] {
  const crudas = respuesta.choices?.[0]?.message?.tool_calls ?? []
  const salida: LlmToolCall[] = []
  crudas.forEach((call, index) => {
    const name = call.function?.name
    if (!name) return
    salida.push({
      id: call.id ?? `${name}-${index}`,
      name,
      args: argsDe(call.function?.arguments),
    })
  })
  return salida
}

function origenPublico(config: Config): string {
  const publico = process.env.RENDER_EXTERNAL_URL?.trim() || process.env.PUBLIC_URL?.trim()
  if (publico) return publico.replace(/\/$/, "")
  return `http://localhost:${config.port}`
}

function mensajeError(status: number, cuerpo: string): string {
  try {
    const parsed = JSON.parse(cuerpo) as RespuestaOpenRouter
    const detalle = typeof parsed.error === "string" ? parsed.error : parsed.error?.message
    if (detalle) return redactarClave(detalle)
  } catch {
    // El cuerpo no es JSON. Se usa el estado HTTP.
  }
  return `OpenRouter respondió ${status}.`
}

export function crearOpenRouter(config: Config): LlmAdapter {
  return {
    provider: "openrouter",
    model: config.model,
    async enviar(sistema, historial, herramientas: ToolSpec[]): Promise<LlmResponse> {
      if (!config.apiKey) throw new Error("Falta OPENROUTER_API_KEY")
      const controlador = new AbortController()
      const timer = setTimeout(() => controlador.abort(), config.timeoutMs)
      timer.unref()
      let respuestaHttp: Response
      try {
        respuestaHttp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          signal: controlador.signal,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": origenPublico(config),
            "X-Title": "Registro como proveedor",
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            max_tokens: config.maxTokensRespuesta,
            messages: mensajes(sistema, historial),
            tools: herramientas.map((spec) => ({
              type: "function",
              function: {
                name: spec.name,
                description: spec.description,
                parameters: spec.parameters,
              },
            })),
          }),
        })
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("TIMEOUT_LLM")
        throw new Error(redactarClave(error instanceof Error ? error.message : "No se pudo contactar a OpenRouter."))
      } finally {
        clearTimeout(timer)
      }
      const cuerpo = await respuestaHttp.text()
      if (!respuestaHttp.ok) throw new Error(mensajeError(respuestaHttp.status, cuerpo))
      let respuesta: RespuestaOpenRouter
      try {
        respuesta = JSON.parse(cuerpo) as RespuestaOpenRouter
      } catch {
        throw new Error("OpenRouter devolvió una respuesta ilegible.")
      }
      if (respuesta.error) {
        const detalle = typeof respuesta.error === "string" ? respuesta.error : respuesta.error.message
        throw new Error(redactarClave(detalle ?? "OpenRouter rechazó la solicitud."))
      }
      const texto = respuesta.choices?.[0]?.message?.content ?? ""
      const tokens = respuesta.usage?.total_tokens
      return {
        text: texto,
        toolCalls: llamadas(respuesta),
        tokens: typeof tokens === "number" && tokens > 0 ? tokens : Math.ceil((sistema.length + texto.length) / 4) + 1,
      }
    },
  }
}
