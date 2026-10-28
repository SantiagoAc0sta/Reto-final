import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ExcelJS from "exceljs"
import { verificarModulo } from "./src/integridad.ts"
import { fechaLocal } from "./src/tools/io.ts"
import { secretosBancarios } from "./src/tools/mapeo.ts"
import {
  armar_paquete,
  generar_formulario,
  leer_solicitud,
  mapear_campos,
  simular_envio,
} from "./src/tools/proveedor.ts"
import type { ToolCtx } from "./src/tools/tipos.ts"

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const fallos: string[] = []

function verificar(condicion: boolean, mensaje: string): void {
  if (!condicion) {
    fallos.push(mensaje)
    console.log(`  fallo  ${mensaje}`)
    return
  }
  console.log(`  ok     ${mensaje}`)
}

async function llamar(herramienta: { execute: (args: unknown, ctx: ToolCtx) => Promise<string> }, args: unknown, ctx: ToolCtx): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const texto = await herramienta.execute(args, ctx)
  return JSON.parse(texto) as { ok: boolean; data?: Record<string, unknown>; error?: string }
}

async function archivosDe(dir: string): Promise<string[]> {
  const salida: string[] = []
  async function walk(actual: string): Promise<void> {
    const entradas = await fs.readdir(actual, { withFileTypes: true })
    for (const entrada of entradas) {
      const ruta = path.join(actual, entrada.name)
      if (entrada.isDirectory()) await walk(ruta)
      else salida.push(ruta)
    }
  }
  await walk(dir)
  return salida.sort()
}

async function hashDir(dir: string): Promise<string> {
  const hash = createHash("sha256")
  for (const archivo of await archivosDe(dir)) {
    const relativo = path.relative(dir, archivo).split(path.sep).join("/")
    hash.update(relativo)
    hash.update(await fs.readFile(archivo))
  }
  return hash.digest("hex")
}

function textoPlanoPdf(pdf: Buffer): string {
  const crudo = pdf.toString("latin1")
  const partes: string[] = []
  for (const coincidencia of crudo.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = coincidencia[1]
    if (!hex || hex.length % 2 !== 0) continue
    partes.push(Buffer.from(hex, "hex").toString("latin1"))
  }
  return partes.join("")
}

function textoCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return ""
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") return String(valor)
  if (typeof valor === "object" && "text" in valor && typeof valor.text === "string") return valor.text
  return ""
}

async function celda(ruta: string, hoja: string, direccion: string): Promise<string> {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.readFile(ruta)
  return textoCelda(libro.getWorksheet(hoja)?.getCell(direccion).value ?? null)
}

async function prepararSandbox(nombre: string, solicitud: unknown, plantilla: string, contenidoPlantilla: string): Promise<string> {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "reto01-"))
  const caso = path.join(raiz, "fixtures", "reto-01", "casos", nombre)
  await fs.mkdir(caso, { recursive: true })
  await fs.cp(path.join(directory, "fixtures", "reto-01", "repositorio"), path.join(raiz, "fixtures", "reto-01", "repositorio"), {
    recursive: true,
  })
  await fs.copyFile(
    path.join(directory, "fixtures", "reto-01", "glosario-campos.json"),
    path.join(raiz, "fixtures", "reto-01", "glosario-campos.json"),
  )
  await fs.writeFile(path.join(caso, "solicitud.json"), JSON.stringify(solicitud), "utf8")
  await fs.writeFile(path.join(caso, plantilla), contenidoPlantilla, "utf8")
  await fs.writeFile(path.join(caso, "soportes-exigidos.json"), JSON.stringify(["rut"]), "utf8")
  return raiz
}

const casos = ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"] as const
const ctxBase: ToolCtx = { directory, sessionId: "demo" }

await fs.rm(path.join(directory, "out"), { recursive: true, force: true })
const hashAntes = await hashDir(path.join(directory, "fixtures", "reto-01"))
const hashOriginal = await hashDir(path.join(directory, "reto-01 1", "reto-01"))
verificar(hashAntes === hashOriginal, "la copia de fixtures coincide con los JSON oficiales")
await verificarModulo(directory)

