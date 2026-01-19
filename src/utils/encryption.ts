import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

export class Encryption {
    private static async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
        return (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
    }

    static async encrypt(text: string, password: string): Promise<string> {
        const salt = randomBytes(SALT_LENGTH);
        const iv = randomBytes(IV_LENGTH);
        const key = await this.deriveKey(password, salt);

        const cipher = createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const tag = cipher.getAuthTag();

        // Combine salt + iv + tag + encrypted
        const result = Buffer.concat([salt, iv, tag, Buffer.from(encrypted, 'hex')]);
        return result.toString('base64');
    }

    static async decrypt(encryptedData: string, password: string): Promise<string> {
        const buffer = Buffer.from(encryptedData, 'base64');

        const salt = buffer.subarray(0, SALT_LENGTH);
        const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
        const tag = buffer.subarray(
            SALT_LENGTH + IV_LENGTH,
            SALT_LENGTH + IV_LENGTH + TAG_LENGTH
        );
        const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

        const key = await this.deriveKey(password, salt);

        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
}
