/**
 * jsdom/RTL 测试 lane 的 setup（仅 tests/**\/*.test.tsx 使用；node lane 不加载）。
 * 注册 jest-dom 无障碍/可见性匹配器，并在每个用例后清理已挂载的 DOM。
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
