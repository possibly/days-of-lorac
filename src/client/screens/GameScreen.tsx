import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BankTradeOption, CardInstance, GameAction, GameView, PartialResources, Resource, Seat } from '@shared/types';
import type { ChatMessage } from '@shared/protocol';
import { getCard } from '@shared/cards';
import { LARGEST_EXPEDITION_MIN } from '@shared/constants';
import type { LinkState } from '../net/socket';
import { ActionBar } from '../action/ActionBar';
import type { Pending } from '../action/types';
import { BoardFrame } from '../board/BoardFrame';
import type { BoardMode, BoardTarget, Floater } from '../board/BoardSvg';
import { edgeLabel, vertexLabel } from '../board/BoardSvg';
import { indexBoard } from '../board/geometry';
import { HandDock } from '../hand/HandDock';
import { MarketTab } from '../market/MarketTab';
import { LedgerRail, SeatRibbon } from '../players/LedgerRail';
import { TradeTab } from '../trade/TradeTab';
import { LogTab } from '../trade/LogTab';
import { DiscardModal } from '../modals/DiscardModal';
import { ProvisionerModal } from '../modals/ProvisionerModal';
import { GameOverSheet } from '../modals/GameOverSheet';
import { Button } from '../ui/Button';
import { GuildSeal } from '../ui/icons';
import { playCue } from '../sound/audio';

type RailTab = 'market' | 'trade' | 'log';

export interface GameScreenProps {
  view: GameView;
  you: Seat;
  connected: boolean;
  link: LinkState;
  botPilot: boolean;
  /** Seats a bot is flying, from the socket snapshot. */
  pilotSeats: number[];
  chats: ChatMessage[];
  onChat: (text: string) => void;
  roomCode: string | null;
  soundOn: boolean;
  letters: boolean;
  isHost: boolean | null;
  sendAction: (action: GameAction) => void;
  onLeave: () => void;
  onRematch: () => void;
  onRules: () => void;
  onToggleSound: () => void;
  onToggleLetters: () => void;
}

