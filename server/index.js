import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT_DIR, 'src', 'data', 'disasters.csv');
const ROUTE_DATA_PATH = path.join(ROOT_DIR, 'src', 'data', 'routes.csv');
const DIST_PATH = path.join(ROOT_DIR, 'dist');

const CSV_HEADERS = ['id', 'name', 'lat', 'lng', 'disasterType', 'victimsText', 'status', 'severity', 'description', 'lastUpdate', 'source'];
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
    CSV_HEADERS.map((key) => escapeCSVValue(record[key] ?? '')).join(',')
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

const app = express();
app.use(express.json({ limit: '1mb' }));

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
