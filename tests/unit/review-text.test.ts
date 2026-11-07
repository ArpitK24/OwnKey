import { describe, it, expect } from 'vitest';
import { codeFrame, renderFindings, severityCounts, wrap } from '../../src/core/review/text';
import type { Finding } from '../../src/core/review/report';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const f = (over: Partial<Finding>): Finding => ({ type: 'bug', severity: 'high', content: 'x', filePath: 'a.ts', line: 2, rationale: '', diff: '', ...over }) as Finding;

describe('terminal review output', () => {
    it('frames the flagged line with its neighbours and clamps at the file edges', () => {
        const lines = ['one', 'two', 'three'];
        expect(codeFrame(lines, 2).map(strip)).toEqual(['  1 │ one', '▶ 2 │ two', '  3 │ three']);
        expect(codeFrame(lines, 1).map(strip)).toEqual(['▶ 1 │ one', '  2 │ two']);
        expect(codeFrame(lines, 9)).toEqual([]);
    });

    it('wraps prose with a hanging indent', () => {
        expect(wrap('aaa bbb ccc ddd', 8, '  ')).toEqual(['  aaa bbb', '  ccc ddd']);
    });

    it('groups findings by file with badge, frame, reasoning and fix command', () => {
        const out = strip(
            renderFindings(
                [
                    f({ id: 'abc', content: 'Missing await', rationale: 'Promise is dropped', diff: '--- a/a.ts\n+++ b/a.ts\n' }),
                    f({ filePath: 'b.ts', severity: 'medium', type: 'security', line: 1, content: 'Trusts client price' }),
                ],
                { readLines: (file) => (file === 'a.ts' ? ['x', 'save()', 'y'] : undefined) }
            )
        );
        expect(out).toContain('a.ts (1)');
        expect(out).toContain('HIGH · bug · L2');
        expect(out).toContain('▶ 2 │ save()');
        expect(out).toContain('Promise is dropped');
        expect(out).toContain('fix  ownkey apply abc');
        expect(out).toContain('b.ts (1)');
        expect(out).toContain('MEDIUM · security · L1');
        expect(out.indexOf('a.ts (1)')).toBeLessThan(out.indexOf('b.ts (1)'));
    });

    it('counts by severity, highest first', () => {
        expect(severityCounts([f({ severity: 'low' }), f({ severity: 'critical' }), f({ severity: 'low' })])).toBe('1 critical · 2 low');
    });
});
