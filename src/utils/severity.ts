import { Severity } from '../types/index.js';

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** true when `severity` is at least as severe as `minimum` */
export function meetsSeverity(severity: string, minimum?: string): boolean {
    if (!minimum) return true;
    const s = SEVERITIES.indexOf(severity as Severity);
    const m = SEVERITIES.indexOf(minimum as Severity);
    return s !== -1 && s <= m;
}

export function parseSeverity(value: string | undefined): Severity | undefined {
    if (value === undefined) return undefined;
    const v = value.toLowerCase() as Severity;
    if (!SEVERITIES.includes(v)) {
        throw new Error(`Invalid severity "${value}". Use one of: ${SEVERITIES.join(', ')}`);
    }
    return v;
}
