// Run once with: node scripts/seed-admin.js
// Creates (or resets the password of) the admin account used to log in and
// test the app. Override the password via ADMIN_SEED_PASSWORD in your .env
// if you don't want the default.
import dotenv from 'dotenv';
import { pool } from '../db.js';
import { hashPassword } from '../services/passwords.js';

dotenv.config();

const USERNAME = 'admin001';
const EMAIL = 'admin@gmail.com';
const PASSWORD = process.env.ADMIN_SEED_PASSWORD || 'ChangeMe123!';

export async function seedAdmin() {
  const passwordHash = hashPassword(PASSWORD);
  const [[existing]] = await pool.query('SELECT id FROM User WHERE username = ? OR email = ?', [USERNAME, EMAIL]);

  if (existing) {
    await pool.query('UPDATE User SET username = ?, email = ?, password_hash = ?, role = ? WHERE id = ?', [USERNAME, EMAIL, passwordHash, 'admin', existing.id]);
    console.log(`[seed-admin] Updated existing admin (id ${existing.id}).`);
  } else {
    const [result] = await pool.query('INSERT INTO User (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [USERNAME, EMAIL, passwordHash, 'admin']);
    console.log(`[seed-admin] Created admin (id ${result.insertId}).`);
  }

  console.log('----------------------------------------');
  console.log(`username: ${USERNAME}`);
  console.log(`email:    ${EMAIL}`);
  console.log(`password: ${PASSWORD}`);
  console.log('----------------------------------------');
  console.log('Log in with either the username or the email.');
}

// Run directly if executed via: node src/scripts/seed-admin.js
if (import.meta.url === `file://${process.argv[1]}`) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Seed failed:', error.message);
      process.exit(1);
    });
}