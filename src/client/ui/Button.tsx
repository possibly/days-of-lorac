import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shown as title + aria-describedby when the button is disabled. */
  reason?: string | null;
  icon?: ReactNode;
}

/**
 * One button component. Primary is the sea gradient, secondary parchment.
 * A disabled button always carries its reason in `title` and a described-by
 * line, so a screen reader hears why it is unavailable.
 */
export function Button({ variant = 'secondary', reason, disabled, icon, children, className, ...rest }: ButtonProps): JSX.Element {
  const isDisabled = disabled || Boolean(reason);
  const reasonId = `reason-${rest.id ?? rest.name ?? Math.abs(hash(String(children)))}`;
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
      disabled={isDisabled}
      title={reason ?? rest.title}
      aria-describedby={reason ? reasonId : rest['aria-describedby']}
    >
      {icon ? <span className="btn-icon" aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
      {reason ? (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      ) : null}
    </button>
  );
}

function hash(value: string): number {
  let out = 0;
  for (let i = 0; i < value.length; i += 1) out = (out * 31 + value.charCodeAt(i)) | 0;
  return out;
}
