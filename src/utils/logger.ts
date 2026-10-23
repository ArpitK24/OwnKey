import chalk from 'chalk';
import { LogLevel } from '../types/index.js';
import { mkdir, appendFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

class Logger {
    private level: LogLevel = 'normal';
    private logDir: string;
    private logFile: string;

    constructor() {
        this.logDir = join(homedir(), '.ownkey', 'logs');
        const date = new Date().toISOString().split('T')[0];
        this.logFile = join(this.logDir, `ownkey-${date}.log`);
    }

    async init(): Promise<void> {
        if (!existsSync(this.logDir)) {
            await mkdir(this.logDir, { recursive: true });
        }
    }

    private out: (...args: unknown[]) => void = (...args) => console.log(...args);

    /** Send all log output to stderr so stdout stays clean for machine-readable reports. */
    useStderr(): void {
        this.out = (...args) => console.error(...args);
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    getLevel(): LogLevel {
        return this.level;
    }

    private shouldLog(messageLevel: LogLevel): boolean {
        const levels: LogLevel[] = ['quiet', 'normal', 'verbose', 'debug'];
        const currentIndex = levels.indexOf(this.level);
        const messageIndex = levels.indexOf(messageLevel);
        return messageIndex <= currentIndex;
    }

    private async writeToFile(message: string, level: string): Promise<void> {
        try {
            const timestamp = new Date().toISOString();
            const logEntry = JSON.stringify({ timestamp, level, message }) + '\n';
            await appendFile(this.logFile, logEntry);
        } catch (error) {
            // Silently fail if we can't write to log file
        }
    }

    info(message: string): void {
        if (this.shouldLog('normal')) {
            this.out(chalk.blue('ℹ'), message);
        }
        this.writeToFile(message, 'info');
    }

    success(message: string): void {
        if (this.shouldLog('normal')) {
            this.out(chalk.green('✓'), message);
        }
        this.writeToFile(message, 'success');
    }

    warn(message: string): void {
        if (this.shouldLog('normal')) {
            this.out(chalk.yellow('⚠'), message);
        }
        this.writeToFile(message, 'warn');
    }

    error(message: string, error?: Error): void {
        if (this.shouldLog('quiet')) {
            console.error(chalk.red('✗'), message);
            if (error && this.level === 'debug') {
                console.error(chalk.gray(error.stack || error.message));
            }
        }
        this.writeToFile(`${message} ${error?.message || ''}`, 'error');
    }

    verbose(message: string): void {
        if (this.shouldLog('verbose')) {
            this.out(chalk.gray('→'), message);
        }
        this.writeToFile(message, 'verbose');
    }

    debug(message: string, data?: any): void {
        if (this.shouldLog('debug')) {
            this.out(chalk.magenta('🐛'), message);
            if (data) {
                this.out(chalk.gray(JSON.stringify(data, null, 2)));
            }
        }
        this.writeToFile(`${message} ${data ? JSON.stringify(data) : ''}`, 'debug');
    }

    spinner(message: string): { succeed: (msg: string) => void; fail: (msg: string) => void } {
        // Simple spinner replacement for ora
        if (this.shouldLog('normal')) {
            this.out(chalk.cyan('⏳'), message);
        }
        return {
            succeed: (msg: string) => this.success(msg),
            fail: (msg: string) => this.error(msg),
        };
    }
}

// Singleton instance
export const logger = new Logger();
