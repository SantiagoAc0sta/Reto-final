import { promises as fs } from "node:fs"
import path from "node:path"
import type { CampoPlantilla, FormatoSalida, SolicitudLista, SoporteIndice } from "./tipos.ts"

export class ErrorHerramienta extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ErrorHerramienta"
  }
}

const CASO_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const AMBIGUAS = new Set(["identificacion tributaria", "numero de identificacion fiscal"])

const EQUIVALENTE_POR_PAIS: Record<string, string> = {
  CO: "NIT",
  EC: "RUC",
  PE: "RUC",
  PA: "RUC",
  HN: "RTN",
}

export function esCasoValido(caso: string): boolean {
  return CASO_VALIDO.test(caso)
}

export function fechaLocal(ahora = new Date()): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, "0")
  const dia = String(ahora.getDate()).padStart(2, "0")
  return `${ahora.getFullYear()}-${mes}-${dia}`
}

export function normalizarTexto(valor: string): string {
  return valor.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
}

export function esEtiquetaAmbigua(etiqueta: string): boolean {
  return AMBIGUAS.has(normalizarTexto(etiqueta))
}

export function equivalenteTributario(pais: string): string {
  return EQUIVALENTE_POR_PAIS[pais] ?? "identificador tributario del país"
}

export function rutaRelativa(directory: string, absoluta: string): string {
  return path.relative(directory, absoluta).split(path.sep).join("/")
}

export function leerRuta(origen: unknown, ruta: string): unknown {
  let actual: unknown = origen
  for (const parte of ruta.split(".")) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return undefined
    const registro = actual as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(registro, parte)) return undefined
    actual = registro[parte]
  }
  return actual
}

export function esEscalar(valor: unknown): valor is string | number | boolean {
  return typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean"
}

function raizFixtures(directory: string): string {
  return path.join(directory, "fixtures", "reto-01")
}

async function leerTexto(ruta: string): Promise<string> {
  try {
    const texto = await fs.readFile(ruta, "utf8")
    return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto
  } catch {
    throw new ErrorHerramienta(`No se encontró el archivo ${path.basename(ruta)}.`)
  }
}

