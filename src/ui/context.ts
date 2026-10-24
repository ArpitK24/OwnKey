import { execFileSync } from 'child_process';
import { basename } from 'path';
import { configManager } from '../config/manager.js';
import { AIProviderFactory } from '../ai/factory.js';

export interface SessionInfo {
    version: string;
    folder: string;
    branch?: string;
    changed?: number;
    provider?: string;
    model?: string;
}

function git(cwd: string, args: string[]): string | undefined {
    try {
        return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return undefined;
    }
}

/** What the header shows: where you are, what changed, and which model reviews it. */
export async function loadSessionInfo(cwd: string, version: string): Promise<SessionInfo> {
    const root = git(cwd, ['rev-parse', '--show-toplevel']);
    const info: SessionInfo = { version, folder: basename(root ?? cwd) };
    if (root) {
        info.branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || undefined;
        const status = git(root, ['status', '--porcelain']);
        info.changed = status === undefined ? undefined : status.split('\n').filter(Boolean).length;
    }
    try {
        if (await configManager.exists()) {
            const config = await configManager.load();
            if (config.activeProvider) {
                info.provider = config.activeProvider;
                const p = config.providers[config.activeProvider] as { model?: string } | undefined;
                info.model = p?.model || AIProviderFactory.getRecommendedModel(config.activeProvider);
            }
        }
    } catch {
        // Unreadable config: the header just shows the setup hint
    }
    return info;
}
