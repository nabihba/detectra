import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Dynamically import the analyze handler ───
const analyzeModule = await import('./api/analyze.js');
const analyzeHandler = analyzeModule.default;

const PORT = 3000;
const STATIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  // Handle API route
  if (req.url === '/api/analyze' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsedBody = JSON.parse(body);

        // Create mock req/res for the serverless handler
        const mockReq = {
          method: 'POST',
          body: parsedBody,
          headers: req.headers,
        };

        const mockRes = {
          statusCode: 200,
          _headers: {},
          _body: null,
          status(code) { this.statusCode = code; return this; },
          json(data) {
            this._body = JSON.stringify(data);
            res.writeHead(this.statusCode, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(this._body);
          },
        };

        await analyzeHandler(mockReq, mockRes);
      } catch (err) {
        console.error('Server error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    return;
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(STATIC_DIR, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    // SPA fallback
    if (ext === '' || ext === '.html') {
      const index = fs.readFileSync(path.join(STATIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(index);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║                                          ║');
  console.log('  ║   🔬 DETECTRA — Local Dev Server         ║');
  console.log(`  ║   → http://localhost:${PORT}               ║`);
  console.log('  ║                                          ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  if (!process.env.GEMINI_API_KEY) {
    console.log('  ⚠️  GEMINI_API_KEY not set! Run with:');
    console.log('     $env:GEMINI_API_KEY="your-key-here"; node server.js');
    console.log('');
  } else {
    console.log('  ✅ Gemini API key detected');
    console.log('');
  }
});
