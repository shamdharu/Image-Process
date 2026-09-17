import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();
export const storageRoot = path.resolve(process.env.STORAGE_PATH || './storage');
export async function ensureVariantFolders(categoryId) {
  await Promise.all(['originals', 'thumbnail', 'web', 'hd', 'print', 'custom'].map((folder) => fs.mkdir(path.join(storageRoot, 'categories', String(categoryId), folder), { recursive: true })));
}
export function categoryPath(categoryId, variant, filename) { return path.join(storageRoot, 'categories', String(categoryId), variant, filename); }