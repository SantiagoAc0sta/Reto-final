# Solución — agente de registro como proveedor

## 1. Problema

La analista administrativa transcribe, una solicitud a la vez, datos que ya están en el repositorio maestro y busca soportes a mano. El agente le deja el formulario lleno, el paquete de soportes y un borrador de correo, y se detiene antes de firmar o enviar.

## 2. Arquitectura

```text
web/ (chat)
    │  POST /api/chat
    ▼
src/server.ts
    │
    ▼
src/agent/loop.ts          tope de iteraciones, confirmación, redacción
    │
    ├── src/llm/gemini.ts  adaptador: enviar(mensajes, herramientas) → respuesta
    │
    └── src/tools/proveedor.ts
            │
            ├── fixtures/reto-01/   solo lectura
            └── out/<caso>/         formulario, paquete, logs
```

El comportamiento está en `agent/prompt.md`. El conocimiento del proceso está en `src/knowledge/registro-proveedor.md`. La ejecución está en `src/tools/`. El servidor solo lee esos archivos y despacha herramientas: un cambio de regla no obliga a tocar el ciclo HTTP.

`modulo/` empaqueta las mismas tres piezas. `modulo/tools/proveedor.ts` reexporta las funciones de `src/tools/proveedor.ts` (es la misma referencia, no una copia). `modulo/agent.md` y `modulo/skill/registro-proveedor/SKILL.md` repiten el prompt y el conocimiento con el frontmatter pedido. `demo.ts` falla si esas piezas divergen.

## 3. Ciclo del agente

Cada turno agrega el mensaje del usuario y llama al adaptador. Si la respuesta trae herramientas, el servidor valida los argumentos con zod, ejecuta la función y devuelve el JSON al modelo. Eso se repite hasta que el modelo responde en texto o hasta `MAX_ITERACIONES` (25). Al llegar al tope, el turno cierra con el resumen de lo que las herramientas alcanzaron a devolver.

La confirmación no depende de que el modelo "prometa" no enviar. `proveedor_simular_envio` solo escribe `ENVIO-SIMULADO.md` si el argumento `confirmado` es verdadero y, además, el servidor marcó `confirmacionExplicita` porque el turno anterior pidió confirmación y el mensaje actual es una aceptación corta (`envía`, `sí`, `confirmo`). En el turno de preparación esa marca es falsa, así que un `confirmado: true` inventado por el modelo se rechaza con `requiere confirmación explícita`. El front pinta ese estado cuando `needsConfirmation` viene en verdadero.

Toda llamada queda en el historial del chat y en `out/log.jsonl` y `out/<caso>/log.jsonl`, con `ts`, `herramienta`, `ok` y `resumen`. El resumen no copia números de cuenta.

## 4. Elección del modelo

Proveedor activo: OpenRouter, con el endpoint compatible con OpenAI `https://openrouter.ai/api/v1/chat/completions`, detrás de la interfaz `LlmAdapter`. El modelo por defecto es `openrouter/free` (`OPENROUTER_MODEL` lo cambia). Ese id enruta solo a modelos gratuitos y conserva el soporte de herramientas, así que un caso no cae en un modelo de pago. `openai/gpt-4o` se descartó porque cobra. El adaptador de Gemini sigue en `src/llm/gemini.ts` y se activa con `LLM_PROVIDER=google`.

Un caso hace cuatro llamadas de herramienta y unas pocas vueltas cortas. Con la variante gratuita el costo del modelo es cero, con cupo diario de OpenRouter. `MAX_ITERACIONES`, `MAX_TOKENS_SESION`, `MAX_TOKENS_RESPUESTA` y `LLM_TIMEOUT_MS` impiden que una sesión consuma la clave sin límite. La clave vive en `.env`, no en el front, ni en el repositorio, ni en los logs. Los mensajes de error se redactan si traen un patrón de clave.

## 5. Diseño del portal web

El formato `portal` no se automatiza. La herramienta responde `formato no soportado` y escribe `out/<caso>/valores-portal.md` con etiqueta, estado y valor para copiar.

Si hubiera que operarlo en una fase posterior:

- Estrategia: un navegador controlado (Playwright) abierto en la máquina de la analista, con una herramienta que rellena campos a partir del markdown y se detiene antes de enviar. Los límites son CAPTCHA, MFA, cambios de layout, iframes y campos que no tienen un nombre estable.
- Credenciales: las escribe la analista en el navegador o en un aviso del sistema operativo en el momento de uso. No entran al repositorio, ni al prompt, ni a los logs, ni a los argumentos que ve el modelo. El agente no recibe la contraseña.
- Reparto: el agente prepara los valores y puede señalar el campo. La persona ingresa usuario y contraseña, resuelve MFA o CAPTCHA y pulsa Enviar. Esas dos acciones no se delegan.

## 6. Decisiones y trade-offs

