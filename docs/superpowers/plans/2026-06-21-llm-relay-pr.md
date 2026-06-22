# LLM-1.5 Anthropic Relay — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让浏览器侧对话系统能够安全地向真实 Claude 发请求，同时保证 `ANTHROPIC_API_KEY` 不进入前端 bundle。架构：浏览器 → `HttpAnthropicTransport`（fetch `/api/llm/anthropic`）→ Vite proxy → Node relay（持有 key，调用 Anthropic SDK）→ Claude API。

**Branch:** `feat/llm-relay`（不影响 health 分支）

**Architecture:**
```
浏览器 React
  └─ HttpAnthropicTransport          # Task 4（src/engine/dialogue/providers/）
       └─ fetch /api/llm/anthropic   # Vite proxy → :3001
Node relay (server/llm/anthropicRelay.ts)   # Task 3
  └─ AnthropicSdkTransport          # Task 2（server/llm/）
       └─ @anthropic-ai/sdk          # Claude API
```

**Baseline:** `2f06862`（main tip，877 tests + 1 skip，tsc clean）。

---

## Global Constraints

- **API key 零泄漏**：Node relay 只从 `process.env.ANTHROPIC_API_KEY` 读取。`VITE_*` 前缀禁止（Vite 会将其注入 bundle）。错误响应绝不包含 key 本身。
- **CI 不调真实 API**：所有 `tests/` 内测试只用 mock/fixture，无网络请求。smoke 命令单独存在于 `tools/smoke-anthropic.ts`，不在 CI 流程。
- **实现现有接口，不改接口契约**：`AnthropicTransport`、`AnthropicRequestPayload`、`AnthropicTransportResult`、`AnthropicTransportFailure` 均已定义在 `src/engine/dialogue/providers/anthropicProvider.ts`，本 PR 只新建实现，不改接口。
- **Node relay 用 `node:http`**（不引入 express/fastify），保持依赖最小。
- **确定性测试**：Transport 层 mock `fetch`；relay 层 mock SDK client；不随机端口。
- **错误映射已有逻辑**：`classifyTransportFailure` 在 `anthropicProvider.ts` 已定义好 HTTP status → ProviderError，`HttpAnthropicTransport` 直接产出 `AnthropicTransportFailure`（kind/status），adapter 的 `classifyTransportFailure` 继续工作，无需改动。
- **Relay 响应 envelope（成功）**：`{ message: AnthropicToolUseResponse; requestId?: string }` — 与 `AnthropicTransportResult` 完全同形，JSON 直接反序列化。
- **Relay 错误响应**：HTTP 状态码 + `{ error: string }`（纯人类可读文字，无结构，绝不含 key）；`HttpAnthropicTransport` 将非 200 转成 `AnthropicTransportFailure{ kind:"http", status }`。
- **Vite proxy**：`/api/llm/*` → `http://localhost:3001`，`changeOrigin: true`，`rewrite: path => path`。
- **开发命令**：`npm run dev:relay`（tsx 直接运行 relay）；`npm run dev:all`（concurrently 并启 Vite + relay）；`npm run smoke:anthropic`（手动 smoke，需 env key）。
- **小清理（同 PR 顺手）**：`src/engine/dialogue/types.ts` 删除残留的 `rawDialogueResponseSchema`（如存在）；`remoteProvider.ts` 头注释更新（Anthropic 路由已接线）。
- **提交格式**：`feat:`/`fix:`/`test:`/`chore:` 前缀，不带 Co-Authored-By。
- **测试命令**：`npx vitest run <path>` 单测；`npx tsc --noEmit` 类型；`npx vite build` 构建验证。

---

## File Structure

新建：
- `server/tsconfig.json` — Node 环境 tsconfig（`module: NodeNext`，`lib: ["ES2022"]`，`types: ["node"]`，不含 DOM）
- `server/llm/anthropicSdkTransport.ts` — SDK wrapper，实现 `AnthropicTransport`（Node-only）
- `server/llm/anthropicRelay.ts` — `node:http` relay server，持有 key，POST `/api/llm/anthropic`
- `src/engine/dialogue/providers/httpAnthropicTransport.ts` — 浏览器 transport，`fetch` 实现 `AnthropicTransport`
- `tools/smoke-anthropic.ts` — 手动 smoke，发一条真实请求，不进 CI

