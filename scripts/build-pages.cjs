#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const viteCli = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const DEFAULT_BASE_PATH = '/Modern-LaTex-Editor/';
const basePathRaw = process.env.BASE_PATH || DEFAULT_BASE_PATH;
const basePath = basePathRaw.endsWith('/') ? basePathRaw : `${basePathRaw}/`;

const env = { ...process.env, BASE_PATH: basePath };

const run = (cmd, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...options });
    child.on('close', (code) => resolve(code));
  });

(async () => {
  if (!fs.existsSync(viteCli)) {
    console.error(`Missing Vite CLI at ${viteCli}. Did you run npm install?`);
    process.exit(1);
  }

  const code = await run(process.execPath, [viteCli, 'build'], { cwd: repoRoot, env });
  if (code !== 0) process.exit(code);

  const distDir = path.join(repoRoot, 'dist');
  const indexHtml = path.join(distDir, 'index.html');
  const notFoundHtml = path.join(distDir, '404.html');

  if (!fs.existsSync(indexHtml)) {
    console.error('Build did not produce dist/index.html');
    process.exit(1);
  }

  fs.copyFileSync(indexHtml, notFoundHtml);
})();

