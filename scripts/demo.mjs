// Legt spielfertige Einzeldateien nach demo/ (für den Klick-Test ohne Build):
// demo/index.html = Planet, demo/coffee.html = Sahne im Kaffee, demo/terrain.html = Wolken über Gelände.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('demo', { recursive: true });
writeFileSync('demo/index.html', readFileSync('dist/index.html', 'utf8'));
for (const name of ['coffee', 'terrain']) {
  const page = readFileSync(`demos/${name}.html`, 'utf8');
  writeFileSync(`demo/${name}.html`,
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    page + '\n</html>\n');
}
console.log('demo/index.html, demo/coffee.html, demo/terrain.html');
