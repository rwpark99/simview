import fs from 'node:fs'; import { execSync } from 'node:child_process';
execSync('node build.mjs src/app.js dist/app.js', { stdio: 'inherit' });
const VER = fs.readFileSync('src/sw.js','utf8').match(/simview-v(\d+\.\d+)/)[1];
fs.writeFileSync('dist/version.json', JSON.stringify({ version: VER }));
const html = fs.readFileSync('src/index.html', 'utf8').split('__APPV__').join(VER);
for (const f of ['sw.js', 'manifest.webmanifest', 'pdf.min.mjs', 'pdf.worker.min.mjs']) fs.copyFileSync('src/' + f, 'dist/' + f);
fs.writeFileSync('dist/index.html', html.replace('<!--PWA-->', '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png">').replace('<!--SCRIPT-->', '<script src="app.js?v=' + VER + '"></script>'));
const js = fs.readFileSync('dist/app.js').toString('base64');
fs.writeFileSync('dist/hwpview-single.html', html.replace('<!--PWA-->', '').replace('<!--SCRIPT-->', '<script src="data:text/javascript;base64,' + js + '"></script>'));
