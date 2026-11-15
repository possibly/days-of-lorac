export interface ToastItem {
  id: number;
  text: string;
  tone?: 'error' | 'info' | 'ok';
}

/** Max two toasts, bottom centre above the dock, click to dismiss. */
export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }): JSX.Element {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.slice(-2).map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone ?? 'info'}`}>
          <span className="toast-bar" aria-hidden="true" />
          <button type="button" className="toast-body" onClick={() => onDismiss(toast.id)} title="Dismiss">
            {toast.text}
          </button>
          <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
