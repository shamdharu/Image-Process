import { pool } from '../db.js';
import { SESSION_COOKIE_NAME, verifySessionToken } from '../services/session.js';

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// Sets req.user from the session cookie if present and valid, otherwise leaves
// req.user undefined. Does NOT reject the request - routes that need a logged
// in user check `req.user` themselves (requirePermission already does this).
export async function attachUser(req, _res, next) {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) return next();

  try {
    const [[user]] = await pool.query('SELECT id, username, email, role FROM User WHERE id = ?', [payload.userId]);
    if (!user) return next();
    // 'permissions' stays as a flat array only for the legacy '*' (super-admin)
    // shortcut; per-category access goes through CategoryPermission instead.
    req.user = { ...user, permissions: user.role === 'admin' ? ['*'] : [] };
  } catch {
    // DB hiccup: treat as logged out rather than crashing the request.
  }
  next();
}

// Use on routes that must have a logged-in user (as opposed to requirePermission,
// which also implies "and they can access this specific category").
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}