import { createHash, randomBytes } from 'node:crypto';

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
