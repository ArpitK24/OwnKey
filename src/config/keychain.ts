import { AIProvider } from '../types/index.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { Encryption } from '../utils/encryption.js';
import { KEYS_FILE, CONFIG_DIR } from './defaults.js';

// Try to use keytar, but fallback gracefully if not available
let keytar: any = null;
try {
    keytar = await import('keytar');
} catch (error) {
    logger.verbose('Keytar not available, using encrypted file storage for API keys');
}

const SERVICE_NAME = 'ownkey-cli';
const ENCRYPTION_PASSWORD = 'ownkey-local-encryption-key'; // In production, derive from machine ID

export class KeychainManager {
    private keysFilePath: string;
    private useKeychain: boolean;

    constructor() {
        this.keysFilePath = join(homedir(), CONFIG_DIR, KEYS_FILE);
        this.useKeychain = keytar !== null;
    }

    private async ensureKeysDir(): Promise<void> {
        const dir = join(homedir(), CONFIG_DIR);
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
    }

    async setApiKey(provider: AIProvider, apiKey: string): Promise<void> {
        const accountName = `${provider}-api-key`;

        if (this.useKeychain) {
            try {
                await keytar.setPassword(SERVICE_NAME, accountName, apiKey);
                logger.verbose(`Stored ${provider} API key in system keychain`);
                return;
            } catch (error) {
                logger.warn(`Failed to store in keychain, falling back to encrypted file`);
                this.useKeychain = false;
            }
        }

        // Fallback to encrypted file
        await this.ensureKeysDir();
        const keys = await this.loadKeysFromFile();
        keys[provider] = apiKey;
        await this.saveKeysToFile(keys);
        logger.verbose(`Stored ${provider} API key in encrypted file`);
    }

    async getApiKey(provider: AIProvider): Promise<string | null> {
        const accountName = `${provider}-api-key`;

        if (this.useKeychain) {
            try {
                const key = await keytar.getPassword(SERVICE_NAME, accountName);
                if (key) {
                    logger.verbose(`Retrieved ${provider} API key from system keychain`);
                    return key;
                }
            } catch (error) {
                logger.warn(`Failed to retrieve from keychain, trying encrypted file`);
                this.useKeychain = false;
            }
        }

        // Fallback to encrypted file
        const keys = await this.loadKeysFromFile();
        const key = keys[provider] || null;
        if (key) {
            logger.verbose(`Retrieved ${provider} API key from encrypted file`);
        }
        return key;
    }

    async deleteApiKey(provider: AIProvider): Promise<void> {
        const accountName = `${provider}-api-key`;

        if (this.useKeychain) {
            try {
                await keytar.deletePassword(SERVICE_NAME, accountName);
                logger.verbose(`Deleted ${provider} API key from system keychain`);
            } catch (error) {
                // Ignore errors
            }
        }

        // Also delete from file
        const keys = await this.loadKeysFromFile();
        delete keys[provider];
        await this.saveKeysToFile(keys);
        logger.verbose(`Deleted ${provider} API key from encrypted file`);
    }

    private async loadKeysFromFile(): Promise<Record<string, string>> {
        if (!existsSync(this.keysFilePath)) {
            return {};
        }

        try {
            const encryptedData = await readFile(this.keysFilePath, 'utf-8');
            const decrypted = await Encryption.decrypt(encryptedData, ENCRYPTION_PASSWORD);
            return JSON.parse(decrypted);
        } catch (error) {
            logger.warn('Failed to decrypt keys file, starting fresh');
            return {};
        }
    }

    private async saveKeysToFile(keys: Record<string, string>): Promise<void> {
        const json = JSON.stringify(keys);
        const encrypted = await Encryption.encrypt(json, ENCRYPTION_PASSWORD);
        await writeFile(this.keysFilePath, encrypted, 'utf-8');
    }
}

export const keychainManager = new KeychainManager();
