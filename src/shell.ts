import { t } from './i18n';

// Gemeinsame Kopfzeile aller Planeten-Seiten: Planetentyp-Umschalter und Sprache.
// Jeder Planetentyp ist ein Modul mit eigener Seite; Menü, Stil und Bedienung sind dieselben.
export type PlanetKind = 'gas' | 'rocky';

const PAGES: { kind: PlanetKind; file: string; de: string; en: string }[] = [
  { kind: 'gas', file: 'index.html', de: 'Gasriese', en: 'Gas giant' },
  { kind: 'rocky', file: 'planets.html', de: 'Gesteinsplanet', en: 'Rocky planet' },
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
  const lb = document.getElementById('lang');
  if (lb) lb.textContent = t('EN', 'DE');
}
