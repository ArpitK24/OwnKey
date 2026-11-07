import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { keeperAnimates, keeperBow, keeperFits, keeperSegments, keeperShown, keeperText, reportKeeperMood, KEEPER_SHAFT, type KeeperMood } from '../../src/ui/keeper';
import { keeperPose } from '../../src/ui/keeper-term';
import { moodFor } from '../../src/ui/session';

const MOODS: KeeperMood[] = ['idle', 'thinking', 'found', 'clean', 'error'];
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('Keeper mark', () => {
    it('is one short line in every mood and tick', () => {
        for (const mood of MOODS) {
            for (let tick = 0; tick < 40; tick++) {
                const text = keeperText(mood, tick);
                expect(text).not.toContain('\n');
                expect([...text].length).toBeLessThanOrEqual(5);
                expect(text).toContain(KEEPER_SHAFT);
            }
        }
    });

    it('turns its bow while thinking and holds a status glyph when done', () => {
        const turns = new Set(Array.from({ length: 8 }, (_, t) => keeperBow('thinking', t)));
        expect(turns).toEqual(new Set(['◐', '◓', '◑', '◒']));
        expect(keeperBow('found')).toBe('◉');
        expect(keeperBow('clean')).toBe('●');
        expect(keeperBow('error')).toBe('×');
        expect(keeperBow('idle', 0)).toBe('◉');
        expect(keeperBow('idle', 31)).toBe('─');
    });

    it('colours the bow by outcome and raises an alarm when it finds something', () => {
        expect(keeperSegments('clean')[0].color).toBe('green');
        expect(keeperSegments('error')[0].color).toBe('red');
        expect(keeperSegments('found', 0).map((s) => s.text).join('')).toBe('◉━┳┳!');
        expect(keeperSegments('idle').some((s) => s.part === 'mark')).toBe(false);
    });

    it('hides on very narrow terminals and assumes 80 columns when unknown', () => {
        expect(keeperFits(23)).toBe(false);
        expect(keeperFits(24)).toBe(true);
        expect(keeperFits(undefined)).toBe(true);
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

    it('puts the mark before a headline on a terminal, and leaves it out of pipes', () => {
        const pose = keeperPose('found', 'Found 2 issues', ['1 high'], 100, true).map(strip);
        expect(pose[0]).toMatch(/^◉━┳┳!? {2}Found 2 issues$/);
        expect(pose[1]).toBe('      1 high');
        expect(keeperPose('clean', 'All clear', [], 10, true).map(strip)).toEqual(['All clear']);
        expect(keeperPose('clean', 'All clear', ['x'], 100, false).map(strip)).toEqual(['All clear', '  x']);
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
