import { createWriteStream } from "node:fs"
import { promises as fs } from "node:fs"
import path from "node:path"
import ExcelJS from "exceljs"
import PDFDocument from "pdfkit"
import {
  ErrorHerramienta,
  cargarIndiceSoportes,
  cargarMaestro,
  directorioSalida,
  directorioSoportes,
  esEscalar,
  fechaLocal,
  leerSolicitud,
  rutaRelativa,
} from "./io.ts"
import { mapearCampos, secretosBancarios } from "./mapeo.ts"
import type {
  CampoMapeado,
  CampoPlantilla,
  ItemChecklist,
  MapeoRecibido,
  PaqueteListo,
  ResultadoFormulario,
  SolicitudLista,
  ToolCtx,
} from "./tipos.ts"

function indiceMapeo(campos: CampoMapeado[]): Map<string, CampoMapeado> {
  const indice = new Map<string, CampoMapeado>()
  for (const campo of campos) indice.set(campo.etiqueta, campo)
  return indice
}

function valorVisible(campo: CampoMapeado | undefined): string {
  if (!campo || campo.estado === "faltante" || campo.valor === null) return "(sin dato en el maestro)"
  const base = String(campo.valor)
  if (campo.estado === "requiere_confirmacion") {
    const nota = campo.nota ?? "requiere confirmacion"
    return `${base} [${nota}]`
  }
  return base
}

function valorCelda(campo: CampoMapeado | undefined): string | number | boolean {
  if (!campo || campo.estado === "faltante" || campo.valor === null) return ""
  return campo.valor
}

async function escribirXlsx(campos: CampoPlantilla[], mapeados: Map<string, CampoMapeado>, ruta: string): Promise<void> {
  const libro = new ExcelJS.Workbook()
  const hojas = new Map<string, ExcelJS.Worksheet>()
  for (const campo of campos) {
    if (!campo.hoja || !campo.celda_etiqueta || !campo.celda_valor) {
      throw new ErrorHerramienta("La plantilla Excel tiene celdas incompletas.")
    }
    let hoja = hojas.get(campo.hoja)
    if (!hoja) {
      hoja = libro.addWorksheet(campo.hoja)
      hojas.set(campo.hoja, hoja)
    }
    hoja.getCell(campo.celda_etiqueta).value = campo.etiqueta
    hoja.getCell(campo.celda_valor).value = valorCelda(mapeados.get(campo.etiqueta))
  }
  await libro.xlsx.writeFile(ruta)
}

function escribirPdf(
  solicitud: SolicitudLista,
  campos: CampoPlantilla[],
  mapeados: Map<string, CampoMapeado>,
  ruta: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "A4", compress: false })
    const stream = createWriteStream(ruta)
    doc.pipe(stream)
    doc.fontSize(18).text("Formulario de registro de proveedor")
    doc.moveDown(0.4)
    doc.fontSize(11).text(`Cliente: ${solicitud.cliente}`)
    doc.text(`País del cliente: ${solicitud.pais}`)
    doc.moveDown()
    for (const campo of campos) {
      doc.font("Helvetica-Bold").fontSize(11).text(campo.etiqueta)
      doc.font("Helvetica").fontSize(11).text(valorVisible(mapeados.get(campo.etiqueta)))
      doc.moveDown(0.4)
    }
    doc.end()
    stream.on("finish", () => resolve())
    stream.on("error", () => reject(new ErrorHerramienta("No se pudo escribir el PDF.")))
  })
}

