export interface LlmToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface LlmMessage {
  role: "user" | "assistant" | "tool"
  content: string
  toolCalls?: LlmToolCall[]
  toolName?: string
  toolCallId?: string
  raw?: unknown
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LlmResponse {
  text: string
  toolCalls: LlmToolCall[]
  tokens: number
  raw?: unknown
}

export interface LlmAdapter {
  readonly provider: string
  readonly model: string
  enviar(sistema: string, mensajes: LlmMessage[], herramientas: ToolSpec[]): Promise<LlmResponse>
}