修改：
- `package.json` — 加 `@anthropic-ai/sdk` 依赖，加 `concurrently` devDep，加 `dev:relay`/`dev:all`/`smoke:anthropic` 脚本
- `vite.config.ts` — 加 `server.proxy` 转发 `/api/llm/*` → relay

可选小清理（若存在则修改）：
- `src/engine/dialogue/types.ts` — 删 `rawDialogueResponseSchema`
- `src/engine/dialogue/providers/remoteProvider.ts` — 更新头注释

测试（新建）：
- `tests/server/anthropicSdkTransport.test.ts` — mock SDK client
- `tests/server/anthropicRelay.test.ts` — mock SDK transport，in-process HTTP
- `tests/dialogue/httpAnthropicTransport.test.ts` — mock `fetch`，覆盖成功/401/429/500/abort

依赖顺序：T1 → T2 → T3 → T4 → T5 → T6（线性）。

---

### Task 1: package.json 脚本 + 依赖 + server/tsconfig.json

**Files:**
- Modify: `package.json`
- New: `server/tsconfig.json`

**Goal:** 添加运行 relay 所需的包和脚本，建立 server/ 的 TS 环境。

- [ ] **Step 1: 写失败测试**（本 task 无 runtime 逻辑，跳过；直接到 Step 2）

- [ ] **Step 2: 实现**

`package.json` 中 `dependencies` 加：
```json
"@anthropic-ai/sdk": "^0.39.0"
```
`devDependencies` 加：
```json
"concurrently": "^9.1.2"
```
`scripts` 加：
```json
"dev:relay": "tsx server/llm/anthropicRelay.ts",
"dev:all": "concurrently \"npm run dev\" \"npm run dev:relay\"",
"smoke:anthropic": "tsx tools/smoke-anthropic.ts"
```

新建 `server/tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist-server",
    "rootDir": "."
  },
  "include": ["server/**/*.ts"]
}
```

- [ ] **Step 3: 安装依赖**
```bash
npm install
```

- [ ] **Step 4: 验证**
```bash
npx tsc --noEmit
npx vitest run
```
预期：全绿，无新 type 错误。

- [ ] **Step 5: 提交**
```
chore(relay): add @anthropic-ai/sdk + concurrently + server tsconfig + dev scripts
```

---

### Task 2: `server/llm/anthropicSdkTransport.ts` + 测试

**Files:**
- New: `server/llm/anthropicSdkTransport.ts`
- New: `tests/server/anthropicSdkTransport.test.ts`

**Goal:** 封装 `@anthropic-ai/sdk`，实现 `AnthropicTransport` 接口，供 relay 内部使用。

**Interfaces:**
- Consumes: `AnthropicTransport`、`AnthropicRequestPayload`、`AnthropicTransportResult`、`AnthropicTransportFailure`（均来自 `src/engine/dialogue/providers/anthropicProvider.ts`）
- Produces: `createAnthropicSdkTransport(apiKey: string): AnthropicTransport`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/anthropicSdkTransport.test.ts`：
```ts
import { describe, expect, it, vi } from "vitest";
import type { AnthropicRequestPayload } from "../../src/engine/dialogue/providers/anthropicProvider";

// 用 vi.mock 替换 SDK，不发真实网络请求
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  return { default: vi.fn(() => ({ messages: { create: mockCreate } })), _mockCreate: mockCreate };
});

