import { GoogleGenAI, Type, type Content, type FunctionDeclaration, type Schema } from "@google/genai"
import type { Config } from "../config.ts"
import type { LlmAdapter, LlmMessage, LlmResponse, LlmToolCall, ToolSpec } from "./adapter.ts"

const TIPOS: Record<string, Type> = {
  object: Type.OBJECT,
  string: Type.STRING,
  number: Type.NUMBER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
}

function esquemaGemini(schema: Record<string, unknown>): Schema {
  const tipo = typeof schema.type === "string" ? TIPOS[schema.type] ?? Type.STRING : Type.STRING
  const description = typeof schema.description === "string" ? schema.description : undefined
  const resultado: Schema = description ? { type: tipo, description } : { type: tipo }
  if (tipo === Type.OBJECT && schema.properties && typeof schema.properties === "object") {
    const properties: Record<string, Schema> = {}
    for (const [clave, valor] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (valor && typeof valor === "object") properties[clave] = esquemaGemini(valor as Record<string, unknown>)
    }
    resultado.properties = properties
    if (Array.isArray(schema.required)) {
      resultado.required = schema.required.filter((item): item is string => typeof item === "string")
    }
  }
  if (tipo === Type.ARRAY && schema.items && typeof schema.items === "object") {
    resultado.items = esquemaGemini(schema.items as Record<string, unknown>)
  }
  return resultado
}

function declaraciones(specs: ToolSpec[]): FunctionDeclaration[] {
  return specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: esquemaGemini(spec.parameters),
  }))
}

function esContenido(valor: unknown): valor is Content {
  if (typeof valor !== "object" || valor === null) return false
  const candidato = valor as { role?: unknown; parts?: unknown }
  return typeof candidato.role === "string" && Array.isArray(candidato.parts)
}

function contenidos(mensajes: LlmMessage[]): Content[] {
  const salida: Content[] = []
  let indice = 0
  while (indice < mensajes.length) {
    const mensaje = mensajes[indice]
    if (!mensaje) break
    if (mensaje.role === "user") {
      salida.push({ role: "user", parts: [{ text: mensaje.content }] })
      indice += 1
      continue
    }
    if (mensaje.role === "assistant") {
      if (esContenido(mensaje.raw)) salida.push(mensaje.raw)
      else if (mensaje.toolCalls && mensaje.toolCalls.length > 0) {
        salida.push({
          role: "model",
          parts: mensaje.toolCalls.map((call) => ({
            functionCall: { name: call.name, args: call.args, id: call.id },
          })),
        })
      } else {
        salida.push({ role: "model", parts: [{ text: mensaje.content || " " }] })
      }
      indice += 1
      continue
    }
    const parts: NonNullable<Content["parts"]> = []
    while (indice < mensajes.length && mensajes[indice]?.role === "tool") {
      const tool = mensajes[indice]
      if (!tool) break
      let payload: unknown
      try {
        payload = JSON.parse(tool.content) as unknown
      } catch {
        payload = { ok: false, error: "respuesta ilegible" }
      }
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        payload = { ok: false, error: "respuesta ilegible" }
      }
      parts.push({
        functionResponse: {
          name: tool.toolName ?? "herramienta",
          id: tool.toolCallId,
          response: payload as Record<string, unknown>,
        },
      })
      indice += 1
    }
    if (parts.length > 0) salida.push({ role: "user", parts })
  }
  return salida
}

function llamadas(valor: unknown): LlmToolCall[] {
  if (!Array.isArray(valor)) return []
  const salida: LlmToolCall[] = []
  valor.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return
    const call = item as { name?: unknown; args?: unknown; id?: unknown }
    if (typeof call.name !== "string") return
    const args =
      typeof call.args === "object" && call.args !== null && !Array.isArray(call.args)
        ? (call.args as Record<string, unknown>)
        : {}
    salida.push({
      id: typeof call.id === "string" ? call.id : `${call.name}-${index}`,
      name: call.name,
      args,
    })
  })
  return salida
}

export function crearGemini(config: Config): LlmAdapter {
  const cliente = config.apiKey ? new GoogleGenAI({ apiKey: config.apiKey }) : null
  return {
    provider: "google",
    model: config.model,
    async enviar(sistema, mensajes, specs): Promise<LlmResponse> {
      if (!cliente || !config.apiKey) throw new Error("Falta GEMINI_API_KEY")
      const promesa = cliente.models.generateContent({
        model: config.model,
        contents: contenidos(mensajes),
        config: {
          systemInstruction: sistema,
          temperature: 0,
          maxOutputTokens: config.maxTokensRespuesta,
          tools: [{ functionDeclarations: declaraciones(specs) }],
        },
      })
      const respuesta = await Promise.race([
        promesa,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error("TIMEOUT_LLM")), config.timeoutMs)
          timer.unref()
        }),
      ])
      const crudas = llamadas(respuesta.functionCalls)
      const texto = typeof respuesta.text === "string" ? respuesta.text : ""
      const uso = respuesta.usageMetadata?.totalTokenCount
      const tokens = typeof uso === "number" && uso > 0 ? uso : Math.ceil((sistema.length + texto.length) / 4) + 1
      const candidato = respuesta.candidates?.[0]?.content
      return {
        text: texto,
        toolCalls: crudas,
        tokens,
        raw: candidato,
      }
    },
  }
}
