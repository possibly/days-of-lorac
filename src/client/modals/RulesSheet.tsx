import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { VP_TARGETS, VP_TARGET_SHIFT } from '@shared/constants';

/** Rules sheet. Two columns, system fonts, closes back where it opened. */
export function RulesSheet({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Modal
      title="Rules of the guild"
      width={720}
      onClose={onClose}
      className="rules-sheet"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="rules-columns">
        <section>
          <h3>Goal</h3>
          <p>Be first to the victory target: {VP_TARGETS[4]} points with four players, {VP_TARGETS[3]} with three, {VP_TARGETS[2]} with two. A compact island takes {Math.abs(VP_TARGET_SHIFT.compact)} points off the target and a grand island adds {VP_TARGET_SHIFT.grand}, because board space is the easiest victory point to find.</p>
          <h3>Turn</h3>
          <p>Draw to five. Roll 2d6. Then play cards, build, trade, and buy one card. Played cards go to your discard at end of turn. Unplayed cards stay in your hand, but every kept card is one less card you draw next turn.</p>
          <h3>Production</h3>
          <p>Settlements take one, cities take two from every hex matching the roll. The robber blocks its hex.</p>
          <h3>Seven</h3>
          <p>Everyone holding more than nine resources discards half, rounded down. Then the roller moves the robber and may steal one random resource from a player with a building on the new hex.</p>
          <h3>Build costs</h3>
          <p>Road: 1 wood, 1 brick. Settlement: 1 wood, 1 brick, 1 sheep, 1 wheat. City: 2 wheat, 3 ore. Cards are free to play.</p>
        </section>
        <section>
          <h3>Cards</h3>
          <p>Every player has a private deck. Buy one card per turn; it goes to your discard and cannot be played until a later turn. Charters score from the moment you buy them and are dead draws forever; a drawn charter is discarded at end of turn so it never clogs your hand.</p>
          <h3>Trade</h3>
          <p>Bank and port trades are unlimited. One open offer at a time: while it waits, nobody can open another. Recipients accept or decline, and the first accept executes it.</p>
          <h3>Awards</h3>
          <p>Longest trade route needs five roads. Largest expedition needs three renown. Each award is worth 2 points and changes hands only when another player strictly exceeds the holder.</p>
          <h3>Keys</h3>
          <ul className="key-list">
            <li><kbd>R</kbd> roll</li>
            <li><kbd>E</kbd> end turn</li>
            <li><kbd>B</kbd> buy</li>
            <li><kbd>T</kbd> trade</li>
            <li><kbd>1</kbd>–<kbd>9</kbd> play or pin card</li>
            <li><kbd>Space</kbd> play or confirm</li>
            <li><kbd>Esc</kbd> cancel or close</li>
            <li><kbd>?</kbd> rules</li>
            <li><kbd>M</kbd> mute</li>
            <li><kbd>L</kbd> log</li>
          </ul>
          <p className="modal-small">The board, prompt, target and your hand never collapse. On a tablet the ledger becomes a ribbon and the market becomes a drawer.</p>
        </section>
      </div>
    </Modal>
  );
}
