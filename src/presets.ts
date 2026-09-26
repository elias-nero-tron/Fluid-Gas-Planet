// Planeten als Parameter, keine Bilder.
// Windprofile: [Breite in Grad, zonaler Wind in m/s], grob nach Voyager/Cassini/Hubble-Messungen
// (Jupiter: Porco et al. 2003, Tollefson et al. 2017; Saturn: Garcia-Melendo et al. 2011;
//  Uranus/Neptun: Sromovsky et al. 1993/2015). Für die Darstellung wird das Profil auf
// seinen Spitzenwert normiert; der Regler "Jet-Stärke" setzt die sichtbare Geschwindigkeit.

export interface Storm {
  name: string;
  lat: number;        // Grad
  lon: number;        // Grad
  radius: number;     // Grad (Bogenmaß auf der Kugel)
  kind: 'anticyclone' | 'cyclone';
  color: string;
  strength: number;   // relativ zum Jet-Spitzenwert
}

export interface Preset {
  name: string;
  wind: [number, number][];
  bands: [number, string][];     // [Breite, Farbe], wird linear interpoliert
  storms: Storm[];
  oblateness: number;
  tilt: number;                  // Achsneigung in Grad
  rotationHours: number;
  atmosphere: string;
  cloud: string;                 // Farbe aufsteigender Konvektionswolken
  atmosphereStrength: number;
  rings: null | { inner: number; outer: number; color: string; opacity: number };
  // Startwerte für Regler, die je Planet sinnvoll anders sind
  tune: { turbulence: number; convection: number; bandWobble: number; stormTint: number; relief: number };
  facts?: Facts;
}

/** Steckbrief für die Anzeige oben links (echte Werte bei den Vorlagen, plausible beim Zufallsplaneten). */
export interface Facts {
  diameterKm: number;
  distanceAU: number;
  yearDays: number;
  tempC: number;               // an der Wolkenobergrenze
  gravity: number;             // m/s²
  moons: number;
  windMs: number;              // stärkste Winde
  clouds: [string, string];    // [deutsch, englisch]
  locked?: boolean;            // gebundene Rotation (Tag = Jahr)
  note?: [string, string];
}

