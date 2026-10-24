import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    keeperAnimates,
    keeperEye,
    keeperFrame,
    keeperSegments,
    keeperShown,
    keeperSize,
    reportKeeperMood,
    type KeeperMood,
    type KeeperSize,
} from '../../src/ui/keeper';
import { keeperPose } from '../../src/ui/keeper-term';
import { moodFor } from '../../src/ui/session';

const MOODS: KeeperMood[] = ['idle', 'thinking', 'found', 'clean', 'error'];
const SIZES: KeeperSize[] = ['full', 'compact', 'inline'];
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('Keeper sizing', () => {
    it('picks the largest size that fits the terminal', () => {
        expect(keeperSize(120)).toBe('full');
        expect(keeperSize(72)).toBe('full');
        expect(keeperSize(71)).toBe('compact');
        expect(keeperSize(44)).toBe('compact');
        expect(keeperSize(43)).toBe('inline');
        expect(keeperSize(24)).toBe('inline');
        expect(keeperSize(23)).toBe('none');
    });

    it('drops to compact on short terminals and assumes 80 columns when unknown', () => {
        expect(keeperSize(120, 12)).toBe('compact');
        expect(keeperSize(undefined)).toBe('full');
        expect(keeperSize(0)).toBe('full');
    });
});

describe('Keeper frames', () => {
    it('keeps every frame rectangular and the same height across moods and ticks', () => {
        for (const size of SIZES) {
            const heights = new Set<number>();
            for (const mood of MOODS) {
                for (let tick = 0; tick < 40; tick++) {
                    const frame = keeperFrame(mood, size, tick);
                    heights.add(frame.length);
                    const widths = new Set(frame.map((l) => [...l].length));
                    expect(widths.size, `${size}/${mood}/${tick}`).toBe(1);
                }
            }
            // A changing height would make the terminal jump while Keeper animates
            expect(heights.size, size).toBe(1);
        }
    });

    it('fits inside its breakpoint with room for text', () => {
        expect([...keeperFrame('idle', 'full')[0]].length).toBeLessThanOrEqual(20);
        expect([...keeperFrame('idle', 'compact')[0]].length).toBeLessThanOrEqual(12);
        expect([...keeperFrame('idle', 'inline')[0]].length).toBeLessThanOrEqual(12);
        expect(keeperFrame('idle', 'none')).toEqual([]);
    });

    it('looks around while thinking and holds an expression otherwise', () => {
        const positions = new Set(Array.from({ length: 8 }, (_, t) => keeperEye('thinking', t).pos));
        expect(positions).toEqual(new Set([-1, 0, 1]));
        expect(keeperFrame('thinking', 'inline', 1)).not.toEqual(keeperFrame('thinking', 'inline', 4));
        expect(keeperFrame('clean', 'compact').join('\n')).toContain('◠ ◠');
        expect(keeperFrame('error', 'inline')[0]).toContain('×');
        expect(keeperFrame('found', 'compact', 0)[0]).toContain('!');
    });

    it('blinks now and then when idle', () => {
        const eyes = Array.from({ length: 32 }, (_, t) => keeperEye('idle', t).glyph);
        expect(eyes.filter((g) => g === '─').length).toBeGreaterThan(0);
        expect(eyes.filter((g) => g === '◉').length).toBeGreaterThan(24);
    });

    it('colours the eye apart from the key, including a lone blink', () => {
        const segs = keeperSegments(' │  ─  │  ');
        expect(segs.find((s) => s.part === 'eye')?.text).toBe('─');
        const frame = keeperSegments(' ╭─────╮ !');
        expect(frame.filter((s) => s.part === 'eye')).toEqual([]);
        expect(frame.find((s) => s.part === 'mark')?.text).toBe('!');
    });
});

describe('Keeper in plain terminals', () => {
    it('only moves on an interactive terminal outside CI', () => {
        expect(keeperAnimates({ isTTY: true }, {})).toBe(true);
        expect(keeperAnimates({ isTTY: false }, {})).toBe(false);
        expect(keeperAnimates({ isTTY: true }, { CI: 'true' })).toBe(false);
        expect(keeperAnimates({ isTTY: true }, { OWNKEY_REDUCED_MOTION: '1' })).toBe(false);
        expect(keeperAnimates({ isTTY: true }, { TERM: 'dumb' })).toBe(false);
        expect(keeperShown({ OWNKEY_NO_MASCOT: '1' })).toBe(false);
    });

    it('sets words level with the eye and adapts to the width', () => {
        const wide = keeperPose('found', 'Found 2 issues', ['1 high'], 100).map(strip);
        const eye = wide.findIndex((l) => l.includes('◎'));
        expect(wide).toHaveLength(8);
        expect(wide[eye]).toContain('Found 2 issues');
        expect(wide[eye + 1]).toContain('1 high');
        const mid = keeperPose('found', 'Found 2 issues', [], 50).map(strip);
        expect(mid).toHaveLength(5);
        expect(mid.find((l) => l.includes('◎'))).toContain('Found 2 issues');
        const narrow = keeperPose('clean', 'All clear', [], 30).map(strip);
        expect(narrow).toHaveLength(1);
        expect(narrow[0]).toMatch(/^\( ◠ \)━┳┳╸ {2}All clear$/);
        expect(keeperPose('clean', 'All clear', [], 10).map(strip)).toEqual(['All clear']);
    });
});

describe('Keeper in the session', () => {
    it('wears the outcome of the last command', () => {
        expect(moodFor('review', 0)).toBe('clean');
        expect(moodFor('review', 1)).toBe('found');
        expect(moodFor('review', 2)).toBe('error');
        expect(moodFor('config', 1)).toBe('error');
    });

    it('lets a command report its own mood through the session state file', () => {
        const file = join(mkdtempSync(join(tmpdir(), 'ok-keeper-')), 'state.json');
        reportKeeperMood('found', { OWNKEY_SESSION_STATE: file });
        expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ mood: 'found' });
        expect(() => reportKeeperMood('clean', {})).not.toThrow();
    });
});
