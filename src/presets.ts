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

/** Zufälliger Gasplanet aus einem Seed: Anzahl Jets, Farben und Stürme werden gewürfelt. */
export function randomPreset(seed: number): Preset {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const jets = 3 + Math.floor(rnd() * 8);
  const eqSign = rnd() < 0.7 ? 1 : -1;
  const wind: [number, number][] = [[-90, 0]];
  for (let i = 1; i < jets * 2; i++) {
    const lat = -90 + (180 * i) / (jets * 2);
    const sign = i % 2 === 0 ? 1 : -1;
    const eq = Math.cos((lat * Math.PI) / 180);
    wind.push([lat, (sign * (40 + rnd() * 80) + eqSign * 150 * Math.pow(eq, 6)) * (0.5 + eq)]);
  }
  wind.push([90, 0]);
  const hue = rnd() * 360;
  const hsl = (h: number, sat: number, l: number) => {
    const a = sat * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
  };
  const bandCount = 6 + Math.floor(rnd() * 14);
  const bands: [number, string][] = [];
  for (let i = 0; i <= bandCount; i++) {
    const lat = -90 + (180 * i) / bandCount;
    const light = i % 2 === 0 ? 0.65 + rnd() * 0.2 : 0.3 + rnd() * 0.2;
    bands.push([lat, hsl(hue + (rnd() - 0.5) * 60, 0.25 + rnd() * 0.4, light)]);
  }
  const storms: Storm[] = [];
  const count = Math.floor(rnd() * 6);
  for (let i = 0; i < count; i++) {
    const lat = (rnd() - 0.5) * 140;
    storms.push({
      name: `Sturm ${i + 1}`, lat, lon: rnd() * 360, radius: 2 + rnd() * 7,
      kind: rnd() < 0.7 ? 'anticyclone' : 'cyclone',
      color: hsl(hue + 180 * rnd(), 0.4, 0.3 + rnd() * 0.5), strength: 0.3 + rnd() * 0.5,
    });
  }
  return {
    name: 'Zufall', wind, bands, storms,
    oblateness: 0.02 + rnd() * 0.08, tilt: rnd() * 30, rotationHours: 8 + rnd() * 20,
    cloud: hsl(hue, 0.3, 0.9), atmosphere: hsl(hue, 0.5, 0.7), atmosphereStrength: 0.2 + rnd() * 0.4,
    rings: rnd() < 0.35 ? { inner: 1.3 + rnd() * 0.3, outer: 1.9 + rnd() * 0.6, color: hsl(hue + 30, 0.2, 0.6), opacity: 0.4 + rnd() * 0.5 } : null,
    tune: { turbulence: 0.3 + rnd() * 0.5, convection: rnd(), bandWobble: 0.4 + rnd(), stormTint: 0.6, relief: 0.3 },
  };
}
