/**
 * Keeper, the OwnKey mascot: a living key whose bow is one inspecting eye.
 *
 * Pure frame data, no terminal I/O, so the Ink session, the plain review output,
 * and the tests all draw the same character. Keeper reacts to what OwnKey is doing
 * (its mood) and redraws to fit the terminal it is in (its size).
 */

import { writeFileSync } from 'fs';

export type KeeperMood = 'idle' | 'thinking' | 'found' | 'clean' | 'error';
export type KeeperSize = 'full' | 'compact' | 'inline' | 'none';

export const KEEPER_ORANGE = '#ff5a1f';

/** Smallest terminal width that fits each size beside its text. */
export const KEEPER_BREAKPOINTS = { full: 72, compact: 44, inline: 24 } as const;

/** Pick the largest Keeper that still leaves room for text at this terminal width. */
export function keeperSize(columns: number | undefined, rows?: number): KeeperSize {
    const cols = columns && columns > 0 ? columns : 80;
    if (cols >= KEEPER_BREAKPOINTS.full && (rows === undefined || rows >= 16)) return 'full';
    if (cols >= KEEPER_BREAKPOINTS.compact) return 'compact';
    if (cols >= KEEPER_BREAKPOINTS.inline) return 'inline';
    return 'none';
}

/**
 * The eye for a mood at an animation tick. Thinking glances left, centre, right;
 * idle blinks now and then; the rest hold an expression.
 */
type Eye = { pos: -1 | 0 | 1; glyph: string; pair?: boolean };

const THINKING_PATH: Eye['pos'][] = [0, -1, -1, 0, 1, 1, 0, 0];

export function keeperEye(mood: KeeperMood, tick = 0): Eye {
    switch (mood) {
        case 'thinking':
            return { pos: THINKING_PATH[tick % THINKING_PATH.length], glyph: '◉' };
        case 'found':
            return { pos: 0, glyph: tick % 6 === 5 ? '◉' : '◎' };
        case 'clean':
            return { pos: 0, glyph: '◠', pair: true };
        case 'error':
            return { pos: 0, glyph: '×' };
        default:
            // A blink every 16 ticks, and an occasional glance to the side
            if (tick % 16 === 15) return { pos: 0, glyph: '─' };
            if (tick % 32 === 8) return { pos: -1, glyph: '◉' };
            if (tick % 32 === 24) return { pos: 1, glyph: '◉' };
            return { pos: 0, glyph: '◉' };
    }
}

/** A short spoken line for a mood, shown beside larger Keepers. */
export function keeperCaption(mood: KeeperMood): string {
    switch (mood) {
        case 'thinking':
            return 'looking into it';
        case 'found':
            return 'found something';
        case 'clean':
            return 'all clear';
        case 'error':
            return 'that went wrong';
        default:
            return 'ready when you are';
    }
}

/** Five cells inside the bow, with the eye placed by position. */
function eyeRow(eye: Eye, width: number): string {
    const face = eye.pair ? `${eye.glyph} ${eye.glyph}` : eye.glyph;
    const room = width - face.length;
    const centre = Math.floor(room / 2);
    const left = Math.max(0, Math.min(room, centre + eye.pos * Math.max(1, centre - 1)));
    return ' '.repeat(left) + face + ' '.repeat(room - left);
}

/**
 * The frame for a mood, size, and tick, as plain lines of equal width.
 * Callers colour it; the shapes carry the character without colour.
 */
export function keeperFrame(mood: KeeperMood, size: KeeperSize, tick = 0): string[] {
    const eye = keeperEye(mood, tick);
    // A blinking alarm mark beside the bow when it finds something
    const mark = mood === 'found' && tick % 2 === 0 ? '!' : ' ';
    // A gentle bob while it works: the whole key rises a row every other beat
    const bob = mood === 'thinking' && tick % 4 >= 2;

    if (size === 'none') return [];

    if (size === 'inline') {
        const glyph = eye.pair ? '◠' : eye.glyph;
        const inner = eye.pos < 0 ? `${glyph}  ` : eye.pos > 0 ? `  ${glyph}` : ` ${glyph} `;
        return [`(${inner})━┳┳╸`];
    }

    if (size === 'compact') {
        const lines = [
            ` ╭─────╮ ${mark}`,
            ` │${eyeRow(eye, 5)}│  `,
            ` ╰──┬──╯  `,
            `    ├┐    `,
            `    ╵     `,
        ];
        return bob ? bobbed(lines) : lines;
    }

    const lines = [
        `   ▄▄▀▀▀▀▀▄▄   ${mark}`,
        `  █${eyeRow(eye, 9)}█   `,
        `   ▀▀▄▄▄▄▄▀▀    `,
        `      ▐█▌       `,
        `      ▐█▙▄      `,
        `      ▐█        `,
        `      ▐█▛▀      `,
        `       ▀        `,
    ];
    return bob ? bobbed(lines) : lines;
}

/** Shift the key up one row (padding below) so it bobs without changing height. */
function bobbed(lines: string[]): string[] {
    const blank = ' '.repeat(lines[0].length);
    return [...lines.slice(1), blank];
}

/** Ticks per second the animations are written for. */
export const KEEPER_FPS = 8;

/** Whether this terminal should see Keeper move: a TTY, not CI, and motion not turned off. */
export function keeperAnimates(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
    if (!stream.isTTY) return false;
    if (env.CI || env.OWNKEY_REDUCED_MOTION || env.OWNKEY_NO_MASCOT) return false;
    if (env.TERM === 'dumb') return false;
    return true;
}

/** Whether to draw Keeper at all. */
export function keeperShown(env: NodeJS.ProcessEnv = process.env): boolean {
    return !env.OWNKEY_NO_MASCOT;
}

export type KeeperPart = 'body' | 'eye' | 'mark' | 'space';

const EYE_GLYPHS = new Set(['◉', '◎', '◠', '×', '─']);

/**
 * Split a frame line into runs a renderer can colour: the key in orange, the eye in
 * the terminal's own foreground so it reads on light and dark themes, the alarm in red.
 */
export function keeperSegments(line: string): { text: string; part: KeeperPart }[] {
    const out: { text: string; part: KeeperPart }[] = [];
    for (const ch of line) {
        // The compact bow's frame uses ─ too; only a lone ─ between spaces is a blink
        const part: KeeperPart = ch === ' ' ? 'space' : ch === '!' ? 'mark' : EYE_GLYPHS.has(ch) ? 'eye' : 'body';
        const last = out[out.length - 1];
        if (last && last.part === part) last.text += ch;
        else out.push({ text: ch, part });
    }
    // The frame's own ─ runs (the compact bow) are several cells long; a blink is one
    for (const seg of out) if (seg.part === 'eye' && /^─{2,}$/.test(seg.text)) seg.part = 'body';
    return out;
}

/**
 * A command run inside the interactive session can tell Keeper how it went (a review
 * with findings exits 0 but should not get a smile). The session passes a file path in
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