describe("AnthropicSdkTransport", () => {
  const minimalPayload: AnthropicRequestPayload = {
    model: "claude-sonnet-4-6",
    max_tokens: 100,
    system: [{ type: "text", text: "s" }],
    messages: [{ role: "user", content: "u" }],
    tools: [],
    tool_choice: { type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true },
  };

  it("成功：返回 ok(AnthropicTransportResult)，含 requestId", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    _mockCreate.mockResolvedValueOnce({
      id: "msg_01abc",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "臣妾遵旨。", proposedClaims: [] } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("test-key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.requestId).toBe("msg_01abc");
      expect(r.value.message.stop_reason).toBe("tool_use");
    }
  });

  it("401: 返回 err({ kind:'http', status:401 })", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    const e = Object.assign(new Error("auth"), { status: 401, headers: {} });
    _mockCreate.mockRejectedValueOnce(e);
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("bad-key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "http", status: 401 });
  });

  it("429: 返回 err({ kind:'http', status:429 })，含 retryAfterMs", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    const e = Object.assign(new Error("rate limit"), { status: 429, headers: { "retry-after": "2" } });
    _mockCreate.mockRejectedValueOnce(e);
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ kind: "http", status: 429 });
      expect((r.error as any).retryAfterMs).toBe(2000);
    }
  });

  it("网络错误（无 status）: 返回 err({ kind:'network' })", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    _mockCreate.mockRejectedValueOnce(new Error("ECONNRESET"));
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("network");
  });
});
```

运行：`npx vitest run tests/server/anthropicSdkTransport.test.ts` — 预期红（文件不存在）。

- [ ] **Step 2: 实现 `server/llm/anthropicSdkTransport.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { ok, err, type Result } from "../../src/engine/infra/result";
import type {
  AnthropicTransport, AnthropicRequestPayload,
  AnthropicTransportResult, AnthropicTransportFailure
} from "../../src/engine/dialogue/providers/anthropicProvider";

export function createAnthropicSdkTransport(apiKey: string): AnthropicTransport {
  const client = new Anthropic({ apiKey });
  return {
    async send(payload: AnthropicRequestPayload): Promise<Result<AnthropicTransportResult, AnthropicTransportFailure>> {
      try {
        const msg = await client.messages.create(payload as Parameters<typeof client.messages.create>[0]);
        return ok({
          message: msg as unknown as import("../../src/engine/dialogue/providers/anthropicProvider").AnthropicToolUseResponse,
          requestId: msg.id,
        });
      } catch (e: unknown) {
        const status = (e as { status?: number }).status;
        const headers = (e as { headers?: Record<string, string> }).headers ?? {};
        if (typeof status === "number") {
          const retryAfterRaw = headers["retry-after"];
          const retryAfterMs = retryAfterRaw ? parseInt(retryAfterRaw, 10) * 1000 : undefined;
          return err({ kind: "http", status, ...(retryAfterMs ? { retryAfterMs } : {}) });
        }
        return err({ kind: "network", message: (e instanceof Error) ? e.message : String(e) });
      }
    },
  };
}
```

> **注意**：`msg` 类型断言为现有 `AnthropicToolUseResponse`，因为 SDK 返回的 `Message` 形状与我们定义的 interface 兼容（`id`/`stop_reason`/`content`/`usage`）。

- [ ] **Step 3: 运行测试**
```bash
npx vitest run tests/server/anthropicSdkTransport.test.ts
```
预期全绿。再跑全套：
```bash
npx vitest run
```
预期：原有测试全绿，新增 4 通过。

- [ ] **Step 4: typecheck**
```bash
npx tsc --noEmit
```

- [ ] **Step 5: 提交**
```
feat(relay): AnthropicSdkTransport — SDK wrapper → AnthropicTransport（401/429/network 分类）
test(relay): AnthropicSdkTransport mock-SDK 四用例
```

---

### Task 3: `server/llm/anthropicRelay.ts` + 测试

**Files:**
- New: `server/llm/anthropicRelay.ts`
- New: `tests/server/anthropicRelay.test.ts`

**Goal:** Node HTTP relay server，POST `/api/llm/anthropic`，持有 API key，调用 SDK transport，返回标准 envelope 或 HTTP 错误。

**Interfaces:**
- Consumes: `createAnthropicSdkTransport` (Task 2), `AnthropicRequestPayload`, `AnthropicTransportFailure`
- Produces: HTTP server, export `startRelay(port: number): http.Server`（方便测试 in-process 启动）

**Relay 协议：**

成功：HTTP 200 + `{ message: AnthropicToolUseResponse, requestId?: string }`

失败映射：
| `AnthropicTransportFailure.kind` | status | status 来源 |
|---|---|---|
| `http`, status 401/403 | 401 | 下游 |
| `http`, status 429 | 429 + `Retry-After` header | 下游 |
| `http`, status 408 | 408 | 下游 |
| `http`, status 5xx | 502 | 屏蔽下游细节 |
| `http`, 其他 4xx | 400 | |
| `network` | 502 | |
| `offline` | 503 | |
| 缺少 API key | 401 | relay 本身 |
| body parse 失败 | 400 | relay 本身 |

错误响应体永远是 `{ error: "<人类可读描述>" }`，**绝不含 key 字面量**。

- [ ] **Step 1: 写失败测试**

新建 `tests/server/anthropicRelay.test.ts`：
```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import http from "node:http";

