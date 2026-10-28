const historial = document.querySelector("#historial")
const formulario = document.querySelector("#formulario")
const mensaje = document.querySelector("#mensaje")
const enviar = document.querySelector("#enviar")
const estado = document.querySelector("#estado")
const aviso = document.querySelector("#aviso")
const salud = document.querySelector("#salud")
const nueva = document.querySelector("#nueva")

const CLAVE = "registro-proveedor-sesion"
let sessionId = sessionStorage.getItem(CLAVE)

function nodo(tag, clase, texto) {
  const el = document.createElement(tag)
  if (clase) el.className = clase
  if (texto !== undefined) el.textContent = texto
  return el
}

function pintar(messages, needsConfirmation) {
  historial.replaceChildren()
  messages.forEach((item, index) => {
    const li = nodo("li", "burbuja")
    const ultimo = index === messages.length - 1
    if (item.role === "user") li.classList.add("usuario")
    if (item.role === "assistant" && ultimo && needsConfirmation) li.classList.add("pide")
    li.append(nodo("p", "rol", item.role === "user" ? "Analista" : "Agente"))
    li.append(nodo("p", "texto", item.content))
    if (item.toolCalls?.length) {
      const lista = nodo("div", "tools")
      for (const call of item.toolCalls) {
        const card = nodo("article", "tool")
        card.append(nodo("header", "", `${call.name} · ${call.ok ? "ok" : "error"}`))
        card.append(nodo("p", "", `Argumentos: ${JSON.stringify(call.args)}`))
        card.append(nodo("p", "", `Resultado: ${call.resumen}`))
        const detalle = document.createElement("details")
        detalle.append(nodo("summary", "", "Ver respuesta"))
        detalle.append(nodo("pre", "", call.resultado ?? ""))
        card.append(detalle)
        lista.append(card)
      }
      li.append(lista)
    }
    historial.append(li)
  })
  aviso.hidden = !needsConfirmation
  aviso.textContent = needsConfirmation
    ? "El agente pide confirmación. Responde “envía” solo si quieres generar ENVIO-SIMULADO.md. No se envía nada al cliente."
    : ""
  historial.scrollTop = historial.scrollHeight
}

async function cargarSalud() {
  try {
    const res = await fetch("/api/health")
    const data = await res.json()
    salud.textContent = data.configured
      ? `${data.provider} · ${data.model}`
      : `${data.provider} · ${data.model} · falta GEMINI_API_KEY`
  } catch {
    salud.textContent = "El servicio no responde"
  }
}

async function cargarHistorial() {
  if (!sessionId) return
  const res = await fetch(`/api/sessions/${sessionId}`)
  if (!res.ok) return
  const data = await res.json()
  pintar(data.messages ?? [], Boolean(data.needsConfirmation))
}

async function hablar(texto) {
  enviar.disabled = true
  estado.hidden = false
  historial.setAttribute("aria-busy", "true")
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: texto }),
    })
    const data = await res.json()
    if (!res.ok) {
      pintar([{ role: "assistant", content: data.error ?? "No se pudo enviar el mensaje.", toolCalls: [] }], false)
      return
    }
    sessionId = data.sessionId
    sessionStorage.setItem(CLAVE, sessionId)
    await cargarHistorial()
  } catch {
    pintar([{ role: "assistant", content: "No hubo conexión con el servidor. La página sigue disponible.", toolCalls: [] }], false)
  } finally {
    enviar.disabled = false
    estado.hidden = true
    historial.removeAttribute("aria-busy")
    mensaje.focus()
  }
}

formulario.addEventListener("submit", (event) => {
  event.preventDefault()
  const texto = mensaje.value.trim()
  if (!texto) return
  mensaje.value = ""
  void hablar(texto)
})

document.querySelectorAll("[data-caso]").forEach((boton) => {
  boton.addEventListener("click", () => {
    const caso = boton.getAttribute("data-caso")
    void hablar(
      `Procesa el caso "${caso}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`,
    )
  })
})

nueva.addEventListener("click", () => {
  sessionId = null
  sessionStorage.removeItem(CLAVE)
  historial.replaceChildren()
  aviso.hidden = true
  mensaje.focus()
})

void cargarSalud()
void cargarHistorial()
