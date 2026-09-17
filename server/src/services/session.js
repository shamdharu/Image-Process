import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || 'dev-only-change-me-in-.env-as-SESSION_SECRET';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

export function createSessionToken(userId) {
  const payload = JSON.stringify({ userId, exp: Date.now() + MAX_AGE_MS });
  const encoded = Buffer.from(payload).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = 'imagery_session';
export const SESSION_MAX_AGE_MS = MAX_AGE_MS;