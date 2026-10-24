import React from 'react';
import { render } from 'ink';
import { spawn } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { Banner, Prompt } from './App.js';
import { BUILTINS, type CommandInfo } from './complete.js';
import { loadSessionInfo } from './context.js';
import { splitWords } from './words.js';

const HISTORY_FILE = join(homedir(), '.ownkey', 'history');
const HISTORY_MAX = 500;

function loadHistory(): string[] {
    try {
        return readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean).slice(-HISTORY_MAX);
    } catch {
        return [];
    }
}

function saveHistory(history: string[]): void {
    try {
        mkdirSync(join(homedir(), '.ownkey'), { recursive: true });
        writeFileSync(HISTORY_FILE, history.slice(-HISTORY_MAX).join('\n') + '\n', { mode: 0o600 });
    } catch {
        // History is a convenience; never fail a session over it
    }
}

function ask(props: Omit<React.ComponentProps<typeof Prompt>, 'onDone'>): Promise<string | null> {
    return new Promise((resolve) => {
        let answer: string | null = null;
        const app = render(<Prompt {...props} onDone={(line) => (answer = line)} />, { exitOnCtrlC: false });
        app.waitUntilExit().then(() => resolve(answer));
    });
}

/** Run one ownkey command as a child process with the real terminal, exactly as if typed in a shell. */
function runCommand(args: string[]): Promise<number> {
    return new Promise((resolve) => {
        // Ctrl+C belongs to the running command; the session survives it
        const ignore = () => undefined;
        process.on('SIGINT', ignore);
        const child = spawn(process.execPath, [...process.execArgv, process.argv[1], ...args], {
            stdio: 'inherit',
            env: { ...process.env, OWNKEY_NO_UI: '1' },
        });
        const done = (code: number) => {
            process.off('SIGINT', ignore);
            resolve(code);
        };
        child.on('error', () => done(2));
        child.on('close', (code, signal) => done(code ?? (signal ? 130 : 1)));
    });
}

function printHelp(commands: CommandInfo[]): void {
    const rows = [...commands, ...BUILTINS];
    console.log('');
    for (const c of rows) console.log(`  ${chalk.bold(c.name.padEnd(10))} ${chalk.gray(c.description)}`);
    console.log(chalk.gray('\n  Add --help to any command for its options, e.g. review --help'));
    console.log(chalk.gray('  Keys: Tab complete, ↑↓ history or suggestions, ←→ move, Ctrl+U clear line, Esc clear, Ctrl+D exit\n'));
}

export async function startSession(commands: CommandInfo[], version: string): Promise<void> {
    const history = loadHistory();
    const known = new Set(commands.map((c) => c.name));

    const banner = render(<Banner version={version} />);
    banner.unmount();

    for (;;) {
        const info = await loadSessionInfo(process.cwd(), version);
        const line = await ask({ info, commands, history });
        if (line === null) break;

        const trimmed = line.trim();
        if (!trimmed) continue;
        if (history[history.length - 1] !== trimmed) history.push(trimmed);
        saveHistory(history);

        let args: string[];
        try {
            args = splitWords(trimmed);
        } catch (e) {
            console.log(chalk.red(`  ${(e as Error).message}`));
            continue;
        }
        if (args[0] === 'ownkey') args = args.slice(1);
        const [name] = args;
        if (!name) continue;

        if (name === 'exit' || name === 'quit' || name === 'q') break;
        if (name === 'help' || name === '?') {
            printHelp(commands);
            continue;
        }
        if (name === 'clear' || name === 'cls') {
            process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
            continue;
        }
        if (!known.has(name) && !name.startsWith('-')) {
            console.log(chalk.yellow(`  Unknown command "${name}". Type help to see them all.`));
            continue;
        }

        const started = Date.now();
        const code = await runCommand(args);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        console.log(code === 0 ? chalk.gray(`  ✓ done in ${secs}s\n`) : chalk.red(`  ✗ exited with code ${code} after ${secs}s\n`));
    }
    console.log(chalk.gray('  Bye.'));
}

