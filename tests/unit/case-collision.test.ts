import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Windows and macOS file systems are case-insensitive by default. Two paths that
// differ only by case overwrite each other there (1.4.0 shipped Keeper.js and
// keeper.js side by side, which broke every command on Windows).
describe('repository paths', () => {
  it('has no two files whose paths differ only by case', () => {
    const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of files) {
      // Compiled output drops the extension difference (.ts/.tsx -> .js).
      const key = f.toLowerCase().replace(/\.(tsx?|jsx?)$/, '');
      const prev = seen.get(key);
      if (prev) clashes.push(`${prev} <-> ${f}`);
      else seen.set(key, f);
    }
    expect(clashes).toEqual([]);
  });
});