const modulo = await import("./modulo/tools/proveedor.ts")
verificar(modulo.leer_solicitud === leer_solicitud, "modulo reexporta la misma herramienta de lectura")
verificar(modulo.generar_formulario === generar_formulario, "modulo reexporta la misma herramienta de formulario")

const maestro = JSON.parse(await fs.readFile(path.join(directory, "fixtures", "reto-01", "repositorio", "maestro.json"), "utf8")) as {
  razon_social: string
  nit: string
  digito_verificacion: string
  banco: { nombre: string; numero_cuenta: string; swift: string }
  ingresos_ultimo_ano: { valor: number }
}
const secretos = secretosBancarios(maestro)
const hoy = fechaLocal()
console.log(`Fecha de corte: ${hoy}`)

for (const caso of casos) {
  console.log(`\n== ${caso} ==`)
  const ctx = ctxBase
  const lectura = await llamar(leer_solicitud, { caso }, ctx)
  verificar(lectura.ok === true, `${caso} lee la solicitud`)
  const formato = String(lectura.data?.formato)
  const etiquetas = Array.isArray(lectura.data?.campos)
    ? lectura.data.campos.flatMap((campo) => {
        if (typeof campo === "object" && campo !== null && "etiqueta" in campo && typeof campo.etiqueta === "string") {
          return [campo.etiqueta]
        }
        return []
      })
    : []
  const mapeo = await llamar(mapear_campos, { caso, campos: etiquetas }, ctx)
  verificar(mapeo.ok === true, `${caso} mapea campos`)
  const dataMapeo = mapeo.data ?? { llenos: [], faltantes: [], requiere_confirmacion: [] }
  const formulario = await llamar(generar_formulario, { caso, mapeo: dataMapeo }, ctx)
  verificar(formulario.ok === true, `${caso} genera formulario`)
  const paquete = await llamar(armar_paquete, { caso }, ctx)
  verificar(paquete.ok === true, `${caso} arma el paquete`)

  const checklist = Array.isArray(paquete.data?.checklist) ? paquete.data.checklist : []
  const bloqueaSoporte = checklist.some((item) => {
    if (typeof item !== "object" || item === null || !("estado" in item)) return false
    return item.estado === "ausente" || item.estado === "vencido"
  })
  const esperadoListo = paquete.data?.formulario_incluido === true && !bloqueaSoporte
  verificar(paquete.data?.listo_para_firma === esperadoListo, `${caso} listo_para_firma sigue la regla de soportes`)

  const borrador = await fs.readFile(path.join(directory, "out", caso, "paquete", "borrador-correo.md"), "utf8")
  for (const secreto of secretos) {
    verificar(!borrador.includes(secreto), `${caso} el borrador no incluye ${secreto}`)
  }
  const log = await fs.readFile(path.join(directory, "out", caso, "log.jsonl"), "utf8")
  const lineas = log.trim().split("\n").map((linea) => JSON.parse(linea) as { ts?: string; herramienta?: string; ok?: boolean; resumen?: string })
  verificar(lineas.length >= 4, `${caso} deja log.jsonl`)
  verificar(lineas.every((linea) => typeof linea.ts === "string" && typeof linea.herramienta === "string" && typeof linea.ok === "boolean" && typeof linea.resumen === "string"), `${caso} el log tiene ts, herramienta, ok y resumen`)
  verificar(!log.includes("AIza"), `${caso} el log no contiene una clave`)

  if (caso === "co-industrias-delta") {
    const ruta = path.join(directory, "out", caso, "formulario.xlsx")
    verificar((await celda(ruta, "Datos Proveedor", "B3")) === "Razón social", "Delta escribe la etiqueta en B3")
    verificar((await celda(ruta, "Datos Proveedor", "C3")) === maestro.razon_social, "Delta C3 es la razón social del maestro")
    verificar((await celda(ruta, "Datos Proveedor", "C4")) === maestro.nit, "Delta C4 es el NIT")
    verificar((await celda(ruta, "Datos Proveedor", "C5")) === maestro.digito_verificacion, "Delta C5 es el dígito")
    verificar((await celda(ruta, "Datos Bancarios", "C5")) === maestro.banco.numero_cuenta, "Delta escribe la cuenta solo en la celda pedida")
    const llenos = Array.isArray(dataMapeo.llenos) ? dataMapeo.llenos : []
    const faltantes = Array.isArray(dataMapeo.faltantes) ? dataMapeo.faltantes : []
    verificar(faltantes.length === 0, "Delta no tiene faltantes")
    verificar(llenos.some((item) => typeof item === "object" && item !== null && "etiqueta" in item && item.etiqueta === "NIT" && "estado" in item && item.estado === "lleno"), "Delta marca el NIT como lleno")
  }

  if (caso === "ec-corp-andina") {
    const pdf = await fs.readFile(path.join(directory, "out", caso, "formulario.pdf"))
    const plano = textoPlanoPdf(pdf)
    verificar(pdf.subarray(0, 5).toString() === "%PDF-", "Andina produce un PDF")
    verificar(plano.includes("Nombre de la empresa"), "Andina incluye la primera etiqueta")
    verificar(plano.includes(maestro.nit), "Andina escribe el NIT en el RUC")
    verificar(plano.includes("identificador extranjero"), "Andina marca el identificador extranjero")
    verificar(plano.includes("sin dato en el maestro"), "Andina no inventa el contribuyente especial")
    const faltantes = JSON.stringify(dataMapeo.faltantes)
    verificar(faltantes.includes("Número de contribuyente especial"), "Andina lista el campo faltante")
    verificar(JSON.stringify(paquete.data?.checklist).includes("certificado_cumplimiento_tributario"), "Andina marca el soporte ausente")
  }

  if (caso === "hn-agroexport-sula") {
    const ruta = path.join(directory, "out", caso, "formulario.xlsx")
    verificar((await celda(ruta, "Registro", "B3")) === maestro.nit, "Sula llena el RTN con el NIT")
    verificar((await celda(ruta, "Registro", "B11")) === String(maestro.ingresos_ultimo_ano.valor), "Sula escribe los ingresos del maestro")
    verificar((await celda(ruta, "Registro", "B12")) === "", "Sula deja vacías las referencias comerciales")
    const confirmar = JSON.stringify(dataMapeo.requiere_confirmacion)
    verificar(confirmar.includes("RTN") && confirmar.includes("identificador extranjero"), "Sula pide confirmar el RTN")
    verificar(JSON.stringify(dataMapeo.faltantes).includes("Referencias comerciales"), "Sula lista referencias como faltante")
  }

  if (caso === "pa-logistica-istmo") {
    verificar(formulario.data?.aviso === "formato no soportado", "Istmo responde formato no soportado")
    const portal = await fs.readFile(path.join(directory, "out", caso, "valores-portal.md"), "utf8")
    verificar(portal.includes("formato no soportado"), "Istmo deja los valores en markdown")
    verificar(portal.includes(maestro.nit), "Istmo copia el NIT para el RUC")
    verificar(portal.includes("identificador extranjero"), "Istmo marca el identificador extranjero")
    const copiado = await fs.readFile(path.join(directory, "out", caso, "paquete", "valores-portal.md"), "utf8")
    verificar(copiado === portal, "Istmo copia el markdown al paquete")
  }
}

