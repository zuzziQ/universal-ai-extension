import { useCallback, useState } from 'react';
import type { ToastItem, ToastKind } from '../types/extension';

let toastIdSeq = 0;

/** Lightweight app-level toast bus (avoids blocking `alert()` in sidepanel). */
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++toastIdSeq;
    setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  return { toasts, pushToast };
}