export const presets: Preset[] = [
  {
    name: 'Jupiter',
    wind: [
      [-90, 0], [-72, 15], [-66, -10], [-62, 25], [-57, -15], [-53, 30], [-47, -10], [-43, 35],
      [-39, -25], [-33, 45], [-29, -30], [-26, 55], [-20, -60], [-17, 10], [-7, 140], [0, 90],
      [7, 125], [15, -10], [17, -30], [21, 60], [23.5, 160], [27, 0], [31, 40], [35, -20],
      [39, 30], [43, -10], [48, 25], [52, -15], [56, 30], [60, -10], [66, 20], [72, 5], [90, 0],
    ],
    bands: [
      [-90, '#586572'], [-70, '#6f7784'], [-58, '#8a8176'], [-48, '#a4917b'], [-40, '#c8b69c'],
      [-33, '#9e7b5c'], [-28, '#d9ccb4'], [-22, '#ece2cf'], [-18, '#a87651'], [-12, '#8e5c3d'],
      [-7, '#c9a37f'], [-3, '#efe5d1'], [3, '#e8d9bd'], [8, '#b98c62'], [12, '#8a5535'],
      [17, '#a06a45'], [20, '#eadfc9'], [24, '#b98d68'], [28, '#dccdb1'], [33, '#a8896a'],
      [40, '#c7b89f'], [50, '#998c7c'], [62, '#7c7b80'], [75, '#646d7a'], [90, '#56616e'],
    ],
    storms: [
      { name: 'Großer Roter Fleck', lat: -22.5, lon: 0, radius: 9, kind: 'anticyclone', color: '#b8472a', strength: 0.9 },
      { name: 'Oval BA', lat: -33, lon: 70, radius: 4, kind: 'anticyclone', color: '#d8a58a', strength: 0.6 },
      { name: 'Weißes Oval', lat: -41, lon: 150, radius: 2.5, kind: 'anticyclone', color: '#f2ede2', strength: 0.5 },
      { name: 'Weißes Oval', lat: -41, lon: 200, radius: 2.5, kind: 'anticyclone', color: '#f2ede2', strength: 0.5 },
      { name: 'Braune Barke', lat: 15, lon: 250, radius: 3, kind: 'cyclone', color: '#6e4128', strength: 0.4 },
      { name: 'Nordpol-Zyklon', lat: 84, lon: 0, radius: 5, kind: 'cyclone', color: '#5f6d7d', strength: 0.5 },
      { name: 'Südpol-Zyklon', lat: -85, lon: 0, radius: 5, kind: 'cyclone', color: '#5f6d7d', strength: 0.5 },
    ],
    oblateness: 0.0649,
    tilt: 3.1,
    rotationHours: 9.93,
    cloud: '#efe8da',
    atmosphere: '#8fb2e0',
    atmosphereStrength: 0.35,
    rings: null,
    facts: { diameterKm: 142984, distanceAU: 5.2, yearDays: 4333, tempC: -108, gravity: 24.8, moons: 95, windMs: 150, clouds: ['Ammoniak-Eis, Ammoniumhydrogensulfid, Wasser', 'ammonia ice, ammonium hydrosulfide, water'] },
    tune: { turbulence: 0.4, convection: 0.8, bandWobble: 0.6, stormTint: 1.6, relief: 0.35 },
  },
  {
    name: 'Saturn',
    wind: [
      [-90, 0], [-78, 100], [-70, 0], [-62, 50], [-55, -20], [-45, 80], [-38, 0], [-30, 120],
      [-20, 300], [-10, 420], [0, 450], [10, 420], [20, 300], [30, 120], [38, 0], [45, 80],
      [55, -20], [62, 50], [70, 0], [78, 120], [90, 0],
    ],
    bands: [
      [-90, '#6f7a86'], [-70, '#a59a82'], [-50, '#cdb994'], [-35, '#dcc9a3'], [-20, '#e6d4ad'],
      [-8, '#ecdcb6'], [0, '#f0e2bf'], [8, '#e8d5ac'], [20, '#dcc59c'], [32, '#cfb58c'],
      [45, '#c8b393'], [60, '#b6a88f'], [74, '#8f9296'], [90, '#6c7886'],
    ],
    storms: [
      { name: 'Nordpolar-Wirbel', lat: 88, lon: 0, radius: 4, kind: 'cyclone', color: '#7d8a8f', strength: 0.3 },
      { name: 'Weißer Fleck', lat: 42, lon: 90, radius: 3, kind: 'anticyclone', color: '#f3ead6', strength: 0.3 },
    ],
    oblateness: 0.0980,
    tilt: 26.7,
    rotationHours: 10.66,
    cloud: '#f4ecd8',
    atmosphere: '#d9c8a0',
    atmosphereStrength: 0.25,
    rings: { inner: 1.24, outer: 2.27, color: '#d8c7a4', opacity: 0.9 },
    facts: { diameterKm: 120536, distanceAU: 9.58, yearDays: 10759, tempC: -139, gravity: 10.4, moons: 274, windMs: 500, clouds: ['Ammoniak-Eis', 'ammonia ice'] },
    tune: { turbulence: 0.35, convection: 0.25, bandWobble: 0.6, stormTint: 0.4, relief: 0.1 },
  },
  {
    name: 'Neptun',
    wind: [
      [-90, 0], [-70, 250], [-50, 150], [-30, -100], [-15, -300], [0, -400], [15, -300],
      [30, -100], [50, 150], [70, 250], [90, 0],
    ],
    bands: [
      [-90, '#2b4f9e'], [-65, '#3c68c4'], [-45, '#3563be'], [-25, '#4a7bd6'], [-10, '#3a6bc8'],
      [0, '#4677d2'], [15, '#3e6fcc'], [35, '#4a7ad4'], [55, '#3563c0'], [75, '#2f58ad'], [90, '#284c98'],
    ],
    storms: [
      { name: 'Großer Dunkler Fleck', lat: -20, lon: 0, radius: 7, kind: 'anticyclone', color: '#1a2f70', strength: 0.7 },
      { name: 'Begleitwolke', lat: -26, lon: 8, radius: 2.5, kind: 'anticyclone', color: '#e6eefc', strength: 0.3 },
      { name: 'Scooter', lat: -42, lon: 120, radius: 2.5, kind: 'anticyclone', color: '#d9e4f8', strength: 0.4 },
      { name: 'Dunkler Fleck 2', lat: -55, lon: 220, radius: 3.5, kind: 'anticyclone', color: '#213a80', strength: 0.5 },
    ],
    oblateness: 0.0171,
    tilt: 28.3,
    rotationHours: 16.11,
    cloud: '#f2f6ff',
    atmosphere: '#7fb0ff',
    atmosphereStrength: 0.5,
    rings: null,
    facts: { diameterKm: 49528, distanceAU: 30.07, yearDays: 60190, tempC: -201, gravity: 11.2, moons: 16, windMs: 580, clouds: ['Methan-Eis', 'methane ice'] },
    tune: { turbulence: 0.5, convection: 1.6, bandWobble: 0.7, stormTint: 0.8, relief: 0.6 },
  },
  {
    name: 'Uranus',
    wind: [
      [-90, 0], [-60, 200], [-30, 60], [-15, -50], [0, -80], [15, -50], [30, 60], [60, 240], [90, 0],
    ],
    bands: [
      [-90, '#b9e4ea'], [-60, '#a9dbe3'], [-30, '#9fd3dd'], [0, '#9ccfda'], [30, '#a2d5de'],
      [55, '#b3dee6'], [75, '#c8e9ee'], [90, '#d2edf1'],
    ],
    storms: [
      { name: 'Heller Fleck', lat: 30, lon: 60, radius: 3, kind: 'anticyclone', color: '#e4f5f7', strength: 0.3 },
    ],
    oblateness: 0.0229,
    tilt: 97.8,
    rotationHours: 17.24,
    cloud: '#f0fbfc',
    atmosphere: '#bff0ff',
    atmosphereStrength: 0.45,
    rings: { inner: 1.64, outer: 2.0, color: '#6d7478', opacity: 0.25 },
    facts: { diameterKm: 51118, distanceAU: 19.19, yearDays: 30687, tempC: -195, gravity: 8.7, moons: 29, windMs: 250, clouds: ['Methan-Eis', 'methane ice'], note: ['liegt auf der Seite (98° Neigung), dreht rückläufig', 'lies on its side (98° tilt), spins retrograde'] },
    tune: { turbulence: 0.2, convection: 0.6, bandWobble: 0.4, stormTint: 0.4, relief: 0.4 },
  },
  {
    name: 'Heißer Jupiter',
    wind: [
      [-90, 0], [-60, -200], [-30, 300], [-10, 1500], [0, 2000], [10, 1500], [30, 300], [60, -200], [90, 0],
    ],
    bands: [
      [-90, '#2a1410'], [-60, '#4a1d12'], [-35, '#7a2e14'], [-15, '#b0481a'], [0, '#d8732a'],
      [15, '#a8431a'], [35, '#6e2912'], [60, '#43190f'], [90, '#26120e'],
    ],
    storms: [
      { name: 'Heißer Fleck', lat: 0, lon: 30, radius: 14, kind: 'anticyclone', color: '#ffb45a', strength: 0.3 },
    ],
    oblateness: 0.01,
    tilt: 0,
    rotationHours: 72,
    cloud: '#ffcf8a',
    atmosphere: '#ff9a5a',
    atmosphereStrength: 0.4,
    rings: null,
    facts: { diameterKm: 163000, distanceAU: 0.031, yearDays: 2.2, tempC: 1200, gravity: 21, moons: 0, windMs: 2400, clouds: ['Silikate (Glasregen)', 'silicates (glass rain)'], locked: true, note: ['Werte wie HD 189733 b', 'values like HD 189733 b'] },
    tune: { turbulence: 0.8, convection: 0.2, bandWobble: 1.2, stormTint: 0.5, relief: 0.15 },
  },
];

