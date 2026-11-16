import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

/**
 * Camera viewfinder for the host: the guest shows the reply QR, the host scans
 * it instead of copying text between two phones.
 *
 * jsQR runs on every other frame at the camera's native size. The scan stops on
 * the first decode, and every failure path (no camera, no permission, no
 * decoder) leaves the paste field as the fallback, so this is never the only way
 * to connect.
 */
type Decoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

export function QrScanModal({
  onDecode,
  onClose,
}: {
  onDecode: (text: string) => void;
  onClose: () => void;
}): JSX.Element {
  const video = useRef<HTMLVideoElement>(null);
  // jsQR is a big chunk and most players never open the scanner, so it is
  // fetched the first time this modal mounts.
  const decoder = useRef<Decoder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decoded = useRef(false);
  const handler = useRef(onDecode);
  handler.current = onDecode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    let counter = 0;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    void import('jsqr')
      .then((module) => {
        decoder.current = module.default as unknown as Decoder;
      })
      .catch(() => setError('The scanner could not load. Paste the reply code instead.'));

    const tick = (): void => {
      if (stopped) return;
      const element = video.current;
      counter += 1;
      // Every other frame is plenty; decoding full resolution is the slow part.
      if (counter % 2 === 0 && element && context && element.readyState >= 2) {
        const width = element.videoWidth;
        const height = element.videoHeight;
        if (width > 0 && height > 0) {
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          context.drawImage(element, 0, 0, width, height);
          const image = context.getImageData(0, 0, width, height);
          const read = decoder.current;
          const found = read ? read(image.data, width, height) : null;
          if (found && found.data) {
            decoded.current = true;
            stopped = true;
            if (stream) for (const track of stream.getTracks()) track.stop();
            handler.current(found.data);
            return;
          }
        }
      }
      frame = window.requestAnimationFrame(tick);
    };

    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setError('This browser has no camera access. Paste the reply code instead.');
      return undefined;
    }

    void media
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((opened) => {
        if (stopped) {
          for (const track of opened.getTracks()) track.stop();
          return;
        }
        stream = opened;
        const element = video.current;
        if (element) {
          element.srcObject = opened;
          void element.play().catch(() => setError('The camera did not start. Paste the reply code instead.'));
        }
        frame = window.requestAnimationFrame(tick);
      })
      .catch(() => {
        setError('Camera blocked. Allow it, or paste the reply code instead.');
      });

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, []);

  return (
    <Modal title="Scan a reply" onClose={onClose} width={420}>
      <div className="qr-scan">
        <div className="qr-scan-frame">
          <video ref={video} playsInline muted aria-label="Camera viewfinder" />
          <span className="qr-scan-reticle" aria-hidden="true" />
        </div>
        {error ? <p className="server-note server-warn">{error}</p> : (
          <p className="qr-scan-hint">Point at the reply code on the other phone.</p>
        )}
      </div>
    </Modal>
  );
}
