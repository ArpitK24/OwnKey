import { describe, it, expect } from 'vitest';
import { DiffParser } from '../../src/core/diff/parser';
import { DiffApplier } from '../../src/core/diff/applier';

const file = ['a', 'b', 'c', 'd', 'e', 'f', ''].join('\n');

function diff(body: string[]) {
    return DiffParser.parse(['--- a/x.txt', '+++ b/x.txt', ...body].join('\n'))[0];
}

describe('DiffApplier', () => {
    it('replaces lines in place (regression: added line landed after the next line)', () => {
        const d = diff(['@@ -2,3 +2,3 @@', ' b', '-c', '+C', ' d']);
        const r = DiffApplier.applyToContent(file, d);
        expect(r.ok).toBe(true);
        expect(r.content).toBe(['a', 'b', 'C', 'd', 'e', 'f', ''].join('\n'));
    });

    it('finds a hunk whose line numbers are off', () => {
        const d = diff(['@@ -40,3 +40,3 @@', ' d', '-e', '+E', ' f']);
        const r = DiffApplier.applyToContent(file, d);
        expect(r.ok).toBe(true);
        expect(r.content).toContain('E');
        expect(r.warnings[0]).toContain('applied at line 4');
    });

    it('rejects a hunk that does not match instead of writing garbage', () => {
        const d = diff(['@@ -2,2 +2,2 @@', ' zzz', '-c', '+C']);
        const r = DiffApplier.applyToContent(file, d);
        expect(r.ok).toBe(false);
        expect(r.errors[0]).toContain('does not match');
    });

    it('handles multiple hunks, CRLF files and blank context lines without a leading space', () => {
        const crlf = ['one', '', 'two', 'three', 'four', 'five', ''].join('\r\n');
        const d = diff(['@@ -1,3 +1,3 @@', '-one', '+ONE', '', ' two', '@@ -5,1 +5,2 @@', ' five', '+six']);
        const r = DiffApplier.applyToContent(crlf, d);
        expect(r.ok).toBe(true);
        expect(r.content).toBe(['ONE', '', 'two', 'three', 'four', 'five', 'six', ''].join('\r\n'));
    });

    it('creates a new file from a /dev/null diff', () => {
        const d = DiffParser.parse(['--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1,2 @@', '+hello', '+world'].join('\n'))[0];
        expect(d.filePath).toBe('new.txt');
        const r = DiffApplier.applyToContent(null, d);
        expect(r.ok).toBe(true);
        expect(r.content).toBe('hello\nworld\n');
    });
});