// Mock createAnthropicSdkTransport
vi.mock("../../server/llm/anthropicSdkTransport", () => ({
  createAnthropicSdkTransport: vi.fn(),
}));
import { createAnthropicSdkTransport } from "../../server/llm/anthropicSdkTransport";

async function postToRelay(server: http.Server, body: unknown): Promise<{ status: number; json: unknown }> {
  const address = server.address() as import("node:net").AddressInfo;
  const raw = await fetch(`http://localhost:${address.port}/api/llm/anthropic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: raw.status, json: await raw.json() };
}

const minimalPayload = {
  model: "claude-sonnet-4-6", max_tokens: 100,
  system: [], messages: [], tools: [], tool_choice: {},
};

describe("anthropicRelay", () => {
  const OLD_ENV = process.env;
  afterEach(() => { process.env = OLD_ENV; vi.resetAllMocks(); });

  it("成功：返回 200 + { message, requestId }", async () => {
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: "sk-test" };
    const fakeResult = { message: { stop_reason: "tool_use", content: [] }, requestId: "msg_01" };
    (createAnthropicSdkTransport as ReturnType<typeof vi.fn>).mockReturnValue({
      send: vi.fn().mockResolvedValue({ ok: true, value: fakeResult }),
    });
    const { startRelay } = await import("../../server/llm/anthropicRelay");
    const server = startRelay(0);
    await new Promise<void>((r) => server.listen(0, r));
    try {
      const { status, json } = await postToRelay(server, minimalPayload);
      expect(status).toBe(200);
      expect((json as any).requestId).toBe("msg_01");
    } finally { server.close(); }
  });

  it("缺少 API key → 401，响应不含 key", async () => {
    process.env = { ...OLD_ENV };
    delete process.env["ANTHROPIC_API_KEY"];
    const { startRelay } = await import("../../server/llm/anthropicRelay");
    const server = startRelay(0);
    await new Promise<void>((r) => server.listen(0, r));
    try {
      const { status, json } = await postToRelay(server, minimalPayload);
      expect(status).toBe(401);
      expect(JSON.stringify(json)).not.toContain("sk-");
    } finally { server.close(); }
  });

  it("下游 429 → relay 返回 429 + Retry-After", async () => {
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: "sk-test" };
    (createAnthropicSdkTransport as ReturnType<typeof vi.fn>).mockReturnValue({
      send: vi.fn().mockResolvedValue({ ok: false, error: { kind: "http", status: 429, retryAfterMs: 3000 } }),
    });
    const { startRelay } = await import("../../server/llm/anthropicRelay");
    const server = startRelay(0);
    await new Promise<void>((r) => server.listen(0, r));
    try {
      const raw = await fetch(`http://localhost:${(server.address() as any).port}/api/llm/anthropic`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(minimalPayload),
      });
      expect(raw.status).toBe(429);
      expect(raw.headers.get("Retry-After")).toBe("3");
    } finally { server.close(); }
  });

  it("下游 401（auth）→ relay 返回 401，响应不含 key", async () => {
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: "sk-real-key" };
    (createAnthropicSdkTransport as ReturnType<typeof vi.fn>).mockReturnValue({
      send: vi.fn().mockResolvedValue({ ok: false, error: { kind: "http", status: 401 } }),
    });
    const { startRelay } = await import("../../server/llm/anthropicRelay");
    const server = startRelay(0);
    await new Promise<void>((r) => server.listen(0, r));
    try {
      const { status, json } = await postToRelay(server, minimalPayload);
      expect(status).toBe(401);
      expect(JSON.stringify(json)).not.toContain("sk-real-key");
    } finally { server.close(); }
  });

  it("body parse 失败 → 400", async () => {
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: "sk-test" };
    const { startRelay } = await import("../../server/llm/anthropicRelay");
    const server = startRelay(0);
    await new Promise<void>((r) => server.listen(0, r));
    try {
      const raw = await fetch(`http://localhost:${(server.address() as any).port}/api/llm/anthropic`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "not json{",
      });
      expect(raw.status).toBe(400);
    } finally { server.close(); }
  });
});
```

- [ ] **Step 2: 实现 `server/llm/anthropicRelay.ts`**

```ts
import http from "node:http";
import { createAnthropicSdkTransport } from "./anthropicSdkTransport";
import type { AnthropicTransportFailure } from "../../src/engine/dialogue/providers/anthropicProvider";

