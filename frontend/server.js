import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;

// Enable CORS and JSON body parsing
app.use(cors());
app.use(express.json());

// Path to the data directory
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ANNOTATIONS_PATH = path.join(DATA_DIR, 'annotations.json');

// Endpoint: List all chart files (excluding annotations.json)
app.get('/api/charts', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const chartFiles = files
      .filter(f => f.endsWith('.json') && f !== 'annotations.json')
      .map(f => f.replace('.json', ''));
    res.json(chartFiles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read data directory', details: error.message });
  }
});

// Endpoint: Get specific chart data
app.get('/api/charts/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Chart data not found' });
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load chart data', details: error.message });
  }
});

// Endpoint: Get all annotations
app.get('/api/annotations', (req, res) => {
  try {
    if (!fs.existsSync(ANNOTATIONS_PATH)) {
      return res.json({});
    }
    const data = fs.readFileSync(ANNOTATIONS_PATH, 'utf-8');
    res.json(JSON.parse(data || '{}'));
  } catch (error) {
    res.status(500).json({ error: 'Failed to read annotations', details: error.message });
  }
});

// Endpoint: Save annotations for a specific chart key
app.post('/api/annotations', (req, res) => {
  try {
    const { fileKey, annotations } = req.body;
    if (!fileKey) {
      return res.status(400).json({ error: 'Missing fileKey' });
    }

    let allAnnotations = {};
    if (fs.existsSync(ANNOTATIONS_PATH)) {
      const existingData = fs.readFileSync(ANNOTATIONS_PATH, 'utf-8');
      allAnnotations = JSON.parse(existingData || '{}');
    }

    // Update the annotations for this specific chart file
    allAnnotations[fileKey] = annotations || [];

    fs.writeFileSync(ANNOTATIONS_PATH, JSON.stringify(allAnnotations, null, 2), 'utf-8');
    res.json({ success: true, message: `Annotations saved for ${fileKey}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save annotations', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
