import { createReadStream } from "node:fs"
import { promises as fs } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { turno } from "./agent/loop.ts"
import { leerConfig } from "./config.ts"
import { verificarModulo } from "./integridad.ts"
import { crearGemini } from "./llm/gemini.ts"
import { crearOpenRouter } from "./llm/openrouter.ts"
import { redactarClave } from "./redactar.ts"
import { idValido, obtenerSesion, vistaPublica } from "./session.ts"

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const webRoot = path.join(directory, "web")
const config = leerConfig(directory)
const adapter = config.provider === "google" ? crearGemini(config) : crearOpenRouter(config)

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
}

function enviarJson(res: ServerResponse, status: number, payload: unknown): void {
  const cuerpo = JSON.stringify(payload)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(cuerpo),
  })
  res.end(cuerpo)
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = []
    let total = 0
    req.on("data", (chunk: Buffer) => {
      total += chunk.length
      if (total > 1_000_000) {
        reject(new Error("El mensaje es demasiado grande."))
        req.destroy()
        return
      }
      partes.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")))
    req.on("error", reject)
  })
}

function archivoWeb(urlPath: string): string | null {
  const pedido = urlPath === "/" ? "/index.html" : urlPath.split("?")[0] ?? "/"
  const destino = path.normalize(path.join(webRoot, pedido))
  const relativo = path.relative(webRoot, destino)
  if (relativo.startsWith("..") || path.isAbsolute(relativo)) return null
  const extension = path.extname(destino)
  if (!MIME[extension]) return null
  return destino
}

async function servirEstatico(res: ServerResponse, ruta: string): Promise<void> {
  try {
    await fs.stat(ruta)
  } catch {
    enviarJson(res, 404, { error: "No se encontró el recurso." })
    return
  }
  const extension = path.extname(ruta)
  res.writeHead(200, { "Content-Type": MIME[extension] ?? "application/octet-stream", "Cache-Control": "no-store" })
  createReadStream(ruta).pipe(res)
}

const server = createServer((req, res) => {
  void atender(req, res)
})

async function atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost")
    if (req.method === "GET" && url.pathname === "/api/health") {
      enviarJson(res, 200, {
        ok: true,
        provider: config.provider,
        model: config.model,
        configured: Boolean(config.apiKey),
      })
      return
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length))
      if (!idValido(id)) {
        enviarJson(res, 400, { error: "El identificador de sesión no es válido." })
        return
      }
      const sesion = await obtenerSesion(directory, id)
      if (sesion.messages.length === 0 && sesion.llm.length === 0 && sesion.id !== id) {
        enviarJson(res, 404, { error: "No existe la sesión." })
        return
      }
      enviarJson(res, 200, vistaPublica(sesion))
      return
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      let crudo: unknown
      try {
        crudo = JSON.parse(await leerCuerpo(req)) as unknown
      } catch {
        enviarJson(res, 400, { error: "El cuerpo del mensaje no es JSON válido." })
        return
      }
      if (!esRegistro(crudo) || typeof crudo.message !== "string") {
        enviarJson(res, 400, { error: "Falta el mensaje." })
        return
      }
      const message = crudo.message.trim()
      if (!message || message.length > 8000) {
        enviarJson(res, 400, { error: "El mensaje está vacío o es demasiado largo." })
        return
      }
      const pedido = typeof crudo.sessionId === "string" ? crudo.sessionId : null
      if (pedido && !idValido(pedido)) {
        enviarJson(res, 400, { error: "El identificador de sesión no es válido." })
        return
      }
      const sesion = await obtenerSesion(directory, pedido)
      const respuesta = await turno({ directory, sesion, message, adapter, config })
      enviarJson(res, 200, respuesta)
      return
    }
    if (req.method === "GET") {
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204)
        res.end()
        return
      }
      const archivo = archivoWeb(url.pathname)
      if (!archivo) {
        enviarJson(res, 404, { error: "No se encontró la página." })
        return
      }
      await servirEstatico(res, archivo)
      return
    }
    enviarJson(res, 404, { error: "Ruta no disponible." })
  } catch (error) {
    const mensaje = redactarClave(error instanceof Error ? error.message : "Error interno")
    enviarJson(res, 200, {
      reply: `No pude completar el turno. ${mensaje} La sesión sigue activa.`,
      toolCalls: [],
      needsConfirmation: false,
    })
  }
}

await verificarModulo(directory)
const host = "0.0.0.0"
server.listen(config.port, host, () => {
  const clave = config.apiKey ? "configurada" : "ausente"
  const publico = process.env.RENDER_EXTERNAL_URL?.trim()
  console.log(publico ? `Registro como proveedor en ${publico}` : `Registro como proveedor en http://localhost:${config.port}`)
  console.log(`escucha=${host}:${config.port} proveedor=${config.provider} modelo=${config.model} clave=${clave}`)
})
