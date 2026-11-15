/**
 * Copy text to the clipboard with a fallback.
 *
 * `navigator.clipboard` only exists in a secure context. The tailnet is plain
 * HTTP on a LAN address, which is not one, so the async API is missing or
 * rejects and the old selection + execCommand path is the only thing left.
 */
export type CopyResult = 'copied' | 'manual' | 'failed';

export async function copyText(text: string): Promise<CopyResult> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      // Permission denied or no user gesture; fall through.
    }
  }
  return legacyCopy(text) ? 'copied' : 'manual';
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  // Off-screen but still selectable: display:none would break selection.
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  const previous = document.activeElement as HTMLElement | null;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
    previous?.focus?.();
  }
}
