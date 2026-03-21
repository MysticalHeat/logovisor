import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function createOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('hex')}`;
}

export function extractBearerToken(
  authorizationHeader?: string,
): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const key = createHash('sha256').update(secret).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, encrypted]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function decryptSecret(value: string, secret: string): string {
  const [ivBase64, authTagBase64, encryptedBase64] = value.split('.');
  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error('invalid encrypted secret payload');
  }

  const key = createHash('sha256').update(secret).digest();
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivBase64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
