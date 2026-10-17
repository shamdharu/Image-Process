import { Router } from 'express';
import { pool } from '../db.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
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

// Public registrations create standard users only. They begin with no folder
// access until an administrator grants it from the Admin dashboard.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
authRouter.post('/api/signup', async (req, res) => {
  const email = req.body?.email?.trim().toLowerCase() || '';
  const password = req.body?.password || '';
  if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const [[existing]] = await pool.query('SELECT id FROM User WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ error: 'Email already in use' });
    const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 180) || 'user';
    let username = base;
    for (let suffix = 2; ; suffix += 1) {
      const [[taken]] = await pool.query('SELECT id FROM User WHERE username = ?', [username]);
      if (!taken) break;
      username = `${base}${suffix}`;
    }
    const [result] = await pool.query("INSERT INTO User (username, email, password_hash, role) VALUES (?, ?, ?, 'user')", [username, email, hashPassword(password)]);
    res.status(201).json({ id: result.insertId, username, email, role: 'user' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
