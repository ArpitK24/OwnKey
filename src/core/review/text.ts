import chalk from 'chalk';
import type { Severity } from '../../types/index.js';
import type { Finding } from './report.js';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const BADGE: Record<Severity, (s: string) => string> = {
    critical: (s) => chalk.bgRed.white.bold(s),
    high: (s) => chalk.red.bold(s),
    medium: (s) => chalk.yellow.bold(s),
    low: (s) => chalk.blue(s),
    info: (s) => chalk.gray(s),
};

export interface TextOptions {
    /** Lines of a file as reviewed, for code frames; omit to skip frames */
    readLines?: (file: string) => string[] | undefined;
    /** Terminal width for wrapping (default 100) */
    columns?: number;
    /** Lines of context around the flagged line (default 1) */
    context?: number;
}

/** Wrap prose to a width with a hanging indent. */
export function wrap(text: string, width: number, indent: string): string[] {
    const out: string[] = [];
    for (const para of text.split(/\n+/)) {
        let line = '';
        for (const word of para.split(/\s+/).filter(Boolean)) {
            if (line && line.length + 1 + word.length > width) {
                out.push(indent + line);
                line = word;
            } else line = line ? `${line} ${word}` : word;
        }
        if (line) out.push(indent + line);
    }
    return out;
}

/** A few lines around the flagged one, numbered, with the flagged line marked. */
export function codeFrame(lines: string[], line: number, context = 1, width = 100): string[] {
    if (line < 1 || line > lines.length) return [];
    const from = Math.max(1, line - context);
    const to = Math.min(lines.length, line + context);
    const gutter = String(to).length;
    const out: string[] = [];
    for (let n = from; n <= to; n++) {
        const raw = lines[n - 1].replace(/\t/g, '    ');
        const code = raw.length > width ? raw.slice(0, width - 1) + '…' : raw;
        const num = String(n).padStart(gutter);
        out.push(n === line ? `${chalk.red('▶')} ${chalk.bold(num)} │ ${code}` : `  ${chalk.gray(num)} ${chalk.gray('│')} ${chalk.gray(code)}`);
    }
    return out;
}

/** Counts per severity, highest first, e.g. "1 high · 2 medium". */
export function severityCounts(findings: Finding[]): string {
    return SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
        .filter(([, n]) => n)
        .map(([s, n]) => `${n} ${s}`)
        .join(' · ');
}

/**
 * Findings for a terminal, grouped by file: a severity badge, the type and line, the
 * finding, a code frame, the reasoning, and the command that applies the fix.
 */
export function renderFindings(findings: Finding[], options: TextOptions = {}): string {
    if (findings.length === 0) return '';
    const cols = Math.max(40, Math.min(options.columns ?? 100, 120));
    const out: string[] = [];
    const files = [...new Set(findings.map((f) => f.filePath))];
    for (const file of files) {
        const inFile = findings.filter((f) => f.filePath === file);
        out.push('');
        out.push(`  ${chalk.bold.underline(file)} ${chalk.gray(`(${inFile.length})`)}`);
        const lines = options.readLines?.(file);
        for (const f of inFile) {
            out.push('');
            const badge = BADGE[f.severity](f.severity.toUpperCase());
            out.push(`  ${badge} ${chalk.gray('·')} ${f.type} ${chalk.gray('·')} ${chalk.cyan(`L${f.line}`)}`);
            out.push(...wrap(f.content, cols - 6, '    ').map((l) => chalk.bold(l)));
            if (lines) {
                const frame = codeFrame(lines, f.line, options.context ?? 1, cols - 14);
                if (frame.length) out.push('', ...frame.map((l) => `    ${l}`));
            }
            if (f.rationale?.trim()) out.push('', ...wrap(f.rationale, cols - 6, '    ').map((l) => chalk.gray(l)));
            if (f.id && f.diff?.trim()) out.push('', `    ${chalk.green('fix')}  ${chalk.bold(`ownkey apply ${f.id}`)} ${chalk.gray('(add --dry-run to preview)')}`);
        }
    }
    return out.join('\n') + '\n';
}
