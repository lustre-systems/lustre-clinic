import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('LUSTR1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export function parseKey(raw: string): Buffer {
    const trimmed = raw.trim();

    const candidates = /^[0-9a-fA-F]+$/.test(trimmed)
        ? [Buffer.from(trimmed, 'hex'), Buffer.from(trimmed, 'base64')]
        : [Buffer.from(trimmed, 'base64')];

    const key = candidates.find((b) => b.length === KEY_BYTES);
    if (!key) {
        throw new Error(`BACKUP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (hex or base64)`);
    }
    return key;
}

export function encrypt(plaintext: Uint8Array, key: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

export function decrypt(envelope: Uint8Array, key: Buffer): Buffer {
    const buf = Buffer.from(envelope);

    if (buf.length < MAGIC.length + IV_BYTES + TAG_BYTES || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error('not a lustre backup envelope');
    }

    const iv = buf.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const body = buf.subarray(MAGIC.length + IV_BYTES, buf.length - TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function generateKey(): string {
    return randomBytes(KEY_BYTES).toString('base64');
}
