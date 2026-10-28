import {
  cargarGlosario,
  cargarMaestro,
  equivalenteTributario,
  esEscalar,
  esEtiquetaAmbigua,
  leerRuta,
  leerSolicitud,
  normalizarTexto,
} from "./io.ts"
import type { CampoMapeado, MapeoCampos } from "./tipos.ts"

function campoBase(etiqueta: string): CampoMapeado {
  return {
    etiqueta,
    estado: "faltante",
    clave: null,
    valor: null,
    confianza: 0,
    nota: null,
    equivalente_pais: null,
  }
}

export function clasificarEtiqueta(
  etiqueta: string,
  pais: string,
  maestro: Record<string, unknown>,
  glosario: Map<string, string>,
): CampoMapeado {
  const campo = campoBase(etiqueta)
  const clave = glosario.get(normalizarTexto(etiqueta))
  if (!clave) {
    campo.nota = "sin sinónimo en el glosario"
    return campo
  }
  campo.clave = clave
  const crudo = leerRuta(maestro, clave)
  const valor = esEscalar(crudo) && crudo !== "" ? crudo : null
  if (valor === null) {
    campo.nota = "la clave del glosario no tiene valor en el maestro"
    return campo
  }

  if (clave === "nit") {
    const equivalente = equivalenteTributario(pais)
    campo.equivalente_pais = equivalente
    campo.valor = valor
    const coincideConPais = normalizarTexto(etiqueta) === normalizarTexto(equivalente)
    if (pais !== "CO") {
      campo.estado = "requiere_confirmacion"
      campo.confianza = 0.75
      campo.nota = "identificador extranjero"
      return campo
    }
    if (!coincideConPais || esEtiquetaAmbigua(etiqueta)) {
      campo.estado = "requiere_confirmacion"
      campo.confianza = 0.7
      campo.nota = `etiqueta ambigua; el equivalente en ${pais} es ${equivalente}`
      return campo
    }
  }

  if (campo.estado === "requiere_confirmacion") return campo
  campo.valor = valor
  campo.confianza = 1
  campo.estado = "lleno"
  campo.nota = null
  campo.equivalente_pais = null
  return campo
}

export async function mapearCampos(directory: string, caso: string, etiquetas: string[]): Promise<MapeoCampos> {
  const solicitud = await leerSolicitud(directory, caso)
  const maestro = await cargarMaestro(directory)
  const glosario = await cargarGlosario(directory)
  const pedidas = etiquetas.length > 0 ? etiquetas : solicitud.campos.map((campo) => campo.etiqueta)
  const mapeo: MapeoCampos = { llenos: [], faltantes: [], requiere_confirmacion: [] }
  for (const etiqueta of pedidas) {
    const campo = clasificarEtiqueta(etiqueta, solicitud.pais, maestro, glosario)
    if (campo.estado === "lleno") mapeo.llenos.push(campo)
    else if (campo.estado === "requiere_confirmacion") mapeo.requiere_confirmacion.push(campo)
    else mapeo.faltantes.push(campo)
  }
  return mapeo
}

export function secretosBancarios(maestro: Record<string, unknown>): string[] {
  const banco = maestro.banco
  if (typeof banco !== "object" || banco === null || Array.isArray(banco)) return []
  const registro = banco as Record<string, unknown>
  return [registro.nombre, registro.numero_cuenta, registro.swift].filter(
    (valor): valor is string => typeof valor === "string" && valor.length > 3,
  )
}

export function ocultarDatosBancarios(texto: string, maestro: Record<string, unknown>): string {
  let salida = texto
  for (const secreto of secretosBancarios(maestro)) {
    salida = salida.split(secreto).join("[dato bancario solo en el formulario]")
  }
  return salida
}
