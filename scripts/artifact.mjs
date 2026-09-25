// Baut aus dist/index.html eine eigenständige Seite ohne <html>/<head>/<body>-Hülle,
// wie sie die claude.ai-Artifact-Veröffentlichung erwartet.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const keep = head
  .replace(/<meta charset[^>]*>/, '')
  .replace(/<meta name="viewport"[^>]*>/, '')
  .trim();
writeFileSync('dist/artifact.html', `${keep}\n${body.trim()}\n`);
console.log('dist/artifact.html', (keep.length + body.length) / 1024 | 0, 'KB');
