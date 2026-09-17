import { Router } from 'express';
import { pool } from '../db.js';
import { hashPassword } from '../services/passwords.js';
import { requireAdmin } from '../middleware/permissions.js';

const VALID_LEVELS = new Set(['view', 'edit', 'manage']);
// Mirrors EMAIL_PATTERN in client/src/App.jsx.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const usersRouter = Router();

usersRouter.get('/api/users', requireAdmin, async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT id, username, email, role, created_at FROM User ORDER BY created_at DESC'
  );
  res.json(rows);
});

usersRouter.get('/api/users/:userId/permissions', requireAdmin, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT category_id AS categoryId, level FROM CategoryPermission WHERE user_id = ?',
    [req.params.userId]
  );
  res.json(rows);
});

// Username is optional on the create form: when the admin leaves it blank we
// derive one from the email local part so the NOT NULL UNIQUE column still gets
// a value. A *derived* collision is suffixed (jane, jane2) instead of failing,
// because the admin never chose that name; an *explicitly typed* username that
// is already taken still returns 409.
function deriveUsername(email) {
  return email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 180) || 'user';
}

async function resolveUsername(connection, requested, email) {
  const base = requested.slice(0, 180) || deriveUsername(email);
  let candidate = base;
  for (let suffix = 2; ; suffix += 1) {
    const [[row]] = await connection.query('SELECT id FROM User WHERE username = ?', [candidate]);
    if (!row) return candidate;
    candidate = `${base}${suffix}`;
  }
}

// Body: { username?, email, password, role, permissions: [{ categoryId, level }] }
// Username is optional - CreateUserDialog only requires email + password, and
// this matches exactly what its submit() sends.
usersRouter.post('/api/users', requireAdmin, async (req, res) => {
  const { username, email, password, role = 'user', permissions = [] } = req.body;
  const requestedUsername = username?.trim() || '';
  const normalizedEmail = email?.trim().toLowerCase() || '';

  if (!normalizedEmail || !password?.trim()) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "admin" or "user"' });
  }

  const [[existingEmail]] = await pool.query('SELECT id FROM User WHERE email = ?', [normalizedEmail]);
  if (existingEmail) return res.status(409).json({ error: 'Email already in use' });

  if (requestedUsername) {
    const [[existingUsername]] = await pool.query('SELECT id FROM User WHERE username = ?', [requestedUsername]);
    if (existingUsername) return res.status(409).json({ error: 'Username already in use' });
  }

  // Admins implicitly have full access, so ignore any submitted permissions for them.
  const grants = role === 'user'
    ? permissions.filter((entry) => entry?.categoryId && VALID_LEVELS.has(entry.level))
    : [];

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const resolvedUsername = await resolveUsername(connection, requestedUsername, normalizedEmail);
    const [result] = await connection.query(
      'INSERT INTO User (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [resolvedUsername, normalizedEmail, hashPassword(password), role]
    );
    const userId = result.insertId;
    if (grants.length) {
      const values = grants.map((grant) => [userId, Number(grant.categoryId), grant.level]);
      await connection.query(
        'INSERT INTO CategoryPermission (user_id, category_id, level) VALUES ?',
        [values]
      );
    }
    await connection.commit();
    res.status(201).json({ id: userId, username: resolvedUsername, email: normalizedEmail, role, permissions: grants });
  } catch (error) {
    await connection.rollback();
    // Backstop for the race between the checks above and the UNIQUE indexes.
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That email or username is already in use' });
    }
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

usersRouter.delete('/api/users/:userId', requireAdmin, async (req, res) => {
  const [result] = await pool.query('DELETE FROM User WHERE id = ?', [req.params.userId]);
  if (!result.affectedRows) return res.sendStatus(404);
  res.sendStatus(204);
});