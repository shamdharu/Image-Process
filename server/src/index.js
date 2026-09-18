import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { pool } from './db.js';
import { attachUser, requireAuth } from './middleware/auth.js';
import { requirePermission, LEVEL_PERMISSIONS } from './middleware/permissions.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { aiRouter } from './routes/ai.js';
import { categoryPath, ensureVariantFolders, storageRoot } from './services/storage.js';
import { enqueueImageJob } from './services/worker.js';
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDirectory, '../../.env') });
dotenv.config();
const app = express();
const port = Number(process.env.PORT || 4000);
const upload = multer({ dest: path.join(storageRoot, 'incoming'), limits: { fileSize: 50 * 1024 * 1024 } });

async function ensureCategoryParentColumn() {
  const [[column]] = await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Category' AND COLUMN_NAME = 'parent_id'");
  if (!column) {
    await pool.query('ALTER TABLE Category ADD COLUMN parent_id BIGINT NULL AFTER number');
    await pool.query('ALTER TABLE Category ADD CONSTRAINT category_parent_fk FOREIGN KEY (parent_id) REFERENCES Category(id) ON DELETE SET NULL');
  }
}

// Document ids are an optional per-image business reference (for example
// DOC-2024-001). They can be supplied at upload time or added/corrected later, so
// the column has to exist for databases created before this feature too. UNIQUE
// keeps one document id pointing at exactly one image; MySQL still permits many
// NULLs, which is how "no document id yet" is represented.
async function ensureImageDocumentIdColumn() {
  const [[table]] = await pool.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Image'");
  if (!table) return;
  const [[column]] = await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Image' AND COLUMN_NAME = 'document_id'");
  if (!column) await pool.query('ALTER TABLE Image ADD COLUMN document_id VARCHAR(120) NULL AFTER original_name');
  const [[index]] = await pool.query("SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Image' AND INDEX_NAME = 'image_document_id'");
  if (!index) await pool.query('ALTER TABLE Image ADD UNIQUE KEY image_document_id (document_id)');
}

// Blank/whitespace document ids are stored as NULL so any number of images can
// go without one, and the value is capped at the column width.
function normalizeDocumentId(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.slice(0, 120) : null;
}

