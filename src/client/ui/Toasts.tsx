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
        <button
          key={toast.id}
          type="button"
          className={`toast toast-${toast.tone ?? 'info'}`}
          onClick={() => onDismiss(toast.id)}
          title="Dismiss"
        >
          <span className="toast-bar" aria-hidden="true" />
          <span>{toast.text}</span>
        </button>
      ))}
    </div>
  );
}
