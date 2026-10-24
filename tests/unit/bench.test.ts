import { describe, it, expect } from 'vitest';
import { BENCH_CASES } from '../../src/bench/cases';
import { plantedLine, scoreCase, summarize, matchesPlanted } from '../../src/bench/score';

const offByOne = BENCH_CASES.find((c) => c.id === 'off-by-one')!;
const control = BENCH_CASES.find((c) => c.id === 'clean-refactor')!;
const f = (over: Partial<{ filePath: string; line: number; type: string; severity: any }>) => ({
    filePath: offByOne.file,
    line: plantedLine(offByOne),
    type: 'bug',
    severity: 'high' as const,
    content: 'x',
    ...over,
});

describe('bench cases', () => {
    it('has unique ids and real changes', () => {
        expect(new Set(BENCH_CASES.map((c) => c.id)).size).toBe(BENCH_CASES.length);
        for (const c of BENCH_CASES) expect(c.changed, c.id).not.toBe(c.base);
    });

    it('plants each bug on exactly one line that the change introduces', () => {
        for (const c of BENCH_CASES.filter((x) => x.expect)) {
            const hits = c.changed.split('\n').filter((l) => l.includes(c.expect!.needle));
            expect(hits.length, c.id).toBe(1);
            expect(c.base.includes(hits[0]), `${c.id}: planted line must be new in the change`).toBe(false);
        }
    });

    it('includes controls', () => {
        expect(BENCH_CASES.filter((c) => !c.expect).length).toBeGreaterThanOrEqual(3);
    });
});

describe('bench scoring', () => {
    it('matches on file, nearby line, and type', () => {
        expect(matchesPlanted(offByOne, f({}))).toBe(true);
        expect(matchesPlanted(offByOne, f({ line: plantedLine(offByOne) + 3 }))).toBe(true);
        expect(matchesPlanted(offByOne, f({ line: plantedLine(offByOne) + 4 }))).toBe(false);
        expect(matchesPlanted(offByOne, f({ type: 'style' }))).toBe(false);
        expect(matchesPlanted(offByOne, f({ filePath: 'other.js' }))).toBe(false);
    });

    it('counts only medium+ unmatched findings as noise', () => {
        const r = scoreCase(offByOne, [f({}), f({ type: 'style', severity: 'low' }), f({ type: 'performance', severity: 'medium' })]);
        expect(r).toMatchObject({ caught: true, matched: 1, noise: 1, kind: 'bug' });
    });

    it('summarizes recall, precision, and flagged controls', () => {
        const s = summarize([
            scoreCase(offByOne, [f({})]),
            scoreCase(BENCH_CASES.find((c) => c.id === 'sql-injection')!, []),
            scoreCase(control, [f({ filePath: control.file, severity: 'high' })]),
        ]);
        expect(s).toMatchObject({ bugCases: 2, caught: 1, recall: 0.5, controlCases: 1, controlsFlagged: 1, precision: 0.5 });
        expect(summarize([]).precision).toBe(1);
    });
});
