// Run with:
// node src/scripts/seed-admin.js
//
// Creates or resets the admin account used to log in and test the app.
//
// Override the password using ADMIN_SEED_PASSWORD in .env

import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';

import { pool } from '../db.js';
import { hashPassword } from '../services/passwords.js';

dotenv.config();

const USERNAME = 'admin001';
const EMAIL = 'admin@gmail.com';

const PASSWORD =
  process.env.ADMIN_SEED_PASSWORD || 'ChangeMe123!';


export async function seedAdmin() {
  try {
    // Hash the admin password
    const passwordHash = hashPassword(PASSWORD);

    // Check whether username or email already exists
    const [[existing]] = await pool.query(
      `
      SELECT id
      FROM User
      WHERE username = ? OR email = ?
      LIMIT 1
      `,
      [USERNAME, EMAIL]
    );


    if (existing) {
      // Existing account -> update it as admin
      await pool.query(
        `
        UPDATE User
        SET
          username = ?,
          email = ?,
          password_hash = ?,
          role = 'admin'
        WHERE id = ?
        `,
        [
          USERNAME,
          EMAIL,
          passwordHash,
          existing.id
        ]
      );

      console.log(
        `[seed-admin] Updated existing admin (id ${existing.id}).`
      );

    } else {
      // No admin -> create one
      const [result] = await pool.query(
        `
        INSERT INTO User
          (username, email, password_hash, role)
        VALUES
          (?, ?, ?, 'admin')
        `,
        [
          USERNAME,
          EMAIL,
          passwordHash
        ]
      );

      console.log(
        `[seed-admin] Created admin (id ${result.insertId}).`
      );
    }


    console.log('----------------------------------------');
    console.log(`username: ${USERNAME}`);
    console.log(`email:    ${EMAIL}`);
    console.log(`password: ${PASSWORD}`);
    console.log('----------------------------------------');
    console.log(
      'Log in with either the username or the email.'
    );

  } finally {
    // NOTE: do NOT call pool.end() here -- when seedAdmin() is called at
    // server startup the pool must stay open for all subsequent requests.
    // pool.end() is only needed when running this script standalone.
  }
}


// Run directly when executing:
// node src/scripts/seed-admin.js
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  seedAdmin()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Seed failed:', error.message);
      pool.end().finally(() => process.exit(1));
    });
}