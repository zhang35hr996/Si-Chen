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
