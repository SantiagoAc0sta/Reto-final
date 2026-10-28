import { promises as fs } from "node:fs"
import path from "node:path"

function normalizar(texto: string): string {
  return texto.replace(/\r\n/g, "\n").trim()
}

export function cuerpoMarkdown(texto: string): string {
  const limpio = texto.replace(/\r\n/g, "\n")
  if (!limpio.startsWith("---\n")) return limpio.trim()
  const fin = limpio.indexOf("\n---\n", 4)
  if (fin === -1) return limpio.trim()
  return limpio.slice(fin + "\n---\n".length).trim()
}

export async function verificarModulo(directory: string): Promise<void> {
  const prompt = normalizar(await fs.readFile(path.join(directory, "agent", "prompt.md"), "utf8"))
  const agentMd = cuerpoMarkdown(await fs.readFile(path.join(directory, "modulo", "agent.md"), "utf8"))
  if (prompt !== agentMd) {
    throw new Error("modulo/agent.md no coincide con agent/prompt.md")
  }
  const conocimiento = normalizar(
    await fs.readFile(path.join(directory, "src", "knowledge", "registro-proveedor.md"), "utf8"),
  )
  const skill = cuerpoMarkdown(
    await fs.readFile(path.join(directory, "modulo", "skill", "registro-proveedor", "SKILL.md"), "utf8"),
  )
  if (conocimiento !== skill) {
    throw new Error("SKILL.md no coincide con src/knowledge/registro-proveedor.md")
  }
  const reexporta = await fs.readFile(path.join(directory, "modulo", "tools", "proveedor.ts"), "utf8")
  if (!reexporta.includes("../../src/tools/proveedor.ts")) {
    throw new Error("modulo/tools/proveedor.ts debe reexportar las herramientas de src/tools/proveedor.ts")
  }
}

export async function cargarInstrucciones(directory: string): Promise<string> {
  const prompt = normalizar(await fs.readFile(path.join(directory, "agent", "prompt.md"), "utf8"))
  const conocimiento = normalizar(
    await fs.readFile(path.join(directory, "src", "knowledge", "registro-proveedor.md"), "utf8"),
  )
  return `${prompt}\n\n# Conocimiento del proceso\n\n${conocimiento}`
}