export function GameScreen({
  view,
  you,
  connected,
  link,
  botPilot,
  pilotSeats,
  chats,
  onChat,
  roomCode,
  soundOn,
  letters,
  isHost,
  sendAction,
  onLeave,
  onRematch,
  onRules,
  onToggleSound,
  onToggleLetters,
}: GameScreenProps): JSX.Element {
  const send = useCallback((action: GameAction) => {
    if (!connected) return;
    sendAction(action);
  }, [connected, sendAction]);

  const [pending, setPending] = useState<Pending>(null);
  const [selection, setSelection] = useState<BoardTarget | null>(null);
  const [victim, setVictim] = useState<Seat | null>(null);
  const [inspectedIid, setInspectedIid] = useState<number | null>(null);
  const [railTab, setRailTab] = useState<RailTab>('market');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [expandedSeat, setExpandedSeat] = useState<number | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [flashHexes, setFlashHexes] = useState<string[]>([]);
  const [boughtStub, setBoughtStub] = useState<{ name: string; open: boolean } | null>(null);
  const [overOpen, setOverOpen] = useState(view.phase === 'gameOver');
  const [reducedMotion, setReducedMotion] = useState(false);

  const diceRef = useRef('');
  const floaterTimer = useRef<number | undefined>(undefined);
  const stubTimer = useRef<number | undefined>(undefined);
  const purchasesRef = useRef({ gameId: view.gameId, seat: view.you, count: view.players[view.you]?.purchases ?? 0 });
  const cueRef = useRef<{ version: number; roads: number; buildings: number; played: number; awards: string; winner: number | null; dice: string; purchases: number } | null>(null);
  const youView = view.players[view.you];
  const hand = youView?.hand ?? [];

  // ----- responsive / motion preferences ----------------------------------
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // ----- purchase tracking -------------------------------------------------
  // The engine reports this directly once per turn, so no guessing from market
  // stock. Another seat's purchase never flips our chip.
  const purchaseUsed = Boolean(view.legal.purchaseUsed);

  // The bought-card stub belongs to our own purchase counter, not to a pile
  // losing a copy. The buy log line carries the defId for the label.
  useEffect(() => {
    const count = youView?.purchases ?? 0;
    const previous = purchasesRef.current;
    if (previous.gameId !== view.gameId || previous.seat !== view.you) {
      purchasesRef.current = { gameId: view.gameId, seat: view.you, count };
      return;
    }
    if (count <= previous.count) {
      if (count < previous.count) purchasesRef.current = { ...previous, count };
      return;
    }
    purchasesRef.current = { ...previous, count };
    const entry = [...view.log].reverse().find((item) => item.kind === 'buy' && item.seat === view.you);
    const rawId = entry?.data?.defId;
    const def = typeof rawId === 'string' ? safeCard(rawId) : null;
    setBoughtStub({ name: def?.name ?? 'a card', open: true });
    if (stubTimer.current !== undefined) window.clearTimeout(stubTimer.current);
    stubTimer.current = window.setTimeout(() => setBoughtStub(null), 1800);
  }, [youView?.purchases, view.gameId, view.you, view.log]);

  useEffect(() => () => {
    if (stubTimer.current !== undefined) window.clearTimeout(stubTimer.current);
    if (floaterTimer.current !== undefined) window.clearTimeout(floaterTimer.current);
  }, []);

  // ----- production feedback ----------------------------------------------
  // Keyed on the roll itself. `version` moves on every action, so keying on it
  // replayed the floaters and the dice tumble after every build or buy.
  useEffect(() => {
    const dice = view.dice;
    if (!dice) {
      diceRef.current = '';
      return;
    }
    const key = `${view.gameId}:${view.turn}:${dice.die1}:${dice.die2}`;
    if (key === diceRef.current) return;
    diceRef.current = key;
    const index = indexBoard(view.board);
    const list: Floater[] = [];
    const blocked: string[] = [];
    const paying: string[] = [];
    if (dice.total !== 7) {
      for (const hex of view.board.hexes) {
        if (hex.token !== dice.total) continue;
        if (hex.id === view.robberHex) {
          blocked.push(hex.id);
          list.push({
            id: `blocked-${hex.id}`,
            x: hex.x,
            y: hex.y - 0.1 * index.scale,
            text: `− ${hex.terrain}`,
            tone: 'blocked',
          });
          continue;
        }
        paying.push(hex.id);
        for (const vertexId of hex.vertices) {
          const building = view.buildings[vertexId];
          if (!building) continue;
          const vertex = index.vertex.get(vertexId);
          if (!vertex) continue;
          const amount = building.type === 'city' ? 2 : 1;
          list.push({
            id: `gain-${hex.id}-${vertexId}`,
            x: vertex.x,
            y: vertex.y - 0.1 * index.scale,
            text: `+${amount} ${hex.terrain === 'desert' ? '' : hex.terrain}`,
            tone: 'gain',
          });
        }
      }
    }
    setFloaters(list);
    setFlashHexes([...blocked, ...paying]);
    if (floaterTimer.current !== undefined) window.clearTimeout(floaterTimer.current);
    floaterTimer.current = window.setTimeout(() => {
      setFloaters([]);
      setFlashHexes([]);
    }, 1100);
  }, [view]);

  // ----- sound cues --------------------------------------------------------
  // One cue per real change: our own purchase, any placement, any card, an
  // award, the win, and a roll only when new dice land.
  useEffect(() => {
    const roads = Object.keys(view.roads).length;
    const buildings = Object.keys(view.buildings).length;
    const played = view.players.reduce((sum, player) => sum + player.playedCount, 0);
    const awards = `${view.awards.longestRoad}/${view.awards.largestExpedition}`;
    const winner = view.winner;
    const purchases = youView?.purchases ?? 0;
    const diceKey = view.dice ? `${view.dice.die1}:${view.dice.die2}` : '';
    const previous = cueRef.current;
    cueRef.current = { version: view.version, roads, buildings, played, awards, winner, dice: diceKey, purchases };
    if (!previous || previous.version === view.version) return;
    if (winner !== null && previous.winner === null) {
      playCue('win');
      return;
    }
    if (awards !== previous.awards) {
      playCue('award');
      return;
    }
    if (diceKey !== '' && diceKey !== previous.dice) {
      playCue('roll');
      return;
    }
    if (played > previous.played) {
      playCue('card');
      return;
    }
    if (purchases > previous.purchases) {
      playCue('buy');
      return;
    }
    if (roads > previous.roads || buildings > previous.buildings) {
      playCue('place');
    }
  }, [view, youView?.purchases]);

  // Keep the discard sheet open while we owe a discard. Another seat's update
  // arrives as a new view and used to close ours mid-selection.
  const owesDiscard = Boolean(view.legal.discard);
  const owedRef = useRef(false);
  useEffect(() => {
    if (!owesDiscard) {
      if (owedRef.current) setDiscardOpen(false);
      owedRef.current = false;
      return;
    }
    if (!owedRef.current) setDiscardOpen(true);
    owedRef.current = true;
  }, [owesDiscard]);

  useEffect(() => {
    if (view.phase === 'gameOver') setOverOpen(true);
  }, [view.phase]);

  useEffect(() => {
    if (pending?.type === 'provisioner') {
      const still = hand.some((card) => card.iid === pending.iid);
      if (!still) setPending(null);
    }
  }, [hand, pending]);

  useEffect(() => {
    if (inspectedIid !== null && !hand.some((card) => card.iid === inspectedIid)) setInspectedIid(null);
  }, [hand, inspectedIid]);

  const playable = useMemo(() => new Map(view.legal.playable.map((entry) => [entry.iid, entry])), [view.legal.playable]);
  const playableIids = useMemo(() => new Set(view.legal.playable.map((entry) => entry.iid)), [view.legal.playable]);
  const choiceIids = useMemo(() => new Set(view.legal.playable.filter((entry) => entry.choice !== null).map((entry) => entry.iid)), [view.legal.playable]);
  const inspected = inspectedIid === null ? null : hand.find((card) => card.iid === inspectedIid) ?? null;


  // ----- targeting derivation ---------------------------------------------
  const mode: BoardMode = (() => {
    if (view.phase === 'setup' && view.legal.isTurn) {
      return view.setup?.step === 'road' ? 'setupRoad' : 'setupSettlement';
    }
    if (view.phase === 'robber' && view.legal.robber) return 'robber';
    if (pending?.type === 'build') return pending.kind;
    if (pending?.type === 'card') {
      if (pending.choice === 'road') return 'road';
      if (pending.choice === 'settlement') return 'settlement';
      return 'robber';
    }
    return 'idle';
  })();

  const legalVertices = (() => {
    if (view.phase === 'setup' && view.legal.isTurn) return view.setup?.step === 'road' ? [] : view.legal.setupSettlements;
    if (pending?.type === 'build') {
      if (pending.kind === 'settlement') return view.legal.build.settlements;
      if (pending.kind === 'city') return view.legal.build.cities;
      return [];
    }
    if (pending?.type === 'card' && pending.choice === 'settlement') {
      return playable.get(pending.iid)?.settlementOptions ?? [];
    }
    return [];
  })();

  const legalEdges = (() => {
    if (view.phase === 'setup' && view.legal.isTurn) return view.setup?.step === 'road' ? view.legal.setupRoads : [];
    if (pending?.type === 'build' && pending.kind === 'road') return view.legal.build.roads;
    if (pending?.type === 'card' && pending.choice === 'road') return playable.get(pending.iid)?.roadOptions ?? [];
    return [];
  })();

  const legalHexes = (() => {
    if (pending?.type === 'card' && pending.choice === 'robber') return playable.get(pending.iid)?.robberHexes ?? [];
    if (view.phase === 'robber' && view.legal.robber) return view.legal.robber.hexes;
    return [];
  })();

  const victimMap = (() => {
    if (pending?.type === 'card' && pending.choice === 'robber') {
      const entry = playable.get(pending.iid);
      return selection?.kind === 'hex' ? entry?.robberVictims?.[selection.id] ?? [] : [];
    }
    if (view.phase === 'robber' && view.legal.robber && selection?.kind === 'hex') {
      return view.legal.robber.victims[selection.id] ?? [];
    }
    return [];
  })();

  const targetList = useMemo(() => {
    const index = indexBoard(view.board);
    if (legalVertices.length > 0) {
      return legalVertices.map((id) => ({ id, kind: 'vertex' as const, label: vertexLabel(view, index, id) }));
    }
    if (legalEdges.length > 0) {
      return legalEdges.map((id) => ({ id, kind: 'edge' as const, label: edgeLabel(view, index, id) }));
    }
    if (legalHexes.length > 0) {
      return legalHexes.map((id) => {
        const hex = view.board.hexes.find((item) => item.id === id);
        return { id, kind: 'hex' as const, label: `Move the robber to ${hex?.terrain ?? 'hex'} ${hex?.token ?? ''}`.trim() };
      });
    }
    return [];
  }, [legalVertices, legalEdges, legalHexes, view]);

  // ----- actions -----------------------------------------------------------
  const cancel = useCallback(() => {
    setPending(null);
    setSelection(null);
    setVictim(null);
    setDrawerOpen(false);
  }, []);

  const play = useCallback((iid: number) => {
    if (!connected) return;
    const entry = playable.get(iid);
    if (!entry) {
      setInspectedIid(iid);
      return;
    }
    const def = safeCard(entry.defId);
    if (!def) return;
    if (entry.choice === 'resources') {
      setInspectedIid(null);
      setPending({ type: 'provisioner', iid, name: def.name });
      return;
    }
    if (entry.choice === 'road') {
      if ((entry.roadOptions ?? []).length === 0) {
        send({ type: 'playCard', iid });
        setInspectedIid(null);
        return;
      }
      setSelection(null);
      setPending({ type: 'card', iid, choice: 'road', name: def.name });
      return;
    }
    if (entry.choice === 'settlement') {
      if ((entry.settlementOptions ?? []).length === 0) {
        send({ type: 'playCard', iid });
        setInspectedIid(null);
        return;
      }
      setSelection(null);
      setPending({ type: 'card', iid, choice: 'settlement', name: def.name });
      return;
    }
    if (entry.choice === 'robber') {
      if ((entry.robberHexes ?? []).length === 0) {
        send({ type: 'playCard', iid, choice: { kind: 'robber' } });
        setInspectedIid(null);
        return;
      }
      setSelection(null);
      setVictim(null);
      setPending({ type: 'card', iid, choice: 'robber', name: def.name });
      return;
    }
    send({ type: 'playCard', iid });
    setInspectedIid(null);
  }, [connected, playable, send]);

  const select = useCallback((target: BoardTarget) => {
    if (!connected) return;
    if (view.phase === 'setup') {
      if (view.setup?.step === 'road' && target.kind === 'edge') send({ type: 'setupRoad', edge: target.id });
      else if (view.setup?.step === 'settlement' && target.kind === 'vertex') send({ type: 'setupSettlement', vertex: target.id });
      return;
    }
    if (pending?.type === 'build') {
      if (pending.kind === 'road' && target.kind === 'edge') send({ type: 'buildRoad', edge: target.id });
      if (pending.kind === 'settlement' && target.kind === 'vertex') send({ type: 'buildSettlement', vertex: target.id });
      if (pending.kind === 'city' && target.kind === 'vertex') send({ type: 'buildCity', vertex: target.id });
      setPending(null);
      return;
    }
    if (pending?.type === 'card') {
      if (pending.choice === 'road' && target.kind === 'edge') {
        send({ type: 'playCard', iid: pending.iid, choice: { kind: 'road', edge: target.id } });
        setPending(null);
        return;
      }
      if (pending.choice === 'settlement' && target.kind === 'vertex') {
        send({ type: 'playCard', iid: pending.iid, choice: { kind: 'settlement', vertex: target.id } });
        setPending(null);
        return;
      }
      if (pending.choice === 'robber' && target.kind === 'hex') {
        setSelection(target);
        const victims = playable.get(pending.iid)?.robberVictims?.[target.id] ?? [];
        setVictim(victims[0] ?? null);
        return;
      }
      return;
    }
    if (view.phase === 'robber' && target.kind === 'hex') {
      setSelection(target);
      const victims = view.legal.robber?.victims[target.id] ?? [];
      setVictim(victims[0] ?? null);
    }
  }, [connected, pending, playable, send, view]);

  const confirmRobber = useCallback(() => {
    if (!connected) return;
    if (view.phase === 'robber' && selection?.kind === 'hex') {
      send({ type: 'moveRobber', hex: selection.id, ...(victim !== null ? { victimSeat: victim } : {}) });
      setSelection(null);
      setVictim(null);
      return;
    }
    if (pending?.type === 'card' && pending.choice === 'robber') {
      if (selection?.kind === 'hex') {
        send({ type: 'playCard', iid: pending.iid, choice: { kind: 'robber', move: { hex: selection.id, ...(victim !== null ? { victimSeat: victim } : {}) } } });
      } else {
        send({ type: 'playCard', iid: pending.iid, choice: { kind: 'robber' } });
      }
      setPending(null);
      setSelection(null);
      setVictim(null);
    }
  }, [connected, pending, selection, send, victim, view.phase]);

  // ----- keyboard ----------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (key === 'Escape') {
        if (pending || selection) {
          event.preventDefault();
          cancel();
        } else if (drawerOpen) setDrawerOpen(false);
        else if (inspectedIid !== null) setInspectedIid(null);
        return;
      }
      if (key === '?' || (key === '/' && event.shiftKey)) {
        event.preventDefault();
        onRules();
        return;
      }
      if (key === 'm' || key === 'M') {
        event.preventDefault();
        onToggleSound();
        return;
      }
      if (key === 'l' || key === 'L') {
        event.preventDefault();
        setRailTab('log');
        setDrawerOpen(true);
        return;
      }
      if (key === 'r' || key === 'R') {
        if (view.legal.canRoll) {
          event.preventDefault();
          send({ type: 'roll' });
        }
        return;
      }
      if (key === 'e' || key === 'E') {
        if (view.legal.canEndTurn) {
          event.preventDefault();
          send({ type: 'endTurn' });
        }
        return;
      }
      if (key === 'b' || key === 'B') {
        event.preventDefault();
        setRailTab('market');
        setDrawerOpen(true);
        return;
      }
      if (key === 't' || key === 'T') {
        event.preventDefault();
        setRailTab('trade');
        setDrawerOpen(true);
        return;
      }
      if (key === ' ' && (pending || selection)) {
        event.preventDefault();
        if (view.phase === 'robber' || pending?.type === 'card') confirmRobber();
        return;
      }
      if (key === 'ArrowRight' || key === 'ArrowLeft' || key === 'ArrowDown' || key === 'ArrowUp') {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('.board-svg .target'));
        if (nodes.length === 0) return;
        const currentIndex = nodes.indexOf(document.activeElement as HTMLElement);
        if (currentIndex < 0) return;
        event.preventDefault();
        const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
        const next = nodes[(currentIndex + delta + nodes.length) % nodes.length];
        next?.focus();
        return;
      }
      if (/^[1-9]$/.test(key)) {
        const index = Number(key) - 1;
        const card = hand[index];
        if (!card) return;
        event.preventDefault();
        setInspectedIid(card.iid);
        if (playableIids.has(card.iid)) play(card.iid);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel, confirmRobber, drawerOpen, hand, inspectedIid, onRules, onToggleSound, pending, play, playableIids, selection, send, view.legal.canEndTurn, view.legal.canRoll, view.phase]);

  // ----- table talk & offer banner ----------------------------------------
  const tableTalk = useMemo(() => {
    if (view.phase === 'gameOver') {
      const winner = view.players.find((player) => player.seat === view.winner);
      return winner ? `${winner.name} wins at ${winner.vp}.` : 'The game is over.';
    }
    if (view.dice) {
      const totalGain = Object.values(view.dice.gains).reduce((sum, gain) => sum + Object.values(gain).reduce((a, b) => a + (b ?? 0), 0), 0);
      if (view.dice.total === 7) return 'Seven. Discards, then the robber moves.';
      return `${view.dice.die1} + ${view.dice.die2} = ${view.dice.total}. ${totalGain > 0 ? `${totalGain} resources produced.` : 'Nothing produced.'}`;
    }
    const latest = view.log[view.log.length - 1];
    return latest?.text ?? 'The island waits.';
  }, [view]);

  const offer = view.tradeOffer;
  const incoming = offer && offer.from !== view.you && offer.to.includes(view.you);

  const describeOffer = (map: PartialResources): string => {
    const parts = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as Resource[])
      .filter((resource) => (map[resource] ?? 0) > 0)
      .map((resource) => `${map[resource]} ${resource}`);
    return parts.join(' and ') || 'nothing';
  };

  const openRail = (tab: RailTab): void => {
    setRailTab(tab);
    setDrawerOpen(true);
  };

  const turnChip = view.phase === 'gameOver'
    ? 'Game over'
    : view.legal.isTurn
      ? `Turn ${view.turn}, your move`
      : `Turn ${view.turn}, ${view.players[view.currentSeat]?.name ?? 'waiting'}`;

  const rail = railTab === 'market'
    ? <MarketTab view={view} purchaseUsed={purchaseUsed} onBuy={(defId) => send({ type: 'buyCard', defId })} letters={letters} />
    : railTab === 'trade'
      ? (
        <TradeTab
          view={view}
          letters={letters}
          onOffer={(give, want, to) => send({ type: 'offerTrade', give, want, to })}
          onCancelOffer={() => send({ type: 'cancelTrade' })}
          onBankTrade={(option: BankTradeOption) => send({ type: 'bankTrade', give: option.give, receive: option.receive, count: option.count })}
        />
      )
      : (
        <LogTab
          view={view}
          chats={chats}
          connected={connected}
          onChat={onChat}
        />
      );


  return (
    <div className={`game-screen${reducedMotion ? ' reduced-motion' : ''}`}>
      <header className="game-header">
        <button type="button" className="home-seal" onClick={onLeave} title="Leave the table and return to the title" aria-label="Leave the table">
          <GuildSeal size={32} />
        </button>
        <span className="header-wordmark">Days of Lorac</span>
        <span className="turn-chip">
          <span className="turn-dot" style={{ background: view.players[view.currentSeat] ? 'var(--gold-300)' : 'var(--ink-500)' }} aria-hidden="true" />
          <span className="hide-phone">{turnChip}</span>
          <span className="only-phone">T{view.turn} · {view.legal.isTurn ? 'you' : (view.players[view.currentSeat]?.name ?? '…')}</span>
        </span>
        <span className="target-chip" title="Victory target for this table">
          <span className="hide-phone">Race to {view.targetVp}</span>
          <span className="only-phone">to {view.targetVp}</span>
        </span>
        {roomCode ? <span className="room-chip mono" title="Room code">Room {roomCode}</span> : null}
        <div className="header-actions">
          <button type="button" className="header-btn" onClick={onToggleLetters} aria-pressed={letters} title="Show W/B/S/H/O letters under resource icons">
            <span className="hide-phone">{letters ? 'Letters on' : 'Letters off'}</span>
            <span className="only-phone">Aa</span>
          </button>
          <button type="button" className="header-btn" onClick={onToggleSound} aria-pressed={soundOn} title="Toggle sound cues">
            <span className="hide-phone">{soundOn ? 'Sound on' : 'Sound off'}</span>
            <span className="only-phone">{soundOn ? 'Snd' : 'Mute'}</span>
          </button>
          <button type="button" className="header-btn" onClick={onRules} title="Rules (?)">Rules</button>
          <button type="button" className="header-btn header-leave" onClick={onLeave} title="Leave the table">Leave</button>
        </div>
      </header>

      {!connected ? (
        <div className="reconnect-banner" role="status">
          <span>Connection lost. Reconnecting…</span>
          <span className="indeterminate" aria-hidden="true" />
        </div>
      ) : null}

      {botPilot ? (
        <div className="pilot-strip" role="status" title="Bot pilot">
          A bot is playing your seat. Reconnect to take back control.
        </div>
      ) : null}

      <div className="game-body">
        <LedgerRail
          view={view}
          inspected={inspected}
          canPlayInspected={inspected ? playableIids.has(inspected.iid) : false}
          inspectedNeedsChoice={inspected ? (playable.get(inspected.iid)?.choice ?? null) !== null : false}
          onPlayInspected={() => { if (inspected) play(inspected.iid); }}
          onCloseInspector={() => setInspectedIid(null)}
          letters={letters}
          pilotSeats={pilotSeats}
        />

        <main className="center-column">
          <SeatRibbon view={view} pilotSeats={pilotSeats} expanded={expandedSeat} onExpand={setExpandedSeat} letters={letters} />

          <div className="board-wrap">
            <BoardFrame
              view={view}
              mode={mode}
              legalVertices={legalVertices}
              legalEdges={legalEdges}
              legalHexes={legalHexes}
              selected={selection}
              floaters={floaters}
              flashHexes={flashHexes}
              onSelect={select}
              targetList={targetList}
              tableTalk={tableTalk}
            />
            {incoming && offer ? (
              <div className="offer-banner" role="status">
                <span><b>{view.players[offer.from]?.name}</b> offers {describeOffer(offer.give)} for {describeOffer(offer.want)}.</span>
                <div className="offer-banner-actions">
                  <Button variant="primary" className="btn-small" onClick={() => send({ type: 'respondTrade', offerId: offer.id, accept: true })}>Accept</Button>
                  <Button variant="secondary" className="btn-small" onClick={() => send({ type: 'respondTrade', offerId: offer.id, accept: false })}>Decline</Button>
                </div>
              </div>
            ) : null}
          </div>

          <ActionBar
            view={view}
            pending={pending}
            selection={selection}
            victim={victim}
            purchaseUsed={purchaseUsed}
            onRoll={() => send({ type: 'roll' })}
            onEndTurn={() => send({ type: 'endTurn' })}
            onOpenTrade={() => openRail('trade')}
            onOpenMarket={() => openRail('market')}
            onDiscard={() => setDiscardOpen(true)}
            onMoveRobber={confirmRobber}
            onVictim={(seat) => setVictim(seat)}
            onCancel={cancel}
            onSkipRobber={() => {
              if (pending?.type === 'card') {
                send({ type: 'playCard', iid: pending.iid, choice: { kind: 'robber' } });
                setPending(null);
                setSelection(null);
                setVictim(null);
              }
            }}
            onAccept={() => offer && send({ type: 'respondTrade', offerId: offer.id, accept: true })}
            onDecline={() => offer && send({ type: 'respondTrade', offerId: offer.id, accept: false })}
            onCancelOffer={() => send({ type: 'cancelTrade' })}
            onSeeResult={() => setOverOpen(true)}
            onConfirmRobber={confirmRobber}
            frozen={!connected}
          />

          <HandDock
            view={view}
            playableIids={playableIids}
            choiceIids={choiceIids}
            selectedIid={inspectedIid}
            onPlay={play}
            onInspect={(card: CardInstance) => setInspectedIid(card.iid)}
            letters={letters}
            boughtStub={boughtStub}
          />
        </main>

        <aside className={`supply-rail${drawerOpen ? ' is-open' : ''}`} aria-label="Market, trade, and log">
          <div className="rail-tabs" role="tablist" aria-label="Supply rail">
            <button type="button" role="tab" aria-selected={railTab === 'market'} className={`rail-tab${railTab === 'market' ? ' is-on' : ''}`} onClick={() => setRailTab('market')}>Market</button>
            <button type="button" role="tab" aria-selected={railTab === 'trade'} className={`rail-tab${railTab === 'trade' ? ' is-on' : ''}`} onClick={() => setRailTab('trade')}>
              Trade{offer && offer.from !== view.you ? <span className="tab-dot" aria-label="incoming offer" /> : null}
            </button>
            <button type="button" role="tab" aria-selected={railTab === 'log'} className={`rail-tab${railTab === 'log' ? ' is-on' : ''}`} onClick={() => setRailTab('log')}>Log</button>
            <button type="button" className="rail-close" onClick={() => setDrawerOpen(false)} aria-label="Close supply drawer">×</button>
          </div>
          <div className="rail-content">{rail}</div>
        </aside>
        {drawerOpen ? <button type="button" className="drawer-scrim" aria-label="Close supply drawer" onClick={() => setDrawerOpen(false)} /> : null}
      </div>

      {discardOpen && view.legal.discard ? (
        <DiscardModal
          required={view.legal.discard.required}
          resources={{ ...(youView?.resources ?? { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }) }}
          onConfirm={(resources) => {
            send({ type: 'discard', resources });
            setDiscardOpen(false);
          }}
        />
      ) : null}

      {pending?.type === 'provisioner' ? (
        <ProvisionerModal
          onConfirm={(resources) => {
            send({ type: 'playCard', iid: pending.iid, choice: { kind: 'resources', resources } });
            setPending(null);
          }}
          onResolveAsWood={() => {
            send({ type: 'playCard', iid: pending.iid, choice: { kind: 'resources', resources: ['wood', 'wood'] } });
            setPending(null);
          }}
        />
      ) : null}

      {overOpen && view.phase === 'gameOver' ? (
        <GameOverSheet
          view={view}
          isHost={isHost}
          onRematch={() => { setOverOpen(false); onRematch(); }}
          onTitle={onLeave}
        />
      ) : null}

      <p className="sr-only">
        {youView && `You hold ${youView.handCount} cards. Renown ${youView.renown} of ${LARGEST_EXPEDITION_MIN}. Victory ${youView.vp} of ${view.targetVp}.`}
      </p>
    </div>
  );
}

function safeCard(defId: string) {
  try {
    return getCard(defId);
  } catch {
    return null;
  }
}
