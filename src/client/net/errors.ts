/**
 * Wire error -> human sentence. One line per code, as listed in the UI spec.
 * Errors the server sends are the only source of rejection text; the client
 * never guesses why an action failed.
 */

const LINES: Record<string, string> = {
  NOT_YOUR_TURN: 'Not your turn yet.',
  WRONG_PHASE: 'You cannot do that right now.',
  CANNOT_AFFORD: 'Not enough resources for that.',
  PILE_EMPTY: 'That pile is empty.',
  PURCHASE_LIMIT: 'One purchase per turn.',
  OCCUPIED: 'Something is already there.',
  TOO_CLOSE: 'Too close to another building. Leave one corner between them.',
  NOT_CONNECTED: 'Connect it to your own road first.',
  INVALID_PLACEMENT: 'That spot does not follow the placement rules.',
  ROBBER_SAME_HEX: 'The robber has to move somewhere else.',
  TRADE_STALE: 'That trade is no longer possible. Nothing was exchanged.',
  CHOICE_REQUIRED: 'Pick a target for this card first.',
  RATE_LIMITED: 'Slow down a moment.',
  ROOM_NOT_FOUND: 'No room with that code.',
  ROOM_FULL: 'That room is full. Ask the host for a seat or start your own.',
  SERVER_ERROR: 'The server had a problem. Try that again.',
  ALREADY_STARTED: 'That game has already started.',
  BAD_MESSAGE: 'The server could not read that. Try again.',
  NAME_REQUIRED: 'Pick a name first.',
  NOT_HOST: 'Only the host can do that.',
  NOT_IN_ROOM: 'You are not in that room any more.',
  INVALID_ROOM: 'That room code cannot be used.',
  TOO_MANY_PLAYERS: 'That room is full.',
  NOT_ENOUGH_PLAYERS: 'Seat at least two players to start.',
  INVALID_ACTION: 'That action is not available.',
  INVALID_CHOICE: 'That is not a legal target for this card.',
  NO_CARD: 'That card is no longer in your hand.',
  CARD_NOT_PLAYABLE: 'That card cannot be played right now.',
  INVALID_DISCARD: 'Discard exactly the required number.',
  DISCARD_NOT_REQUIRED: 'You do not owe a discard.',
  INVALID_VICTIM: 'That player has nothing on that hex.',
  INVALID_ROBBER_HEX: 'Choose a hex on the island.',
  GAME_OVER: 'The game is over.',
  TRADE_EXISTS: 'An offer is already open.',
  NO_TRADE: 'That offer is closed.',
  NOT_RECIPIENT: 'That offer was not made to you.',
  INVALID_TRADE: 'That offer is not valid.',
  SETUP_COMPLETE: 'Setup is already finished.',
  SEAT_INVALID: 'That seat no longer exists.',
  INTERNAL: 'The server had a problem. Try that again.',
};

export function errorLine(code: string, fallback?: string): string {
  return LINES[code] ?? fallback ?? 'That did not work. Try again.';
}
