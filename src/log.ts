import { promises as fs } from "node:fs"
import path from "node:path"
import { esCasoValido } from "./tools/io.ts"

interface EntradaLog {
  ts: string
  herramienta: string
  ok: boolean
  resumen: string
}

let pendiente: Promise<void> = Promise.resolve()

async function escribir(directory: string, caso: string | null, entrada: EntradaLog): Promise<void> {
  const linea = `${JSON.stringify(entrada)}\n`
  const raiz = path.join(directory, "out")
  await fs.mkdir(raiz, { recursive: true })
  await fs.appendFile(path.join(raiz, "log.jsonl"), linea, "utf8")
  if (caso && esCasoValido(caso)) {
    const dirCaso = path.join(raiz, caso)
    await fs.mkdir(dirCaso, { recursive: true })
    await fs.appendFile(path.join(dirCaso, "log.jsonl"), linea, "utf8")
  }
}

export function registrar(
  directory: string,
  caso: string | null,
  herramienta: string,
  ok: boolean,
  resumen: string,
): Promise<void> {
  const entrada: EntradaLog = {
    ts: new Date().toISOString(),
    herramienta,
    ok,
    resumen: resumen.replace(/\s+/g, " ").slice(0, 500),
  }
  pendiente = pendiente.then(() => escribir(directory, caso, entrada)).catch(() => undefined)
  return pendiente
}
