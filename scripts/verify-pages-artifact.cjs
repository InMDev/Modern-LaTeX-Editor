#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const notFoundPath = path.join(distDir, '404.html');

const DEFAULT_BASE_PATH = '/Modern-LaTex-Editor/';
const basePathRaw = process.env.BASE_PATH || DEFAULT_BASE_PATH;
const basePath = basePathRaw.endsWith('/') ? basePathRaw : `${basePathRaw}/`;

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!fs.existsSync(distDir)) fail('Missing dist/. Run the build first.');
if (!fs.existsSync(indexHtmlPath)) fail('Missing dist/index.html');
if (!fs.existsSync(notFoundPath)) fail('Missing dist/404.html (SPA fallback)');

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const expectedPrefix = `${basePath}assets/`;
if (!indexHtml.includes(expectedPrefix)) {
  fail(`dist/index.html does not reference assets under ${expectedPrefix}. Check BASE_PATH and Vite base.`);
}

const notFoundHtml = fs.readFileSync(notFoundPath, 'utf8');
if (notFoundHtml !== indexHtml) {
  fail('dist/404.html is not identical to dist/index.html (expected SPA fallback).');
}

console.log(`Pages artifact OK (base=${basePath})`);

