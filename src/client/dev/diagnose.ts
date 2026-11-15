/**
 * On-device measurements, for when a layout is right in the simulator and wrong
 * on the phone. Load the game with `?diag=1` and a panel pins to the top left
 * with the numbers that decide which way it is broken: layout viewport, visual
 * viewport and its zoom scale, document scroll width, the supply drawer's box,
 * the safe-area insets, and every visible element whose right edge sits past
 * the visible area.
 *
 * Inert without the query parameter. Not imported by anything else, so deleting
 * this file only needs the one call in App.tsx removed.
 */

const PANEL_ID = 'lorac-diag';

function probeInsets(): string {
  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'pointer-events:none',
    'padding-left:env(safe-area-inset-left)',
    'padding-right:env(safe-area-inset-right)',
    'padding-top:env(safe-area-inset-top)',
    'padding-bottom:env(safe-area-inset-bottom)',
  ].join(';');
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const read = (value: string): string => value.replace('px', '') || '0';
  const out = `${read(style.paddingLeft)}/${read(style.paddingRight)}/${read(style.paddingTop)}/${read(style.paddingBottom)}`;
  probe.remove();
  return out;
}

function offenders(panel: HTMLElement): string[] {
  const vv = window.visualViewport;
  const left = (vv?.offsetLeft ?? 0) + 0.5;
  const right = left + (vv?.width ?? window.innerWidth) - 1;
  const hits: { name: string; right: number; left: number }[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    if (panel.contains(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.right <= right + 1 && rect.left >= left - 1) continue;
    const name = (el.getAttribute('class') || el.tagName).toString().split(' ')[0] ?? el.tagName;
    hits.push({ name, right: Math.round(rect.right), left: Math.round(rect.left) });
    if (hits.length > 40) break;
  }
  // Keep the outermost few: children of an overflowing row repeat the same news.
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const hit of hits) {
    const key = `${hit.name}:${hit.right}:${hit.left}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  ${hit.name} ${hit.left}..${hit.right}`);
    if (lines.length >= 8) break;
  }
  return lines;
}

export function installDiagnostics(): void {
  if (document.getElementById(PANEL_ID)) return;
  const panel = document.createElement('pre');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:2147483647',
    'margin:0',
    'padding:6px 8px',
    'max-height:52vh',
    'overflow:auto',
    'background:rgba(8,19,15,.94)',
    'color:#e8dcb0',
    'border-bottom:1px solid #c9a75f',
    'font:9px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
    'white-space:pre-wrap',
    'pointer-events:auto',
  ].join(';');
  panel.addEventListener('click', () => panel.remove());
  document.body.append(panel);

  const draw = (): void => {
    if (!panel.isConnected) return;
    const vv = window.visualViewport;
    const de = document.documentElement;
    const rail = document.querySelector('.supply-rail');
    const content = document.querySelector('.rail-content');
    const railRect = rail?.getBoundingClientRect();
    const lines = [
      `inner ${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio} screen ${window.screen.width}x${window.screen.height}`,
      `visual ${Math.round(vv?.width ?? 0)}x${Math.round(vv?.height ?? 0)} scale ${(vv?.scale ?? 1).toFixed(2)} off ${Math.round(vv?.offsetLeft ?? 0)},${Math.round(vv?.offsetTop ?? 0)}`,
      `doc scroll ${de.scrollWidth} client ${de.clientWidth} body ${document.body.scrollWidth}`,
      `safe L/R/T/B ${probeInsets()}`,
      railRect
        ? `rail ${Math.round(railRect.left)}..${Math.round(railRect.right)} w ${Math.round(railRect.width)} open ${rail?.classList.contains('is-open')}`
        : 'rail absent',
      content
        ? `content client ${content.clientWidth} scroll ${content.scrollWidth} left ${content.scrollLeft}`
        : 'content absent',
    ];
    const over = offenders(panel);
    if (over.length > 0) lines.push('past visible edge:', ...over);
    panel.textContent = `${lines.join('\n')}\n(tap to close)`;
  };

  draw();
  window.setInterval(draw, 500);
  window.addEventListener('resize', draw);
  window.visualViewport?.addEventListener('resize', draw);
  window.visualViewport?.addEventListener('scroll', draw);
}