// ---------- Umrechnung in Shader-Tabellen ----------

export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2));
  return [c[0], c[1], c[2]];
}

function sampleCurve<T>(stops: [number, T][], lat: number, lerp: (a: T, b: T, t: number) => T): T {
  if (lat <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (lat <= stops[i][0]) {
      const [la, a] = stops[i - 1];
      const [lb, b] = stops[i];
      const t = (lat - la) / (lb - la);
      // Glatte Übergänge (smoothstep), damit Jets und Bänder keine Knicke haben.
      return lerp(a, b, t * t * (3 - 2 * t));
    }
  }
  return stops[stops.length - 1][1];
}

export const TABLE = 64;

/** Normiertes Windprofil (Spitzenwert = 1) an 64 Breiten von −90° bis +90°. */
export function windTable(p: Preset): Float32Array {
  const peak = Math.max(...p.wind.map(([, v]) => Math.abs(v)));
  const out = new Float32Array(TABLE);
  for (let i = 0; i < TABLE; i++) {
    const lat = -90 + (180 * i) / (TABLE - 1);
    out[i] = sampleCurve(p.wind, lat, (a, b, t) => a + (b - a) * t) / peak;
  }
  return out;
}

/** Bandfarben (linear RGB) an 64 Breiten. contrast verstärkt/dämpft den Unterschied zum Mittel. */
export function bandTable(p: Preset, contrast: number): Float32Array {
  const stops = p.bands.map(([lat, hex]) => [lat, hexToLinear(hex)] as [number, [number, number, number]]);
  const rows: [number, number, number][] = [];
  const mean = [0, 0, 0];
  for (let i = 0; i < TABLE; i++) {
    const lat = -90 + (180 * i) / (TABLE - 1);
    const c = sampleCurve(stops, lat, (a, b, t): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    rows.push(c);
    for (let k = 0; k < 3; k++) mean[k] += c[k] / TABLE;
  }
  const out = new Float32Array(TABLE * 4);
  rows.forEach((c, i) => {
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.max(0, mean[k] + (c[k] - mean[k]) * contrast);
    out[i * 4 + 3] = 1;
  });
  return out;
}

/**
 * Misst Bandfarben aus einem Bild: für jede Breite die mittlere Farbe der Bildzeile.
 * Funktioniert mit flachen Karten und mit Fotos der Planetenscheibe (schwarzer Raum und
 * dunkler Rand werden ignoriert, genutzt wird die Mitte jeder Zeile).
 */
export async function bandsFromImage(file: File): Promise<[number, string][]> {
  const bmp = await createImageBitmap(file);
  const w = 256, h = Math.max(64, Math.round((256 * bmp.height) / bmp.width));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const lum = (i: number) => 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
  // Oberste und unterste Zeile mit Planet finden (Foto der Scheibe hat schwarzen Rand).
  const rowHasPlanet = (y: number) => { let n = 0; for (let x = 0; x < w; x++) if (lum((y * w + x) * 4) > 18) n++; return n > w * 0.02; };
  let top = 0, bottom = h - 1;
  while (top < h - 1 && !rowHasPlanet(top)) top++;
  while (bottom > top && !rowHasPlanet(bottom)) bottom--;
  const out: [number, string][] = [];
  for (let k = 0; k < TABLE; k++) {
    const lat = 90 - (180 * k) / (TABLE - 1);
    const y = Math.round(top + ((bottom - top) * k) / (TABLE - 1));
    let x0 = 0, x1 = w - 1;
    while (x0 < w - 1 && lum((y * w + x0) * 4) <= 18) x0++;
    while (x1 > x0 && lum((y * w + x1) * 4) <= 18) x1--;
    const mid = (x0 + x1) / 2, half = Math.max(1, (x1 - x0) * 0.2);
    let r = 0, gg = 0, b = 0, n = 0;
    for (let x = Math.floor(mid - half); x <= Math.ceil(mid + half); x++) {
      const i = (y * w + Math.min(w - 1, Math.max(0, x))) * 4;
      r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++;
    }
    const to = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    out.push([lat, `#${to(r)}${to(gg)}${to(b)}`]);
  }
  return out.reverse();
}

/** Neuer Zufallswert aus dem Zufallsgenerator des Browsers (32 Bit). */
export function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] || 1;
}

