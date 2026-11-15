/** Client-only targeting state. Nothing here decides legality; it only says
 * which legal array the board should draw. */
export type Pending =
  | { type: 'build'; kind: 'road' | 'settlement' | 'city' }
  | { type: 'card'; iid: number; choice: 'road' | 'settlement' | 'robber'; name: string }
  | { type: 'provisioner'; iid: number; name: string }
  | null;
