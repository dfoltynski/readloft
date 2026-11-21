import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'error';
export interface ToastOptions {
  /** Optional action button (e.g. "Undo"). */
  action?: { label: string; onClick: () => void };
  /** Visible time in ms (default 4500). */
  duration?: number;
}
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastOptions['action'];
}

type ShowToast = (message: string, kind?: ToastKind, options?: ToastOptions) => void;
const ToastContext = createContext<ShowToast>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const show = useCallback<ShowToast>((message, kind = 'info', options) => {
    const id = nextId.current++;
    setItems((xs) => [...xs, { id, message, kind, action: options?.action }]);
    setTimeout(() => dismiss(id), options?.duration ?? 4500);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
