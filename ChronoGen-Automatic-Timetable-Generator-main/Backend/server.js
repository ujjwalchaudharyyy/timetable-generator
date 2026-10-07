// server.js — ChronoGen main entry point
// Boots Express, wires up middleware and routes, serves the frontend pages.

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../Frontend')));

// Make sure the uploads folder exists before multer tries to write to it
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// ── API Routes ───────────────────────────────────────────────
app.use('/api/upload',   require('./routes/upload'));
app.use('/api/generate', require('./routes/generate'));
app.use('/api/export',   require('./routes/export'));

// Simple health check — useful for monitoring and smoke tests
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Page Routes ──────────────────────────────────────────────
app.get('/',         (req, res) => res.sendFile(path.join(__dirname, '../Frontend/index.html')));
app.get('/input',    (req, res) => res.sendFile(path.join(__dirname, '../Frontend/input.html')));
app.get('/generate', (req, res) => res.sendFile(path.join(__dirname, '../Frontend/generate.html')));
app.get('/output',   (req, res) => res.sendFile(path.join(__dirname, '../Frontend/output.html')));

// ── Error Handler ────────────────────────────────────────────
// Catches anything that slips past route-level try/catch and always returns JSON
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, error: err.message });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ⚡ ChronoGen running at http://localhost:${PORT}\n`);
});
