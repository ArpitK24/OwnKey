import type { Severity } from '../types/index.js';
import { meetsSeverity } from '../utils/severity.js';
import type { BenchCase } from './cases.js';

/** A reported finding, reduced to what scoring needs. */
export interface BenchFinding {
    filePath: string;
    line: number;
    type: string;
    severity: Severity;
    content: string;
}

export interface CaseResult {
    id: string;
    title: string;
    kind: 'bug' | 'control';
    /** Bug cases: the planted defect was reported */
    caught: boolean;
    /** Findings that matched the planted defect */
    matched: number;
    /** Unmatched findings at medium or above (false alarms on controls, noise on bug cases) */
    noise: number;
    findings: BenchFinding[];
    error?: string;
    durationMs: number;
}

export interface BenchSummary {
    bugCases: number;
    caught: number;
    /** caught / bugCases */
    recall: number;
    /** matched findings / (matched + noise) over all cases; 1 when nothing was reported */
    precision: number;
    controlCases: number;
    /** Control cases with at least one false alarm */
    controlsFlagged: number;
    errors: number;
}

/** How far (in lines) a finding may sit from the planted line and still count. */
export const LINE_TOLERANCE = 3;
/** Noise threshold: low/info nits never count against a reviewer. */
export const NOISE_SEVERITY: Severity = 'medium';

/** 1-based line of the planted defect in the changed file. */
export function plantedLine(c: BenchCase): number {
    if (!c.expect) return 0;
    const idx = c.changed.split('\n').findIndex((l) => l.includes(c.expect!.needle));
    if (idx === -1) throw new Error(`Bench case ${c.id}: needle not found in changed file`);
    return idx + 1;
}

export function matchesPlanted(c: BenchCase, f: BenchFinding): boolean {
    if (!c.expect) return false;
    if (f.filePath !== c.file) return false;
    if (Math.abs(f.line - plantedLine(c)) > LINE_TOLERANCE) return false;
    return (c.expect.types as string[]).includes(f.type);
}

export function scoreCase(c: BenchCase, findings: BenchFinding[], durationMs = 0, error?: string): CaseResult {
    let matched = 0;
    let noise = 0;
    for (const f of findings) {
        if (matchesPlanted(c, f)) matched++;
        else if (meetsSeverity(f.severity, NOISE_SEVERITY)) noise++;
    }
    return {
        id: c.id,
        title: c.title,
        kind: c.expect ? 'bug' : 'control',
        caught: matched > 0,
        matched,
        noise,
        findings,
        error,
        durationMs,
    };
}

export function summarize(results: CaseResult[]): BenchSummary {
    const bugs = results.filter((r) => r.kind === 'bug');
    const controls = results.filter((r) => r.kind === 'control');
    const caught = bugs.filter((r) => r.caught).length;
    const matched = results.reduce((n, r) => n + r.matched, 0);
    const noise = results.reduce((n, r) => n + r.noise, 0);
    return {
        bugCases: bugs.length,
        caught,
        recall: bugs.length ? caught / bugs.length : 0,
        precision: matched + noise ? matched / (matched + noise) : 1,
        controlCases: controls.length,
        controlsFlagged: controls.filter((r) => r.noise > 0).length,
        errors: results.filter((r) => r.error).length,
    };
}
