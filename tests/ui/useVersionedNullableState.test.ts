/**
 * useVersionedNullableState：版本号源自已提交 state（非渲染期 ref），用作强制重挂 key。
 * @vitest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useVersionedNullableState } from "../../src/ui/hooks/useVersionedNullableState";

describe("useVersionedNullableState", () => {
  it("初始为 null、version 0；设新值递增；设相同对象不递增；null↔值也递增", () => {
    const { result } = renderHook(() => useVersionedNullableState<{ id: string }>());
    expect(result.current[0]).toBeNull();
    expect(result.current[2]).toBe(0);

    const a = { id: "a" };
    act(() => result.current[1](a));
    expect(result.current[0]).toBe(a);
    expect(result.current[2]).toBe(1);

    // 设为同一对象：版本不变（避免无谓重挂）
    act(() => result.current[1](a));
    expect(result.current[2]).toBe(1);

    const b = { id: "b" };
    act(() => result.current[1](b));
    expect(result.current[2]).toBe(2);

    // 值 → null 也递增
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
    expect(result.current[2]).toBe(3);
  });

  it("同一批次 set(null) 紧接 set(next)：版本顺序推进，最终得到新 key", () => {
    const { result } = renderHook(() => useVersionedNullableState<{ id: string }>());
    const first = { id: "first" };
    act(() => result.current[1](first));
    const keyAfterFirst = result.current[2];

    const next = { id: "next" };
    // 模拟 App onDone：同一事件回调里先 set(null) 再 set(nextBeat)
    act(() => {
      result.current[1](null);
      result.current[1](next);
    });
    expect(result.current[0]).toBe(next);
    expect(result.current[2]).toBe(keyAfterFirst + 2); // null 一次 + next 一次
    expect(result.current[2]).not.toBe(keyAfterFirst); // key 一定变化 → 重挂
  });

  it("支持 functional updater", () => {
    const { result } = renderHook(() => useVersionedNullableState<number>());
    act(() => result.current[1](1));
    act(() => result.current[1]((cur) => (cur ?? 0) + 10));
    expect(result.current[0]).toBe(11);
    expect(result.current[2]).toBe(2);
  });
});
