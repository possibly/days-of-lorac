import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  /** Width in px, max 720. */
  width?: number;
  className?: string;
  /** Blocks Esc and scrim dismissal (mandatory flows like discard). */
  mandatory?: boolean;
  footer?: ReactNode;
}

/**
 * One modal shape: centred parchment sheet on a 46% sea scrim, focus trapped,
 * Esc closes when the flow is cancellable. Focus moves in on mount and returns
 * to the opener on unmount.
 */
export function Modal({ title, children, onClose, width = 480, className, mandatory, footer }: ModalProps): JSX.Element {
  const sheet = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = sheet.current;
    const first = node?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => {
      opener.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && onClose && !mandatory) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const node = sheet.current;
      if (!node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, mandatory]);

  return createPortal(
    <div
      className="modal-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && onClose && !mandatory) onClose();
      }}
    >
      <div
        className={`modal-sheet${className ? ` ${className}` : ''}`}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={sheet}
      >
        <h2 id={headingId} className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
