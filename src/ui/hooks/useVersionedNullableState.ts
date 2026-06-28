import { useCallback, useState, type SetStateAction } from "react";

/**
 * 可空状态 + 已提交版本号。每次设为「与当前不同」的值（含 null↔值、值↔新值）版本号递增；
 * 版本号源自已提交 state（reducer 纯函数），不在渲染期读写 ref——可安全用作 React key 强制重挂。
 *
 * setter 兼容直接值与 functional updater；同一批次内 set(null) 紧接 set(next) 会顺序推进版本，
 * 最终得到新 key（用于对话/反应屏在事件链、反应队列切换时重建组件、frame、去重集合）。
 * 设为与当前 Object.is 相等的值不推进版本（避免无谓重挂）。
 */
export function useVersionedNullableState<T>(): readonly [T | null, (next: SetStateAction<T | null>) => void, number] {
  const [box, setBox] = useState<{ value: T | null; version: number }>({ value: null, version: 0 });
  const setValue = useCallback((next: SetStateAction<T | null>) => {
    setBox((prev) => {
      const value = typeof next === "function" ? (next as (cur: T | null) => T | null)(prev.value) : next;
      if (Object.is(value, prev.value)) return prev;
      return { value, version: prev.version + 1 };
    });
  }, []);
  return [box.value, setValue, box.version] as const;
}
