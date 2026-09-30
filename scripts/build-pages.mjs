// Builds the static GitHub Pages site into docs/: the web UI plus the latest data/analytics.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');
const data = path.join(ROOT, 'data', 'analytics.json');
if (!fs.existsSync(data)) { console.error('data/analytics.json missing — run `npm run index` first'); process.exit(1); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'web'), OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.copyFileSync(data, path.join(OUT, 'data', 'analytics.json'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
const rw = path.join(ROOT, 'data', 'rewards.json');
if (fs.existsSync(rw)) fs.copyFileSync(rw, path.join(OUT, 'data', 'rewards.json'));
console.log(`docs/ ready (${(fs.statSync(path.join(OUT, 'data', 'analytics.json')).size / 1e6).toFixed(1)} MB data)`);