console.log("\n== confirmación y errores ==")
const sinConfirmar = await llamar(simular_envio, { caso: "co-industrias-delta", confirmado: false }, ctxBase)
verificar(sinConfirmar.ok === false && sinConfirmar.error === "requiere confirmación explícita", "sin confirmación no simula el envío")
const bloqueado = await llamar(simular_envio, { caso: "co-industrias-delta", confirmado: true }, { ...ctxBase, confirmacionExplicita: false })
verificar(bloqueado.ok === false && bloqueado.error === "requiere confirmación explícita", "el modelo no puede confirmar por su cuenta")
const enviado = await llamar(simular_envio, { caso: "co-industrias-delta", confirmado: true }, { ...ctxBase, confirmacionExplicita: true })
verificar(enviado.ok === true, "con confirmación explícita escribe ENVIO-SIMULADO.md")
const envio = await fs.readFile(path.join(directory, "out", "co-industrias-delta", "ENVIO-SIMULADO.md"), "utf8")
for (const secreto of secretos) verificar(!envio.includes(secreto), `el envío simulado no incluye ${secreto}`)

const inexistente = await llamar(leer_solicitud, { caso: "no-existe" }, ctxBase)
verificar(inexistente.ok === false && !inexistente.error?.includes("    at "), "un caso inexistente responde sin traza")
const traversal = await llamar(leer_solicitud, { caso: "../maestro" }, ctxBase)
verificar(traversal.ok === false, "un caso con ruta relativa se rechaza")

