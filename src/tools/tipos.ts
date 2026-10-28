export interface ToolCtx {
  directory: string
  sessionId: string
  confirmacionExplicita?: boolean
}

export type FormatoSalida = "xlsx" | "pdf" | "portal"
export type EstadoCampo = "lleno" | "faltante" | "requiere_confirmacion"
export type EstadoSoporte = "presente" | "ausente" | "vencido"

export interface CampoPlantilla {
  etiqueta: string
  obligatorio: boolean | null
  hoja: string | null
  celda_etiqueta: string | null
  celda_valor: string | null
}

export interface ConfirmacionEtiqueta {
  etiqueta: string
  motivo: string
  equivalente: string
}

export interface SolicitudLista {
  pais: string
  cliente: string
  formato: FormatoSalida
  asunto: string
  de: string
  campos: CampoPlantilla[]
  soportes: string[]
  requiere_confirmacion: ConfirmacionEtiqueta[]
  advertencia: string | null
}

export interface CampoMapeado {
  etiqueta: string
  estado: EstadoCampo
  clave: string | null
  valor: string | number | boolean | null
  confianza: number
  nota: string | null
  equivalente_pais: string | null
}

export interface MapeoCampos {
  llenos: CampoMapeado[]
  faltantes: CampoMapeado[]
  requiere_confirmacion: CampoMapeado[]
}

export interface MapeoRecibido {
  llenos: Array<{ etiqueta: string }>
  faltantes: Array<{ etiqueta: string }>
  requiere_confirmacion: Array<{ etiqueta: string }>
}

export interface ItemChecklist {
  tipo: string
  estado: EstadoSoporte
  vigencia_hasta: string | null
  archivo: string | null
}

export interface ResultadoFormulario {
  ruta: string
  formato: FormatoSalida
  aviso: string | null
  etiquetas_recibidas: number
  valores_recalculados: true
}

export interface PaqueteListo {
  ruta: string
  listo_para_firma: boolean
  checklist: ItemChecklist[]
  faltantes: string[]
  requiere_confirmacion: string[]
  bloqueos: string[]
  formulario_incluido: boolean
}

export interface SoporteIndice {
  tipo: string
  archivo: string
  vigencia_hasta: string | null
  descripcion: string
}
