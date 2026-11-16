/**
 * Peer guest: the side that answers an invite.
 *
 * The guest gets an offer code (from a link or a QR scan), produces an answer,
 * and waits for the host to paste it. When the data channel opens, the ordinary
 * online client attaches to it and joins the room named in the offer, so every
 * screen after this point is the normal lobby and game.
 */
import { createDeferredSocket, rtcSocket } from './socket-like';
import type { DeferredSocket } from './socket-like';
import { decodeCode, encodeCode } from './codec';
import {
  gatheredDescription,
  ICE_SERVERS,
  isOffer,
  replyUrl,
  trimSdp,
} from './signaling';
import type { AnswerPayload, OfferPayload } from './signaling';

export class PeerGuest {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private readonly transport: DeferredSocket = createDeferredSocket();
  private offered: OfferPayload | null = null;
  private disposed = false;

  /** Decodes an invite code, link, or pasted URL. Null means "not an invite". */
  async readOffer(input: string): Promise<OfferPayload | null> {
    const payload = await decodeCode<OfferPayload>(input);
    if (!isOffer(payload)) return null;
    // Remember it here, so the UI can show the table before the guest has
    // answered, and so `join` does not need the payload passed in again.
    this.offered = payload;
    return payload;
  }

  get offer(): OfferPayload | null {
    return this.offered;
  }

  /**
   * Accepts the offer and returns the reply the host has to paste. Resolves
   * after ICE gathering, so the code is complete when it is shown.
   */
  async answer(offer: OfferPayload): Promise<{ code: string; link: string }> {
    this.offered = offer;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.ondatachannel = (event) => {
      if (this.disposed) return;
      this.channel = event.channel;
      // The channel may already be open here; the deferred socket handles both
      // orders and replays the open event either way.
      this.transport.attach(rtcSocket(event.channel));
    };

    await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const sdp = trimSdp(await gatheredDescription(pc));
    const payload: AnswerPayload = { v: 1, t: 'answer', id: offer.id, sdp };
    const code = await encodeCode(payload);
    return { code, link: replyUrl(window.location.href, code) };
  }

  /** The socket the game client should attach to, channel or not yet. */
  socket(): DeferredSocket {
    return this.transport;
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.pc?.close();
    } catch {
      // already closed
    }
    this.pc = null;
    this.channel = null;
    this.transport.close();
  }
}
