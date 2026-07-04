import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from '../config/env.js';

/**
 * File storage abstraction. Ships with a local-disk driver (files served via the
 * /uploads static route). Swappable for S3/MinIO by implementing `saveFile`
 * against the AWS SDK when STORAGE_DRIVER=s3.
 */
export async function saveFile(file) {
  if (config.storage.driver === 's3') return saveToS3(file);
  return saveToLocal(file);
}

async function saveToLocal(file) {
  const dir = config.storage.localDir;
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(file.originalname) || '';
  const key = `${Date.now()}-${nanoid(8)}${ext}`;
  await fs.writeFile(path.join(dir, key), file.buffer);
  return {
    key,
    url: `${config.appUrl}/uploads/${key}`,
    size: file.size,
    mimeType: file.mimetype,
    originalName: file.originalname,
  };
}

async function saveToS3(file) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: config.storage.region,
    endpoint: config.storage.endpoint || undefined,
    forcePathStyle: config.storage.forcePathStyle,
    credentials: { accessKeyId: config.storage.accessKey, secretAccessKey: config.storage.secretKey },
  });
  const ext = path.extname(file.originalname) || '';
  const key = `documents/${Date.now()}-${nanoid(8)}${ext}`;
  await client.send(
    new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype })
  );
  const base = config.storage.endpoint
    ? `${config.storage.endpoint}/${config.storage.bucket}`
    : `https://${config.storage.bucket}.s3.${config.storage.region}.amazonaws.com`;
  return { key, url: `${base}/${key}`, size: file.size, mimeType: file.mimetype, originalName: file.originalname };
}

export default { saveFile };
