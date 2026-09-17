import { pool } from '../db.js';

// Mirrors PERMISSION_LEVELS in App.jsx's CreateUserDialog.
// 'manage' includes everything 'edit' includes, etc.
// Exported so /api/me/permissions can hand the client the resolved capability
// list instead of it re-deriving one from `level` (the two tables drifting apart
// is exactly how the "view only can still download" bug happened).
export const LEVEL_PERMISSIONS = {
  view: ['view'],
  edit: ['view', 'download', 'upload'],
  manage: ['view', 'download', 'upload', 'image.delete', 'category.delete', 'category.create', 'category.edit'],
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
    if (user.role === 'admin' || user.permissions?.includes('*')) return next();

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
      if (level && LEVEL_PERMISSIONS[level]?.includes(permission)) return next();
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
    res.status(403).json({ error: `Missing permission: ${permission}` });
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin' || req.user?.permissions?.includes('*')) return next();
  res.status(403).json({ error: 'Admin access required' });
}