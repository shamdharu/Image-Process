import { Router } from 'express';
import { pool } from '../db.js';
import { verifyPassword } from '../services/passwords.js';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from '../services/session.js';

export const authRouter = Router();

authRouter.post('/api/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier?.trim() || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  const [[user]] = await pool.query(
    'SELECT id, username, email, password_hash, role FROM User WHERE username = ? OR email = ?',
    [identifier.trim(), identifier.trim()]
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username/email or password' });
  }

  const token = createSessionToken(user.id);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    // secure: true, // enable once served over HTTPS
  });
  res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
});

authRouter.post('/api/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.sendStatus(204);
});