export async function leerJson(ruta: string): Promise<unknown> {
  const texto = await leerTexto(ruta)
  try {
    return JSON.parse(texto) as unknown
  } catch {
    throw new ErrorHerramienta(`El archivo ${path.basename(ruta)} está corrupto y no se pudo leer.`)
  }
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

export async function cargarMaestro(directory: string): Promise<Record<string, unknown>> {
  const ruta = path.join(raizFixtures(directory), "repositorio", "maestro.json")
  const json = await leerJson(ruta)
  if (!esRegistro(json)) {
    throw new ErrorHerramienta("El repositorio maestro no tiene el formato esperado.")
  }
  return json
}

export async function cargarGlosario(directory: string): Promise<Map<string, string>> {
  const ruta = path.join(raizFixtures(directory), "glosario-campos.json")
  const json = await leerJson(ruta)
  if (!esRegistro(json)) {
    throw new ErrorHerramienta("El glosario de campos no tiene el formato esperado.")
  }
  const indice = new Map<string, string>()
  for (const [etiqueta, clave] of Object.entries(json)) {
    if (typeof clave === "string" && clave.length > 0) indice.set(normalizarTexto(etiqueta), clave)
  }
  return indice
}

export async function cargarIndiceSoportes(directory: string): Promise<SoporteIndice[]> {
  const ruta = path.join(raizFixtures(directory), "repositorio", "soportes", "index.json")
  const json = await leerJson(ruta)
  if (!Array.isArray(json)) {
    throw new ErrorHerramienta("El índice de soportes no tiene el formato esperado.")
  }
  const soportes: SoporteIndice[] = []
  for (const item of json) {
    if (!esRegistro(item)) throw new ErrorHerramienta("El índice de soportes tiene una fila inválida.")
    if (typeof item.tipo !== "string" || typeof item.archivo !== "string") {
      throw new ErrorHerramienta("El índice de soportes tiene una fila incompleta.")
    }
    if (item.archivo !== path.basename(item.archivo) || item.archivo.includes("..")) {
      throw new ErrorHerramienta("El índice de soportes apunta a una ruta no permitida.")
    }
    const vigencia = item.vigencia_hasta
    if (vigencia !== null && typeof vigencia !== "string") {
      throw new ErrorHerramienta("Una vigencia de soporte no es legible.")
    }
    soportes.push({
      tipo: item.tipo,
      archivo: item.archivo,
      vigencia_hasta: vigencia,
      descripcion: typeof item.descripcion === "string" ? item.descripcion : item.tipo,
    })
  }
  return soportes
}

function interpretarFormato(valor: unknown): FormatoSalida {
  if (valor === "xlsx" || valor === "pdf" || valor === "portal") return valor
  throw new ErrorHerramienta("formato no soportado")
}

function filaCelda(valor: unknown): CampoPlantilla {
  if (!esRegistro(valor)) throw new ErrorHerramienta("La plantilla Excel tiene una fila inválida.")
  const hoja = valor.hoja
  const celdaEtiqueta = valor.celda_etiqueta
  const etiqueta = valor.etiqueta
  const celdaValor = valor.celda_valor
  if (
    typeof hoja !== "string" ||
    typeof celdaEtiqueta !== "string" ||
    typeof etiqueta !== "string" ||
    typeof celdaValor !== "string" ||
    !hoja ||
    !celdaEtiqueta ||
    !etiqueta ||
    !celdaValor
  ) {
    throw new ErrorHerramienta("La plantilla Excel tiene celdas incompletas.")
  }
  return {
    etiqueta,
    obligatorio: null,
    hoja,
    celda_etiqueta: celdaEtiqueta,
    celda_valor: celdaValor,
  }
}

function filaCampo(valor: unknown): CampoPlantilla {
  if (!esRegistro(valor) || typeof valor.etiqueta !== "string" || !valor.etiqueta) {
    throw new ErrorHerramienta("La plantilla de campos tiene una fila inválida.")
  }
  return {
    etiqueta: valor.etiqueta,
    obligatorio: typeof valor.obligatorio === "boolean" ? valor.obligatorio : null,
    hoja: null,
    celda_etiqueta: null,
    celda_valor: null,
  }
}

async function leerPlantilla(dirCaso: string, formato: FormatoSalida): Promise<CampoPlantilla[]> {
  if (formato === "xlsx") {
    const json = await leerJson(path.join(dirCaso, "plantilla-celdas.json"))
    if (!Array.isArray(json)) throw new ErrorHerramienta("La plantilla Excel no es una lista de celdas.")
    return json.map((fila) => filaCelda(fila))
  }
  const json = await leerJson(path.join(dirCaso, "plantilla-campos.json"))
  if (!Array.isArray(json)) throw new ErrorHerramienta("La plantilla de campos no es una lista.")
  return json.map((fila) => filaCampo(fila))
}

async function leerSoportes(dirCaso: string): Promise<string[]> {
  const json = await leerJson(path.join(dirCaso, "soportes-exigidos.json"))
  if (!Array.isArray(json) || json.some((item) => typeof item !== "string")) {
    throw new ErrorHerramienta("La lista de soportes exigidos no es legible.")
  }
  return json
}

export async function leerSolicitud(directory: string, caso: string): Promise<SolicitudLista> {
  if (!esCasoValido(caso)) throw new ErrorHerramienta("El identificador de caso no es válido.")
  const dirCaso = path.join(raizFixtures(directory), "casos", caso)
  let stat
  try {
    stat = await fs.stat(dirCaso)
  } catch {
    throw new ErrorHerramienta(`No existe el caso "${caso}".`)
  }
  if (!stat.isDirectory()) throw new ErrorHerramienta(`No existe el caso "${caso}".`)

  const crudo = await leerJson(path.join(dirCaso, "solicitud.json"))
  if (!esRegistro(crudo) || typeof crudo.pais !== "string" || typeof crudo.cliente !== "string") {
    throw new ErrorHerramienta("La solicitud no tiene el país o el cliente.")
  }
  const formato = interpretarFormato(crudo.formato)
  const pais = crudo.pais
  let campos: CampoPlantilla[] = []
  let advertencia: string | null = null
  try {
    campos = await leerPlantilla(dirCaso, formato)
  } catch (error) {
    if (!(error instanceof ErrorHerramienta)) throw error
    advertencia = error.message
  }
  let soportes: string[] = []
  try {
    soportes = await leerSoportes(dirCaso)
  } catch (error) {
    if (!(error instanceof ErrorHerramienta)) throw error
    advertencia = [advertencia, error.message].filter((parte) => parte !== null).join(" ")
  }
  const requiere_confirmacion = campos.filter((campo) => esEtiquetaAmbigua(campo.etiqueta)).map((campo) => ({
    etiqueta: campo.etiqueta,
    motivo: "etiqueta ambigua",
    equivalente: equivalenteTributario(pais),
  }))
  return {
    pais,
    cliente: crudo.cliente,
    formato,
    asunto: typeof crudo.asunto === "string" ? crudo.asunto : "",
    de: typeof crudo.de === "string" ? crudo.de : "",
    campos,
    soportes,
    requiere_confirmacion,
    advertencia,
  }
}

export function directorioSalida(directory: string, caso: string): string {
  if (!esCasoValido(caso)) throw new ErrorHerramienta("El identificador de caso no es válido.")
  return path.join(directory, "out", caso)
}

export function directorioSoportes(directory: string): string {
  return path.join(raizFixtures(directory), "repositorio", "soportes")
}
