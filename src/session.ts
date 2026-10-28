import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import type { LlmMessage } from "./llm/adapter.ts"

export interface VistaTool {
  name: string
  args: Record<string, unknown>
  ok: boolean
  resumen: string
  resultado: string
}

export interface MensajeVista {
  role: "user" | "assistant"
  content: string
  toolCalls?: VistaTool[]
}

export interface Sesion {
  id: string
  messages: MensajeVista[]
  llm: LlmMessage[]
  esperandoConfirmacion: boolean
  needsConfirmation: boolean
  tokensUsados: number
}

const memoria = new Map<string, Sesion>()
const ID_VALIDO = /^[A-Za-z0-9_-]{1,80}$/

export function idValido(id: string): boolean {
  return ID_VALIDO.test(id)
}

function vacia(id: string): Sesion {
  return {
    id,
    messages: [],
    llm: [],
    esperandoConfirmacion: false,
    needsConfirmation: false,
    tokensUsados: 0,
  }
}

function rutaSesion(directory: string, id: string): string {
  return path.join(directory, "out", "sessions", `${id}.json`)
}

export async function obtenerSesion(directory: string, id: string | null): Promise<Sesion> {
  const sessionId = id && idValido(id) ? id : randomUUID()
  const existente = memoria.get(sessionId)
  if (existente) return existente
  if (id && idValido(id)) {
    try {
      const texto = await fs.readFile(rutaSesion(directory, sessionId), "utf8")
      const parsed = JSON.parse(texto) as Sesion
      if (parsed && parsed.id === sessionId && Array.isArray(parsed.messages) && Array.isArray(parsed.llm)) {
        memoria.set(sessionId, parsed)
        return parsed
      }
    } catch {
      // No hay archivo todavía. Se crea la sesión en memoria.
    }
  }
  const sesion = vacia(sessionId)
  memoria.set(sessionId, sesion)
  return sesion
}

export async function guardarSesion(directory: string, sesion: Sesion): Promise<void> {
  memoria.set(sesion.id, sesion)
  const dir = path.join(directory, "out", "sessions")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(rutaSesion(directory, sesion.id), JSON.stringify(sesion), "utf8")
}

export function vistaPublica(sesion: Sesion): {
  id: string
  needsConfirmation: boolean
  tokensUsados: number
  messages: MensajeVista[]
} {
  return {
    id: sesion.id,
    needsConfirmation: sesion.needsConfirmation,
    tokensUsados: sesion.tokensUsados,
    messages: sesion.messages,
  }
}
