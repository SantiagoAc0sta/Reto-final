import { config as cargarEnv } from "dotenv"
import path from "node:path"

export interface Config {
  port: number
  provider: "openrouter" | "google"
  model: string
  apiKey: string | null
  maxIteraciones: number
  maxTokensSesion: number
  maxTokensRespuesta: number
  timeoutMs: number
}

function entero(nombre: string, valor: string | undefined, defecto: number): number {
  const parsed = Number(valor ?? defecto)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defecto
}

export function leerConfig(directory: string): Config {
  cargarEnv({ path: path.join(directory, ".env") })
  const pedido = process.env.LLM_PROVIDER?.trim()
  const provider = pedido === "google" ? "google" : "openrouter"
  const clave =
    provider === "google" ? process.env.GEMINI_API_KEY?.trim() : process.env.OPENROUTER_API_KEY?.trim()
  const modelo =
    provider === "google"
      ? process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash"
      : process.env.OPENROUTER_MODEL?.trim() || "openrouter/free"
  return {
    port: entero("PORT", process.env.PORT, 3000),
    provider,
    model: modelo,
    apiKey: clave ? clave : null,
    maxIteraciones: entero("MAX_ITERACIONES", process.env.MAX_ITERACIONES, 25),
    maxTokensSesion: entero("MAX_TOKENS_SESION", process.env.MAX_TOKENS_SESION, 80000),
    maxTokensRespuesta: entero("MAX_TOKENS_RESPUESTA", process.env.MAX_TOKENS_RESPUESTA, 2048),
    timeoutMs: entero("LLM_TIMEOUT_MS", process.env.LLM_TIMEOUT_MS, 60000),
  }
}