function escaparTabla(valor: string): string {
  return valor.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

async function escribirPortal(
  solicitud: SolicitudLista,
  campos: CampoPlantilla[],
  mapeados: Map<string, CampoMapeado>,
  ruta: string,
): Promise<void> {
  const lineas = [
    "# Valores para el portal",
    "",
    "formato no soportado",
    "",
    `Cliente: ${solicitud.cliente}`,
    `País del cliente: ${solicitud.pais}`,
    "",
    "El alta en el portal no se automatiza. Estos valores salen del maestro y están listos para copiar. Las credenciales y el clic en Enviar los hace una persona.",
    "",
    "| Etiqueta | Estado | Valor | Nota |",
    "| --- | --- | --- | --- |",
  ]
  for (const campo of campos) {
    const mapeado = mapeados.get(campo.etiqueta)
    const estado = mapeado?.estado ?? "faltante"
    const valor = mapeado && mapeado.estado !== "faltante" && mapeado.valor !== null ? String(mapeado.valor) : ""
    const nota = mapeado?.nota ?? ""
    lineas.push(`| ${escaparTabla(campo.etiqueta)} | ${estado} | ${escaparTabla(valor)} | ${escaparTabla(nota)} |`)
  }
  lineas.push("")
  await fs.writeFile(ruta, lineas.join("\n"), "utf8")
}

export async function generarFormulario(
  directory: string,
  caso: string,
  mapeoRecibido: MapeoRecibido,
): Promise<ResultadoFormulario> {
  const solicitud = await leerSolicitud(directory, caso)
  if (solicitud.campos.length === 0) {
    throw new ErrorHerramienta(solicitud.advertencia ?? "No hay campos de plantilla para generar el formulario.")
  }
  const mapeo = await mapearCampos(directory, caso, [])
  const mapeados = indiceMapeo([...mapeo.llenos, ...mapeo.faltantes, ...mapeo.requiere_confirmacion])
  const dir = directorioSalida(directory, caso)
  await fs.mkdir(dir, { recursive: true })
  for (const nombre of ["formulario.xlsx", "formulario.pdf", "valores-portal.md"]) {
    await fs.rm(path.join(dir, nombre), { force: true })
  }
  const etiquetasRecibidas =
    mapeoRecibido.llenos.length + mapeoRecibido.faltantes.length + mapeoRecibido.requiere_confirmacion.length

  if (solicitud.formato === "xlsx") {
    const absoluta = path.join(dir, "formulario.xlsx")
    await escribirXlsx(solicitud.campos, mapeados, absoluta)
    return {
      ruta: rutaRelativa(directory, absoluta),
      formato: "xlsx",
      aviso: null,
      etiquetas_recibidas: etiquetasRecibidas,
      valores_recalculados: true,
    }
  }
  if (solicitud.formato === "pdf") {
    const absoluta = path.join(dir, "formulario.pdf")
    await escribirPdf(solicitud, solicitud.campos, mapeados, absoluta)
    return {
      ruta: rutaRelativa(directory, absoluta),
      formato: "pdf",
      aviso: null,
      etiquetas_recibidas: etiquetasRecibidas,
      valores_recalculados: true,
    }
  }
  const absoluta = path.join(dir, "valores-portal.md")
  await escribirPortal(solicitud, solicitud.campos, mapeados, absoluta)
  return {
    ruta: rutaRelativa(directory, absoluta),
    formato: "portal",
    aviso: "formato no soportado",
    etiquetas_recibidas: etiquetasRecibidas,
    valores_recalculados: true,
  }
}

function sinDatosBancarios(texto: string, maestro: Record<string, unknown>): string {
  let salida = texto
  for (const secreto of secretosBancarios(maestro)) salida = salida.split(secreto).join("[omitido]")
  return salida
}

function construirChecklistMd(
  caso: string,
  hoy: string,
  items: ItemChecklist[],
  faltantes: string[],
  confirmar: string[],
  listo: boolean,
): string {
  const filas = items.map((item) => {
    const vigencia = item.vigencia_hasta ?? "sin vencimiento"
    const archivo = item.archivo ?? "—"
    return `| ${item.tipo} | ${item.estado} | ${vigencia} | ${archivo} |`
  })
  const listaFaltantes = faltantes.length > 0 ? faltantes.map((item) => `- ${item}`).join("\n") : "- Ninguno"
  const listaConfirmar = confirmar.length > 0 ? confirmar.map((item) => `- ${item}`).join("\n") : "- Ninguno"
  return [
    `# Checklist ${caso}`,
    "",
    `Fecha de corte: ${hoy}`,
    `Listo para firma: ${listo ? "sí" : "no"}`,
    "",
    "Los campos faltantes no bloquean la firma. Un soporte ausente o vencido sí la bloquea.",
    "",
    "| Tipo | Estado | Vigencia | Archivo |",
    "| --- | --- | --- | --- |",
    ...filas,
    "",
    "## Campos faltantes",
    "",
    listaFaltantes,
    "",
    "## Requiere confirmacion",
    "",
    listaConfirmar,
    "",
  ].join("\n")
}

function construirBorrador(
  solicitud: SolicitudLista,
  razonSocial: string,
  items: ItemChecklist[],
  faltantes: string[],
): string {
  const incluidos = items.filter((item) => item.estado === "presente")
  const bloqueados = items.filter((item) => item.estado !== "presente")
  const lineaSoporte = (item: ItemChecklist) =>
    `- ${item.tipo} (${item.estado}${item.vigencia_hasta ? `, vigencia hasta ${item.vigencia_hasta}` : ""})`
  return [
    "# Borrador de correo",
    "",
    `Para: ${solicitud.de}`,
    `Asunto: Re: ${solicitud.asunto}`,
    "",
    "Estimados,",
    "",
    `Adjuntamos el formulario de registro de ${razonSocial} y los soportes disponibles para la firma del representante legal. Este texto es un borrador: no se ha enviado.`,
    "",
    "Soportes incluidos:",
    incluidos.length > 0 ? incluidos.map(lineaSoporte).join("\n") : "- Ninguno vigente",
    "",
    "Soportes que todavía no se pueden usar:",
    bloqueados.length > 0 ? bloqueados.map(lineaSoporte).join("\n") : "- Ninguno",
    "",
    "Campos sin dato en el maestro:",
    faltantes.length > 0 ? faltantes.map((item) => `- ${item}`).join("\n") : "- Ninguno",
    "",
    "Quedamos atentos a la firma del representante legal antes de cualquier envío.",
    "",
    "Cordialmente,",
    "Analista administrativa",
    razonSocial,
    "",
  ].join("\n")
}

export async function armarPaquete(directory: string, caso: string): Promise<PaqueteListo> {
  const solicitud = await leerSolicitud(directory, caso)
  const maestro = await cargarMaestro(directory)
  const mapeo = await mapearCampos(directory, caso, [])
  const indice = await cargarIndiceSoportes(directory)
  const hoy = fechaLocal()
  const dirCaso = directorioSalida(directory, caso)
  const paqueteDir = path.join(dirCaso, "paquete")
  await fs.rm(paqueteDir, { recursive: true, force: true })
  await fs.mkdir(paqueteDir, { recursive: true })

  const checklist: ItemChecklist[] = []
  for (const tipo of solicitud.soportes) {
    const soporte = indice.find((item) => item.tipo === tipo)
    if (!soporte) {
      checklist.push({ tipo, estado: "ausente", vigencia_hasta: null, archivo: null })
      continue
    }
    const origen = path.join(directorioSoportes(directory), soporte.archivo)
    let existe = false
    try {
      const stat = await fs.stat(origen)
      existe = stat.isFile()
    } catch {
      existe = false
    }
    if (!existe) {
      checklist.push({ tipo, estado: "ausente", vigencia_hasta: soporte.vigencia_hasta, archivo: null })
      continue
    }
    await fs.copyFile(origen, path.join(paqueteDir, soporte.archivo))
    const vencido = soporte.vigencia_hasta !== null && soporte.vigencia_hasta < hoy
    checklist.push({
      tipo,
      estado: vencido ? "vencido" : "presente",
      vigencia_hasta: soporte.vigencia_hasta,
      archivo: soporte.archivo,
    })
  }

  const nombresFormulario = ["formulario.xlsx", "formulario.pdf", "valores-portal.md"]
  let formularioIncluido = false
  for (const nombre of nombresFormulario) {
    const origen = path.join(dirCaso, nombre)
    try {
      await fs.copyFile(origen, path.join(paqueteDir, nombre))
      formularioIncluido = true
    } catch {
      // El formulario de otro formato no existe. Se intenta el siguiente.
    }
  }

  const bloqueos = checklist
    .filter((item) => item.estado === "ausente" || item.estado === "vencido")
    .map((item) => `${item.tipo} ${item.estado}`)
  if (!formularioIncluido) bloqueos.push("formulario ausente")
  const faltantes = mapeo.faltantes.map((campo) => campo.etiqueta)
  const confirmar = mapeo.requiere_confirmacion.map((campo) =>
    campo.nota ? `${campo.etiqueta}: ${campo.nota}` : campo.etiqueta,
  )
  const listo = bloqueos.length === 0
  const razon = esEscalar(maestro.razon_social) ? String(maestro.razon_social) : "Periferia IT Group"
  const checklistMd = construirChecklistMd(caso, hoy, checklist, faltantes, confirmar, listo)
  const borrador = sinDatosBancarios(construirBorrador(solicitud, razon, checklist, faltantes), maestro)
  await fs.writeFile(path.join(paqueteDir, "checklist.md"), checklistMd, "utf8")
  await fs.writeFile(path.join(paqueteDir, "borrador-correo.md"), borrador, "utf8")

  return {
    ruta: rutaRelativa(directory, paqueteDir),
    listo_para_firma: listo,
    checklist,
    faltantes,
    requiere_confirmacion: confirmar,
    bloqueos,
    formulario_incluido: formularioIncluido,
  }
}

export async function simularEnvio(directory: string, caso: string, confirmado: boolean, ctx: ToolCtx): Promise<{ ruta: string }> {
  if (ctx.confirmacionExplicita === true && !confirmado) {
    throw new ErrorHerramienta("El usuario ya confirmó. Llama de nuevo con confirmado en true.")
  }
  if (!confirmado || ctx.confirmacionExplicita === false) {
    throw new ErrorHerramienta("requiere confirmación explícita")
  }
  const dirCaso = directorioSalida(directory, caso)
  await fs.mkdir(dirCaso, { recursive: true })
  const paqueteDir = path.join(dirCaso, "paquete")
  let archivos: string[] = []
  try {
    archivos = (await fs.readdir(paqueteDir)).sort()
  } catch {
    archivos = []
  }
  const maestro = await cargarMaestro(directory)
  const cuerpo = sinDatosBancarios(
    [
      "# Envío simulado",
      "",
      `Caso: ${caso}`,
      "Confirmación: el usuario autorizó este turno.",
      "Resultado: no se envió correo ni se cargó un portal. Este archivo solo documenta la simulación.",
      "",
      "Archivos del paquete:",
      archivos.length > 0 ? archivos.map((nombre) => `- ${nombre}`).join("\n") : "- No hay paquete generado.",
      "",
    ].join("\n"),
    maestro,
  )
  const absoluta = path.join(dirCaso, "ENVIO-SIMULADO.md")
  await fs.writeFile(absoluta, cuerpo, "utf8")
  return { ruta: rutaRelativa(directory, absoluta) }
}
