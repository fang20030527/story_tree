import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const files = new Map([
  ['/', resolve(here, 'index.html')],
  ['/style.css', resolve(here, 'style.css')],
  ['/preview.js', resolve(here, 'preview.js')],
  ['/assets/InstrumentSerif-Regular.ttf', resolve(here, 'assets/InstrumentSerif-Regular.ttf')],
  ['/assets/Ionicons.ttf', resolve(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf')],
  ['/app/assets/images/black-hole-english-logo.svg', resolve(root, 'app/assets/images/black-hole-english-logo.svg')],
  ...['new-cat-species-002.jpg', 'ai-arms-race.jpg', 'viking-word-independence-001.webp', 'secret-agent-sketchbook-011.jpg'].map((name) => [`/app/assets/images/editorial/${name}`, resolve(root, 'app/assets/images/editorial', name)]),
]);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  const file = files.get(new URL(req.url, 'http://127.0.0.1').pathname);
  if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500); res.end('Preview asset unavailable'); }
});
server.listen(8767, '127.0.0.1', () => process.stdout.write('第二版视觉样稿：http://127.0.0.1:8767\n'));
