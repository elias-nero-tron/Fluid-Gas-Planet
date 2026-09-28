import { t } from './i18n';

// Gemeinsame Kopfzeile aller Planeten-Seiten: Planetentyp-Umschalter und Sprache.
// Jeder Planetentyp ist ein Modul mit eigener Seite; Menü, Stil und Bedienung sind dieselben.
export type PlanetKind = 'gas' | 'rocky';

const PAGES: { kind: PlanetKind; file: string; de: string; en: string }[] = [
  { kind: 'gas', file: 'index.html', de: 'Gasriese', en: 'Gas giant' },
  { kind: 'rocky', file: 'planets.html', de: 'Gesteinsplanet', en: 'Rocky planet' },
];
// Eingefrorene Versionen: ['' = aktuell] + Dateien in demo/
const VERSIONS: [string, string, string][] = [
  ['', 'aktuell', 'current'],
  ['gas-v0.1.html', 'Gasriese v0.1 (eingefroren)', 'Gas giant v0.1 (frozen)'],
  ['gas-v0.4.html', 'Gasriese v0.4 (eingefroren)', 'Gas giant v0.4 (frozen)'],
  ['planets-v21.html', 'Gesteinsplanet v21 (eingefroren)', 'Rocky planet v21 (frozen)'],
];
const ONLINE = 'https://raw.githack.com/elias-nero-tron/Fluid-Gas-Planet/main/demo/';

/** Link auf die Seite eines Planetentyps. Alle Seiten liegen im selben Ordner (Build, demo/, Entwicklung).
 *  Eine einzeln gespeicherte Datei (file://, z. B. im Download-Ordner) hat keine Nachbarn: dann die Online-Fassung. */
export function pageHref(file: string): string {
  const lone = location.protocol === 'file:' && !/Fluid-Gas-Planet\//.test(location.pathname);
  return lone ? ONLINE + file : file;
}

/** Kopfzeile füllen (bei jedem Sprachwechsel erneut aufrufen). */
export function initShell(current: PlanetKind) {
  const nav = document.getElementById('ptype');
  if (nav) {
    nav.setAttribute('aria-label', t('Planetentyp', 'Planet type'));
    nav.innerHTML = '';
    for (const p of PAGES) {
      const a = document.createElement('a');
      a.textContent = t(p.de, p.en);
      a.href = pageHref(p.file);
      if (p.kind === current) a.setAttribute('aria-current', 'page');
      nav.append(a);
    }
  }
  // Versionsschalter: eingefrorene Stände, die gut waren (fertige Einzeldateien in demo/, werden nie neu gebaut)
  const head = nav?.parentElement;
  if (head && !document.getElementById('ver-switch')) {
    const sel = document.createElement('select');
    sel.id = 'ver-switch';
    sel.setAttribute('aria-label', t('Version', 'Version'));
    sel.style.cssText = 'width: auto; flex: 0 1 7.5em; min-width: 0;';
    head.insertBefore(sel, document.getElementById('lang'));
    sel.addEventListener('change', () => { if (sel.value) location.href = pageHref(sel.value); });
  }
  const vs = document.getElementById('ver-switch') as HTMLSelectElement | null;
  if (vs) {
    vs.innerHTML = '';
    for (const [file, de, en] of VERSIONS) {
      const o = document.createElement('option');
      o.value = file; o.textContent = t(de, en);
      vs.append(o);
    }
    vs.value = '';
  }
  const lb = document.getElementById('lang');
  if (lb) lb.textContent = t('EN', 'DE');
}
