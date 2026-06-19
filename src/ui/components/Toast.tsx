/**
 * 轻量 Toast（§八：简短提示）。无依赖：useToasts 持有队列，ToastHost 渲染并自动消隐。
 * 用于"已批阅""已存档"等一次性反馈，替代为此弹出的居中确认框。
 */
import { useCallback, useRef, useState } from "react";

export interface ToastItem {
  id: number;
  text: string;
  tone?: "info" | "warn";
}

export function useToasts(timeout = 2400) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);
  const push = useCallback(
    (text: string, tone: ToastItem["tone"] = "info") => {
      const id = ++seq.current;
      setToasts((list) => [...list, { id, text, tone }]);
      window.setTimeout(() => dismiss(id), timeout);
    },
    [dismiss, timeout],
  );
  return { toasts, push, dismiss };
}

export function ToastHost({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast--${t.tone ?? "info"}`}
          onClick={() => onDismiss(t.id)}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
