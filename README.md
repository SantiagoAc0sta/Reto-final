# Registro como proveedor

Agente conversacional que prepara el registro de Periferia como proveedor. Lee la solicitud, cruza los campos con el maestro, genera el formulario y arma el paquete de firma. No firma ni envía.

## Arranque local

```bash
bun install
Copy-Item .env.example .env
```

En `.env`, completa `OPENROUTER_API_KEY`. La clave se lee solo en el servidor. El modelo por defecto es `openrouter/free`: OpenRouter elige un modelo gratuito que acepte herramientas. `openai/gpt-4o` no es gratuito.

```bash
bun src/server.ts
```

Abre [http://localhost:3000](http://localhost:3000). El mismo comando levanta el chat y la API.

## Demo sin modelo

`demo.ts` ejecuta las herramientas sobre los cuatro casos oficiales, sin clave y sin llamar al modelo. Limpia `out/` al inicio y no modifica `fixtures/`.

```bash
bun install
bun run demo.ts
```

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ sessionId, reply, toolCalls, needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial de la sesión |
| `GET` | `/api/health` | `{ ok: true, provider, model }` |

`toolCalls` incluye nombre, argumentos y un resumen. Si `needsConfirmation` es verdadero, el chat resalta que hace falta una respuesta explícita antes del envío simulado.

## Variables

| Variable | Uso |
|---|---|
| `OPENROUTER_API_KEY` | Clave de OpenRouter. Solo en el entorno del backend. |
| `OPENROUTER_MODEL` | Modelo. Por defecto `openrouter/free`. |
| `LLM_PROVIDER` | `openrouter` o `google`. Por defecto `openrouter`. |
| `GEMINI_API_KEY` | Clave de Gemini, solo si `LLM_PROVIDER=google`. |
| `GEMINI_MODEL` | Modelo de Gemini. Por defecto `gemini-2.5-flash`. |
| `PORT` | Puerto HTTP. Por defecto `3000`. |
| `MAX_ITERACIONES` | Tope de ciclos herramienta-modelo por turno. Por defecto `25`. |
| `MAX_TOKENS_SESION` | Tope aproximado de tokens por sesión. |
| `MAX_TOKENS_RESPUESTA` | Tope de tokens de cada respuesta del modelo. |
| `LLM_TIMEOUT_MS` | Tiempo máximo de espera al modelo. |

## Prueba sugerida

En una sesión nueva:

```text
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles
faltan, si el paquete está listo para firma y qué soportes debo actualizar.
No envíes nada todavía.
```

Un mensaje posterior `envía` escribe solo `out/ec-corp-andina/ENVIO-SIMULADO.md`.

## Despliegue en Render

El blueprint está en `render.yaml` y la imagen en `Dockerfile`. Render inyecta `PORT` y `RENDER_EXTERNAL_URL`. El proceso escucha en `0.0.0.0`. La clave no va en el repositorio: el blueprint la deja vacía para escribirla en el panel.

1. Sube este proyecto a un repositorio de GitHub. No incluyas `.env` ni `out/`.
2. En Render, elige **New** y luego **Blueprint**. Conecta el repositorio.
3. Cuando pida `OPENROUTER_API_KEY`, pega la clave de OpenRouter.
4. Al terminar, la URL pública es la del servicio, del tipo `https://registro-proveedor.onrender.com`. El chequeo de salud es `/api/health`.

En el plan gratuito el servicio se duerme si nadie entra, y `out/` se borra en cada despliegue o reinicio. Las sesiones y los formularios generados no persisten.

## Fixtures

`fixtures/reto-01/` es una copia de solo lectura de los JSON oficiales. El agente no los modifica.
