import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type ToastLevel = 'info' | 'success' | 'error';
type Toast = { id: number; message: string; level: ToastLevel; icon?: IconName };

type Ctx = {
  push: (message: string, opts?: { level?: ToastLevel; icon?: IconName }) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast must be used inside ToastProvider');
  return c;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);

  const push = useCallback<Ctx['push']>((message, opts) => {
    const id = next.current++;
    const t: Toast = { id, message, level: opts?.level ?? 'info', icon: opts?.icon };
    setItems((prev) => [...prev, t]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed top-14 right-6 z-[80] flex flex-col gap-2 pointer-events-none">
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {}, []);
  const color = toast.level === 'success' ? 'border-l-success' : toast.level === 'error' ? 'border-l-danger' : 'border-l-accent';
  const iconColor = toast.level === 'success' ? 'text-success' : toast.level === 'error' ? 'text-danger' : 'text-accent';
  const icon: IconName = toast.icon ?? (toast.level === 'success' ? 'check' : toast.level === 'error' ? 'x' : 'sparkles');
  return (
    <div className={`min-w-[260px] px-3.5 py-2.5 bg-bg-raised border border-border-subtle border-l-2 rounded-md flex items-center gap-2.5 text-xs animate-toast-in pointer-events-auto ${color}`}>
      <Icon name={icon} size={14} className={iconColor} />
      <span className="text-text-primary">{toast.message}</span>
    </div>
  );
}
