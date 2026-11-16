#!/usr/bin/env tsx
/**
 * Balance simulator CLI.
 *
 *   npm run sim                        # 10 games per matchup, 2/3/4 players, normal
 *   npm run sim -- 50                  # 50 games per matchup
 *   npm run sim -- 50 --players 4      # 4-player only
 *   npm run sim -- 50 --difficulty all # easy, normal and hard in one pass
 *   npx tsx scripts/balance.ts --games 100 --players 2,3,4 --difficulty hard --seed 500
 *
 * Options:
 *   --games N            games per (player count, difficulty) matchup
 *   --players 2,3,4      player counts to run
 *   --difficulty D       easy | normal | hard | all
 *   --cards P            standard | expanded | varied
 *   --costs C            printed | shuffled
 *   --seed N             first seed; game i uses seed + i
 *   --max-actions N      per-game action cap before the run is called a stall
 *   --json               print the raw report as JSON instead of the summary
 *
 * Exits non-zero when any game had a rejected action or stalled, so it can be
 * wired into a check later.
 */
import { runBalance, formatReport, DIFFICULTIES } from '../src/server/bots/simulate.js';
import type { SimOptions } from '../src/server/bots/simulate.js';
import {
  DEFAULT_CARD_SETTINGS,
  isCardCostMode,
  isCardPoolMode,
} from '../src/shared/card-settings.js';
import type { BotDifficulty } from '../src/shared/types.js';

interface ParsedArgs {
  options: Partial<SimOptions>;
  json: boolean;
  help: boolean;
  errors: string[];
}

function parseDifficulty(value: string, errors: string[]): BotDifficulty[] | null {
  if (value === 'all') return DIFFICULTIES;
  if (value === 'easy' || value === 'normal' || value === 'hard') return [value];
  errors.push(`unknown difficulty "${value}" (easy | normal | hard | all)`);
  return null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: Partial<SimOptions> = {};
  const errors: string[] = [];
  let json = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      // Positional form: `npm run sim -- 50`.
      const games = Number.parseInt(arg, 10);
      if (Number.isFinite(games) && games > 0) options.games = games;
      else errors.push(`unrecognised argument "${arg}"`);
      continue;
    }

    const eq = arg.indexOf('=');
    const flag = eq >= 0 ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
    const next = (): string | null => {
      if (inline !== undefined) return inline;
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return null;
      index += 1;
      return value;
    };

    if (flag === '--games') {
      const raw = next();
      const games = raw === null ? NaN : Number.parseInt(raw, 10);
      if (!Number.isFinite(games) || games <= 0) errors.push('--games needs a positive integer');
      else options.games = games;
    } else if (flag === '--players') {
      const raw = next();
      if (raw === null) errors.push('--players needs a list like 2,3,4');
      else {
        const counts = raw
          .split(',')
          .map((part) => Number.parseInt(part.trim(), 10))
          .filter((value) => Number.isFinite(value));
        const bad = counts.filter((count) => count < 2 || count > 4);
        if (counts.length === 0 || bad.length > 0) errors.push('--players must be 2, 3 or 4');
        else options.playerCounts = [...new Set(counts)];
      }
    } else if (flag === '--difficulty') {
      const raw = next();
      if (raw === null) errors.push('--difficulty needs a value');
      else {
        const parsed = parseDifficulty(raw, errors);
        if (parsed) options.difficulties = parsed;
      }
    } else if (flag === '--cards') {
      const raw = next();
      if (raw === null || !isCardPoolMode(raw)) {
        errors.push('--cards must be standard, expanded or varied');
      } else {
        options.cards = { ...(options.cards ?? DEFAULT_CARD_SETTINGS), pool: raw };
      }
    } else if (flag === '--costs') {
      const raw = next();
      if (raw === null || !isCardCostMode(raw)) {
        errors.push('--costs must be printed or shuffled');
      } else {
        options.cards = { ...(options.cards ?? DEFAULT_CARD_SETTINGS), costs: raw };
      }
    } else if (flag === '--seed') {
      const raw = next();
      const seed = raw === null ? NaN : Number.parseInt(raw, 10);
      if (!Number.isFinite(seed)) errors.push('--seed needs an integer');
      else options.seed = seed;
    } else if (flag === '--max-actions') {
      const raw = next();
      const max = raw === null ? NaN : Number.parseInt(raw, 10);
      if (!Number.isFinite(max) || max <= 0) errors.push('--max-actions needs a positive integer');
      else options.maxActions = max;
    } else {
      errors.push(`unknown flag "${flag}"`);
    }
  }

  return { options, json, help, errors };
}

const HELP = `Days of Lorac balance sim

  npm run sim -- [games] [--players 2,3,4] [--difficulty easy|normal|hard|all]
                  [--cards standard|expanded|varied] [--costs printed|shuffled]
                  [--seed N] [--max-actions N] [--json]

Defaults: 10 games per matchup, players 2,3,4, difficulty normal, seed 1,
standard cards at printed prices.
`;

async function main(): Promise<void> {
  const { options, json, help, errors } = parseArgs(process.argv.slice(2));
  if (help) {
    process.stdout.write(HELP);
    return;
  }
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  const report = runBalance(options);
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(report)}\n`);
  }

  const rejected = report.buckets.reduce((sum, bucket) => sum + bucket.rejected, 0);
  const stalls = report.buckets.reduce((sum, bucket) => sum + bucket.stalls.length, 0);
  if (rejected > 0 || stalls > 0) process.exitCode = 1;
}

void main();
