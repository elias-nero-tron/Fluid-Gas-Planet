// Legt spielfertige Einzeldateien nach demo/ (für den Klick-Test ohne Build):
// demo/index.html = Planet, demo/coffee.html = Sahne im Kaffee.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('demo', { recursive: true });
writeFileSync('demo/index.html', readFileSync('dist/index.html', 'utf8'));
const coffee = readFileSync('demos/coffee.html', 'utf8');
writeFileSync('demo/coffee.html',
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  coffee + '\n</html>\n');
console.log('demo/index.html, demo/coffee.html');
