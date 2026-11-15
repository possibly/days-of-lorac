import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GAME_VERSION, versionLabel } from '@shared/version';

const packageJsonPath = fileURLToPath(new URL('../../../package.json', import.meta.url));

describe('GAME_VERSION', () => {
  it('is valid semver', () => {
    expect(GAME_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it('matches the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
    expect(pkg.version).toBe(GAME_VERSION);
  });

  it('formats as a UI label', () => {
    expect(versionLabel()).toBe(`v${GAME_VERSION}`);
  });
});