function failureToHttpStatus(f: AnthropicTransportFailure): number {
  if (f.kind === "offline") return 503;
  if (f.kind === "network") return 502;
  // f.kind === "http"
  const s = f.status ?? 502;
  if (s === 401 || s === 403) return 401;
  if (s === 408) return 408;
  if (s === 429) return 429;
  if (s >= 500) return 502;
  if (s >= 400) return 400;
  return 502;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json), ...extraHeaders });
  res.end(json);
}

export function startRelay(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/api/llm/anthropic") {
      sendJson(res, 404, { error: "not found" }); return;
    }
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) { sendJson(res, 401, { error: "ANTHROPIC_API_KEY not configured" }); return; }

    // Read body
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }

    const transport = createAnthropicSdkTransport(apiKey);
    const result = await transport.send(payload as Parameters<typeof transport.send>[0]);

    if (result.ok) {
      sendJson(res, 200, result.value); return;
    }
    const f = result.error;
    const status = failureToHttpStatus(f);
    const extraHeaders: Record<string, string> = {};
    if (f.kind === "http" && f.status === 429 && f.retryAfterMs !== undefined) {
      extraHeaders["Retry-After"] = String(Math.ceil(f.retryAfterMs / 1000));
    }
    sendJson(res, status, { error: "upstream error" }, extraHeaders);
  });
  return server;
}

// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = parseInt(process.env["RELAY_PORT"] ?? "3001", 10);
  const server = startRelay(port);
  server.listen(port, () => { console.log(`[anthropic-relay] listening on :${port}`); });
}
```

> **ESM note:** `server/tsconfig.json` 使用 `module: NodeNext`，tsx 执行时不需要显式 ESM 配置。`import.meta.url` 在 tsx 环境正常工作。

- [ ] **Step 3: 运行测试**
```bash
npx vitest run tests/server/anthropicRelay.test.ts
npx vitest run
```

- [ ] **Step 4: typecheck**
```bash
npx tsc --noEmit
```

- [ ] **Step 5: 提交**
```
feat(relay): Node HTTP relay（node:http，key 从 env 读，失败零泄漏，failureToHttpStatus 映射）
test(relay): relay 五用例（200/无key401/429/下游401/body解析失败）
```

---

### Task 4: Vite proxy config

**Files:**
- Modify: `vite.config.ts`

**Goal:** Vite dev server 把 `/api/llm/*` 转发到 relay，让浏览器的 `fetch("/api/llm/anthropic")` 能到达本地 relay。

- [ ] **Step 1: 无需测试**（proxy 是 Vite 运行时配置，不进单测）

- [ ] **Step 2: 实现**

在 `vite.config.ts` 中加 `server.proxy`：

```ts
/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/llm": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: typecheck + 全套测试**
```bash
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 4: 提交**
```
chore(relay): vite.config.ts 加 /api/llm proxy → relay :3001
```

---

### Task 5: `src/engine/dialogue/providers/httpAnthropicTransport.ts` + 测试

**Files:**
- New: `src/engine/dialogue/providers/httpAnthropicTransport.ts`
- New: `tests/dialogue/httpAnthropicTransport.test.ts`

**Goal:** 浏览器安全 transport，实现 `AnthropicTransport`，通过 `fetch` 调用 relay endpoint。

**Interfaces:**
- Consumes: `AnthropicTransport`、`AnthropicRequestPayload`、`AnthropicTransportResult`、`AnthropicTransportFailure`
- Produces: `createHttpAnthropicTransport(endpoint?: string): AnthropicTransport`（`endpoint` 默认 `"/api/llm/anthropic"`）

**协议：**

```
POST {endpoint}
Content-Type: application/json
body: AnthropicRequestPayload (JSON)

200 → parse { message, requestId? } → ok(AnthropicTransportResult)
429 → err({ kind:"http", status:429, retryAfterMs: Retry-After×1000 (if header present) })
401/403 → err({ kind:"http", status })
408 → err({ kind:"http", status:408 })
5xx → err({ kind:"http", status })
其他 → err({ kind:"http", status })
AbortError → err({ kind:"network", message:"aborted" })
TypeError (offline) → err({ kind:"offline" })
```

- [ ] **Step 1: 写失败测试**

新建 `tests/dialogue/httpAnthropicTransport.test.ts`：
```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import type { AnthropicRequestPayload } from "../../src/engine/dialogue/providers/anthropicProvider";

const minimalPayload: AnthropicRequestPayload = {
  model: "claude-sonnet-4-6", max_tokens: 100,
  system: [{ type: "text", text: "s" }],
  messages: [{ role: "user", content: "u" }],
  tools: [], tool_choice: { type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true },
};

function mockFetch(status: number, body: unknown, headers?: Record<string, string>) {
  const hdrs = new Headers(headers ?? {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => hdrs.get(k) },
    json: async () => body,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("HttpAnthropicTransport", () => {
  it("200: 返回 ok(AnthropicTransportResult)", async () => {
    const envelope = {
      message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "emit_dialogue_line", input: {} }], usage: {} },
      requestId: "msg_02",
    };
    mockFetch(200, envelope);
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const t = createHttpAnthropicTransport();
    const r = await t.send(minimalPayload);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.requestId).toBe("msg_02");
  });

  it("401: err({ kind:'http', status:401 })", async () => {
    mockFetch(401, { error: "auth failed" });
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const r = await createHttpAnthropicTransport().send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "http", status: 401 });
  });

  it("429 + Retry-After: err({ kind:'http', status:429, retryAfterMs:5000 })", async () => {
    mockFetch(429, { error: "rate limit" }, { "Retry-After": "5" });
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const r = await createHttpAnthropicTransport().send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "http", status: 429, retryAfterMs: 5000 });
  });

  it("500: err({ kind:'http', status:500 })", async () => {
    mockFetch(500, { error: "internal" });
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const r = await createHttpAnthropicTransport().send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "http", status: 500 });
  });

  it("AbortError → err({ kind:'network', message:'aborted' })", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("The user aborted"), { name: "AbortError" })));
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await createHttpAnthropicTransport().send(minimalPayload, { signal: ctrl.signal });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.kind).toBe("network"); }
  });

  it("fetch TypeError (offline) → err({ kind:'offline' })", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const r = await createHttpAnthropicTransport().send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("offline");
  });
});
```

- [ ] **Step 2: 实现 `src/engine/dialogue/providers/httpAnthropicTransport.ts`**

```ts
import { ok, err, type Result } from "../../infra/result";
import type {
  AnthropicTransport, AnthropicRequestPayload,
  AnthropicTransportResult, AnthropicTransportFailure,
  TransportOptions,
} from "./anthropicProvider";

export function createHttpAnthropicTransport(endpoint = "/api/llm/anthropic"): AnthropicTransport {
  return {
    async send(
      payload: AnthropicRequestPayload,
      options?: TransportOptions,
    ): Promise<Result<AnthropicTransportResult, AnthropicTransportFailure>> {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: options?.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as AnthropicTransportResult;
          return ok(data);
        }
        const retryAfterRaw = res.headers.get("Retry-After");
        const retryAfterMs = retryAfterRaw ? parseInt(retryAfterRaw, 10) * 1000 : undefined;
        return err<AnthropicTransportFailure>({
          kind: "http",
          status: res.status,
          ...(retryAfterMs ? { retryAfterMs } : {}),
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
          return err({ kind: "network", message: "aborted" });
        }
        if (e instanceof TypeError) {
          return err({ kind: "offline" });
        }
        return err({ kind: "network", message: String(e) });
      }
    },
  };
}
```

- [ ] **Step 3: 运行测试**
```bash
npx vitest run tests/dialogue/httpAnthropicTransport.test.ts
npx vitest run
```

- [ ] **Step 4: typecheck**
```bash
npx tsc --noEmit
```

- [ ] **Step 5: 提交**
```
feat(relay): HttpAnthropicTransport — 浏览器安全 fetch transport（401/429/500/abort/offline）
test(relay): HttpAnthropicTransport 六用例（mock fetch，不调真实 API）
```

---

### Task 6: Smoke script + 顺手小清理

**Files:**
- New: `tools/smoke-anthropic.ts`
- Modify (if applicable): `src/engine/dialogue/types.ts` (删 rawDialogueResponseSchema)
- Modify (if applicable): `src/engine/dialogue/providers/remoteProvider.ts` (更新头注释)

**Goal:** 提供手动 smoke 路径；清理过期 schema 和注释。

- [ ] **Step 1: 检查需清理项**

```bash
grep -n "rawDialogueResponseSchema" src/engine/dialogue/types.ts 2>/dev/null || echo "not found"
```

如存在则删除相关行（类型定义 + export，若有的话）；确认无其他地方引用：
```bash
grep -r "rawDialogueResponseSchema" src/ tests/
```

更新 `remoteProvider.ts` 头注释（删"所有 provider 暂时 not configured"，改为"Anthropic provider 已接线；其他 provider 返回 not_configured"）。

- [ ] **Step 2: 新建 `tools/smoke-anthropic.ts`**

```ts
/**
 * Manual smoke test — NOT in CI. Run with:
 *   ANTHROPIC_API_KEY=sk-... npm run smoke:anthropic
 *
 * Sends one real request through the full pipeline:
 *   HttpAnthropicTransport → relay → Anthropic SDK → Claude
 *
 * Requires: relay running locally (npm run dev:relay)
 */
