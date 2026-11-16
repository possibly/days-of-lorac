import { copyText } from './clipboard';

export type ShareResult = 'shared' | 'copied' | 'manual' | 'failed';

/**
 * One tap on a phone: the system share sheet when it exists, clipboard as the
 * fallback, and `manual` when both are unavailable (plain HTTP on a LAN blocks
 * `navigator.clipboard`).
 */
export async function shareText(text: string, title: string): Promise<ShareResult> {
  const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch (error) {
      // Cancelling the sheet is not a failure worth reporting; a real failure
      // falls through to the clipboard.
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared';
    }
  }
  const copied = await copyText(text);
  return copied === 'copied' ? 'copied' : 'manual';
}

export async function shareLink(url: string, title: string): Promise<ShareResult> {
  const nav = navigator as Navigator & { share?: (data: { title?: string; url?: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared';
    }
  }
  const copied = await copyText(url);
  return copied === 'copied' ? 'copied' : 'manual';
}
