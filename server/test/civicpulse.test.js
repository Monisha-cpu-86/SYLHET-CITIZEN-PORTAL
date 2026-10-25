import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { isWithinSccBounds, SCC_WARDS, REPORT_STATUSES } from '../../shared/sylhet.js';
import { requireRoles, requireAuth } from '../src/middleware/auth.js';
import { removeReportImage, storeReportImage } from '../src/services/photos.js';

const temporaryFiles = [];

after(async () => {
  await Promise.all(temporaryFiles.map(removeReportImage));
});

test('Sylhet ward and report status options are complete and stable', () => {
  assert.equal(SCC_WARDS.length, 27);
  assert.equal(SCC_WARDS[0], 'Ward 1');
  assert.equal(SCC_WARDS[26], 'Ward 27');
  assert.ok(REPORT_STATUSES.includes('confirmed_resolved'));
  assert.ok(REPORT_STATUSES.includes('reopened'));
});

test('SCC map bounds accept edge coordinates and reject outside pins', () => {
  assert.equal(isWithinSccBounds(24.85, 91.8), true);
  assert.equal(isWithinSccBounds(24.95, 91.93), true);
  assert.equal(isWithinSccBounds(24.949, 91.93), true);
  assert.equal(isWithinSccBounds(24.9501, 91.8687), false);
  assert.equal(isWithinSccBounds(Number.NaN, 91.8687), false);
});

test('role guard refuses unauthorized users and permits matching staff roles', () => {
  let forbiddenStatus;
  let passed = false;
  const response = { status(code) { forbiddenStatus = code; return this; }, json() { return this; } };
  requireRoles('super_admin')({ user: { role: 'citizen' } }, response, () => { passed = true; });
  assert.equal(forbiddenStatus, 403);
  assert.equal(passed, false);
  requireRoles('super_admin')({ user: { role: 'super_admin' } }, response, () => { passed = true; });
  assert.equal(passed, true);
});

test('authentication guard rejects unauthenticated requests', () => {
  let status;
  const response = { status(code) { status = code; return this; }, json() { return this; } };
  requireAuth({ session: {} }, response, () => assert.fail('Unauthenticated request must not pass.'));
  assert.equal(status, 401);
});

test('image service rejects fake image content and converts a valid image to metadata-free WebP', async () => {
  await assert.rejects(
    storeReportImage({ buffer: Buffer.from('not an image'), size: 12 }),
    (error) => error.status === 400,
  );
  const image = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 90, b: 120 } },
  }).jpeg().toBuffer();
  const stored = await storeReportImage({ buffer: image, size: image.length });
  temporaryFiles.push(stored.fileName);
  assert.equal(stored.mimeType, 'image/webp');
  assert.equal(stored.width, 64);
  const fileBuffer = await (await import('node:fs/promises')).readFile(
    new URL(`../data/uploads/${stored.fileName}`, import.meta.url),
  );
  const metadata = await sharp(fileBuffer).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.exif, undefined);
});