import { createHttpAnthropicTransport } from "../src/engine/dialogue/providers/httpAnthropicTransport";
import { createDialogueProvider } from "../src/engine/dialogue/providers/remoteProvider";

async function main() {
  const transport = createHttpAnthropicTransport("http://localhost:3001/api/llm/anthropic");
  const provider = createDialogueProvider({
    model: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    transport,
  });

  const request = {
    speakerId: "smoke_test",
    speakerContext: {
      profile: "测试角色，用于 smoke 验证。",
      voice: "平静",
      relevantMemories: [],
    },
    policy: { offeredContextIds: [], gates: [] },
  } as Parameters<typeof provider.generate>[0];

  console.log("[smoke] sending request…");
  const result = await provider.generate(request, { timeoutMs: 15000 });
  if (result.ok) {
    console.log("[smoke] OK:", JSON.stringify(result.value, null, 2));
  } else {
    console.error("[smoke] FAIL:", JSON.stringify(result.error, null, 2));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

> 注：smoke 直接连 relay（不走 Vite proxy），因此传完整 URL 而非 `/api/llm/anthropic`。

- [ ] **Step 3: 全套验证**
```bash
npx tsc --noEmit
npx vitest run
npx vite build
```
预期：tsc 0 错误，全套绿，build 成功。

- [ ] **Step 4: 提交**
```
feat(relay): smoke-anthropic 手动 smoke 脚本
chore(dialogue): 删 rawDialogueResponseSchema 残留 + 更新 remoteProvider 头注释
```

---

## Self-Review Checklist

实现完成后逐项确认：

1. `ANTHROPIC_API_KEY` 仅在 `server/` 下读取，`src/` 无任何 key 读取 ✓
2. 错误响应 body 无 key 泄漏（relay 测试断言 `not.toContain("sk-")` 覆盖）✓
3. CI 零真实网络请求（所有 tests/ 用 mock）✓
4. `HttpAnthropicTransport` 不含业务逻辑（不做 claim/text gate，只转发）✓
5. 现有 `classifyTransportFailure` 在 adapter 内不受影响 ✓
6. `npx tsc --noEmit` 零错误 ✓
7. `npx vite build` 成功（server/ 不被 Vite bundle）✓
8. 全套测试 ≥ 877 pass（新增 ≥ 14 个）✓
