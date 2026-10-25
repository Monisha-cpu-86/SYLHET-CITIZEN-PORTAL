import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { UPLOAD_DIR } from '../config/env.js';

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxImageBytes = 5 * 1024 * 1024;

export async function storeReportImage(file) {
  if (!file || file.size > maxImageBytes) {
    const error = new Error('Each image must be 5 MB or smaller.');
    error.status = 400;
    throw error;
  }
  const detectedType = await fileTypeFromBuffer(file.buffer);
  if (!detectedType || !allowedImageTypes.has(detectedType.mime)) {
    const error = new Error('Upload a valid JPG, PNG, or WebP image.');
    error.status = 400;
    throw error;
  }

  const processed = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  await mkdir(UPLOAD_DIR, { recursive: true });
  const fileName = `${randomUUID()}.webp`;
  await writeFile(path.join(UPLOAD_DIR, fileName), processed.data, { flag: 'wx' });
  return {
    fileName,
    mimeType: 'image/webp',
    fileSize: processed.data.length,
    width: processed.info.width,
    height: processed.info.height,
  };
}

export async function readReportImage(fileName) {
  return readFile(path.join(UPLOAD_DIR, path.basename(fileName)));
}

export async function removeReportImage(fileName) {
  try {
    await unlink(path.join(UPLOAD_DIR, path.basename(fileName)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export { maxImageBytes };
