import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * QR rendering for invite links and reply codes.
 *
 * The code is drawn as one path per dark module, at error correction L because
 * an SDP payload is long. If the payload does not fit a version 40 code the
 * component says so instead of throwing, and the copyable text next to it stays
 * the primary path.
 */
export function QrCode({
  text,
  size = 232,
  label = 'QR code',
}: {
  text: string;
  size?: number;
  label?: string;
}): JSX.Element {
  const drawing = useMemo(() => {
    try {
      const code = qrcode(0, 'L');
      code.addData(text, 'Byte');
      code.make();
      const count = code.getModuleCount();
      let path = '';
      for (let row = 0; row < count; row += 1) {
        for (let column = 0; column < count; column += 1) {
          if (code.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
        }
      }
      return { count, path, error: null as string | null };
    } catch {
      return { count: 0, path: '', error: 'Too long for a QR code. Share the link instead.' };
    }
  }, [text]);

  if (drawing.error) return <p className="qr-error">{drawing.error}</p>;

  return (
    <svg
      className="qr-code"
      width={size}
      height={size}
      viewBox={`0 0 ${drawing.count} ${drawing.count}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={drawing.count} height={drawing.count} fill="#ffffff" />
      <path d={drawing.path} fill="#161109" />
    </svg>
  );
}
