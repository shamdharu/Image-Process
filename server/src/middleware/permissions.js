import { pool } from '../db.js';

// Mirrors PERMISSION_LEVELS in App.jsx's CreateUserDialog.
// 'manage' includes everything 'edit' includes, etc.
// 'image.edit' covers editing an image's own details (currently its document id).
// It is intentionally part of both 'edit' and 'manage': it is not destructive and
// the uploader already controls the name the image is filed under.
// Exported so /api/me/permissions can hand the client the resolved capability
// list instead of it re-deriving one from `level` (the two tables drifting apart
// is exactly how the "view only can still download" bug happened).
export const LEVEL_PERMISSIONS = {
  view: ['view'],
  download: ['view', 'download'],
  edit: ['view', 'download', 'upload', 'image.edit'],
  manage: ['view', 'download', 'upload', 'image.edit', 'image.delete', 'category.delete', 'category.create', 'category.edit'],
};

async function categoryIdForImage(imageId) {
  const [[row]] = await pool.query('SELECT category_id FROM Image WHERE id = ?', [imageId]);
  return row?.category_id ?? null;
}

async function defaultResolveCategoryId(req) {
  if (req.params.categoryId) return Number(req.params.categoryId);
  if (req.body?.categoryId) return Number(req.body.categoryId);
  if (req.query.categoryId) return Number(req.query.categoryId);
  if (req.params.imageId) return categoryIdForImage(Number(req.params.imageId));
  return null;
}

/**
 * requirePermission(permission, options)
 *
 * options.getCategoryId: optional async (req) => categoryId, for routes where
 * the category can't be inferred from params/body/query alone.
 *
 * Admins (role === 'admin') and the legacy '*' permission bypass everything.
 * Everyone else needs a CategoryPermission row for the resolved categoryId
 * whose level grants the requested permission.
 */
export function requirePermission(permission, { getCategoryId } = {}) {
  return async (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role === 'admin' || user.permissions?.includes('*')) {
      req.categoryId = await defaultResolveCategoryId(req).catch(() => null);
      return next();
    }

    let categoryId;
    try {
      categoryId = getCategoryId ? await getCategoryId(req) : await defaultResolveCategoryId(req);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
    if (categoryId == null) return res.status(403).json({ error: `Missing permission: ${permission}` });

    try {
      const [[row]] = await pool.query(
        'SELECT level FROM CategoryPermission WHERE user_id = ? AND category_id = ?',
        [user.id, categoryId]
      );
      const level = row?.level;
      if (level && LEVEL_PERMISSIONS[level]?.includes(permission)) {
        req.categoryId = categoryId;
        return next();
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
    res.status(403).json({ error: `Missing permission: ${permission}` });
  };
}

/**
 * Standalone permission check (for use inside route handlers, not as middleware).
 * Returns true if the user is an admin, or has a CategoryPermission row granting
 * the requested permission on the given category.
 */
export async function checkPermission(user, categoryId, permission) {
  if (!user) return false;
  if (user.role === 'admin' || user.permissions?.includes('*')) return true;
  if (categoryId == null) return false;
  try {
    const [[row]] = await pool.query(
      'SELECT level FROM CategoryPermission WHERE user_id = ? AND category_id = ?',
      [user.id, categoryId]
    );
    return Boolean(row?.level && LEVEL_PERMISSIONS[row.level]?.includes(permission));
  } catch (error) {
    return false;
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin' || req.user?.permissions?.includes('*')) return next();
  res.status(403).json({ error: 'Admin access required' });
}
