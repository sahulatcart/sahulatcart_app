'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A confirm dialog on the native <dialog> element: it renders in the top layer (never clipped by a
 * table's overflow), Esc closes it, focus is held inside and returns to the opener on close. Replaces
 * window.prompt/confirm for the console's consequential writes (2026-10-14 critique).
 */
/** The common case: one question, one consequential button. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel, danger = false, busy = false }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} busy={busy}
      actions={<button type="button" className={danger ? 'btn danger' : 'btn'} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>}>
      {children}
    </Dialog>
  );
}

export default function Dialog({ open, onClose, title, children, actions, busy = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** The buttons, primary last. Cancel is added before them. */
  actions: ReactNode;
  /** While a write is in flight the dialog cannot be dismissed. */
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      onClick={(e) => { if (e.target === ref.current && !busy) onClose(); }}
    >
      {open && (
        <>
          <div className="dialog-head"><h2 id={titleId}>{title}</h2></div>
          <div className="dialog-body">{children}</div>
          <div className="dialog-foot">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            {actions}
          </div>
        </>
      )}
    </dialog>
  );
}
