import { Config, ConfigError, AIProvider } from '../types/index.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { keychainManager } from './keychain.js';
import { DEFAULT_CONFIG, CONFIG_DIR, CONFIG_FILE } from './defaults.js';

export class ConfigManager {
    private configPath: string;
    private config: Config | null = null;

    constructor() {
        this.configPath = join(homedir(), CONFIG_DIR, CONFIG_FILE);
    }

    async ensureConfigDir(): Promise<void> {
        const dir = join(homedir(), CONFIG_DIR);
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
            logger.verbose(`Created config directory: ${dir}`);
        }
    }

    async exists(): Promise<boolean> {
        return existsSync(this.configPath);
    }

    async load(): Promise<Config> {
        if (this.config) {
            return this.config;
        }

        if (!existsSync(this.configPath)) {
            logger.verbose('No config file found, using defaults');
            this.config = { ...DEFAULT_CONFIG };
            return this.config;
        }

        try {
            const content = await readFile(this.configPath, 'utf-8');
            const loaded = JSON.parse(content);

            // Merge with defaults to ensure all fields exist
            this.config = {
                ...DEFAULT_CONFIG,
                ...loaded,
                providers: {
                    ...DEFAULT_CONFIG.providers,
                    ...loaded.providers,
                },
                defaults: {
                    ...DEFAULT_CONFIG.defaults,
                    ...loaded.defaults,
                },
            };

            logger.verbose('Loaded configuration from file');
            return this.config!;
        } catch (error) {
            throw new ConfigError('Failed to load configuration file', error);
        }
    }

    async save(config: Config): Promise<void> {
        await this.ensureConfigDir();

        try {
            const content = JSON.stringify(config, null, 2);
            await writeFile(this.configPath, content, 'utf-8');
            this.config = config;
            logger.verbose('Saved configuration to file');
        } catch (error) {
            throw new ConfigError('Failed to save configuration file', error);
        }
    }

    async update(updates: Partial<Config>): Promise<void> {
        const current = await this.load();
        const updated = {
            ...current,
            ...updates,
            providers: {
                ...current.providers,
                ...updates.providers,
            },
            defaults: {
                ...current.defaults,
                ...updates.defaults,
            },
        };
        await this.save(updated);
    }

    async setSupabase(url: string, serviceRoleKey: string): Promise<void> {
        const config = await this.load();
        config.supabaseUrl = url;
        config.supabaseServiceRoleKey = serviceRoleKey;
        await this.save(config);
        logger.success('Supabase configuration saved');
    }

    async setProvider(provider: AIProvider, apiKey: string, model?: string): Promise<void> {
        const config = await this.load();
        config.activeProvider = provider;

        if (model) {
            if (!config.providers[provider]) {
                config.providers[provider] = {};
            }
            config.providers[provider]!.model = model;
        }

        await this.save(config);
        await keychainManager.setApiKey(provider, apiKey);
        logger.success(`${provider} provider configured`);
    }

    async getApiKey(provider?: AIProvider): Promise<string | null> {
        const config = await this.load();
        const targetProvider = provider || config.activeProvider;

        if (!targetProvider) {
            return null;
        }

        return await keychainManager.getApiKey(targetProvider);
    }

    async validate(): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        try {
            const config = await this.load();

            // Check if at least one provider is configured
            if (!config.activeProvider) {
                errors.push('No active AI provider configured. Run: ownkey config');
            }

            // Check if API key exists for active provider
            if (config.activeProvider) {
                const apiKey = await this.getApiKey(config.activeProvider);
                if (!apiKey) {
                    errors.push(`No API key found for ${config.activeProvider}`);
                }
            }

            return { valid: errors.length === 0, errors };
        } catch (error) {
            errors.push('Failed to load configuration');
            return { valid: false, errors };
        }
    }

    async reset(): Promise<void> {
        this.config = null;
        if (existsSync(this.configPath)) {
            await writeFile(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
            logger.success('Configuration reset to defaults');
        }
    }
}

export const configManager = new ConfigManager();
