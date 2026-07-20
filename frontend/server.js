import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

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
const AI_SELECTION_PATH = path.join(DATA_DIR, 'ai_selection.json');

// Endpoint: List all chart files (excluding annotations.json)
app.get('/api/charts', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const chartFiles = files
      .filter(f => f.endsWith('.json') && !['annotations.json', 'ai_selection.json'].includes(f))
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

// Endpoint: Delete a chart dataset (and its annotations)
app.delete('/api/charts/:name', (req, res) => {
  try {
    const chartName = req.params.name;
    const reserved = new Set(['annotations', 'ai_selection']);
    if (
      !chartName ||
      reserved.has(chartName) ||
      chartName.includes('..') ||
      chartName.includes('/') ||
      chartName.includes('\\')
    ) {
      return res.status(400).json({ error: 'Invalid chart name' });
    }

    const fileName = `${chartName}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    if (path.dirname(filePath) !== DATA_DIR) {
      return res.status(400).json({ error: 'Invalid chart path' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Chart data not found' });
    }

    fs.unlinkSync(filePath);

    // Remove annotations for this chart if present
    if (fs.existsSync(ANNOTATIONS_PATH)) {
      try {
        const allAnnotations = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, 'utf-8') || '{}');
        if (Object.prototype.hasOwnProperty.call(allAnnotations, chartName)) {
          delete allAnnotations[chartName];
          fs.writeFileSync(ANNOTATIONS_PATH, JSON.stringify(allAnnotations, null, 2), 'utf-8');
        }
      } catch (annotationError) {
        console.error('Failed to clean annotations after chart delete:', annotationError);
      }
    }

    // Clear AI selection if it pointed at this chart
    if (fs.existsSync(AI_SELECTION_PATH)) {
      try {
        const selection = JSON.parse(fs.readFileSync(AI_SELECTION_PATH, 'utf-8'));
        if (selection?.chart === chartName) {
          fs.unlinkSync(AI_SELECTION_PATH);
        }
      } catch (selectionError) {
        console.error('Failed to clean AI selection after chart delete:', selectionError);
      }
    }

    res.json({ success: true, message: `Deleted dataset ${chartName}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete chart data', details: error.message });
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

// Endpoint: Publish the exact chart setup currently selected for AI discussion
app.post('/api/ai-selection', (req, res) => {
  try {
    const selection = req.body;
    const isBarSelection = selection?.chart && Number.isInteger(selection?.selectedBar?.barIndex);
    const isHeikenAshiRange = (
      selection?.type === 'heiken_ashi_range' &&
      selection?.chart &&
      (
        selection.selection === null ||
        (
          selection.selection?.startTime &&
          selection.selection?.endTime &&
          Number.isInteger(selection.selection?.startBarIndex) &&
          Number.isInteger(selection.selection?.endBarIndex)
        )
      )
    );
    if (!isBarSelection && !isHeikenAshiRange) {
      return res.status(400).json({ error: 'Selection must include a chart bar or Heiken Ashi range' });
    }

    const tempPath = `${AI_SELECTION_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(selection, null, 2), 'utf-8');
    fs.renameSync(tempPath, AI_SELECTION_PATH);
    res.json({ success: true, path: AI_SELECTION_PATH });
  } catch (error) {
    res.status(500).json({ error: 'Failed to publish AI selection', details: error.message });
  }
});

app.get('/api/ai-selection', (req, res) => {
  try {
    if (!fs.existsSync(AI_SELECTION_PATH)) {
      return res.status(404).json({ error: 'No chart setup has been selected yet' });
    }
    res.json(JSON.parse(fs.readFileSync(AI_SELECTION_PATH, 'utf-8')));
  } catch (error) {
    res.status(500).json({ error: 'Failed to read AI selection', details: error.message });
  }
});

// Endpoint: Get backtester results
app.get('/api/charts/:name/backtest', (req, res) => {
  try {
    const chartName = req.params.name;
    const pythonScript = path.join(__dirname, '..', 'backend', 'backtester.py');
    
    // Construct command with config overrides if present in query parameters
    let cmd = `python3 "${pythonScript}" --chart "${chartName}" --json`;
    
    if (req.query.slopeThreshold) {
      cmd += ` --slope-threshold ${parseFloat(req.query.slopeThreshold)}`;
    }
    if (req.query.retestTolerance) {
      cmd += ` --retest-tolerance ${parseFloat(req.query.retestTolerance)}`;
    }
    if (req.query.minWick) {
      cmd += ` --min-wick ${parseFloat(req.query.minWick)}`;
    }
    if (req.query.maxEmaDist) {
      cmd += ` --max-ema-dist ${parseFloat(req.query.maxEmaDist)}`;
    }
    if (req.query.cooldownBars !== undefined) {
      cmd += ` --cooldown-bars ${parseInt(req.query.cooldownBars, 10)}`;
    }
    if (req.query.wickBodyOffset !== undefined) {
      cmd += ` --wick-body-offset ${parseInt(req.query.wickBodyOffset, 10)}`;
    }
    if (req.query.startTime) {
      cmd += ` --start-time ${req.query.startTime}`;
    }
    if (req.query.endTime) {
      cmd += ` --end-time ${req.query.endTime}`;
    }
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Backtester error:', error, stderr);
        return res.status(500).json({ error: 'Failed to run backtester', details: stderr || error.message });
      }
      try {
        const results = JSON.parse(stdout);
        res.json(results);
      } catch (parseError) {
        console.error('Failed to parse backtester JSON output:', stdout);
        res.status(500).json({ error: 'Failed to parse backtester output', details: parseError.message, stdout });
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during backtest initiation', details: error.message });
  }
});

// Endpoint: Run backtester optimization
app.get('/api/charts/:name/optimize', (req, res) => {
  try {
    const chartName = req.params.name;
    const pythonScript = path.join(__dirname, '..', 'backend', 'backtester.py');
    const cmd = `python3 "${pythonScript}" --chart "${chartName}" --optimize`;
    
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Optimizer error:', error, stderr);
        return res.status(500).json({ error: 'Failed to run optimizer', details: stderr || error.message });
      }
      try {
        const results = JSON.parse(stdout);
        res.json(results);
      } catch (parseError) {
        console.error('Failed to parse optimizer JSON output:', stdout);
        res.status(500).json({ error: 'Failed to parse optimizer output', details: parseError.message, stdout });
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during optimization initiation', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
