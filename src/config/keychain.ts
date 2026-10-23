import { AIProvider } from '../types/index.js';
import { readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { Encryption } from '../utils/encryption.js';
import { KEYS_FILE, CONFIG_DIR } from './defaults.js';

// Try to use keytar, but fallback gracefully if not available
// Set OWNKEY_NO_KEYCHAIN=1 to force file storage (CI, containers, tests).
let keytar: any = null;
try {
    if (!process.env.OWNKEY_NO_KEYCHAIN) {
        const mod: any = await import('keytar');
        keytar = mod.default ?? mod;
    }
} catch (error) {
    logger.verbose('Keytar not available, using encrypted file storage for API keys');
}

const SERVICE_NAME = 'ownkey-cli';
// Keys written by OwnKey <= 1.0.2 used this fixed password. Read-only now, for one-time migration.
const LEGACY_PASSWORD = 'ownkey-local-encryption-key';
const MASTER_KEY_FILE = 'master.key';

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
            await mkdir(dir, { recursive: true, mode: 0o700 });
        }
    }

    /**
     * Per-install random secret (32 bytes, file mode 0600) used to encrypt keys.enc.
     * Created on first use; never leaves the machine.
     */
    private async getMasterKey(create: boolean): Promise<string | null> {
        const path = join(homedir(), CONFIG_DIR, MASTER_KEY_FILE);
        if (existsSync(path)) {
            return (await readFile(path, 'utf-8')).trim();
        }
        if (!create) return null;
        await this.ensureKeysDir();
        const secret = randomBytes(32).toString('base64');
        await writeFile(path, secret, { encoding: 'utf-8', mode: 0o600 });
        return secret;
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
            // Try plain JSON file for testing
            const plainPath = this.keysFilePath.replace('.enc', '.json');
            if (existsSync(plainPath)) {
                try {
                    const content = await readFile(plainPath, 'utf-8');
                    return JSON.parse(content);
                } catch (error) {
                    logger.warn('Failed to read plain keys file');
                    return {};
                }
            }
            return {};
        }

        const encryptedData = await readFile(this.keysFilePath, 'utf-8');
        const master = await this.getMasterKey(false);
        if (master) {
            try {
                return JSON.parse(await Encryption.decrypt(encryptedData, master));
            } catch {
                // fall through to legacy format
            }
        }
        try {
            const keys = JSON.parse(await Encryption.decrypt(encryptedData, LEGACY_PASSWORD));
            // Migrate from the fixed legacy password to a per-install secret.
            await this.saveKeysToFile(keys);
            logger.verbose('Migrated keys file to per-install encryption');
            return keys;
        } catch {
            logger.warn('Could not decrypt ~/.ownkey/keys.enc; run ownkey config to store your key again');
            return {};
        }
    }

    private async saveKeysToFile(keys: Record<string, string>): Promise<void> {
        await this.ensureKeysDir();
        const master = (await this.getMasterKey(true)) as string;
        const encrypted = await Encryption.encrypt(JSON.stringify(keys), master);
        await writeFile(this.keysFilePath, encrypted, { encoding: 'utf-8', mode: 0o600 });
        await chmod(this.keysFilePath, 0o600).catch(() => undefined);
    }
}

export const keychainManager = new KeychainManager();
