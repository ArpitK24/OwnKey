// Core type definitions for OwnKey CLI

export type LogLevel = 'quiet' | 'normal' | 'verbose' | 'debug';

export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export const AI_PROVIDERS: AIProvider[] = ['openai', 'anthropic', 'gemini', 'ollama'];

export type SuggestionType =
    | 'bug'
    | 'security'
    | 'performance'
    | 'refactor'
    | 'style'
    | 'architecture'
    | 'test'
    | 'documentation';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type RunStatus = 'running' | 'completed' | 'failed';

export type SuggestionAction = 'applied' | 'rejected' | 'undone';

// Configuration types
export interface Config {
    /** Postgres connection string (Supabase → Connect → connection string). Optional. */
    databaseUrl?: string;
    /** @deprecated Legacy field. A postgres:// value here is treated as databaseUrl. */
    supabaseUrl?: string;
    /** @deprecated Legacy field, no longer used to connect. */
    supabaseServiceRoleKey?: string;
    providers: {
        openai?: {
            model?: string;
            /** OpenAI-compatible base URL (e.g. https://openrouter.ai/api/v1) */
            endpoint?: string;
        };
        anthropic?: {
            model?: string;
        };
        gemini?: {
            model?: string;
        };
        ollama?: {
            endpoint?: string;
            model?: string;
        };
    };
    activeProvider?: AIProvider;
    defaults: {
        maxFileSize: string;
        logLevel: LogLevel;
    };
}

// File scanning types
export interface FileMetadata {
    path: string;
    relativePath: string;
    size: number;
    lastModified: Date;
    extension: string;
}

export interface FileContent extends FileMetadata {
    content: string;
}

export interface ScanResult {
    files: FileMetadata[];
    totalSize: number;
    skippedFiles: string[];
    warnings: string[];
}

// Code context types
export interface CodeContext {
    files: FileContent[];
    projectInfo: ProjectMetadata;
    totalTokens?: number;
    /** Unified diff under review (ownkey review). When set, the model focuses on these changes. */
    reviewPatch?: string;
}

export interface ProjectMetadata {
    name: string;
    rootPath: string;
    fileCount: number;
    language?: string;
    framework?: string;
}

// AI provider types
export interface Suggestion {
    type: SuggestionType;
    severity: Severity;
    content: string;
    diff: string;
    filePath: string;
    rationale: string;
    /** 1-based line in the file the finding is about, when the model gives one */
    line?: number;
    tags?: Record<string, any>;
}

export interface AnalyzeOptions {
    streaming?: boolean;
    maxTokens?: number;
    temperature?: number;
}

export interface AIProviderInterface {
    analyze(context: CodeContext, options?: AnalyzeOptions): AsyncGenerator<Suggestion>;
    testConnection(): Promise<boolean>;
}

// Database types
export interface Project {
    id: string;
    name: string;
    rootPath: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface Run {
    id: string;
    projectId: string;
    command: string;
    status: RunStatus;
    summary?: string;
    startedAt: Date;
    finishedAt?: Date;
}

export interface SuggestionRecord extends Suggestion {
    id: string;
    projectId: string;
    createdAt: Date;
}

export interface SuggestionHistory {
    id: string;
    suggestionId: string;
    action: SuggestionAction;
    details?: string;
    actedAt: Date;
}

// Diff types
export interface DiffResult {
    filePath: string;
    hunks: DiffHunk[];
    additions: number;
    deletions: number;
}

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
}

// Backup types
export interface BackupInfo {
    filePath: string;
    backupPath: string;
    timestamp: Date;
    size: number;
}

// Error types
export class OwnKeyError extends Error {
    constructor(
        message: string,
        public code: string,
        public details?: any
    ) {
        super(message);
        this.name = 'OwnKeyError';
    }
}

export class ConfigError extends OwnKeyError {
    constructor(message: string, details?: any) {
        super(message, 'CONFIG_ERROR', details);
        this.name = 'ConfigError';
    }
}

export class DatabaseError extends OwnKeyError {
    constructor(message: string, details?: any) {
        super(message, 'DATABASE_ERROR', details);
        this.name = 'DatabaseError';
    }
}

export class AIProviderError extends OwnKeyError {
    constructor(message: string, details?: any) {
        super(message, 'AI_PROVIDER_ERROR', details);
        this.name = 'AIProviderError';
    }
}

export class ScanError extends OwnKeyError {
    constructor(message: string, details?: any) {
        super(message, 'SCAN_ERROR', details);
        this.name = 'ScanError';
    }
}
