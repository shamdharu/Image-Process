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
import { requirePermission, requireAdmin, LEVEL_PERMISSIONS, checkPermission } from './middleware/permissions.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { aiRouter } from './routes/ai.js';
import { categoryPath, ensureVariantFolders, storageRoot } from './services/storage.js';
import { enqueueImageJob } from './services/worker.js';
import { seedAdmin } from './scripts/seed-admin.js';
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

// ---- Organizations --------------------------------------------------------
// Organizations sit above folders: every folder (Category) belongs to exactly
// one organization, and the sidebar shows only the selected org's folders. The
// table + Category.organization_id column are ensured here so databases created
// before this feature gain them on startup. Existing folders default into the
// first organization so nothing disappears after the migration.
async function ensureOrganizationTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS Organization (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      created_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES User(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
  const [[orgTable]] = await pool.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Category'");
  if (!orgTable) return;
  const [[column]] = await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Category' AND COLUMN_NAME = 'organization_id'");
  if (!column) await pool.query('ALTER TABLE Category ADD COLUMN organization_id BIGINT NULL AFTER parent_id');
  const [[fk]] = await pool.query("SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Category' AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'category_organization_fk'");
  if (!fk) {
    // Existing rows keep NULL until they are assigned to the first org below.
    await pool.query('ALTER TABLE Category ADD CONSTRAINT category_organization_fk FOREIGN KEY (organization_id) REFERENCES Organization(id) ON DELETE SET NULL').catch(() => {});
  }
  // Seed a default organization and pull unassigned folders into it so the
  // sidebar never shows a folder that belongs to no organization.
  const [[first]] = await pool.query('SELECT id FROM Organization ORDER BY id LIMIT 1');
  if (!first) {
    const [result] = await pool.query("INSERT INTO Organization (name) VALUES ('Default Organization')");
    await pool.query('UPDATE Category SET organization_id = ? WHERE organization_id IS NULL', [result.insertId]);
  } else {
    await pool.query('UPDATE Category SET organization_id = ? WHERE organization_id IS NULL', [first.id]);
  }
}

// Document ids are a per-image business reference (for example DOC-2024-001).
// One is required at upload time (POST /api/uploads rejects a blank value), and
// it can still be added or corrected later, so the column has to exist for
// databases created before this feature too. Ids are unique per folder (see the
// index below); the column stays nullable on new databases because images that
// predate this rule - or whose id is cleared while editing - have none.
async function ensureImageDocumentIdColumn() {
  const [[table]] = await pool.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Image'");
  if (!table) return;
  const [[column]] = await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Image' AND COLUMN_NAME = 'document_id'");
  if (!column) await pool.query('ALTER TABLE Image ADD COLUMN document_id VARCHAR(120) NULL AFTER original_name');
  // A document id must be unique WITHIN a folder, but the same id may exist in
  // several folders (that is what "Copy to folder" relies on). So the unique key
  // is (category_id, document_id). Any older unique index on document_id alone
  // - whatever it was named - is dropped, otherwise a copy would be rejected.
  const [[folderIndex]] = await pool.query("SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Image' AND INDEX_NAME = 'image_folder_document_id'");
  if (!folderIndex) await pool.query('ALTER TABLE Image ADD UNIQUE KEY image_folder_document_id (category_id, document_id)');
  const [soloIndexes] = await pool.query("SELECT INDEX_NAME AS name FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Image' AND NON_UNIQUE = 0 GROUP BY INDEX_NAME HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME) = 'document_id'");
  for (const { name } of soloIndexes) await pool.query('ALTER TABLE Image DROP INDEX ??', [name]);

  // Same idea for the duplicate-image checksum: the file hash is unique WITHIN a
  // folder, so the same picture can live in several folders (a copy has exactly
  // the same bytes, so a workspace-wide unique key on checksum_hash rejects it).
  // The old single-column unique index on checksum_hash is replaced by
  // (category_id, checksum_hash).
  const [[checksumFolderIndex]] = await pool.query("SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Image' AND INDEX_NAME = 'image_folder_checksum'");
  if (!checksumFolderIndex) await pool.query('ALTER TABLE Image ADD UNIQUE KEY image_folder_checksum (category_id, checksum_hash)');
  const [soloChecksumIndexes] = await pool.query("SELECT INDEX_NAME AS name FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Image' AND NON_UNIQUE = 0 GROUP BY INDEX_NAME HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME) = 'checksum_hash'");
  for (const { name } of soloChecksumIndexes) await pool.query('ALTER TABLE Image DROP INDEX ??', [name]);
}

// Blank/whitespace document ids are stored as NULL so any number of images can
// go without one, and the value is capped at the column width.
function normalizeDocumentId(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.slice(0, 120) : null;
}

// User accounts + per-category permission grants.
// Mirrors PERMISSION_LEVELS ('view' | 'download' | 'edit' | 'manage') from CreateUserDialog in App.jsx.
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
      level ENUM('view','download','edit','manage') NOT NULL,
      UNIQUE KEY user_category (user_id, category_id),
      FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES Category(id) ON DELETE CASCADE
    )
  `);
  // Existing databases need the added download-only enum value too.
  await pool.query("ALTER TABLE CategoryPermission MODIFY level ENUM('view','download','edit','manage') NOT NULL");
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
  // Folders are scoped to an organization: the client asks for one org's
  // folders at a time (the one selected in the sidebar). No filter = all orgs.
  const organizationId = req.query.organizationId ? Number(req.query.organizationId) : null;
  if (isAdmin) {
    if (organizationId) {
      const [rows] = await pool.query('SELECT c.*, COUNT(i.id) AS image_count FROM Category c LEFT JOIN Image i ON i.category_id = c.id WHERE c.organization_id = ? GROUP BY c.id ORDER BY COALESCE(c.parent_id, c.id), c.parent_id IS NOT NULL, c.number', [organizationId]);
      return res.json(rows);
    }
    const [rows] = await pool.query('SELECT c.*, COUNT(i.id) AS image_count FROM Category c LEFT JOIN Image i ON i.category_id = c.id GROUP BY c.id ORDER BY COALESCE(c.parent_id, c.id), c.parent_id IS NOT NULL, c.number');
    return res.json(rows);
  }
  const [grants] = await pool.query('SELECT category_id AS categoryId, level FROM CategoryPermission WHERE user_id = ?', [req.user.id]);
  if (!grants.length) return res.json([]);

  const [tree] = await pool.query('SELECT id, parent_id, organization_id FROM Category');
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
  // Non-admins additionally only see folders of the selected organization.
  const visible = tree
    .filter((row) => invited.has(String(row.id)))
    .filter((row) => !organizationId || String(row.organization_id) === String(organizationId));
  if (!visible.length) return res.json([]);
  const levels = new Map(grants.map((grant) => [String(grant.categoryId), grant.level]));
  const [rows] = await pool.query(
    `SELECT c.*, COUNT(i.id) AS image_count
     FROM Category c LEFT JOIN Image i ON i.category_id = c.id
     WHERE c.id IN (?)
     GROUP BY c.id
     ORDER BY COALESCE(c.parent_id, c.id), c.parent_id IS NOT NULL, c.number`,
    [visible.map((row) => row.id)]
  );
  res.json(rows.map((row) => ({ ...row, access_level: levels.get(String(row.id)) ?? null })));
});

// ---- Organization endpoints -----------------------------------------------
// The sidebar's organization list. Reading is open to any signed-in user;
// creating/renaming/deleting stays admin-only, mirroring folder management.
app.get('/api/organizations', requireAuth, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT o.id, o.name, o.created_at,
            (SELECT COUNT(*) FROM Category c WHERE c.organization_id = o.id) AS foldersCount,
            1 AS membersCount
     FROM Organization o ORDER BY o.id`
  );
  res.json(rows);
});
app.post('/api/organizations', requireAdmin, async (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'Organization name is required' });
  try {
    const [result] = await pool.query('INSERT INTO Organization (name, created_by) VALUES (?, ?)', [name.slice(0, 191), req.user.id]);
    const [[org]] = await pool.query('SELECT id, name FROM Organization WHERE id = ?', [result.insertId]);
    res.status(201).json(org);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An organization with that name already exists' });
    res.status(500).json({ error: error.message });
  }
});
app.put('/api/organizations/:orgId', requireAdmin, async (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'Organization name is required' });
  const [result] = await pool.query('UPDATE Organization SET name = ? WHERE id = ?', [name.slice(0, 191), req.params.orgId]);
  if (!result.affectedRows) return res.sendStatus(404);
  const [[org]] = await pool.query('SELECT id, name FROM Organization WHERE id = ?', [req.params.orgId]);
  res.json(org);
});
app.delete('/api/organizations/:orgId', requireAdmin, async (req, res) => {
  const [[org]] = await pool.query('SELECT id FROM Organization WHERE id = ?', [req.params.orgId]);
  if (!org) return res.sendStatus(404);
  // Folders of a deleted org fall back to the first remaining organization so
  // every folder always belongs to exactly one org.
  const [[fallback]] = await pool.query('SELECT id FROM Organization WHERE id != ? ORDER BY id LIMIT 1', [req.params.orgId]);
  await pool.query('UPDATE Category SET organization_id = ? WHERE organization_id = ?', [fallback ? fallback.id : null, req.params.orgId]);
  await pool.query('DELETE FROM Organization WHERE id = ?', [req.params.orgId]);
  res.sendStatus(204);
});
app.post('/api/categories', requireAuth, async (req, res) => {
  const { name } = req.body; if (!name) return res.status(400).json({ error: 'Category name is required' });
  const parentId = req.body.parentId ? Number(req.body.parentId) : null;
  // New folders land in the organization currently selected in the sidebar.
  // Subfolders inherit their parent's organization; the client may also send an
  // explicit organizationId for root folders.
  let organizationId = req.body.organizationId ? Number(req.body.organizationId) : null;
  if (parentId) {
    const [[parent]] = await pool.query('SELECT id, organization_id FROM Category WHERE id = ?', [parentId]);
    if (!parent) return res.status(400).json({ error: 'Parent category does not exist' });
    organizationId = parent.organization_id ?? organizationId;
  }
  if (!organizationId) {
    const [[first]] = await pool.query('SELECT id FROM Organization ORDER BY id LIMIT 1');
    organizationId = first?.id ?? null;
  }
  // Every folder belongs to exactly one organization — refuse to create an
  // orphan when none exists (the client points the admin at the org dialog).
  if (!organizationId) return res.status(400).json({ error: 'Create an organization before adding folders' });
  const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const [[next]] = await connection.query('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM Category FOR UPDATE'); const [result] = await connection.query('INSERT INTO Category (number, parent_id, organization_id, name, created_by) VALUES (?, ?, ?, ?, ?)', [next.number, parentId, organizationId, name, req.user.id]); await connection.commit(); await ensureVariantFolders(result.insertId); res.status(201).json({ id: result.insertId, number: next.number, parent_id: parentId, organization_id: organizationId, name }); }
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

// Search images by document id across folders. Only folders the caller can see
// are searched: admins see everything, everyone else only folders they have a
// grant on (any level includes 'view'). Optionally scoped to one organization.
// Matches are "contains", exact matches first, capped at 50.
app.get('/api/images/search', requireAuth, async (req, res) => {
  try {
    const term = String(req.query.q || '').trim().slice(0, 120);
    if (!term) return res.json([]);
    const isAdmin = req.user.role === 'admin' || req.user.permissions?.includes('*');
    const organizationId = req.query.organizationId ? Number(req.query.organizationId) : null;
    // Escape LIKE wildcards so a search for "100%" or "A_1" matches literally.
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    let where = 'i.document_id LIKE ?';
    const params = [like];
    if (organizationId) {
      where += ' AND c.organization_id = ?';
      params.push(organizationId);
    }
    if (!isAdmin) {
      const [grants] = await pool.query('SELECT category_id FROM CategoryPermission WHERE user_id = ?', [req.user.id]);
      if (!grants.length) return res.json([]);
      where += ' AND i.category_id IN (?)';
      params.push(grants.map((grant) => grant.category_id));
    }
    const [rows] = await pool.query(
      `SELECT i.id, i.category_id, i.original_name, i.document_id, i.file_size, i.created_at, c.name AS category_name, c.number AS category_number
       FROM Image i JOIN Category c ON c.id = i.category_id
       WHERE ${where}
       ORDER BY (i.document_id = ?) DESC, i.document_id, c.number
       LIMIT 50`,
      [...params, term]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/images', requirePermission('view'), async (req, res) => { const categoryId = Number(req.query.categoryId || 1); const [rows] = await pool.query('SELECT i.*, c.name AS category_name, u.username AS uploader FROM Image i JOIN Category c ON c.id = i.category_id LEFT JOIN User u ON u.id = i.uploaded_by WHERE i.category_id = ? ORDER BY i.created_at DESC', [categoryId]); res.json(rows); });

// A document id can be given while uploading (POST /api/uploads) or added and
// corrected afterwards, which is what this endpoint is for. The permission
// middleware resolves the image's own category, so the caller needs 'edit' - the
// level that already carries 'image.edit' - or 'manage'/admin on that folder.
app.patch('/api/images/:imageId', requirePermission('image.edit'), async (req, res) => {
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(imageId) || imageId <= 0) return res.status(400).json({ error: 'Invalid image id' });
  const [[image]] = await pool.query('SELECT id, category_id FROM Image WHERE id = ?', [imageId]);
  if (!image) return res.sendStatus(404);
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'documentId')) return res.status(400).json({ error: 'documentId is required' });
  const documentId = normalizeDocumentId(req.body.documentId);
  if (documentId) {
    const [[documentTaken]] = await pool.query('SELECT id FROM Image WHERE category_id = ? AND document_id = ? AND id <> ?', [image.category_id, documentId, imageId]);
    if (documentTaken) return res.status(409).json({ error: 'Document ID is already used by another image in this folder', documentId, conflictImageId: documentTaken.id });
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
  // A document id is mandatory at upload time. Existing rows may still be NULL
  // (legacy images, or an id cleared later while editing), which is why the
  // column stays nullable and normalizeDocumentId still maps blank to NULL.
  const documentId = normalizeDocumentId(req.body.documentId);
  if (!documentId) {
    await removeUploadTemp(req.file);
    return res.status(400).json({ error: 'Document ID is required' });
  }
  {
    const [[documentTaken]] = await pool.query('SELECT id FROM Image WHERE category_id = ? AND document_id = ?', [categoryId, documentId]);
    if (documentTaken) {
      await removeUploadTemp(req.file);
      return res.status(409).json({ error: 'Document ID is already used by another image in this folder', documentId, conflictImageId: documentTaken.id });
    }
  }
  const checksum = crypto.createHash('sha256').update(await fs.readFile(req.file.path)).digest('hex');
  const [[duplicate]] = await pool.query('SELECT id FROM Image WHERE category_id = ? AND checksum_hash = ?', [categoryId, checksum]);
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

// ---- Move / copy an image between folders ---------------------------------
const IMAGE_VARIANT_FOLDERS = ['originals', 'thumbnail', 'web', 'hd', 'print'];

// Moving an image is like uploading into the destination folder, so the caller
// needs 'image.edit' on the image's current folder (checked by the middleware)
// and 'upload' on the destination folder (checked below).
app.post('/api/images/:imageId/move', requirePermission('image.edit'), async (req, res) => {
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(imageId) || imageId <= 0) return res.status(400).json({ error: 'Invalid image id' });
  const destinationId = Number(req.body.categoryId);
  if (!Number.isInteger(destinationId) || destinationId <= 0) return res.status(400).json({ error: 'A destination folder is required' });

  const [[sourceImage]] = await pool.query('SELECT id, category_id, document_id, checksum_hash FROM Image WHERE id = ?', [imageId]);
  if (!sourceImage) return res.sendStatus(404);
  if (Number(sourceImage.category_id) === destinationId) {
    return res.status(400).json({ error: 'Destination folder must differ from the current folder' });
  }
  const [[destination]] = await pool.query('SELECT id FROM Category WHERE id = ?', [destinationId]);
  if (!destination) return res.status(404).json({ error: 'Destination folder not found' });

  const canUploadToDestination = await checkPermission(req.user, destination.id, 'upload');
  if (!canUploadToDestination) return res.status(403).json({ error: 'You do not have permission to move images into that folder' });

  // Document ids are unique per folder, so the move is refused if the
  // destination already holds an image with the same id.
  if (sourceImage.document_id) {
    const [[clash]] = await pool.query('SELECT id FROM Image WHERE category_id = ? AND document_id = ?', [destination.id, sourceImage.document_id]);
    if (clash) return res.status(409).json({ error: `That folder already has an image with document ID ${sourceImage.document_id}` });
  }
  const [[sameFile]] = await pool.query('SELECT id FROM Image WHERE category_id = ? AND checksum_hash = ?', [destination.id, sourceImage.checksum_hash]);
  if (sameFile) return res.status(409).json({ error: 'That folder already contains this image' });

  const sourceRoot = path.join(storageRoot, 'categories', String(sourceImage.category_id));
  const targetRoot = path.join(storageRoot, 'categories', String(destination.id));
  const movedFiles = [];
  const connection = await pool.getConnection();
  try {
    await ensureVariantFolders(destination.id);
    await fs.mkdir(path.join(targetRoot, 'custom'), { recursive: true });

    // Originals + generated variants (current extension and the legacy .jpeg name).
    const pairs = [];
    for (const folder of IMAGE_VARIANT_FOLDERS) {
      for (const suffix of new Set([variantExtension(folder), 'jpeg'])) {
        pairs.push([
          path.join(sourceRoot, folder, `${imageId}.${suffix}`),
          path.join(targetRoot, folder, `${imageId}.${suffix}`),
        ]);
      }
    }
    // Custom renders are named "<imageId>_<something>".
    const customFiles = await fs.readdir(path.join(sourceRoot, 'custom')).catch(() => []);
    for (const file of customFiles.filter((name) => name.startsWith(`${imageId}_`))) {
      pairs.push([path.join(sourceRoot, 'custom', file), path.join(targetRoot, 'custom', file)]);
    }
    for (const [src, dest] of pairs) {
      if (!(await fileExists(src))) continue;
      await fs.rename(src, dest);
      movedFiles.push([src, dest]);
    }

    await connection.beginTransaction();
    await connection.query('UPDATE Image SET category_id = ? WHERE id = ?', [destination.id, imageId]);
    // Keep the stored variant paths pointing at the new folder.
    const [variantRows] = await connection.query('SELECT file_path FROM ImageVariant WHERE image_id = ?', [imageId]);
    for (const row of variantRows) {
      if (row.file_path?.startsWith(sourceRoot)) {
        await connection.query(
          'UPDATE ImageVariant SET file_path = ? WHERE image_id = ? AND file_path = ?',
          [targetRoot + row.file_path.slice(sourceRoot.length), imageId, row.file_path]
        );
      }
    }
    await connection.commit();

    const [[moved]] = await pool.query(
      'SELECT i.*, c.name AS category_name FROM Image i JOIN Category c ON c.id = i.category_id WHERE i.id = ?',
      [imageId]
    );
    res.json(moved);
  } catch (error) {
    await connection.rollback().catch(() => {});
    // Put any files that were already moved back where they were.
    for (const [src, dest] of movedFiles.reverse()) await fs.rename(dest, src).catch(() => {});
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Copying keeps the source where it is and creates a new image row in the
// destination folder with the SAME document id. Document ids are unique per
// folder, so the copy is refused only if the destination folder already has an
// image with that id. The caller needs 'image.edit' on the source (via the
// middleware) and 'upload' on the destination.
app.post('/api/images/:imageId/copy', requirePermission('image.edit'), async (req, res) => {
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(imageId) || imageId <= 0) return res.status(400).json({ error: 'Invalid image id' });
  const destinationId = Number(req.body.categoryId);
  if (!Number.isInteger(destinationId) || destinationId <= 0) return res.status(400).json({ error: 'A destination folder is required' });

  const [[sourceImage]] = await pool.query(
    'SELECT id, category_id, original_name, document_id, checksum_hash, mime_type, file_size FROM Image WHERE id = ?',
    [imageId]
  );
  if (!sourceImage) return res.sendStatus(404);
  if (Number(sourceImage.category_id) === destinationId) {
    return res.status(400).json({ error: 'Destination folder must differ from the current folder' });
  }
  const [[destination]] = await pool.query('SELECT id FROM Category WHERE id = ?', [destinationId]);
  if (!destination) return res.status(404).json({ error: 'Destination folder not found' });

  const canUploadToDestination = await checkPermission(req.user, destination.id, 'upload');
  if (!canUploadToDestination) return res.status(403).json({ error: 'You do not have permission to copy images into that folder' });

  const sourceOriginal = categoryPath(sourceImage.category_id, 'originals', `${imageId}.jpg`);
  if (!(await fileExists(sourceOriginal))) return res.status(404).json({ error: 'Original file for this image is missing' });

  if (sourceImage.document_id) {
    const [[clash]] = await pool.query('SELECT id FROM Image WHERE category_id = ? AND document_id = ?', [destination.id, sourceImage.document_id]);
    if (clash) return res.status(409).json({ error: `That folder already has an image with document ID ${sourceImage.document_id}` });
  }
  const [[sameFile]] = await pool.query('SELECT id FROM Image WHERE category_id = ? AND checksum_hash = ?', [destination.id, sourceImage.checksum_hash]);
  if (sameFile) return res.status(409).json({ error: 'That folder already contains this image' });

  let copiedPath = null;
  let committed = false;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [copied] = await connection.query(
      "INSERT INTO Image (category_id, original_name, document_id, checksum_hash, status, uploaded_by, mime_type, file_size) VALUES (?, ?, ?, ?, 'processing', ?, ?, ?)",
      [destination.id, sourceImage.original_name, sourceImage.document_id, sourceImage.checksum_hash, req.user.id, sourceImage.mime_type, sourceImage.file_size]
    );
    const copiedId = copied.insertId;
    const [job] = await connection.query(
      "INSERT INTO UploadJob (image_id, status, progress, created_by) VALUES (?, 'queued', 0, ?)",
      [copiedId, req.user.id]
    );

    // Only the original is copied. The worker regenerates thumbnail/web/hd from
    // it, exactly as it does for a fresh upload.
    await ensureVariantFolders(destination.id);
    copiedPath = categoryPath(destination.id, 'originals', `${copiedId}.jpg`);
    await fs.copyFile(sourceOriginal, copiedPath);

    await connection.commit();
    committed = true;
    enqueueImageJob({ jobId: job.insertId, imageId: copiedId, categoryId: destination.id, originalPath: copiedPath });

    const [[copiedImage]] = await pool.query(
      'SELECT i.*, c.name AS category_name FROM Image i JOIN Category c ON c.id = i.category_id WHERE i.id = ?',
      [copiedId]
    );
    res.status(202).json({ ...copiedImage, jobId: job.insertId, status: 'processing' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (copiedPath && !committed) await fs.rm(copiedPath, { force: true }).catch(() => {});
    if (error.code === 'ER_DUP_ENTRY' && /document_id/.test(error.message)) {
      return res.status(409).json({ error: `That folder already has an image with document ID ${sourceImage.document_id}` });
    }
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
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

Promise.all([ensureCategoryParentColumn(), ensureImageDocumentIdColumn(), ensureUserTables(), ensureOrganizationTables()])
  .then(() => seedAdmin())
  .then(() => app.listen(port, () => console.log(`Image platform API listening on http://localhost:${port}`)))
  .catch((error) => {
    console.error('database migration:', error.message);
    process.exit(1);
  });
