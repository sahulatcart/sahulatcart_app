'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
/** An optional action on the toast, e.g. Undo after a reversible write (console, 2026-10-14). */
export interface ToastAction { label: string; onClick: () => void }
interface T { id: number; kind: Kind; msg: string; action?: ToastAction }
const Ctx = createContext<(msg: string, kind?: Kind, action?: ToastAction) => void>(() => {});
export const useToast = () => useContext(Ctx);

let seq = 0;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const drop = useCallback((id: number) => setItems((x) => x.filter((t) => t.id !== id)), []);
  const push = useCallback((msg: string, kind: Kind = 'info', action?: ToastAction) => {
    const id = ++seq;
    setItems((x) => [...x, { id, kind, msg, action }]);
    // Errors and toasts with an action stay longer: they need reading, or a decision.
    setTimeout(() => drop(id), action ? 8000 : kind === 'error' ? 6000 : 3800);
  }, [drop]);
  return (
    <Ctx.Provider value={push}>
      {children}
      {/* Live region: screen readers announce each toast as it appears. */}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 aria-hidden /> : t.kind === 'error' ? <XCircle aria-hidden /> : <Info aria-hidden />}
            <span>{t.msg}</span>
            {t.action && <button type="button" className="toast-action" onClick={() => { drop(t.id); t.action!.onClick(); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
