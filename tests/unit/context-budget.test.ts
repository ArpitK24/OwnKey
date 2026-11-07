import { describe, it, expect } from 'vitest';
import { fitContext } from '../../src/core/review/run';

const file = (name: string, size: number) => ({ path: name, relativePath: name, extension: '.ts', size, content: 'x'.repeat(size) }) as any;

describe('fitting the first prompt to the context', () => {
    it('keeps everything that fits', () => {
        const r = fitContext([file('a.ts', 10), file('b.ts', 10)], 'diff', 1000);
        expect(r.trimmed).toEqual([]);
        expect(r.files[1].content).toBe('x'.repeat(10));
    });

    it('replaces files that do not fit with a pointer to read_file, and keeps the diff', () => {
        const r = fitContext([file('a.ts', 300), file('big.ts', 900), file('c.ts', 100)], 'd'.repeat(200), 1000);
        expect(r.patch).toBe('d'.repeat(200));
        expect(r.trimmed).toEqual(['big.ts']);
        expect(r.files[1].content).toContain('use read_file');
        expect(r.files[2].content).toBe('x'.repeat(100));
    });

    it('cuts whole file diffs from a diff that alone is too long', () => {
        const patch = 'diff --git a/a b/a\n' + 'a'.repeat(400) + '\ndiff --git a/b b/b\n' + 'b'.repeat(400) + '\n';
        const r = fitContext([], patch, 1000);
        expect(r.patch).toContain('a/a');
        expect(r.patch).not.toContain('b/b');
        expect(r.patch).toContain('1 more file diff(s) left out');
    });
});
