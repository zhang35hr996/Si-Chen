import { describe, expect, it, vi, afterEach } from "vitest";
import http from "node:http";
import type { AnthropicTransport } from "../../src/engine/dialogue/providers/anthropicProvider";
import { createRelayServer } from "../../server/llm/anthropicRelay";

afterEach(() => { vi.resetAllMocks(); });

async function postToRelay(server: http.Server, body: unknown): Promise<{ status: number; json: unknown; headers: Headers }> {
  const address = server.address() as import("node:net").AddressInfo;
  const raw = await fetch(`http://127.0.0.1:${address.port}/api/llm/anthropic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: raw.status, json: await raw.json(), headers: raw.headers };
}

function listenRandom(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

const minimalPayload = {
  model: "claude-sonnet-4-6",
  max_tokens: 100,
  system: [{ type: "text", text: "sys" }],
  messages: [{ role: "user", content: "hello" }],
  tools: [],
  tool_choice: { type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true },
};

const cachedPayload = {
  model: "claude-sonnet-4-6",
  max_tokens: 100,
  system: [
    { type: "text", text: "rules", cache_control: { type: "ephemeral" } },
    { type: "text", text: "etiquette", cache_control: { type: "ephemeral" } },
  ],
  messages: [{ role: "user", content: "hello" }],
  tools: [],
  tool_choice: { type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true },
};

describe("createRelayServer", () => {
  it("成功：返回 200 + { message, requestId }", async () => {
    const fakeResult = { message: { stop_reason: "tool_use", content: [] }, requestId: "req_01" };
    const fakeTransport: AnthropicTransport = {
      send: vi.fn().mockResolvedValue({ ok: true, value: fakeResult }),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const { status, json } = await postToRelay(server, minimalPayload);
      expect(status).toBe(200);
      expect((json as any).requestId).toBe("req_01");
    } finally {
      server.close();
    }
  });

  it("下游 429 → relay 返回 429 + Retry-After 头", async () => {
    const fakeTransport: AnthropicTransport = {
      send: vi.fn().mockResolvedValue({ ok: false, error: { kind: "http", status: 429, retryAfterMs: 3000 } }),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const { status, headers } = await postToRelay(server, minimalPayload);
      expect(status).toBe(429);
      expect(headers.get("Retry-After")).toBe("3");
    } finally {
      server.close();
    }
  });

  it("下游 401（auth）→ relay 返回 401", async () => {
    const fakeTransport: AnthropicTransport = {
      send: vi.fn().mockResolvedValue({ ok: false, error: { kind: "http", status: 401 } }),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const { status, json } = await postToRelay(server, minimalPayload);
      expect(status).toBe(401);
      // 响应不含 upstream 内容
      expect(JSON.stringify(json)).toContain("upstream error");
    } finally {
      server.close();
    }
  });

  it("body parse 失败 → 400", async () => {
    const fakeTransport: AnthropicTransport = {
      send: vi.fn(),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const address = server.address() as import("node:net").AddressInfo;
      const raw = await fetch(`http://127.0.0.1:${address.port}/api/llm/anthropic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json{",
      });
      expect(raw.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("schema 验证失败（缺字段）→ 400", async () => {
    const fakeTransport: AnthropicTransport = {
      send: vi.fn(),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const { status, json } = await postToRelay(server, { model: "claude-sonnet-4-6" });
      expect(status).toBe(400);
      expect((json as any).error).toBe("invalid request schema");
    } finally {
      server.close();
    }
  });

  it("schema 验证失败（max_tokens 超限）→ 400", async () => {
    const fakeTransport: AnthropicTransport = {
      send: vi.fn(),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const { status } = await postToRelay(server, { ...minimalPayload, max_tokens: 9999 });
      expect(status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("网络错误 → 502", async () => {
    const fakeTransport: AnthropicTransport = {
      send: vi.fn().mockResolvedValue({ ok: false, error: { kind: "network", message: "ECONNRESET" } }),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const { status } = await postToRelay(server, minimalPayload);
      expect(status).toBe(502);
    } finally {
      server.close();
    }
  });

  it("404 对非法路由", async () => {
    const fakeTransport: AnthropicTransport = {
      send: vi.fn(),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const address = server.address() as import("node:net").AddressInfo;
      const raw = await fetch(`http://127.0.0.1:${address.port}/other`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(minimalPayload),
      });
      expect(raw.status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("forwards cache_control blocks to transport without stripping", async () => {
    let receivedPayload: unknown;
    const fakeTransport: AnthropicTransport = {
      send: vi.fn().mockImplementation((p) => {
        receivedPayload = p;
        return Promise.resolve({ ok: true, value: { message: { stop_reason: "tool_use", content: [] }, requestId: "req_cache" } });
      }),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const { status } = await postToRelay(server, cachedPayload);
      expect(status).toBe(200);
      const system = (receivedPayload as typeof cachedPayload).system;
      expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
      expect(system[1]!.cache_control).toEqual({ type: "ephemeral" });
    } finally {
      server.close();
    }
  });

  it("request without cache_control is valid", async () => {
    const fakeTransport: AnthropicTransport = {
      send: vi.fn().mockResolvedValue({ ok: true, value: { message: { stop_reason: "tool_use", content: [] }, requestId: "req_no_cache" } }),
    };
    const server = createRelayServer(fakeTransport);
    await listenRandom(server);
    try {
      const { status } = await postToRelay(server, minimalPayload);
      expect(status).toBe(200);
    } finally {
      server.close();
    }
  });
});