const sandboxRoto = await prepararSandbox(
  "caso-roto",
  { pais: "CO", cliente: "Caso Roto", formato: "xlsx", asunto: "Roto", de: "a@b.com" },
  "plantilla-celdas.json",
  "{ esto no es json",
)
const roto = await llamar(leer_solicitud, { caso: "caso-roto" }, { directory: sandboxRoto, sessionId: "demo" })
verificar(roto.ok === true && typeof roto.data?.advertencia === "string", "una plantilla corrupta avisa y sigue")
verificar(Array.isArray(roto.data?.campos) && roto.data.campos.length === 0, "la plantilla corrupta no inventa campos")
const mapaRoto = await llamar(mapear_campos, { caso: "caso-roto", campos: [] }, { directory: sandboxRoto, sessionId: "demo" })
verificar(mapaRoto.ok === true, "el mapeo continúa después de la plantilla corrupta")
const genRoto = await llamar(
  generar_formulario,
  { caso: "caso-roto", mapeo: { llenos: [], faltantes: [], requiere_confirmacion: [] } },
  { directory: sandboxRoto, sessionId: "demo" },
)
verificar(genRoto.ok === false && !genRoto.error?.includes("    at "), "generar explica la plantilla corrupta sin traza")

const sandboxAmbiguo = await prepararSandbox(
  "caso-ambiguo",
  { pais: "CO", cliente: "Caso Ambiguo", formato: "pdf", asunto: "Ambiguo", de: "a@b.com" },
  "plantilla-campos.json",
  JSON.stringify([
    { etiqueta: "Identificación tributaria", obligatorio: true },
    { etiqueta: "Razón social", obligatorio: true },
  ]),
)
const ambiguo = await llamar(leer_solicitud, { caso: "caso-ambiguo" }, { directory: sandboxAmbiguo, sessionId: "demo" })
verificar(JSON.stringify(ambiguo.data?.requiere_confirmacion).includes("NIT"), "la etiqueta ambigua propone el NIT")
const mapaAmbiguo = await llamar(
  mapear_campos,
  { caso: "caso-ambiguo", campos: ["Identificación tributaria", "Razón social"] },
  { directory: sandboxAmbiguo, sessionId: "demo" },
)
verificar(JSON.stringify(mapaAmbiguo.data?.requiere_confirmacion).includes("Identificación tributaria"), "el mapeo no da por cerrado el campo ambiguo")

const sandboxWord = await prepararSandbox(
  "caso-word",
  { pais: "CO", cliente: "Caso Word", formato: "word", asunto: "Word", de: "a@b.com" },
  "plantilla-campos.json",
  "[]",
)
const word = await llamar(leer_solicitud, { caso: "caso-word" }, { directory: sandboxWord, sessionId: "demo" })
verificar(word.ok === false && word.error === "formato no soportado", "un formato desconocido responde formato no soportado")

await fs.rm(sandboxRoto, { recursive: true, force: true })
await fs.rm(sandboxAmbiguo, { recursive: true, force: true })
await fs.rm(sandboxWord, { recursive: true, force: true })

const hashDespues = await hashDir(path.join(directory, "fixtures", "reto-01"))
verificar(hashDespues === hashAntes, "los fixtures siguen intactos después de la demo")

const globalLog = await fs.readFile(path.join(directory, "out", "log.jsonl"), "utf8")
verificar(globalLog.trim().length > 0, "out/log.jsonl registra las llamadas")

console.log(fallos.length === 0 ? "\nDemo correcta." : `\n${fallos.length} verificaciones fallaron.`)
if (fallos.length > 0) process.exit(1)
