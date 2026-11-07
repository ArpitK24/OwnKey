import chalk from 'chalk';
import { KEEPER_FPS, keeperAnimates, keeperFits, keeperSegments, keeperShown, type KeeperMood } from './keeper.js';

type Stream = NodeJS.WriteStream;

function paintColor(color: string): (s: string) => string {
    if (color.startsWith('#')) return chalk.hex(color);
    const fn = (chalk as unknown as Record<string, (s: string) => string>)[color];
    return typeof fn === 'function' ? fn : (s: string) => s;
}

/** The mark, coloured for a plain (non-Ink) terminal. */
export function paintKeeper(mood: KeeperMood = 'idle', tick = 0): string {
    return keeperSegments(mood, tick)
        .map((s) => (s.part === 'shaft' ? paintColor(s.color)(s.text) : chalk.bold(paintColor(s.color)(s.text))))
        .join('');
}

/**
 * A one-line headline with the mark at its head, and detail lines indented under the
 * words. Without room for the mark, or with it turned off, the words stand alone.
 */
export function keeperPose(mood: KeeperMood, title: string, detail: string[] = [], columns = process.stdout.columns, tty = Boolean(process.stdout.isTTY)): string[] {
    // Pipes and logs get the words in the same layout, without the mark
    if (!tty || !keeperShown() || !keeperFits(columns)) return [title, ...detail.map((d) => `  ${d}`)];
    return [`${paintKeeper(mood)}  ${title}`, ...detail.map((d) => `      ${d}`)];
}

function elapsed(ms: number): string {
    const s = ms / 1000;
    return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/**
 * A live status line with the mark turning at its head. Steps print above it and stay
 * in scrollback; the live line redraws in place with the elapsed time. Off a TTY (CI,
 * pipes) it prints the plain lines it would otherwise show, with no escape codes.
 */
export class KeeperStatus {
    private tick = 0;
    private label = '';
    private steps = 0;
    private started = 0;
    private timer: NodeJS.Timeout | undefined;
    private readonly live: boolean;

    constructor(private readonly stream: Stream = process.stdout) {
        this.live = keeperAnimates(stream) && keeperFits(stream.columns);
    }

    /** Lookups the agent made so far. */
    get lookups(): number {
        return this.steps;
    }

    /** Milliseconds since start(). */
    get elapsedMs(): number {
        return this.started ? Date.now() - this.started : 0;
    }

    start(label: string): void {
        this.label = label;
        this.started = Date.now();
        if (!this.live) {
            this.stream.write(chalk.gray(`  ${label}\n`));
            return;
        }
        this.stream.write('\x1b[?25l');
        this.draw();
        this.timer = setInterval(() => {
            this.tick++;
            this.draw();
        }, 1000 / KEEPER_FPS);
        this.timer.unref?.();
        // Leave the terminal tidy if the process is interrupted mid-review
        process.once('exit', () => this.restore());
    }

    /** Print a finished step above the live line. */
    step(text: string): void {
        this.steps++;
        const line = chalk.gray(`  │ ${text}\n`);
        if (!this.live) {
            this.stream.write(line);
            return;
        }
        this.clear();
        this.stream.write(line);
        this.draw();
    }

    /** Stop animating and clear the live line. */
    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        if (this.live) {
            this.clear();
            this.restore();
        }
    }

    private restore(): void {
        if (this.live) this.stream.write('\x1b[?25h');
    }

    private clear(): void {
        this.stream.write('\r\x1b[2K');
    }

    private draw(): void {
        const cols = this.stream.columns || 80;
        const tail = ` ${elapsed(this.elapsedMs)}${this.steps ? ` · ${this.steps} lookup${this.steps === 1 ? '' : 's'}` : ''}`;
        const room = Math.max(8, cols - 10 - tail.length);
        const label = this.label.length > room ? this.label.slice(0, room - 1) + '…' : this.label;
        this.clear();
        this.stream.write(`  ${paintKeeper('thinking', this.tick)}  ${label}${chalk.gray(tail)}`);
    }
}
