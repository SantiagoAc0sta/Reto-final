export function redactarClave(texto: string): string {
  return texto
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redactado]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redactado]")
    .replace(/GEMINI_API_KEY\s*[=:]\s*\S+/gi, "GEMINI_API_KEY=[redactado]")
    .replace(/OPENROUTER_API_KEY\s*[=:]\s*\S+/gi, "OPENROUTER_API_KEY=[redactado]")
    .replace(/sk-or-v1-[0-9A-Za-z]+/g, "[redactado]")
}
