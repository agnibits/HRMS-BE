import multer from 'multer';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * File-upload middleware factory (Multer, in-memory). Buffers are handed to the
 * storage service (local/S3) or parsers (Excel import) by the calling module,
 * keeping transient files out of disk. Enforces size and MIME-type limits.
 */
function fileFilter(allowed) {
  return (_req, file, cb) => {
    if (!allowed || allowed.length === 0 || allowed.includes(file.mimetype)) return cb(null, true);
    cb(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`, { code: 'UNSUPPORTED_FILE_TYPE' }));
  };
}

export function upload({ field = 'file', maxCount = 1, allowed } = {}) {
  const m = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.storage.maxUploadBytes },
    fileFilter: fileFilter(allowed),
  });
  return maxCount > 1 ? m.array(field, maxCount) : m.single(field);
}

export const SPREADSHEET_MIME = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const DOC_MIME = [...IMAGE_MIME, 'application/pdf', ...SPREADSHEET_MIME];

export default upload;
