import { ok, err, type Result } from "../../infra/result";
import { dialogueToolOutputSchema, dialogueToolOutputJsonSchema, makeUsage,
         type DialogueProviderResult, type ProviderError, type ProviderResult,
         type ProviderErrorMeta, type NormalizedUsage } from "../providerContract";
import type { DialogueProvider, DialogueRequest, DialogueGenerationOptions } from "../types";
import type { CharacterRank } from "../../content/schemas";
import type { AudienceRole } from "../reactionTypes";
import { compilePromptPayload } from "../promptPayload";

const TOOL_NAME = "emit_dialogue_line";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_TOKENS = 800;

// ── WORLD_RULES_TEXT — exactly 12 rules ──────────────────────────────────────

export const WORLD_RULES_TEXT = `
你是一位宫廷叙事引擎，负责生成单个角色在一轮对话中的中文台词。

1. 只生成 speaker 的本轮台词，严禁替玩家发言或叙述引擎行为。
2. 严格遵守 currentScene.directive 指定的本轮行为目标，不得自行改变。
3. 使用 speaker.standing.selfRefs 中适合当前场合的自称（面向皇帝用 toPlayer；正式场合用 formal）。
4. 对皇帝称"陛下"；不得使用 etiquette 中 forbiddenTerms 所列称谓。
5. 不得在台词中透出 JSON 字段名、规则说明或内部 ID。
6. 不得凭空引入 payload 未提供的事实或事件。
7. proposedClaims 只记录台词中明确表达的事实，不填隐含信息。
8. 引用 relevantMemories 中记忆的 claim 必须填写对应 memory id 在 sourceRefs（如 { kind: "memory", id: "..." }）。
9. 不确定信息不得用断言语气（"确实"、"一定"），应用 "听说"、"好像" 等。
10. forbiddenClaims 中的事实内容一律不在台词中出现。
11. allowedClaims 为空不代表禁止问候、情绪表达或主观感受。
12. 台词长度适中，符合人物身份与场景私密度（audience.privacy）。
`.trim();

// ── renderEtiquetteBlock ──────────────────────────────────────────────────────

export function renderEtiquetteBlock(
  etiquette: DialogueRequest["etiquette"],
  speakerSelfRefs: CharacterRank["selfRefs"],
  audienceRole: AudienceRole,
): string {
  return [
    `[礼仪约束]`,
    `允许称谓（allowedTerms）：${etiquette.allowedTerms.join("、") || "（无）"}`,
    `禁用称谓（forbiddenTerms）：${etiquette.forbiddenTerms.join("、") || "（无）"}`,
    `称谓规则（addressRules）：`,
    ...etiquette.addressRules.map(
      (r) => `  - ${r.rank}：自称 ${r.selfRefs.toPlayer.join("/")}，称对方 ${r.addressedAs}`,
    ),
    `speaker 对皇帝自称（selfRefs.toPlayer）：${speakerSelfRefs.toPlayer.join("、")}`,
    `受众身份（audienceRole）：${audienceRole}`,
  ].join("\n");
}