1. Recalcular el mapeo dentro de `generar_formulario` y `armar_paquete`, aunque el contrato recibe el objeto `mapeo`. La alternativa era confiar en los valores que reenvía el modelo. Se descartó porque un valor plausible que no está en el maestro no puede llegar al Excel. El argumento se valida para cumplir el contrato y para dejar constancia de cuántas etiquetas envió el modelo; las celdas salen del maestro.
2. Coincidencia exacta del glosario, sin ignorar mayúsculas ni tildes, en lugar de una distancia de edición. Un parecido entre "cuenta" y "contacto" escribiría el dato equivocado. Lo que no está en el glosario queda `faltante`.
3. Un solo proceso Node/Bun que sirve el HTML y la API, en lugar de un front React con build. El arranque es `bun src/server.ts` y no hay un segundo comando para el chat.
4. PDF generado con pdfkit, no un AcroForm. Los fixtures traen la lista de campos, no un PDF binario del cliente. El PDF reproduce etiqueta y valor en el orden de `plantilla-campos.json`.
5. Reexportar las herramientas hacia `modulo/` en lugar de copiar el archivo. Una copia se desfasa en el primer cambio. La demo compara la identidad de la función.

## 7. Supuestos

- La vigencia se compara con la fecha local de ejecución. Una fecha igual a hoy sigue vigente; solo una fecha anterior vence. `vigencia_hasta: null` no vence.
- El portal usa `plantilla-campos.json`, igual que el PDF.
- Las etiquetas ambiguas de este reto son "Identificación tributaria" y "Número de identificación fiscal". NIT, RUC y RTN no son ambiguas, pero si el país del cliente no es Colombia el campo se llena con el NIT y queda en `requiere_confirmacion` con la nota "identificador extranjero".
- El valor de "País" en el formulario es el país del proveedor en el maestro (`CO`), no el país del cliente.
- Un campo faltante no bloquea `listo_para_firma`. Un soporte ausente o vencido sí. Si el formulario todavía no se generó, el paquete tampoco queda listo.
- Los datos bancarios se escriben solo en las celdas que la plantilla pide. No entran al borrador, ni al envío simulado, ni al texto de la respuesta del chat.

## 8. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer la solicitud | Hecho | Más variantes de plantilla rota y etiquetas no previstas en el glosario. |
| HU-2 Mapear campos | Hecho | Un dueño del maestro y un glosario que crezca sin editar código. |
| HU-3 Excel | Hecho | Plantillas con celdas combinadas, validaciones y varias filas repetibles. |
| HU-3 PDF | Hecho | Respetar el PDF original del cliente cuando exista un binario, no solo la lista de campos. |
| HU-3 Portal | Hecho como diseño y como markdown copiable | El navegador controlado de la sección 5, con una persona en el envío. |
| HU-4 Paquete para firma | Hecho | Firma electrónica y envío real, ambos fuera de este reto y siempre con una persona. |
| HU-5 Errores | Hecho | Reintentos y una cola cuando haya más de una analista al mismo tiempo. |

El despliegue está preparado para Render con `render.yaml` y `Dockerfile`. La URL pública la asigna Render al crear el servicio; la clave de OpenRouter se carga en el panel, no en la imagen. En el plan gratuito el disco es efímero.

## 9. Uso de IA

Se usó Cursor (agente Auto) para leer el PRD, implementar el ciclo, las herramientas, el chat, `demo.ts` y esta memoria. Se descartó dejar que el modelo de chat inventara valores faltantes, embeber el prompt en el servidor y automatizar el portal con la contraseña del cliente dentro del contexto del modelo. Las herramientas quedaron como única fuente de los valores que se escriben.

## 10. Riesgos

- El modelo puede intentar completar un faltante o saltarse la confirmación. Mitigación: las herramientas recalculan desde el maestro y el envío simulado exige la marca del servidor, no solo el argumento del modelo.
- El maestro puede estar desactualizado. Mitigación en producción: un dueño del dato y una fecha de actualización visible en el checklist.
- Un soporte vence entre la preparación y la firma. Mitigación: la vigencia se calcula el día de la ejecución y el checklist la muestra.
- La clave puede filtrarse en un log del proveedor. Mitigación: variable de entorno, tope de uso y redacción de errores. Aun así, en producción la clave debería estar en un almacén del runtime, no en un archivo de la máquina de cada analista.
- El portal cambia de layout, pide CAPTCHA o MFA. Mitigación: la persona opera el navegador; el agente solo prepara los valores.

## Dependencias

- `zod` valida los argumentos de cada herramienta.
- `exceljs` escribe cada etiqueta y cada valor en la hoja y la celda indicadas.
- `pdfkit` genera el PDF en el orden de la plantilla, sin comprimir, para poder revisar el texto.
- El chat llama a OpenRouter por HTTP. `@google/genai` queda como adaptador alterno si `LLM_PROVIDER=google`. Cambiar de proveedor no toca el ciclo ni las herramientas.
- `dotenv` carga `.env` cuando el proceso no lo hace solo.