/**
 * Zufälliger Gasplanet aus einem Seed. Gleicher Seed = gleicher Planet (reproduzierbar, speicherbar).
 * Erst wird eine Familie gewürfelt (jupiter-, saturnartig, Eisriese, heißer Jupiter, exotisch),
 * dann Bänder mit ungleichen Breiten, Jets an den Bandgrenzen, Stürme, Ringe und Stimmung.
 */
export interface RandomOptions {
  family?: string;                  // '' = würfeln, sonst jovian | saturnian | ice | hot | exotic
  bands?: number;                   // 0 = würfeln, sonst Anzahl Bänder
  storms?: 'auto' | 'none' | 'few' | 'many';
  rings?: 'auto' | 'yes' | 'no';
}

export function randomPreset(seed: number, opts: RandomOptions = {}): Preset {
  // mulberry32: kleiner, guter Pseudozufall
  let st = seed >>> 0;
  const rnd = () => {
    st = (st + 0x6d2b79f5) >>> 0;
    let t = st;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (a: number, b: number) => a + (b - a) * rnd();
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const hsl = (h: number, sat: number, l: number) => {
    h = ((h % 360) + 360) % 360;
    const a = sat * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
  };

  type Family = { name: string; hue: [number, number]; sat: [number, number]; zoneL: [number, number]; beltL: [number, number];
    bands: [number, number]; eq: number; jet: [number, number]; contrast: number; atmoSat: number };
  const families: Family[] = [
    { name: 'jovian', hue: [20, 45], sat: [0.25, 0.55], zoneL: [0.78, 0.9], beltL: [0.35, 0.55], bands: [10, 18], eq: 1, jet: [40, 160], contrast: 1, atmoSat: 0.4 },
    { name: 'saturnian', hue: [35, 55], sat: [0.2, 0.4], zoneL: [0.75, 0.88], beltL: [0.6, 0.72], bands: [8, 14], eq: 3, jet: [30, 120], contrast: 0.5, atmoSat: 0.3 },
    { name: 'ice', hue: [185, 230], sat: [0.35, 0.65], zoneL: [0.55, 0.75], beltL: [0.4, 0.6], bands: [4, 9], eq: -2, jet: [60, 250], contrast: 0.6, atmoSat: 0.6 },
    { name: 'hot', hue: [0, 30], sat: [0.55, 0.85], zoneL: [0.45, 0.65], beltL: [0.15, 0.3], bands: [5, 10], eq: 6, jet: [100, 400], contrast: 1.2, atmoSat: 0.8 },
    { name: 'exotic', hue: [0, 360], sat: [0.3, 0.7], zoneL: [0.6, 0.85], beltL: [0.25, 0.5], bands: [6, 20], eq: 0, jet: [30, 200], contrast: 1, atmoSat: 0.6 },
  ];
  // Erst würfeln, dann Vorgaben anwenden: so bleibt der Zufallsstrom gleich, und derselbe Seed
  // ergibt ohne Vorgaben denselben Planeten wie in v0.2.3.
  const rolled = pick(families);
  const fam = families.find((f) => f.name === opts.family) ?? rolled;
  const hue = range(fam.hue[0], fam.hue[1]);
  const accentHue = hue + pick([30, 60, 150, 180, 210, -40]);

  // Bandgrenzen mit ungleichen Breiten (Summe = 180°)
  const nbRolled = Math.round(range(fam.bands[0], fam.bands[1]));
  const nb = opts.bands && opts.bands >= 2 ? Math.round(opts.bands) : nbRolled;
  const widths = Array.from({ length: nb }, () => range(0.4, 1.6));
  const total = widths.reduce((x, y) => x + y, 0);
  const edges: number[] = [-90];
  for (const w of widths) edges.push(edges[edges.length - 1] + (180 * w) / total);
  edges[edges.length - 1] = 90;

  // Farben: abwechselnd helle Zonen und dunkle Gürtel, gelegentlich Akzentband, Pole kühler
  const bands: [number, string][] = [];
  for (let i = 0; i < nb; i++) {
    const mid = (edges[i] + edges[i + 1]) / 2;
    const polar = Math.pow(Math.abs(mid) / 90, 2);
    const zone = i % 2 === 0;
    let h = hue + range(-12, 12);
    if (rnd() < 0.12) h = accentHue;
    const l = zone ? range(fam.zoneL[0], fam.zoneL[1]) : range(fam.beltL[0], fam.beltL[1]);
    const c = hsl(h + polar * range(-40, 60), range(fam.sat[0], fam.sat[1]) * (1 - 0.5 * polar), l * (1 - 0.25 * polar));
    bands.push([mid, c]);
  }
  bands.unshift([-90, hsl(hue + 180 * range(0, 0.4), 0.2, range(0.3, 0.5))]);
  bands.push([90, hsl(hue + 180 * range(0, 0.4), 0.2, range(0.3, 0.5))]);

  // Jets an den Bandgrenzen mit wechselndem Vorzeichen, Äquatorjet je nach Familie
  const wind: [number, number][] = [[-90, 0]];
  for (let i = 1; i < nb; i++) {
    const lat = edges[i];
    const sign = i % 2 === 0 ? 1 : -1;
    const cos = Math.cos((lat * Math.PI) / 180);
    const eqPart = fam.eq * 60 * Math.exp(-Math.pow(lat / range(12, 30), 2));
    wind.push([lat, sign * range(fam.jet[0], fam.jet[1]) * (0.4 + 0.6 * cos) + eqPart]);
  }
  wind.push([90, 0]);

  // Stürme: ein großer Hauptsturm (manchmal), Ovale, Barken
  const storms: Storm[] = [];
  const stormMode = opts.storms ?? 'auto';
  if (stormMode !== 'none' && (rnd() < 0.6 || stormMode === 'many')) {
    const lat = range(-35, 35);
    storms.push({ name: 'Großer Fleck', lat, lon: range(0, 360), radius: range(5, 11), kind: 'anticyclone',
      color: pick([hsl(accentHue, 0.6, 0.45), hsl(hue - 20, 0.7, 0.4), hsl(hue, 0.15, 0.9), hsl(hue + 200, 0.5, 0.25)]), strength: range(0.6, 1) });
  }
  const smallRolled = Math.floor(range(0, 9));
  const small = stormMode === 'none' ? 0 : stormMode === 'few' ? Math.min(smallRolled, 3) : stormMode === 'many' ? smallRolled + 8 : smallRolled;
  for (let i = 0; i < small; i++) {
    const anti = rnd() < 0.7;
    storms.push({ name: anti ? 'Oval' : 'Barke', lat: range(-70, 70), lon: range(0, 360), radius: range(1.5, 4.5),
      kind: anti ? 'anticyclone' : 'cyclone', color: anti ? hsl(hue, 0.15, range(0.85, 0.95)) : hsl(hue, 0.5, range(0.2, 0.35)), strength: range(0.3, 0.7) });
  }

  const tilt = rnd() < 0.08 ? range(60, 100) : range(0, 35);
  const ringRoll = rnd();
  const wantRings = opts.rings === 'yes' || (opts.rings !== 'no' && ringRoll < 0.4);
  const rings = wantRings
    ? (() => { const inner = range(1.2, 1.7); return { inner, outer: inner + range(0.25, 1.3), color: hsl(hue + range(-30, 30), range(0.05, 0.3), range(0.4, 0.8)), opacity: range(0.15, 0.9) }; })()
    : null;

  const oblateness = range(0.005, 0.12), rotationHours = range(7, 30);
  const cloud = hsl(hue + range(-20, 20), 0.2, range(0.88, 0.97));
  const atmosphere = hsl(fam.name === 'hot' ? range(10, 30) : hue + range(150, 210), fam.atmoSat, 0.7), atmosphereStrength = range(0.2, 0.6);
  const tune = { turbulence: range(0.2, 0.8), convection: range(0, 1.5), bandWobble: range(0.3, 1.2), stormTint: range(0.6, 2), relief: range(0.1, 0.5) };
  // Steckbrief: plausible Werte für einen Stern wie die Sonne (Gleichgewichtstemperatur ~ 255 K/√a).
  const dia: Record<string, [number, number]> = { jovian: [110000, 160000], saturnian: [95000, 130000], ice: [40000, 60000], hot: [120000, 220000], exotic: [30000, 220000] };
  const au = fam.name === 'hot' ? range(0.02, 0.08) : fam.name === 'ice' ? range(12, 45) : range(2, 15);
  const diameterKm = Math.round(range(dia[fam.name][0], dia[fam.name][1]) / 100) * 100;
  const tempC = Math.round(255 / Math.sqrt(au) - 273 + range(-20, 20) + (fam.name === 'hot' ? 300 : 0));
  const clouds: [string, string] = tempC > 700 ? ['Silikate, Eisen', 'silicates, iron'] : tempC > 0 ? ['Wasser, Salze', 'water, salts']
    : tempC > -150 ? ['Ammoniak-Eis', 'ammonia ice'] : ['Methan-Eis', 'methane ice'];
  const facts: Facts = {
    diameterKm, distanceAU: +au.toFixed(au < 1 ? 3 : 2), yearDays: +(365.25 * Math.pow(au, 1.5)).toFixed(1), tempC,
    gravity: +(24.8 * (diameterKm / 142984) * range(0.6, 1.4)).toFixed(1),
    moons: fam.name === 'hot' ? 0 : Math.floor(range(0, 120)), windMs: Math.round(range(fam.jet[0], fam.jet[1]) * 2),
    clouds, locked: fam.name === 'hot',
  };
  return {
    name: `Zufall #${seed.toString(16).padStart(8, '0')}`, wind, bands, storms,
    oblateness, tilt, rotationHours: fam.name === 'hot' ? facts.yearDays * 24 : rotationHours, facts,
    cloud, atmosphere, atmosphereStrength, rings, tune,
  };
}