export interface AnthropicToolUseResponse {
  id?: string;
  stop_reason: string;
  content: { type: string; name?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface AnthropicRequestPayload {
  model: string; max_tokens: number;
  system: AnthropicSystemBlock[];
  messages: { role: "user"; content: string }[];
  tools: { name: string; description: string; strict: true; input_schema: unknown }[];
  tool_choice: { type: "tool"; name: string; disable_parallel_tool_use: true };
}
export interface TransportOptions { signal?: AbortSignal; }
export interface AnthropicTransportResult { message: AnthropicToolUseResponse; requestId?: string; }
/** Structured failure — transport classifies HTTP/network itself; adapter never inspects raw Error shapes. */
export interface AnthropicTransportFailure { kind: "http" | "network" | "offline"; status?: number; requestId?: string; retryAfterMs?: number; message?: string; }
/** Injected seam. send NEVER throws for HTTP/network — returns a Result. Real SDK transport is a separate relay PR. */
export interface AnthropicTransport { send(payload: AnthropicRequestPayload, options?: TransportOptions): Promise<Result<AnthropicTransportResult, AnthropicTransportFailure>>; }

export function buildAnthropicToolRequest(request: DialogueRequest, model: string, options?: DialogueGenerationOptions): AnthropicRequestPayload {
  const payload = compilePromptPayload(request);
  return {
    model, max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: [
      { type: "text", text: WORLD_RULES_TEXT, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: renderEtiquetteBlock(
          request.etiquette,
          payload.speaker.standing.selfRefs,
          payload.audience.targetRole,
        ),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: JSON.stringify(payload) }],
    tools: [{ name: TOOL_NAME, description: "提交角色台词及其结构化事实。", strict: true, input_schema: dialogueToolOutputJsonSchema }],
    tool_choice: { type: "tool", name: TOOL_NAME, disable_parallel_tool_use: true },
  };
}

const TIMEOUT = Symbol("timeout");
const CANCEL = Symbol("cancel");

export function createAnthropicProvider(opts: { model: string; transport: AnthropicTransport }): DialogueProvider {
  return {
    id: `anthropic:${opts.model}`,
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: true, batch: false },
    async generate(request, options): Promise<ProviderResult<DialogueProviderResult>> {
      if (options?.signal?.aborted) return err<ProviderError>({ kind: "cancelled", retryable: false }); // pre-aborted
      const payload = buildAnthropicToolRequest(request, opts.model, options);
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let resolveCancel!: (v: typeof CANCEL) => void;
      const deadline = new Promise<typeof TIMEOUT>((res) => { timer = setTimeout(() => res(TIMEOUT), timeoutMs); });
      const cancel = new Promise<typeof CANCEL>((res) => { resolveCancel = res; });
      const onCallerAbort = () => resolveCancel(CANCEL);
      options?.signal?.addEventListener("abort", onCallerAbort, { once: true });
      try {
        // Promise.race guarantees the deadline/cancel even if the transport ignores the signal.
        const winner = await Promise.race([opts.transport.send(payload, { signal: controller.signal }), deadline, cancel]);
        if (winner === TIMEOUT) { controller.abort(); return err<ProviderError>({ kind: "transport", retryable: true, cause: "timeout" }); }
        if (winner === CANCEL) { controller.abort(); return err<ProviderError>({ kind: "cancelled", retryable: false }); }
        if (!winner.ok) return err(classifyTransportFailure(winner.error));
        return parseToolUse(winner.value, request, opts.model);
      } finally {
        options?.signal?.removeEventListener("abort", onCallerAbort); // remove even when transport returns first
        if (timer) clearTimeout(timer);
      }
    },
  };
}

function extractAnthropicUsage(m: AnthropicToolUseResponse): NormalizedUsage | undefined {
  const u = m.usage;
  if (!u) return undefined;
  // Pass raw values (no `?? 0`): makeUsage returns undefined if a required field
  // is absent, so a partial usage object isn't faked into a priced zero-cost run.
  return makeUsage({
    uncachedInputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    ...(u.cache_read_input_tokens !== undefined ? { cacheReadTokens: u.cache_read_input_tokens } : {}),
    ...(u.cache_creation_input_tokens !== undefined ? { cacheCreationTokens: u.cache_creation_input_tokens } : {}),
  });
}

function parseToolUse(res: AnthropicTransportResult, request: DialogueRequest, model: string): ProviderResult<DialogueProviderResult> {
  const m = res.message;
  const usage = extractAnthropicUsage(m);
  const meta: ProviderErrorMeta = {
    ...(res.requestId !== undefined ? { requestId: res.requestId } : {}),
    ...(usage ? { usage } : {}),
  };
  switch (m.stop_reason) {
    case "tool_use": break;
    case "max_tokens": return err<ProviderError>({ kind: "protocol", retryable: true, cause: "truncated", meta });
    case "refusal": return err<ProviderError>({ kind: "refused", retryable: false, meta });
    case "pause_turn": return err<ProviderError>({ kind: "protocol", retryable: false, cause: "pause_turn", meta }); // v1: not a plain retry
    case "model_context_window_exceeded": return err<ProviderError>({ kind: "config", retryable: false, cause: "request_too_large", meta });
    default: return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  }
  const blocks = m.content.filter((b) => b.type === "tool_use");
  if (blocks.length === 0) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  if (blocks.length > 1) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "multiple_tool_calls", meta });
  if (blocks[0]!.name !== TOOL_NAME) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "wrong_tool", meta });
  const parsed = dialogueToolOutputSchema.safeParse(blocks[0]!.input);
  if (!parsed.success) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta });
  return ok<DialogueProviderResult>({
    speaker: request.speakerId,
    text: parsed.data.text,
    choices: [],
    proposedClaims: parsed.data.proposedClaims,
    mentionedContextRefs: parsed.data.mentionedContextRefs,
    ...(usage ? { usage } : {}),
    providerMeta: { provider: "anthropic", model, ...(res.requestId ? { requestId: res.requestId } : {}) },
  });
}

function classifyTransportFailure(f: AnthropicTransportFailure): ProviderError {
  const meta = { ...(f.requestId ? { requestId: f.requestId } : {}), ...(f.status ? { statusCode: f.status } : {}) };
  if (f.kind === "offline") return { kind: "offline", retryable: false, meta };
  if (f.kind === "network") return { kind: "transport", retryable: true, cause: "network", meta };
  switch (f.status) {           // f.kind === "http"
    case 408: return { kind: "transport", retryable: true, cause: "timeout", meta };
    case 401: case 403: return { kind: "config", retryable: false, cause: "auth", meta };
    case 402: return { kind: "config", retryable: false, cause: "billing", meta };
    case 404: return { kind: "config", retryable: false, cause: "model_not_found", meta };
    case 413: return { kind: "config", retryable: false, cause: "request_too_large", meta };
    case 429: return { kind: "transport", retryable: true, cause: "rate_limit", meta: { ...meta, ...(f.retryAfterMs ? { retryAfterMs: f.retryAfterMs } : {}) } };
    default:
      if (typeof f.status === "number" && f.status >= 500) return { kind: "transport", retryable: true, cause: "5xx", meta };
      if (typeof f.status === "number" && f.status >= 400) return { kind: "config", retryable: false, cause: "invalid_request", meta }; // all other 4xx → not retryable
      return { kind: "transport", retryable: true, cause: "network", meta };
  }
}
