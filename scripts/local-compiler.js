#!/usr/bin/env node

/**
 * Texure Local LaTeX Compiler Server
 * 
 * A zero-dependency lightweight Node.js server that runs locally and compiles 
 * LaTeX documents using your local TeX distribution (e.g. pdflatex).
 * 
 * Usage:
 *   node scripts/local-compiler.js [port]
 */

import http from 'http';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const PORT = process.argv[2] ? parseInt(process.argv[2], 10) : (process.env.PORT ? parseInt(process.env.PORT, 10) : 5001);

const server = http.createServer((req, res) => {
  // CORS Headers to allow requests from any origin (e.g. Netlify deployment)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS Preflight request
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle Compile Request
  if (req.method === 'POST' && (req.url === '/compile' || req.url === '/api/v2' || req.url === '/')) {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON request body.' }));
        return;
      }

      const { code } = payload;
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Missing "code" field in payload.' }));
        return;
      }

      // Create a unique temporary directory
      let tempDir;
      try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'texure-compile-'));
      } catch (err) {
        console.error('Failed to create temp directory:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Failed to create workspace on server.' }));
        return;
      }

      const texPath = path.join(tempDir, 'document.tex');
      const pdfPath = path.join(tempDir, 'document.pdf');
      const logPath = path.join(tempDir, 'document.log');

      // Write code to document.tex
      try {
        fs.writeFileSync(texPath, code, 'utf8');
      } catch (err) {
        console.error('Failed to write tex file:', err);
        cleanup(tempDir);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Failed to write input file.' }));
        return;
      }

      // Compile using pdflatex
      // We use interaction=nonstopmode to ensure pdflatex doesn't prompt for input on errors
      const cmd = `pdflatex -interaction=nonstopmode -output-directory="${tempDir}" "${texPath}"`;
      console.log(`[Compiling] Running command: ${cmd}`);

      exec(cmd, (execErr, stdout, stderr) => {
        // Even if exec returns an error code (e.g. compilation failed), pdflatex still writes a log
        // that contains details. So we inspect log file and output PDF presence first.
        let pdfBase64 = null;
        let logContent = '';

        if (fs.existsSync(logPath)) {
          logContent = fs.readFileSync(logPath, 'utf8');
        } else {
          logContent = stdout + '\n' + stderr;
        }

        const compiledSuccessfully = fs.existsSync(pdfPath);
        if (compiledSuccessfully) {
          try {
            const pdfBuffer = fs.readFileSync(pdfPath);
            pdfBase64 = pdfBuffer.toString('base64');
          } catch (err) {
            console.error('Failed to read compiled PDF:', err);
          }
        }

        // Clean up workspace
        cleanup(tempDir);

        if (compiledSuccessfully && pdfBase64) {
          console.log('[Compiling] Success!');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'success',
            result: pdfBase64,
            log: logContent
          }));
        } else {
          console.log('[Compiling] Failed to produce PDF.');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'error',
            log: logContent || 'pdflatex execution failed without creating a log file. Make sure LaTeX is installed on the host machine.'
          }));
        }
      });
    });
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'error', message: 'Endpoint not found. Use POST /compile.' }));
});

// Helper to remove directory recursively
function cleanup(dirPath) {
  try {
    if (fs.rmSync) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } else {
      fs.rmdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    console.error(`Failed to clean up directory ${dirPath}:`, err);
  }
}

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log('===================================================');
  console.log(` Texure Local LaTeX Compiler Server Running`);
  console.log(` Address: http://localhost:${PORT}`);
  console.log(` Endpoint: http://localhost:${PORT}/compile`);
  console.log('===================================================');
  console.log(`Prerequisites:`);
  console.log(` - pdflatex command must be available in your PATH.`);
  console.log(` - Test this by running: pdflatex --version`);
  console.log('===================================================');
});