// User accounts + per-category permission grants.
// Mirrors PERMISSION_LEVELS ('view' | 'edit' | 'manage') from CreateUserDialog in App.jsx.
async function ensureUserTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS User (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(191) NOT NULL UNIQUE,
      email VARCHAR(191) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','user') NOT NULL DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS CategoryPermission (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      category_id BIGINT NOT NULL,
      level ENUM('view','edit','manage') NOT NULL,
      UNIQUE KEY user_category (user_id, category_id),
      FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES Category(id) ON DELETE CASCADE
    )
  `);
}

function withOriginalExtension(name, originalName, mimeType) {
  const extension = originalName.includes('.') ? originalName.split('.').pop().toLowerCase() : ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }[mimeType] || 'jpg');
  return name && name.includes('.') ? name : `${name || 'image'}.${extension}`;
}
function variantExtension(variant) {
  return variant === 'thumbnail' || variant === 'web' ? 'webp' : 'jpg';
}
function variantConfig(variant) {
  return {
    thumbnail: { width: 280, format: 'webp', quality: 86 },
    web: { width: 1280, format: 'webp', quality: 86 },
    hd: { width: 2048, format: 'jpeg', quality: 86 },
    print: { width: 3600, format: 'jpeg', quality: 94 }
  }[variant];
}
async function removeUploadTemp(file) {
  if (file?.path) await fs.rm(file.path, { force: true }).catch(() => {});
}
async function fileExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}
async function ensureGeneratedVariant(imageId, categoryId, variant) {
  const config = variantConfig(variant);
  if (!config) return null;
  const output = categoryPath(categoryId, variant, `${imageId}.${variantExtension(variant)}`);
  if (await fileExists(output)) return output;
  await ensureVariantFolders(categoryId);
  const originalPath = categoryPath(categoryId, 'originals', `${imageId}.jpg`);
  await sharp(originalPath)
    .rotate()
    .resize({ width: config.width, withoutEnlargement: true })
    .toFormat(config.format, { quality: config.quality })
    .toFile(output);
  const stats = await fs.stat(output);
  await pool.query('INSERT IGNORE INTO ImageVariant (image_id, variant_type, file_path, width, height, file_size) VALUES (?, ?, ?, 0, 0, ?)', [imageId, variant, output, stats.size]);
  return output;
}

// credentials: true + an explicit origin (not '*') are both required for the
// browser to send/accept the session cookie cross-origin.
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());
// NOTE: /storage used to be mounted here with express.static, which handed out
// every original and generated file with no session or permission check at all
// - a view-only user (or anyone with the URL) could pull any image. All file
// access now goes through /api/variants/:imageId/:variant, which runs
// requirePermission against the owning category.
app.use(attachUser);
app.use(authRouter);
app.use(usersRouter);
app.use(aiRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/me', (req, res) => res.json(req.user || null));

// Lets the client grey out download/upload affordances per folder. The resolved
// capability list is computed here so the client never has to mirror
// LEVEL_PERMISSIONS - that duplicated mapping is how the level -> permission
// relationship previously drifted out of sync with the API.
app.get('/api/me/permissions', requireAuth, async (req, res) => {
  if (req.user.role === 'admin' || req.user.permissions?.includes('*')) {
    return res.json({ isAdmin: true, grants: [] });
  }
  try {
    const [rows] = await pool.query(
      `SELECT cp.category_id AS categoryId, cp.level, c.number, c.name
       FROM CategoryPermission cp
       JOIN Category c ON c.id = cp.category_id
       WHERE cp.user_id = ?
       ORDER BY c.number`,
      [req.user.id]
    );
    res.json({ isAdmin: false, grants: rows.map((row) => ({ ...row, permissions: LEVEL_PERMISSIONS[row.level] || [] })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admins see every folder. Everyone else sees the folders they were granted PLUS
// that folder's ancestor chain, so a granted folder still renders in its correct
// position in the tree. Siblings, unrelated parents' subtrees, and the granted
// folder's own subfolders are not returned at all, so their names never reach the
// browser. Ancestors come back with access_level: null to mark them as pure
// containers.
app.get('/api/categories', requireAuth, async (req, res) => {
  const isAdmin = req.user.role === 'admin' || req.user.permissions?.includes('*');
  if (isAdmin) {
    const [rows] = await pool.query('SELECT c.*, COUNT(i.id) AS image_count FROM Category c LEFT JOIN Image i ON i.category_id = c.id GROUP BY c.id ORDER BY COALESCE(c.parent_id, c.id), c.parent_id IS NOT NULL, c.number');
    return res.json(rows);
  }

  const [grants] = await pool.query('SELECT category_id AS categoryId, level FROM CategoryPermission WHERE user_id = ?', [req.user.id]);
  if (!grants.length) return res.json([]);

  const [tree] = await pool.query('SELECT id, parent_id FROM Category');
  const parentOf = new Map(tree.map((row) => [String(row.id), row.parent_id]));
  const invited = new Set();
  for (const grant of grants) {
    let cursor = String(grant.categoryId);
    // The invited-set check also stops us looping if the tree ever has a cycle.
    while (!invited.has(cursor)) {
      invited.add(cursor);
      const parent = parentOf.get(cursor);
      if (parent == null) break;
      cursor = String(parent);
    }
  }

  const levels = new Map(grants.map((grant) => [String(grant.categoryId), grant.level]));
  const [rows] = await pool.query(
    `SELECT c.*, COUNT(i.id) AS image_count
     FROM Category c LEFT JOIN Image i ON i.category_id = c.id
     WHERE c.id IN (?)
     GROUP BY c.id
     ORDER BY COALESCE(c.parent_id, c.id), c.parent_id IS NOT NULL, c.number`,
    [[...invited].map(Number)]
  );
  res.json(rows.map((row) => ({ ...row, access_level: levels.get(String(row.id)) ?? null })));
});
app.post('/api/categories', requireAuth, async (req, res) => {
  const { name } = req.body; if (!name) return res.status(400).json({ error: 'Category name is required' });
  const parentId = req.body.parentId ? Number(req.body.parentId) : null;
  if (parentId) {
    const [[parent]] = await pool.query('SELECT id FROM Category WHERE id = ?', [parentId]);
    if (!parent) return res.status(400).json({ error: 'Parent category does not exist' });
  }
  const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const [[next]] = await connection.query('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM Category FOR UPDATE'); const [result] = await connection.query('INSERT INTO Category (number, parent_id, name, created_by) VALUES (?, ?, ?, ?)', [next.number, parentId, name, req.user.id]); await connection.commit(); await ensureVariantFolders(result.insertId); res.status(201).json({ id: result.insertId, number: next.number, parent_id: parentId, name }); }
  catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }); } finally { connection.release(); }
});
app.put('/api/categories/:categoryId', requirePermission('category.edit'), async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const [result] = await pool.query('UPDATE Category SET name = ? WHERE id = ?', [name, categoryId]);
  if (!result.affectedRows) return res.sendStatus(404);
  const [[category]] = await pool.query('SELECT id, number, name FROM Category WHERE id = ?', [categoryId]);
  res.json(category);
});
app.delete('/api/categories/:categoryId', requirePermission('category.delete'), async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const [[category]] = await pool.query('SELECT id FROM Category WHERE id = ?', [categoryId]);
  if (!category) return res.sendStatus(404);
  const [categoryRows] = await pool.query('WITH RECURSIVE category_tree AS (SELECT id FROM Category WHERE id = ? UNION ALL SELECT c.id FROM Category c JOIN category_tree ct ON c.parent_id = ct.id) SELECT id FROM category_tree', [categoryId]);
  const categoryIds = categoryRows.map((row) => row.id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [images] = await connection.query('SELECT id FROM Image WHERE category_id IN (?)', [categoryIds]);
    const imageIds = images.map((image) => image.id);
    if (imageIds.length) {
      await connection.query('DELETE FROM ShareLink WHERE image_id IN (?)', [imageIds]);
      await connection.query('DELETE FROM ImageVariant WHERE image_id IN (?)', [imageIds]);
      await connection.query('DELETE FROM UploadJob WHERE image_id IN (?)', [imageIds]);
      await connection.query('DELETE FROM Image WHERE id IN (?)', [imageIds]);
    }
    await connection.query('DELETE FROM CategoryPermission WHERE category_id IN (?)', [categoryIds]);
    await connection.query('DELETE FROM Category WHERE id IN (?)', [categoryIds]);
    await connection.commit();
    await Promise.all(categoryIds.map((id) => fs.rm(path.join(storageRoot, 'categories', String(id)), { recursive: true, force: true })));
    res.sendStatus(204);
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally { connection.release(); }
});

app.get('/api/images', requirePermission('view'), async (req, res) => { const categoryId = Number(req.query.categoryId || 1); const [rows] = await pool.query('SELECT i.*, c.name AS category_name, u.username AS uploader FROM Image i JOIN Category c ON c.id = i.category_id LEFT JOIN User u ON u.id = i.uploaded_by WHERE i.category_id = ? ORDER BY i.created_at DESC', [categoryId]); res.json(rows); });

// A document id can be given while uploading (POST /api/uploads) or added and
// corrected afterwards, which is what this endpoint is for. The permission
// middleware resolves the image's own category, so the caller needs 'edit' - the
// level that already carries 'image.edit' - or 'manage'/admin on that folder.
app.patch('/api/images/:imageId', requirePermission('image.edit'), async (req, res) => {
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(imageId) || imageId <= 0) return res.status(400).json({ error: 'Invalid image id' });
  const [[image]] = await pool.query('SELECT id FROM Image WHERE id = ?', [imageId]);
  if (!image) return res.sendStatus(404);
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'documentId')) return res.status(400).json({ error: 'documentId is required' });
  const documentId = normalizeDocumentId(req.body.documentId);
  if (documentId) {
    const [[documentTaken]] = await pool.query('SELECT id FROM Image WHERE document_id = ? AND id <> ?', [documentId, imageId]);
    if (documentTaken) return res.status(409).json({ error: 'Document ID is already used by another image', documentId, conflictImageId: documentTaken.id });
  }
  await pool.query('UPDATE Image SET document_id = ? WHERE id = ?', [documentId, imageId]);
  res.json({ id: imageId, document_id: documentId });
});

// multer runs BEFORE requirePermission: with the old order, req.body.categoryId
// was always undefined when the permission check ran (multer hadn't parsed the
// multipart body yet), so the category-aware check had nothing to check against.
app.post('/api/uploads', upload.single('file'), requirePermission('upload'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File is required' });
  const categoryRef = Number(req.body.categoryId);
  const [[category]] = await pool.query('SELECT id FROM Category WHERE id = ? OR number = ? LIMIT 1', [categoryRef, categoryRef]);
  if (!category) {
    await removeUploadTemp(req.file);
    return res.status(400).json({ error: 'Category does not exist' });
  }
  const categoryId = category.id;
  const documentId = normalizeDocumentId(req.body.documentId);
  if (documentId) {
    const [[documentTaken]] = await pool.query('SELECT id FROM Image WHERE document_id = ?', [documentId]);
    if (documentTaken) {
      await removeUploadTemp(req.file);
      return res.status(409).json({ error: 'Document ID is already used by another image', documentId, conflictImageId: documentTaken.id });
    }
  }
  const checksum = crypto.createHash('sha256').update(await fs.readFile(req.file.path)).digest('hex');
  const [[duplicate]] = await pool.query('SELECT id FROM Image WHERE checksum_hash = ?', [checksum]);
  if (duplicate) {
    await removeUploadTemp(req.file);
    return res.status(409).json({ error: 'Duplicate image detected', imageId: duplicate.id });
  }
  const savedName = withOriginalExtension(req.body.name, req.file.originalname, req.file.mimetype);
  const [imageResult] = await pool.query("INSERT INTO Image (category_id, original_name, document_id, checksum_hash, status, uploaded_by, mime_type, file_size) VALUES (?, ?, ?, ?, 'processing', ?, ?, ?)", [categoryId, savedName, documentId, checksum, req.user.id, req.file.mimetype, req.file.size]);
  const [jobResult] = await pool.query("INSERT INTO UploadJob (image_id, status, progress, created_by) VALUES (?, 'queued', 0, ?)", [imageResult.insertId, req.user.id]);
  await ensureVariantFolders(categoryId);
  const originalPath = categoryPath(categoryId, 'originals', `${imageResult.insertId}.jpg`);
  await fs.rename(req.file.path, originalPath);
  enqueueImageJob({ jobId: jobResult.insertId, imageId: imageResult.insertId, categoryId, originalPath });
  res.status(202).json({ jobId: jobResult.insertId, imageId: imageResult.insertId, documentId, status: 'processing' });
});

app.get('/api/jobs', async (_req, res) => { const [rows] = await pool.query('SELECT * FROM UploadJob ORDER BY created_at DESC LIMIT 20'); res.json(rows); });

app.delete('/api/images/:imageId', requirePermission('image.delete'), async (req, res) => {
  const imageId = Number(req.params.imageId);
  const [[image]] = await pool.query('SELECT category_id FROM Image WHERE id = ?', [imageId]);
  if (!image) return res.sendStatus(404);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM ShareLink WHERE image_id = ?', [imageId]);
    await connection.query('DELETE FROM ImageVariant WHERE image_id = ?', [imageId]);
    await connection.query('DELETE FROM UploadJob WHERE image_id = ?', [imageId]);
    await connection.query('DELETE FROM Image WHERE id = ?', [imageId]);
    await connection.commit();
    const imageRoot = path.join(storageRoot, 'categories', String(image.category_id));
    await Promise.all(['originals', 'thumbnail', 'web', 'hd', 'print'].map(async (folder) => {
      await fs.rm(path.join(imageRoot, folder, `${imageId}.${variantExtension(folder)}`), { force: true });
      await fs.rm(path.join(imageRoot, folder, `${imageId}.jpeg`), { force: true });
    }));
    const customRoot = path.join(imageRoot, 'custom');
    const customFiles = await fs.readdir(customRoot).catch(() => []);
    await Promise.all(customFiles.filter((file) => file.startsWith(`${imageId}_`)).map((file) => fs.rm(path.join(customRoot, file), { force: true })));
    res.sendStatus(204);
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally { connection.release(); }
});

// Previews need only 'view'. Pulling the asset itself - the untouched original,
// or the print-resolution render - needs 'download', otherwise a view-only user
// can simply request /api/variants/<id>/original.
// 'hd' stays on 'view' because the full screen viewer renders it.
const DOWNLOAD_VARIANTS = new Set(['original', 'print']);

app.get('/api/variants/:imageId/:variant', (req, res, next) => {
  const permission = DOWNLOAD_VARIANTS.has(req.params.variant) ? 'download' : 'view';
  return requirePermission(permission)(req, res, next);
}, async (req, res) => {
  const [[image]] = await pool.query('SELECT category_id FROM Image WHERE id = ?', [req.params.imageId]);
  if (!image) return res.sendStatus(404);
  const folder = req.params.variant === 'original' ? 'originals' : req.params.variant;
  if (folder !== 'originals' && !variantConfig(folder)) return res.status(400).json({ error: 'Unknown image variant' });
  const imageId = Number(req.params.imageId);
  let filePath = categoryPath(image.category_id, folder, `${imageId}.${variantExtension(folder)}`);
  const legacyPath = categoryPath(image.category_id, folder, `${req.params.imageId}.jpeg`);
  try {
    if (folder !== 'originals' && !(await fileExists(filePath))) {
      filePath = await ensureGeneratedVariant(imageId, image.category_id, folder);
    }
    res.sendFile(filePath, (error) => {
      if (!error || folder === 'thumbnail' || folder === 'web') return;
      res.sendFile(legacyPath);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

Promise.all([ensureCategoryParentColumn(), ensureImageDocumentIdColumn(), ensureUserTables()])
  .then(() => app.listen(port, () => console.log(`Image platform API listening on http://localhost:${port}`)))
  .catch((error) => {
    console.error('database migration:', error.message);
    process.exit(1);
  });