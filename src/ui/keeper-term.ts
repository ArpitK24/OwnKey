import chalk from 'chalk';
import {
    KEEPER_FPS,
    KEEPER_ORANGE,
    keeperAnimates,
    keeperCaption,
    keeperFrame,
    keeperSegments,
    keeperShown,
    keeperSize,
    type KeeperMood,
} from './keeper.js';

type Stream = NodeJS.WriteStream;

/** Colour one frame line for a plain (non-Ink) terminal. */
export function paintKeeperLine(line: string): string {
    return keeperSegments(line)
        .map(({ text, part }) =>
            part === 'body' ? chalk.hex(KEEPER_ORANGE)(text) : part === 'eye' ? chalk.bold(text) : part === 'mark' ? chalk.red.bold(text) : text
        )
        .join('');
}

/**
 * Keeper's pose with words beside it, sized to the terminal. Returns plain lines
 * (already coloured) so callers decide where they go.
 */
export function keeperPose(mood: KeeperMood, title: string, detail: string[] = [], columns = process.stdout.columns): string[] {
    const size = keeperSize(columns);
    if (!keeperShown() || size === 'none') return [title, ...detail];
    const frame = keeperFrame(mood, size === 'full' ? 'compact' : size);
    if (size === 'inline') return [`${paintKeeperLine(frame[0])}  ${title}`, ...detail.map((d) => `          ${d}`)];
    const text = [title, ...detail];
    // Words sit level with the eye, below the top of the bow
    return frame.map((line, i) => `${paintKeeperLine(line)}  ${text[i - 1] ?? ''}`.trimEnd()).concat(text.slice(frame.length - 1).map((t) => `${' '.repeat(frame[0].length)}  ${t}`));
}

/**
 * A live status line with Keeper working at its head. Steps print above it and stay
 * in scrollback; the live line redraws in place. Off a TTY (CI, pipes) it degrades to
 * the plain lines it would otherwise print, with no escape codes.
 */
export class KeeperStatus {
    private tick = 0;
    private label = '';
    private steps = 0;
    private timer: NodeJS.Timeout | undefined;
    private readonly live: boolean;

    constructor(private readonly stream: Stream = process.stdout) {
        this.live = keeperAnimates(stream) && keeperSize(stream.columns) !== 'none';
    }

    start(label: string): void {
        this.label = label;
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
        if (!this.live) {
            this.stream.write(chalk.gray(`  ↳ ${text}\n`));
            return;
        }
        this.clear();
        this.stream.write(chalk.gray(`  ↳ ${text}\n`));
        this.steps++;
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
        const head = paintKeeperLine(keeperFrame('thinking', 'inline', this.tick)[0]);
        const room = Math.max(8, cols - 14);
        const full = this.steps ? `${this.label} · ${this.steps} lookup${this.steps === 1 ? '' : 's'}` : this.label;
        const label = full.length > room ? full.slice(0, room - 1) + '…' : full;
        const dots = '.'.repeat(1 + (Math.floor(this.tick / 3) % 3));
        this.clear();
        this.stream.write(`  ${head} ${chalk.gray(label + dots)}`);
    }
}

export { keeperCaption };
