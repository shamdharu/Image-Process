import sharp from 'sharp';
import { pool } from '../db.js';
import { categoryPath, ensureVariantFolders } from './storage.js';
const queue = [];
let running = false;
export function enqueueImageJob(job) { queue.push(job); processQueue(); }
async function processQueue() {
  if (running || !queue.length) return;
  running = true;
  const job = queue.shift();
  try {
    await ensureVariantFolders(job.categoryId);
    const input = sharp(job.originalPath).rotate();
    for (const [type, width, format, extension] of [['thumbnail', 280, 'webp', 'webp'], ['web', 1280, 'webp', 'webp']]) {
      const filename = `${job.imageId}.${extension}`;
      const output = categoryPath(job.categoryId, type, filename);
      await input.clone().resize({ width, withoutEnlargement: true }).toFormat(format, { quality: type === 'print' ? 94 : 86 }).toFile(output);
      await pool.query('INSERT IGNORE INTO ImageVariant (image_id, variant_type, file_path, width, height, file_size) VALUES (?, ?, ?, 0, 0, 0)', [job.imageId, type, output]);
      await pool.query('UPDATE UploadJob SET progress = ? WHERE id = ?', [({ thumbnail: 50, web: 100 })[type], job.jobId]);
    }
    await pool.query("UPDATE Image SET status = 'ready' WHERE id = ?", [job.imageId]);
    await pool.query("UPDATE UploadJob SET status = 'complete', progress = 100 WHERE id = ?", [job.jobId]);
  } catch (error) {
    await pool.query("UPDATE Image SET status = 'failed' WHERE id = ?", [job.imageId]).catch(() => {});
    await pool.query("UPDATE UploadJob SET status = 'failed' WHERE id = ?", [job.jobId]).catch(() => {});
    console.error('image worker:', error.message);
  } finally { running = false; processQueue(); }
}
