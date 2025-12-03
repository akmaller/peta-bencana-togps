import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT_DIR, 'src', 'data', 'disasters.csv');
const ROUTE_DATA_PATH = path.join(ROOT_DIR, 'src', 'data', 'routes.csv');
const DIST_PATH = path.join(ROOT_DIR, 'dist');
const UPLOAD_ROOT = path.join(ROOT_DIR, 'uploads');
const PHOTO_UPLOAD_PATH = path.join(UPLOAD_ROOT, 'photos');

const CSV_HEADERS = ['id', 'name', 'lat', 'lng', 'disasterType', 'victimsText', 'status', 'severity', 'description', 'lastUpdate', 'source', 'photos'];
const ROUTE_CSV_HEADERS = ['id', 'name', 'color', 'coordinates', 'distanceKm', 'durationMinutes', 'createdAt'];

const escapeCSVValue = (value) => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const serializeRecords = (records = []) => {
  const headerRow = CSV_HEADERS.join(',');
  const dataRows = records.map((record) => (
    CSV_HEADERS.map((key) => {
      const value = key === 'photos'
        ? JSON.stringify(Array.isArray(record[key]) ? record[key] : [])
        : record[key];
      return escapeCSVValue(value ?? '');
    }).join(',')
  ));
  return [headerRow, ...dataRows].join('\n');
};

const serializeRouteRecords = (records = []) => {
  const headerRow = ROUTE_CSV_HEADERS.join(',');
  const dataRows = records.map((record) => (
    ROUTE_CSV_HEADERS.map((key) => {
      const value = key === 'coordinates'
        ? JSON.stringify(record[key] ?? [])
        : record[key];
      return escapeCSVValue(value ?? '');
    }).join(',')
  ));
  return [headerRow, ...dataRows].join('\n');
};

const ensureUploadDirectory = async () => {
  try {
    await fs.mkdir(PHOTO_UPLOAD_PATH, { recursive: true });
  } catch (error) {
    console.error('Failed to prepare upload directory:', error);
  }
};

await ensureUploadDirectory();

const sanitizeFileName = (raw = '') => {
  return raw
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PHOTO_UPLOAD_PATH),
    filename: (req, file, cb) => {
      const locationName = sanitizeFileName(req.body?.locationName || 'lokasi');
      const safeBase = locationName || 'lokasi';
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 10000)}`;
      cb(null, `${safeBase}-${uniqueSuffix}${ext}`);
    }
  }),
  limits: { files: 12 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Hanya file gambar yang diizinkan.'));
    }
    cb(null, true);
  }
});

const isHeicFile = (file) => {
  const mimetype = (file?.mimetype || '').toLowerCase();
  if (mimetype.includes('heic') || mimetype.includes('heif')) return true;
  const original = (file?.originalname || file?.filename || '').toLowerCase();
  return original.endsWith('.heic') || original.endsWith('.heif');
};

const convertUploadToJpeg = async (file) => {
  if (!file?.path || !file?.filename) return null;
  const isAlreadyJpeg = /\.jpe?g$/i.test(file.filename);
  if (isAlreadyJpeg) {
    return file.filename;
  }
  const parsed = path.parse(file.filename);
  const targetName = `${parsed.name}.jpg`;
  const targetPath = path.join(PHOTO_UPLOAD_PATH, targetName);
  const cleanupTemporary = async () => {
    await fs.unlink(file.path).catch(() => {});
  };
  const convertHeicBuffer = async () => {
    const inputBuffer = await fs.readFile(file.path);
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 1
    });
    await fs.writeFile(targetPath, outputBuffer);
  };
  const convertWithSharp = async () => {
    await sharp(file.path, { failOnError: false })
      .withMetadata()
      .toFormat('jpeg', { quality: 95, mozjpeg: true })
      .toFile(targetPath);
  };
  try {
    if (isHeicFile(file)) {
      await convertHeicBuffer();
    } else {
      await convertWithSharp();
    }
    await cleanupTemporary();
    return targetName;
  } catch (error) {
    console.error('JPEG conversion failed:', error);
    throw new Error('Konversi foto gagal. Pastikan format file didukung.');
  }
};

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(PHOTO_UPLOAD_PATH));

app.get('/api/disasters', async (req, res) => {
  try {
    const csv = await fs.readFile(DATA_PATH, 'utf-8');
    res.type('text/csv').send(csv);
  } catch (error) {
    console.error('Failed to read CSV:', error);
    res.status(500).json({ error: 'Failed to read disasters database.' });
  }
});

app.get('/api/routes', async (req, res) => {
  try {
    const csv = await fs.readFile(ROUTE_DATA_PATH, 'utf-8');
    res.type('text/csv').send(csv);
  } catch (error) {
    console.error('Failed to read routes CSV:', error);
    res.status(500).json({ error: 'Failed to read routes database.' });
  }
});

app.put('/api/routes', async (req, res) => {
  try {
    const { records } = req.body || {};
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Payload must include array property "records".' });
    }
    const csvPayload = serializeRouteRecords(records);
    await fs.writeFile(ROUTE_DATA_PATH, csvPayload, 'utf-8');
    res.json({ success: true, count: records.length });
  } catch (error) {
    console.error('Failed to write routes CSV:', error);
    res.status(500).json({ error: 'Failed to update routes database.' });
  }
});

app.put('/api/disasters', async (req, res) => {
  try {
    const { records } = req.body || {};
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Payload must include array property "records".' });
    }
    const csvPayload = serializeRecords(records);
    await fs.writeFile(DATA_PATH, csvPayload, 'utf-8');
    res.json({ success: true, count: records.length });
  } catch (error) {
    console.error('Failed to write CSV:', error);
    res.status(500).json({ error: 'Failed to update disasters database.' });
  }
});

app.post('/api/photos/upload', (req, res) => {
  upload.array('photos', 12)(req, res, async (err) => {
    if (err) {
      console.error('Photo upload failed:', err);
      return res.status(400).json({ error: err.message || 'Gagal mengunggah foto.' });
    }
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      const convertedFiles = await Promise.all(files.map(convertUploadToJpeg));
      res.json({
        success: true,
        files: convertedFiles.filter(Boolean)
      });
    } catch (error) {
      console.error('Photo conversion error:', error);
      res.status(500).json({ error: error.message || 'Gagal mengonversi foto ke JPG.' });
    }
  });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(DIST_PATH));
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
}

const PORT = process.env.PORT || 8802;
app.listen(PORT, () => {
  console.log(`Disaster Monitor server running on port ${PORT}`);
});
