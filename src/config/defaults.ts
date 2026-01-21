import { Config, LogLevel } from '../types/index.js';

export const DEFAULT_CONFIG: Config = {
    providers: {
        openai: {
            model: 'gpt-4-turbo',
        },
        anthropic: {
            model: 'claude-opus-4-5-20251101',
        },
        gemini: {
            model: 'gemini-2.5-pro',
        },
        ollama: {
            endpoint: 'http://localhost:11434',
            model: 'deepseek-coder:latest',
        },
    },
    defaults: {
        maxFileSize: '500kb',
        logLevel: 'normal' as LogLevel,
    },
};

export const CONFIG_DIR = '.ownkey';
export const CONFIG_FILE = 'config.json';
export const KEYS_FILE = 'keys.enc';
export const LOGS_DIR = 'logs';

export const DEFAULT_EXCLUDES = [
    '.git',
    'node_modules',
    'dist',
    'build',
    'target',
    'out',
    'vendor',
    '.cache',
    '.next',
    '.nuxt',
    'coverage',
    '.env',
    '*.lock',
    '*.min.js',
    '*.min.css',
];

export const BINARY_EXTENSIONS = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.bmp',
    '.ico',
    '.svg',
    '.webp',
    '.mp4',
    '.avi',
    '.mov',
    '.mp3',
    '.wav',
    '.zip',
    '.tar',
    '.gz',
    '.rar',
    '.7z',
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
];

export const MAX_FILE_SIZE_BYTES = 500 * 1024; // 500KB

export const BACKUP_EXTENSION = '.ownkey.bak';
export const MAX_BACKUPS_PER_FILE = 3;
