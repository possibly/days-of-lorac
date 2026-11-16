import { copyText } from './clipboard';

export type ShareResult = 'shared' | 'copied' | 'manual' | 'failed';

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
