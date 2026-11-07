/**
 * Keeper, the OwnKey mark: a small key, `◉━┳┳`, whose round bow is an eye.
 *
 * One line, four cells. It sits at the head of the banner, the prompt header, the live
 * review status, and the review summary, and its bow tells you what OwnKey is doing:
 * it turns while a review works, and changes to an alarm, a tick, or a cross when it is
 * done. Pure data, no terminal I/O, so Ink, plain output, and tests draw the same thing.
 */

import { writeFileSync } from 'fs';

export type KeeperMood = 'idle' | 'thinking' | 'found' | 'clean' | 'error';

export const KEEPER_ORANGE = '#ff5a1f';

/** The key's shaft and teeth, after the bow. */
export const KEEPER_SHAFT = '━┳┳';

/** Narrowest terminal that shows the mark; below it the words stand alone. */
export const KEEPER_MIN_COLUMNS = 24;

/** Ticks per second the animation is written for. */
export const KEEPER_FPS = 8;

/** The bow turning, a quarter at a time, like a key in a lock. */
const TURN = ['◐', '◓', '◑', '◒'];

export type KeeperPart = 'bow' | 'shaft' | 'mark';

export interface KeeperSegment {
    text: string;
    part: KeeperPart;
    /** Colour a renderer should use: the brand orange, or a status colour */
    color: string;
}

const MOOD_COLOR: Record<KeeperMood, string> = {
    idle: KEEPER_ORANGE,
    thinking: KEEPER_ORANGE,
    found: 'yellow',
    clean: 'green',
    error: 'red',
};

/** The bow glyph for a mood at an animation tick. */
export function keeperBow(mood: KeeperMood, tick = 0): string {
    switch (mood) {
        case 'thinking':
            return TURN[Math.floor(tick / 2) % TURN.length];
        case 'found':
            return '◉';
        case 'clean':
            return '●';
        case 'error':
            return '×';
        default:
            // A blink now and then
            return tick % 32 === 31 ? '─' : '◉';
    }
}

/**
 * The mark as coloured runs: the bow in its mood colour, the shaft in orange, and
 * a blinking `!` after it when a review found something.
 */
export function keeperSegments(mood: KeeperMood = 'idle', tick = 0): KeeperSegment[] {
    const out: KeeperSegment[] = [
        { text: keeperBow(mood, tick), part: 'bow', color: MOOD_COLOR[mood] },
        { text: KEEPER_SHAFT, part: 'shaft', color: KEEPER_ORANGE },
    ];
    if (mood === 'found') out.push({ text: tick % 8 < 6 ? '!' : ' ', part: 'mark', color: 'yellow' });
    return out;
}

/** The mark as plain text (no colour), e.g. `◉━┳┳`. */
export function keeperText(mood: KeeperMood = 'idle', tick = 0): string {
    return keeperSegments(mood, tick)
        .map((s) => s.text)
        .join('');
}

/** Whether the mark fits beside its words at this terminal width. */
export function keeperFits(columns: number | undefined): boolean {
    const cols = columns && columns > 0 ? columns : 80;
    return cols >= KEEPER_MIN_COLUMNS;
}

/** Whether this terminal should see the mark move: a TTY, not CI, and motion not turned off. */
export function keeperAnimates(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
    if (!stream.isTTY) return false;
    if (env.CI || env.OWNKEY_REDUCED_MOTION || env.OWNKEY_NO_MASCOT) return false;
    if (env.TERM === 'dumb') return false;
    return true;
}

/** Whether to draw the mark at all. */
export function keeperShown(env: NodeJS.ProcessEnv = process.env): boolean {
    return !env.OWNKEY_NO_MASCOT;
}

/**
 * A command run inside the interactive session can tell Keeper how it went (a review
 * with findings exits 0 but should not get a tick). The session passes a file path in
 * OWNKEY_SESSION_STATE; commands write their mood there.
 */
export function reportKeeperMood(mood: KeeperMood, env: NodeJS.ProcessEnv = process.env): void {
    const file = env.OWNKEY_SESSION_STATE;
    if (!file) return;
    try {
        // Synchronous: the process may exit right after
        writeFileSync(file, JSON.stringify({ mood }), 'utf-8');
    } catch {
        // Cosmetic only
    }
}
