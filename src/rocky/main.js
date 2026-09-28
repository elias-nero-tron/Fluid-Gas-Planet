import { Panel } from '../ui';
import { t, lang, setLang } from '../i18n';
import { initShell } from '../shell';
import { SKY_GEN_WGSL, SKY_DRAW_WGSL, skyParams } from '../sky/sky';
// ============================================================================================
// Prozedurale Planeten, nachgebaut nach colordodge "ProceduralPlanet" (three.js, WTFPL) und erweitert.
//
// Verfahren des Originals (so übernommen):
//   Würfel-Kugel: sechs Würfelseiten, jede bekommt eigene Karten. Höhe und Feuchte sind je eine
//   Mischung aus zwei fBm-Feldern (Simplex, 16 Oktaven, wahlweise "ridged") mit einem dritten Feld
//   als Mischmaske. Ein zufällig gemaltes Biom-Bild (x = Feuchte, y = Höhe; Farbverläufe, Kreise,
//   Wasser-, Strand- und Binnenland-Band) färbt. Normalen: Sobel über Höhe + Bildhelligkeit,
//   Wasser glatt. Rauigkeit und Metall aus der Wasserlinie. Dazu Wolken, Leuchtsaum, Nebel,
//   Sterne, Sonne mit Blendenflecken, dat.GUI-Ordner Lighting/Camera/Material/Debug/Environment.
//
// "+20 %" (Verbessert):
//   Meeresspiegel als Regler (fehlte), live. Wasser mit Beer-Lambert-Tiefenfarbe, GGX-Sonnenglitzern,
//   Fresnel, Wellen und Brandung. Erosionsrinnen (Gavoronoise nach Clay John / Fewes, auf die Kugel
//   übertragen), Detail-Oktaven zur Laufzeit, Geländeschatten, Terrassen. Atmosphäre mit Rayleigh-,
//   Mie- und Ozon-Streuung (Transmissions-Tabelle nach Bruneton). Wolken mit Zonalwinden
//   (Passat/Westwind/polare Ostwinde), Klimabändern, Wolkenschatten und Vorwärtsstreuung.
//   Nebel und Sterne bleiben stehen, nur der Planet dreht sich, ruhig.
//
// Technik: WebGPU. Karten (Höhe, Feuchte, Wolken, Nebel, Luft-Tabelle) entstehen in Compute-Shadern,
// in Kacheln verteilt auf viele Bilder, damit die Seite flüssig bleibt. Bild in HDR, dann Luft, Überstrahlung, Filmkurve.
//
// Fremder Code in dieser Datei (beide MIT-Lizenz):
//   snoise(): 3D-Simplexrauschen aus webgl-noise (hier nach WGSL übertragen), Copyright (C) 2011 Ashima Arts (Ian McEwan),
//             Copyright (C) 2011-2022 Stefan Gustavson; Gradientenversion nach Gustavson.
//   hash33(), hash13(): "Hash without Sine", Copyright (c) 2014 David Hoskins.
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
//   following conditions: The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
//   ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
//   FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
//   LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
//   ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
// ============================================================================================

const Q = new URLSearchParams(location.search);
const coarse = matchMedia('(max-width: 760px), (pointer: coarse)').matches;

// ------------------------------------------------------------------ Zustand & Voreinstellungen
const randomSeed = () => String(Math.floor(10000000 + Math.random() * 89999999));
const hashSeed = /^#?(\d{3,12})$/.exec(location.hash);
const S = {
  seed: Q.get('seed') || (hashSeed ? hashSeed[1] : randomSeed()),
  style: Q.get('style') === 'orig' ? 'orig' : 'plus',
  res: Number(Q.get('res')) || (coarse ? 1024 : 2048),
  palette: Q.get('palette') === 'cd' ? 'cd' : 'earth',
  sea: -1,                                   // -1 = Wert des Planeten (aus dem Seed)
  // Original (Material/Lighting wie im three.js-Vorbild)
  nscale: 1.0, rough: 0.8, metal: 0.5, sunI: 1.6, ambient: 0.22, glow: 0.6, cloudOpO: 0.6,
  // Verbessert
  waves: 1.0, clarity: 1.0, foam: 0.7,
  bump: 1.5, relief: 0.018, erosion: 1.0, terrace: 0.0, detail: 1.0, shadows: 1.0,
  gloss: 0.75, exposure: 1.0, ambientP: 0.35,
  cloudOp: 1.0, cloudH: 0.012, wind: 1.0, cloudShadow: 0.8,
  atmo: 1.0, thick: 2.5, haze: 1.0, bloom: 0.6,
  // gemeinsam
  sunAz: -58, sunEl: 12, cover: 0.5,
  nebula: 1.0, stars: 1.0, flare: 0.5,
  mwWidth: 1.0, mwCore: 1.0, mwDust: 1.0, mwHii: 1.0,
  rotate: true, spin: 1.2, spinZoom: 1.0, volcanoes: 0.5, rivers: 1, tilt: 23, fov: 36,
  view: 0, quality: 0,
};
// Wer reduzierte Bewegung eingestellt hat, bekommt einen stehenden Planeten (Drehen lässt sich einschalten)
if (matchMedia('(prefers-reduced-motion: reduce)').matches) S.rotate = false;
const DEF = { ...S };
const numQ = (k) => { const v = Q.get(k); if (v !== null && v !== '' && !isNaN(Number(v)) && k in S) S[k] = Number(v); };
for (const k of Object.keys(S)) if (typeof S[k] === 'number' && k !== 'res') numQ(k);
const cloudRes = Number(Q.get('cres')) || (coarse ? 512 : 2048);
const nebRes = Number(Q.get('nres')) || (coarse ? 512 : 2048);

// ------------------------------------------------------------------ Zufall (seedString wie im Original)
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function rng(seed) {
  const s = xmur3(String(seed));
  let a = s(), b = s(), c = s(), d = s();
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let x = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; x = (x + d) | 0; c = (c + x) | 0;
    return (x >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Planet-Parameter aus dem Seed. Wie im Original zufällig und (bis auf den Meeresspiegel) nicht als Regler sichtbar.
function planetParams(seed) {
  const R = rng(seed + '|planet');
  const rr = (a, b) => a + (b - a) * R();
  const field = () => ({ res1: rr(0.35, 1.2), res2: rr(0.2, 1.0), resMix: rr(0.3, 1.1), mixScale: rr(0.5, 1.0), type: Math.floor(rr(0, 4)) });
  return {
    noiseSeed: rr(0, 400),
    h: field(),
    m: field(),
    water: rr(0.3, 0.72),        // Wasseranteil (Original: zufälliger waterLevel ohne Regler)
    cloudSeed: rr(0, 400),
    cloudCover: rr(0.16, 0.36),
    nebSeed: rr(0, 400),
    nebHue: R(), nebHue2: R(), nebSat: rr(0.45, 0.9), nebBright: rr(0.5, 1.2),
    moistM: rr(0.8, 1.2),
    mountains: rr(0.18, 0.34),
    beltFreq: rr(1.1, 1.9),
  };
}
let PP = planetParams(S.seed);

// ------------------------------------------------------------------ Oberfläche (Texte, Regler)
const $ = (id) => document.getElementById(id);
const pct = (v) => `${Math.round(v * 100)} %`;

function controls() {
  return [
    { id: 'planet', title: t('Planet', 'Planet'), open: true, items: [
      { k: 'res', type: 'select', label: t('Kartenauflösung', 'Map resolution'), opts: [[512, '512'], [1024, '1024'], [2048, '2048'], [4096, t('4096 (~1 GB Grafikspeicher)', '4096 (~1 GB GPU memory)')], [8192, t('8192 (~4,5 GB, starke Grafikkarte)', '8192 (~4.5 GB, strong GPU)')]], regen: true,
        help: t('Pixel pro Würfelseite für Höhe, Feuchte und Relief (im Original "resolution"). Sechs Seiten ergeben die Kugel; 2048 sind rund um den Äquator 8192 Pixel.', 'Pixels per cube face for height, moisture and relief (the original\'s "resolution"). Six faces make the sphere; 2048 is 8192 pixels around the equator.'),
        fx: t('Speicher: 6·N²·8 Byte (+⅓ Mipmaps)', 'Memory: 6·N²·8 bytes (+⅓ mipmaps)') },
      { k: 'palette', mode: 'plus', type: 'select', label: t('Farben', 'Colours'), opts: [['earth', t('Erdähnlich', 'Earth-like')], ['cd', t('Original-Biombild', 'Original biome image')]],
        help: t('Biom-Bild: dieselben Zufallsfarben wie im Original, aber physikalisch beleuchtet. Erdähnlich: Klimazonen aus Breite, Höhe und Feuchte (Wüste, Steppe, Wald, Regenwald, Taiga, Tundra, Fels, Schnee).', 'Biome image: the same random colours as the original, but physically lit. Earth-like: climate zones from latitude, altitude and moisture (desert, steppe, forest, rainforest, taiga, tundra, rock, snow).'),
        fx: 'T = 1 − 1,25·|sin φ|^1,35 − 1,6·(h − s),  Biom = f(T, Feuchte, Hang)' },
    ] },
    { id: 'sea', title: t('Meer', 'Sea'), open: true, items: [
      { k: 'sea', min: 0, max: 1, step: 0.005, label: t('Meeresspiegel', 'Sea level'), fmt: (v) => `${pct(v)} ${t('Wasser', 'water')}`,
        help: t('Fehlte im Original (dort zufällig, ohne Regler). Bestimmt, welcher Anteil der Oberfläche unter Wasser liegt. Küsten, Strände, Relief und Farben folgen sofort, ohne Neuberechnung.', 'Missing in the original (random there, no control). Sets how much of the surface is under water. Coasts, beaches, relief and colours follow instantly, without recomputing.'),
        fx: t('s = Quantil der Höhen: P(h < s) = Wasseranteil', 's = height quantile: P(h < s) = water fraction') },
      { k: 'waves', mode: 'plus', min: 0, max: 3, step: 0.01, label: t('Wind & Wellen', 'Wind & waves'),
        help: t('Wellenneigung. Aus der Nähe siehst du einzelne Wellen, aus der Ferne werden sie zur Rauigkeit des Sonnenglitzerns, so wie auf Satellitenbildern.', 'Wave slope. Up close you see single waves; from afar they become the roughness of the sun glint, as in satellite images.'),
        fx: 'σ² = 0,003 + 0,00512·W (Cox–Munk),  α = √(α₀² + σ²_subpixel)' },
      { k: 'clarity', mode: 'plus', min: 0.2, max: 3, step: 0.01, label: t('Klarheit', 'Clarity'),
        help: t('Wie tief man ins Wasser sieht. Flaches Wasser über Sand wird türkis, tiefes dunkelblau, weil Rot zuerst verschluckt wird.', 'How deep you can see into the water. Shallow water over sand turns turquoise, deep water navy, because red is absorbed first.'),
        fx: 'T = exp(−κ·z·(1/μᵥ + 1/μₛ)),  κ = (0,45; 0,065; 0,021) m⁻¹ / ' + t('Klarheit', 'clarity') },
      { k: 'foam', mode: 'plus', min: 0, max: 2, step: 0.01, label: t('Brandung', 'Surf'),
        help: t('Schaumlinien an der Küste, die mit den Wellen auf den Strand laufen.', 'Foam lines at the coast that run up the beach with the waves.'),
        fx: 'Schaum = (1 − z/z_b)·smoothstep(0,55; 0,95; ½ + ½ sin(2π·3z/z_b − ωt))' },
    ] },
    { id: 'terrain', title: t('Gelände', 'Terrain'), open: true, items: [
      { k: 'nscale', mode: 'orig', min: 0, max: 4, step: 0.01, label: t('Normalenstärke', 'Normal scale'),
        help: t('Wie im Original (Material → normalScale): Stärke der Normal-Karte aus Höhe + Bildhelligkeit. Daher die feinen Höhenlinien-Stufen.', 'As in the original (Material → normalScale): strength of the normal map from height + image brightness. Hence the fine contour steps.'),
        fx: 'n = normalize(−s·Sobel(h₈ + Y(biom)), 1),  h₈ = ⌊255·h⌋/255' },
      { k: 'bump', mode: 'plus', min: 0, max: 3, step: 0.01, label: t('Relief-Schärfe', 'Relief sharpness'),
        help: t('Wie steil Hänge im Licht wirken. Die Normalen kommen hier exakt aus dem Rauschen (Ableitung), ohne Stufen.', 'How steep slopes look in the light. Normals come exactly from the noise derivative here, without steps.'),
        fx: 'n = normalize(r̂ − k·∇ₛh)' },
      { k: 'relief', mode: 'plus', min: 0, max: 0.08, step: 0.001, label: t('Relief-Höhe', 'Relief height'),
        help: t('Echte Verschiebung der Oberfläche. Berge ragen am Rand über die Kugel hinaus und werfen Schatten.', 'Real displacement of the surface. Mountains rise above the limb and cast shadows.'),
        fx: 'r = 1 + k_r·max(h − s, 0)' },
      { k: 'volcanoes', mode: 'plus', min: 0, max: 1, step: 0.01, label: t('Vulkane', 'Volcanoes'), regen: true,
        help: t('Kegelberge mit Gipfelkrater (Schichtvulkane), zufällig auf dem Land verteilt. 0 = keine.', 'Cone mountains with a summit crater (stratovolcanoes), scattered over land. 0 = none.'),
        fx: 'h += H·((1−r/R)^1.8 − 0.55·(1 − (r/r_c)²)₊)' },
      { k: 'rivers', mode: 'plus', type: 'select', label: t('Flüsse', 'Rivers'), opts: [[1, t('an (berechneter Verlauf)', 'on (computed course)')], [0, t('aus', 'off')]], regen: 'rivers',
        help: t('Flüsse laufen wirklich bergab: Senken werden aufgefüllt (Priority-Flood, Barnes 2014), dann sammelt jeder Punkt das Regenwasser seiner Oberlieger (Abflussakkumulation, O’Callaghan & Mark 1984). Wo genug zusammenkommt, entsteht ein Fluss, breiter mit mehr Wasser. Echte Strömung im Flussbett (Flachwasser) folgt später als zweite Stufe.', 'Rivers truly run downhill: sinks are filled (priority-flood, Barnes 2014), then every point collects the rain of the cells above it (flow accumulation, O’Callaghan & Mark 1984). Where enough gathers a river forms, wider with more water. Real flow in the river bed (shallow water) comes later as a second stage.') },
      { k: 'erosion', mode: 'plus', min: 0, max: 3, step: 0.01, label: t('Erosion', 'Erosion'), regen: true,
        help: t('Rinnen und Grate, die hangabwärts laufen und sich verzweigen, wie von Regen ausgewaschen. Formel von Clay John / Fewes (2D), hier auf die Kugel übertragen.', 'Gullies and ridges that run downhill and branch, as if washed out by rain. Formula by Clay John / Fewes (2D), carried over to the sphere here.'),
        fx: 'Δh = −½D·Σᵢ aᵢ(1 − Σ_c w_c cos 2π(q−c)·(r̂×∇h)),  aᵢ = 2⁻ⁱ' },
      { k: 'terrace', mode: 'plus', min: 0, max: 1, step: 0.01, label: t('Terrassen', 'Terraces'),
        help: t('Gesteinsschichten als Stufen, bewusst und glatt statt als 8-Bit-Treppe wie im Original.', 'Rock strata as steps, deliberate and smooth instead of the original\'s 8-bit staircase.'),
        fx: 'h′ = s + Δ(⌊x⌋ + smoothstep(½−w, ½+w, x−⌊x⌋)),  x = (h−s)/Δ' },
      { k: 'detail', mode: 'plus', min: 0, max: 2.5, step: 0.01, label: t('Feindetail', 'Fine detail'),
        help: t('Weitere Oktaven, live im Pixel gerechnet: beim Heranzoomen wird die Oberfläche immer feiner, ohne Pixelblöcke.', 'More octaves computed live per pixel: zooming in keeps adding detail, without pixel blocks.'),
        fx: 'Σ_{f > N/2π} snoise(f·p)·A/f,  ' + t('ausgeblendet unter 3 px', 'faded below 3 px') },
      { k: 'shadows', mode: 'plus', min: 0, max: 1, step: 0.01, label: t('Geländeschatten', 'Terrain shadows'),
        help: t('Berge werfen Schatten, bei flacher Sonne lang. Der Strahl zur Sonne wird über die Höhenkarte verfolgt.', 'Mountains cast shadows, long at low sun. The ray to the sun is traced over the height map.'),
        fx: t('Schatten, wenn z(q) > z₀ + s·tan ε + s²/2', 'shadow if z(q) > z₀ + s·tan ε + s²/2') },
    ] },
    { id: 'material', title: 'Material', items: [
      { k: 'rough', mode: 'orig', min: 0, max: 1, step: 0.01, label: 'roughness',
        help: t('Wie im Original. Die Rauigkeits-Karte (Land hoch, Wasser niedrig) wird damit multipliziert.', 'As in the original. The roughness map (land high, water low) is multiplied by it.'), fx: 'α = (roughness·map)²,  D_GGX = α²/(π((n·h)²(α²−1)+1)²)' },
      { k: 'metal', mode: 'orig', min: 0, max: 1, step: 0.01, label: 'metalness',
        help: t('Wie im Original: dieselbe Karte dient auch als Metall-Karte. Deshalb glänzt das Land dort metallisch.', 'As in the original: the same map also serves as metalness map. That is why the land has a metallic sheen.'), fx: 'F₀ = mix(0,04; Albedo; metalness·map)' },
      { k: 'gloss', mode: 'plus', min: 0, max: 1, step: 0.01, label: t('Glanz (Land)', 'Gloss (land)'),
        help: t('Glanzlichter auf Fels und Hängen. Wasser glänzt immer nach seiner eigenen Physik.', 'Highlights on rock and slopes. Water always shines by its own physics.'), fx: 'α_Land = α_Material·(1 − 0,55·Glanz)' },
    ] },
    { id: 'light', title: t('Licht', 'Lighting'), items: [
      { k: 'sunAz', min: -180, max: 180, step: 1, label: t('Sonne: Richtung', 'Sun: direction'), fmt: (v) => `${Math.round(v)}°`,
        help: t('Seitliches Licht zeigt das Relief am stärksten. Der Planet dreht sich, die Sonne steht fest.', 'Side light shows the relief best. The planet turns, the sun stays fixed.') },
      { k: 'sunEl', min: -60, max: 60, step: 1, label: t('Sonne: Höhe', 'Sun: height'), fmt: (v) => `${Math.round(v)}°` },
      { k: 'sunI', mode: 'orig', min: 0, max: 4, step: 0.01, label: t('Sonnenlicht', 'Sun light'), help: t('Wie im Original (Lighting).', 'As in the original (Lighting).') },
      { k: 'ambient', mode: 'orig', min: 0, max: 1, step: 0.01, label: t('Umgebungslicht', 'Ambient light'), help: t('Wie im Original (Lighting): hellt auch die Nachtseite auf.', 'As in the original (Lighting): also lights the night side.') },
      { k: 'exposure', mode: 'plus', min: 0.2, max: 3, step: 0.01, label: t('Belichtung', 'Exposure'),
        help: t('Kamera-Belichtung. Danach ACES-Filmkurve, damit Glanzlichter nicht ausfressen.', 'Camera exposure, followed by the ACES film curve so highlights do not clip.'), fx: 'c = ACES(E·L)^(1/2,2)' },
      { k: 'ambientP', mode: 'plus', min: 0, max: 1.5, step: 0.01, label: t('Himmelslicht', 'Skylight'),
        help: t('Streulicht des Himmels auf der Tagseite. Die Nachtseite bleibt dunkel, wie im All.', 'Scattered skylight on the day side. The night side stays dark, as in space.') },
    ] },
    { id: 'clouds', title: t('Wolken', 'Clouds'), items: [
      { k: 'cover', min: 0, max: 1, step: 0.01, label: t('Bedeckung', 'Cover'), fmt: pct,
        help: t('Anteil des Himmels mit Wolken. 0 schaltet die Wolken aus.', 'Share of the sky with clouds. 0 turns clouds off.') },
      { k: 'cloudOpO', mode: 'orig', min: 0, max: 1, step: 0.01, label: t('Deckkraft', 'Opacity') },
      { k: 'cloudOp', mode: 'plus', min: 0, max: 2, step: 0.01, label: t('Dichte', 'Density'),
        help: t('Optische Dicke. Am Planetenrand schaut man schräg durch die Schicht, dort werden Wolken dichter.', 'Optical thickness. At the limb you look through the layer at a slant, so clouds get denser there.'), fx: 'α = 1 − exp(−τ/μᵥ)' },
      { k: 'cloudH', mode: 'plus', min: 0.002, max: 0.04, step: 0.001, label: t('Höhe', 'Height'),
        help: t('Abstand der Wolkenschicht zum Boden in Planetenradien. Echte Höhe: die Schatten fallen versetzt.', 'Distance of the cloud layer above ground in planet radii. Real height: shadows fall offset.') },
      { k: 'wind', mode: 'plus', min: 0, max: 4, step: 0.01, label: t('Wind', 'Wind'),
        help: t('Wolken ziehen in Breitenbändern wie auf der Erde: Passat nach Westen, Westwinde in mittleren Breiten, polare Ostwinde. Sie entstehen und vergehen dabei.', 'Clouds drift in latitude bands as on Earth: trade winds to the west, westerlies at mid latitudes, polar easterlies. They form and dissolve on the way.'),
        fx: 'u(φ) = −0,9·sin 6|φ| + 0,35·e^(−((|φ|−0,75)/0,18)²)' },
      { k: 'cloudShadow', mode: 'plus', min: 0, max: 1, step: 0.01, label: t('Wolkenschatten', 'Cloud shadows') },
    ] },
    { id: 'atmo', title: t('Atmosphäre', 'Atmosphere'), items: [
      { k: 'glow', mode: 'orig', min: 0, max: 3, step: 0.01, label: t('Leuchtsaum', 'Glow'), help: t('Wie im Original: Fresnel-Leuchtsaum um den Planeten.', 'As in the original: Fresnel glow around the planet.'), fx: 'I = (c − n·v)^p' },
      { k: 'atmo', mode: 'plus', min: 0, max: 3, step: 0.01, label: t('Luftdichte', 'Air density'),
        help: t('Rayleigh-Streuung: kurzes Blau streut stärker, deshalb der blaue Rand und die rötliche Tag-Nacht-Grenze.', 'Rayleigh scattering: short blue scatters more, hence the blue limb and the reddish terminator.'),
        fx: 'β_R = (5,8; 13,6; 33,1)·10⁻⁶ m⁻¹,  P_R = 3/(16π)·(1 + cos²θ)' },
      { k: 'thick', mode: 'plus', min: 1, max: 6, step: 0.01, label: t('Schichtdicke', 'Layer thickness'), fmt: (v) => `×${v.toFixed(1)}`,
        help: t('Überhöhung der Lufthülle für die Sichtbarkeit. ×1 ist die echte Erde (8 km Skalenhöhe).', 'Exaggeration of the air layer for visibility. ×1 is the real Earth (8 km scale height).') },
      { k: 'haze', mode: 'plus', min: 0, max: 4, step: 0.01, label: t('Dunst', 'Haze'),
        help: t('Mie-Streuung an Staub und Tröpfchen: heller Schein, wenn die Sonne hinter dem Planeten steht.', 'Mie scattering by dust and droplets: bright halo when the sun is behind the planet.'),
        fx: 'P_M = 3/(8π)·(1−g²)(1+cos²θ)/((2+g²)(1+g²−2g cos θ)^1,5), g = 0,8' },
    ] },
    { id: 'env', title: t('Umgebung', 'Environment'), items: [
      { k: 'nebula', min: 0, max: 3, step: 0.01, label: t('Milchstraße', 'Milky Way'),
        help: t('Hintergrund wie am echten Nachthimmel: helles Band mit Kern, dunkle Staubbahnen, wenige rote Gaswolken, im Band mehr Sterne. Er steht fest und dreht sich nicht mit dem Planeten.', 'Background as in the real night sky: bright band with a core, dark dust lanes, a few red gas clouds, more stars in the band. It stays fixed and does not spin with the planet.') },
      { k: 'mwWidth', min: 0.3, max: 3, step: 0.01, label: t('Bandbreite', 'Band width'), regen: 'sky',
        help: t('Wie breit das Milchstraßenband ist. Wir sehen die Scheibe der Galaxie von innen, als Band über den Himmel.', 'How wide the Milky Way band is. We see the disk of the galaxy from inside, as a band across the sky.'), fx: 'I ∝ exp(−(b/0,16·w)²)' },
      { k: 'mwCore', min: 0, max: 3, step: 0.01, label: t('Kern', 'Core'), regen: 'sky',
        help: t('Helligkeit des Zentrums der Galaxie (Bulge): warm-gelblich, weil dort alte Sterne stehen.', 'Brightness of the galactic centre (bulge): warm yellowish, because old stars live there.') },
      { k: 'mwDust', min: 0, max: 2, step: 0.01, label: t('Staubbahnen', 'Dust lanes'), regen: 'sky',
        help: t('Dunkle Staubwolken in der Mittelebene schlucken das Sternlicht, wie der „Große Riss“ am echten Himmel.', 'Dark dust clouds in the mid-plane swallow starlight, like the Great Rift in the real sky.') },
      { k: 'mwHii', min: 0, max: 3, step: 0.01, label: t('Rote Gaswolken', 'Red gas clouds'), regen: 'sky',
        help: t('Leuchtender Wasserstoff (H-alpha) um junge Sterne, klein und selten, nur im Band.', 'Glowing hydrogen (H-alpha) around young stars, small and rare, only in the band.') },
      { k: 'stars', min: 0, max: 3, step: 0.01, label: t('Sterne', 'Stars') },
      { k: 'flare', min: 0, max: 2, step: 0.01, label: t('Blendenflecke', 'Lens flare') },
      { k: 'bloom', mode: 'plus', min: 0, max: 2, step: 0.01, label: t('Überstrahlung', 'Bloom'),
        help: t('Helles Glitzern und die Sonne strahlen weich über, wie bei einer echten Linse.', 'Bright glints and the sun bleed softly, as in a real lens.') },
    ] },
    { id: 'motion', title: t('Drehung & Kamera', 'Spin & camera'), items: [
      { k: 'rotate', type: 'check', label: t('Drehen', 'Rotate') },
      { k: 'spinZoom', min: 0, max: 3, step: 0.05, label: t('Drehung beim Zoomen bremsen', 'Slow spin when zoomed'), fmt: (v) => v.toFixed(2),
        help: t('Je näher du am Boden bist, desto langsamer dreht sich der Planet. 0 = immer gleich schnell, 1 = proportional zur Höhe, höher = stärker gebremst.', 'The closer you are to the ground, the slower the planet turns. 0 = always the same speed, 1 = proportional to altitude, higher = braked harder.'),
        fx: 'ω = ω₀ · clamp((d − 1)/1.2, 0, 1)^k' },
      { k: 'spin', min: 0, max: 12, step: 0.1, label: t('Drehgeschwindigkeit', 'Spin speed'), fmt: (v) => `${v.toFixed(1)}°/s`,
        help: t('Ruhig und mächtig: 1,5°/s ist eine Umdrehung in 4 Minuten. Nebel und Sterne drehen nicht mit.', 'Calm and majestic: 1.5°/s is one turn in 4 minutes. Nebula and stars do not turn with it.'),
        fx: 'T = 360° / ω' },
      { k: 'tilt', min: 0, max: 90, step: 1, label: t('Achsneigung', 'Axial tilt'), fmt: (v) => `${Math.round(v)}°` },
      { k: 'fov', min: 15, max: 75, step: 1, label: t('Blickwinkel', 'Field of view'), fmt: (v) => `${Math.round(v)}°` },
      { k: 'quality', type: 'select', label: t('Bildauflösung', 'Render resolution'), opts: [[0, t('Automatisch (so scharf wie flüssig geht)', 'Automatic (as sharp as stays smooth)')], [2, t('200 % (Supersampling)', '200 % (supersampling)')], [1.5, '150 %'], [1, '100 %'], [0.75, '75 %'], [0.5, '50 %']],
        help: t('Automatisch senkt die Bildauflösung, wenn die Grafikkarte nicht hinterherkommt, und hebt sie wieder, sobald Luft ist.', 'Automatic lowers the render resolution when the GPU cannot keep up and raises it again when there is headroom.') },
    ] },
    { id: 'debug', title: 'Debug', items: [
      { k: 'view', type: 'select', label: t('Anzeige', 'Display'), opts: [[0, t('Farbe', 'Colour')], [1, t('Höhe', 'Height')], [2, t('Feuchte', 'Moisture')], [3, t('Normalen', 'Normals')], [4, t('Rauigkeit', 'Roughness')], [5, t('Albedo', 'Albedo')]],
        help: t('Die einzelnen Karten wie im Debug-Ordner des Originals. Darunter das Biom-Bild dieses Planeten (x = Feuchte, y = Höhe).', 'The individual maps as in the original\'s Debug folder. Below it, this planet\'s biome image (x = moisture, y = height).') },
    ] },
  ];
}

// Menü: dasselbe Panel wie beim Gasriesen (ⓘ-Erklärung, Blase beim Drüberfahren, Doppelklick = zurücksetzen).
// Regler des anderen Stils stehen ausgegraut in einem eigenen Abschnitt ganz unten.
let panel = null;
const openState = {};
function hintOf(it) { return (it.help || it.label) + (it.fx ? `<code class="fx">${it.fx}</code>` : ''); }
function fmtVal(it, v) { return it.fmt ? it.fmt(v) : Number(v).toFixed(it.step < 0.01 ? 3 : it.step < 1 ? 2 : 0); }
function itemByKey(k) { for (const sec of controls()) for (const it of sec.items) if (it.k === k) return it; return { k }; }
function addItem(P, it) {
  if (it.type === 'select') P.select(it.k, it.label, it.opts.map(([v, x]) => [String(v), x]), hintOf(it));
  else if (it.type === 'check') P.toggle(it.k, it.label, hintOf(it));
  else {
    if (it.regen) Panel.heavy.add(it.k);   // teure Regler: erst beim Loslassen neu rechnen
    P.range(it.k, it.label, it.min, it.max, it.step, hintOf(it), (v) => fmtVal(it, v));
  }
}
function buildUI() {
  const root = $('panel-body');
  for (const d of root.querySelectorAll('details')) if (d.dataset.id) openState[d.dataset.id] = d.open;
  root.innerHTML = '';
  DEF.sea = PP.water;
  panel = new Panel(root, S, (k) => { if (k === 'style') { setStyle(S.style, true); return; } changed(itemByKey(k)); }, DEF);
  const secs = controls();
  const inactive = [];
  // Kopf: Stil und Seed
  panel.section(t('Stil & Seed', 'Style & seed'), undefined, true);
  panel.select('style', t('Stil', 'Style'), [['plus', t('+20 % besser', '+20 % better')], ['orig', 'Original 1:1 (colordodge)']],
    t('Original 1:1: genau wie das three.js-Vorbild von colordodge. +20 % besser: dieselbe Grundform mit echter Physik für Licht, Wasser, Luft und Gelände.',
      'Original 1:1: exactly like colordodge\'s three.js model. +20 % better: the same base shape with real physics for light, water, air and terrain.'));
  const sr = document.createElement('div');
  sr.className = 'seedrow';
  sr.innerHTML = `<label for="seed">seed</label><input id="seed" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"><button id="rnd" type="button">${t('Zufall', 'Randomize')}</button>`;
  panel.custom(sr);
  sr.querySelector('#seed').value = S.seed;
  sr.querySelector('#seed').addEventListener('change', (e) => newSeed(e.target.value));
  sr.querySelector('#rnd').addEventListener('click', () => newSeed(randomSeed()));
  for (const sec of secs) {
    const act = sec.items.filter((it) => !it.mode || it.mode === S.style);
    for (const it of sec.items) if (it.mode && it.mode !== S.style) inactive.push(it);
    if (!act.length) continue;
    panel.section(sec.title, undefined, sec.id in openState ? openState[sec.id] : !!sec.open);
    root.lastElementChild.dataset.id = sec.id;
    for (const it of act) addItem(panel, it);
    if (sec.id === 'debug') panel.custom(lutCanvas);
  }
  if (inactive.length) {
    panel.section(S.style === 'orig' ? t('Nur in „+20 % besser“', 'Only in “+20 % better”') : t('Nur in „Original 1:1“', 'Only in “Original 1:1”'),
      t('Diese Regler wirken im gewählten Stil nicht.', 'These controls have no effect in the chosen style.'), !!openState.inactive);
    root.lastElementChild.dataset.id = 'inactive';
    root.lastElementChild.classList.add('inactive');
    for (const it of inactive) { addItem(panel, it); panel.disable(it.k, true); }
  }
  initShell('rocky');
  $('t-title').textContent = t('Gesteinsplanet', 'Rocky planet');
  $('version').textContent = __VERSION__;
  $('panel-title').textContent = t('Regler', 'Controls');
  $('t-hint').textContent = coarse ? t('wischen: drehen · zwei Finger: zoomen', 'swipe: turn · pinch: zoom') : t('ziehen: drehen · Rad: zoomen', 'drag: turn · wheel: zoom');
  $('mode-tag').textContent = S.style === 'orig' ? 'Original 1:1 (colordodge)' : t('+20 % besser', '+20 % better');
  $('credits').innerHTML = t(
    'Echtzeit-WebGPU, keine Bilddateien. Grundform nach <a href="https://github.com/colordodge/ProceduralPlanet" target="_blank" rel="noopener">colordodge/ProceduralPlanet</a> (WTFPL). Idee: elias-nero-tron. <a href="https://github.com/elias-nero-tron/Fluid-Gas-Planet" target="_blank" rel="noopener">Quellcode</a>',
    'Real-time WebGPU, no image files. Base shape after <a href="https://github.com/colordodge/ProceduralPlanet" target="_blank" rel="noopener">colordodge/ProceduralPlanet</a> (WTFPL). Idea: elias-nero-tron. <a href="https://github.com/elias-nero-tron/Fluid-Gas-Planet" target="_blank" rel="noopener">Source code</a>');
  document.documentElement.lang = lang;
}

// Biom-Bild (wie im Original als 2D-Canvas gemalt), auch im Debug-Ordner sichtbar
const lutCanvas = document.createElement('canvas');
lutCanvas.id = 'lut';
lutCanvas.width = 512; lutCanvas.height = 512;
lutCanvas.setAttribute('aria-label', 'Biome image');

// ------------------------------------------------------------------ WebGPU
const canvas = $('view');
function fail(msg) { const el = $('status'); el.hidden = false; el.textContent = msg; throw new Error(msg); }

// ---------------------------------------------------------------- WGSL: Grundlagen
const COMMON = /* wgsl */`
const PI = 3.14159265359;
const QPI = 0.785398163397;
// Würfelseiten: Richtung = em + st.x·ex + st.y·ey, st = tan((2uv − 1)·π/4) (winkeltreu)
struct Basis { ex: vec3f, ey: vec3f, em: vec3f }
fn faceBasis(f: i32) -> Basis {
  switch f {
    case 0: { return Basis(vec3f(0.0, 0.0, -1.0), vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0)); }
    case 1: { return Basis(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), vec3f(-1.0, 0.0, 0.0)); }
    case 2: { return Basis(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, -1.0), vec3f(0.0, 1.0, 0.0)); }
    case 3: { return Basis(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(0.0, -1.0, 0.0)); }
    case 4: { return Basis(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0)); }
    default: { return Basis(vec3f(-1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, -1.0)); }
  }
}
fn majorFace(d: vec3f) -> i32 {
  let a = abs(d);
  if (a.x >= a.y && a.x >= a.z) { return select(1, 0, d.x > 0.0); }
  if (a.y >= a.z) { return select(3, 2, d.y > 0.0); }
  return select(5, 4, d.z > 0.0);
}
fn faceDir(f: i32, uv: vec2f) -> vec3f {
  let B = faceBasis(f);
  let st = tan((uv * 2.0 - 1.0) * QPI);
  return normalize(B.em + st.x * B.ex + st.y * B.ey);
}
// Richtung -> Seite, uv, uv-Ableitungen im Bild (für saubere Mipmaps ohne Nahtlinien) und Jacobi-Zeilen
struct Face { f: i32, uv: vec2f, gx: vec2f, gy: vec2f, jx: vec3f, jy: vec3f }
fn toFace(d: vec3f, ddx: vec3f, ddy: vec3f) -> Face {
  var r: Face;
  r.f = majorFace(d);
  let B = faceBasis(r.f);
  let m = dot(d, B.em);
  let st = vec2f(dot(d, B.ex), dot(d, B.ey)) / m;
  let k = 0.5 / (QPI * (1.0 + st * st));
  r.uv = atan(st) / QPI * 0.5 + 0.5;
  r.jx = (B.ex - st.x * B.em) * (k.x / m);
  r.jy = (B.ey - st.y * B.em) * (k.y / m);
  r.gx = vec2f(dot(r.jx, ddx), dot(r.jy, ddx));
  r.gy = vec2f(dot(r.jx, ddy), dot(r.jy, ddy));
  return r;
}
// Texel-Mitten liegen exakt auf den Würfelkanten (keine Nähte)
fn faceUv(F: Face, n: f32) -> vec2f { return F.uv * ((n - 1.0) / n) + 0.5 / n; }
fn hash33(q: vec3f) -> vec3f { var p3 = fract(q * vec3f(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
fn hash13(q: vec3f) -> f32 { var p3 = fract(q * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn sq(x: f32) -> f32 { return x * x; }
`;

// Abtasten der Würfelkarten (nur in Shadern mit Sampler)
const TEXH = /* wgsl */`
fn texFace(tx: texture_2d_array<f32>, F: Face, n: f32) -> vec4f { let s = (n - 1.0) / n; return textureSampleGrad(tx, samp, faceUv(F, n), F.f, F.gx * s, F.gy * s); }
fn texFaceLod(tx: texture_2d_array<f32>, F: Face, n: f32, lod: f32) -> vec4f { return textureSampleLevel(tx, samp, faceUv(F, n), F.f, lod); }
fn texDirLod(tx: texture_2d_array<f32>, d: vec3f, n: f32, lod: f32) -> vec4f {
  let F = toFace(d, vec3f(0.0), vec3f(0.0));
  return textureSampleLevel(tx, samp, faceUv(F, n), F.f, lod);
}
`;

const NOISE = /* wgsl */`
fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289v4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute(x: vec4f) -> vec4f { return mod289v4(((x * 34.0) + 10.0) * x); }
fn taylorInvSqrt(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }
// 3D-Simplexrauschen mit exaktem Gradienten (Ashima Arts / Stefan Gustavson, MIT-Lizenz). Rückgabe: (Wert, Gradient)
fn snoiseG(v: vec3f) -> vec4f {
  let C = vec2f(1.0 / 6.0, 1.0 / 3.0);
  let D = vec4f(0.0, 0.5, 1.0, 2.0);
  var i = floor(v + dot(v, C.yyy));
  let x0 = v - i + dot(i, C.xxx);
  let g = step(x0.yzx, x0.xyz);
  let l = 1.0 - g;
  let i1 = min(g.xyz, l.zxy);
  let i2 = max(g.xyz, l.zxy);
  let x1 = x0 - i1 + C.xxx;
  let x2 = x0 - i2 + C.yyy;
  let x3 = x0 - D.yyy;
  i = mod289v3(i);
  let p = permute(permute(permute(i.z + vec4f(0.0, i1.z, i2.z, 1.0)) + i.y + vec4f(0.0, i1.y, i2.y, 1.0)) + i.x + vec4f(0.0, i1.x, i2.x, 1.0));
  let n_ = 0.142857142857;
  let ns = n_ * D.wyz - D.xzx;
  let j = p - 49.0 * floor(p * ns.z * ns.z);
  let x_ = floor(j * ns.z);
  let y_ = floor(j - 7.0 * x_);
  let x = x_ * ns.x + ns.yyyy;
  let y = y_ * ns.x + ns.yyyy;
  let h = 1.0 - abs(x) - abs(y);
  let b0 = vec4f(x.xy, y.xy);
  let b1 = vec4f(x.zw, y.zw);
  let s0 = floor(b0) * 2.0 + 1.0;
  let s1 = floor(b1) * 2.0 + 1.0;
  let sh = -step(h, vec4f(0.0));
  let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  let a1 = b1.xzyw + s1.xzyw * sh.zzww;
  var p0 = vec3f(a0.xy, h.x);
  var p1 = vec3f(a0.zw, h.y);
  var p2 = vec3f(a1.xy, h.z);
  var p3 = vec3f(a1.zw, h.w);
  let norm = taylorInvSqrt(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  let m = max(0.5 - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4f(0.0));
  let m2 = m * m;
  let m4 = m2 * m2;
  let pdotx = vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  let tmp = m2 * m * pdotx;
  var grad = -8.0 * (tmp.x * x0 + tmp.y * x1 + tmp.z * x2 + tmp.w * x3);
  grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  grad *= 105.0;
  return vec4f(105.0 * dot(m4, pdotx), grad);
}
fn snoise(v: vec3f) -> f32 { return snoiseG(v).x; }
// Erosionsrinnen ("Gavoronoise" nach Clay John / Fewes, 3D): Streifen quer zu dir = r̂ × ∇h laufen hangabwärts.
// Acht Zellecken mit glatter Teilung der Eins als Gewichten: stetig, und nur 8 statt 27 Zellen.
fn gullies8(q: vec3f, dir: vec3f) -> vec4f {
  let ip = floor(q);
  let fp = q - ip;
  let u = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
  var acc = vec4f(0.0);
  for (var k = 0; k < 8; k++) {
    let o = vec3f(f32(k & 1), f32((k >> 1u) & 1), f32((k >> 2u) & 1));
    let c = ip + o;
    let pp = q - c - (hash33(c) - 0.5) * 0.7;
    let wv = mix(1.0 - u, u, o);
    let w = wv.x * wv.y * wv.z;
    let ph = dot(pp, dir) * 6.2831853;
    acc += vec4f(cos(ph), -sin(ph) * 6.2831853 * dir) * w;
  }
  return acc;
}
fn fbmS(p0: vec3f, oct: i32) -> f32 {
  var n = 0.0;
  var a = 0.5;
  var p = p0;
  for (var i = 0; i < 12; i++) { if (i >= oct) { break; } n += a * snoise(p); p = p * 2.02 + vec3f(1.7, 9.2, 3.1); a *= 0.5; }
  return n;
}
`;

// Parameter für Erzeugungs-Jobs: 8 × vec4, Kachel in g (Ende) und h (Anfang, Seite, N)
const JDECL = /* wgsl */`
struct Jb { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f, f: vec4f, g: vec4f, h: vec4f }
@group(0) @binding(0) var<uniform> J: Jb;
`;

// ---------------------------------------------------------------- Karten: Höhe, Feuchte, Gradient (Compute)
// a = Höhe (res1, res2, resMix, mixScale), b = (Typ H, Seed H, Typ F, Seed F), c = Feuchte, d = Erosion,
// e = Gebirge (Höhe, Gürtelfrequenz, Grat-Startfrequenz, fBm-Rest), f = (Modus, Erosions-Oktaven, Meeresspiegel, -)
const GEN = JDECL + /* wgsl */`
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
fn octOff(seed: f32, i: i32) -> vec3f { return (hash33(vec3f(seed * 0.1373, f32(i) * 1.7311 + 3.1, seed * 0.0719 + 11.0)) - 0.5) * 120.0; }
// Original: immer 16 Oktaven. Verbessert: nur bis zur Nyquist-Grenze der Karte, der Rest kommt live im Pixel.
fn octFor(frq: f32) -> i32 {
  if (J.f.x < 0.5) { return 16; }
  return clamp(i32(floor(log2(J.h.w * frq / 6.2832))) + 1, 2, 16);
}
// baseNoise / ridgedNoise des Originals: Σ simplex(p·2ⁱ/frq)·½/2ⁱ, danach Kontrast ×2 bzw. hoch 4. Rückgabe: (Wert, Gradient)
fn fbm(p: vec3f, frq: f32, seed: f32, ridged: bool, oct: i32) -> vec4f {
  var n = 0.0;
  var gain = 1.0;
  var g = vec3f(0.0);
  for (var i = 0; i < 16; i++) {
    if (i >= oct) { break; }
    let q = p * (gain / frq) + octOff(seed, i);
    let sn = snoiseG(q);
    var s = sn.x * 0.5 + 0.5;
    var gi = sn.yzw * 0.5;
    if (ridged) { s = 1.0 - abs(sn.x); gi = sn.yzw * select(-1.0, 1.0, sn.x < 0.0); }
    n += s * 0.5 / gain;
    g += gi * (0.5 / frq);
    gain *= 2.0;
  }
  if (ridged) { let n3 = n * n * n; g *= 4.0 * n3; n *= n3; }
  else { n = (n - 0.5) * 2.0 + 0.5; g *= 2.0; }
  return vec4f(n, g);
}
fn composite(p: vec3f, prm: vec4f, px: vec2f, cap: i32) -> vec4f {
  let ty = px.x;
  let seed = px.y;
  let r1 = ty > 1.5;
  let r2 = (ty > 0.5 && ty < 1.5) || ty > 2.5;
  let A = fbm(p, prm.x, seed + 11.437, r1, min(octFor(prm.x), cap));
  let B = fbm(p, prm.y, seed + 93.483, r2, min(octFor(prm.y), cap));
  let C = fbm(p, prm.z, seed + 23.675, false, min(octFor(prm.z), min(cap, 6)));
  let k = 1.0 + 3.0 * prm.w;
  let tm = (C.x - 0.5) * k + 0.5;
  let tt = clamp(tm, 0.0, 1.0);
  let gt = select(vec3f(0.0), C.yzw * k, tm > 0.0 && tm < 1.0);
  return vec4f(mix(A.x, B.x, tt), mix(A.yzw, B.yzw, tt) + (B.x - A.x) * gt);
}
fn octRot(o: i32) -> mat3x3f {
  let a = f32(o) * 2.39996 + 0.7;
  let b = f32(o) * 1.1 + 0.3;
  let ca = cos(a); let sa = sin(a); let cb = cos(b); let sb = sin(b);
  return mat3x3f(ca, sa, 0.0, -sa, ca, 0.0, 0.0, 0.0, 1.0) * mat3x3f(1.0, 0.0, 0.0, 0.0, cb, sb, 0.0, -sb, cb);
}
// Grat-Multifraktal nach Musgrave (1994): scharfe Kämme, glatte Täler; jede Oktave gewichtet mit der vorigen
fn ridgedMF(p: vec3f, f0: f32, seed: f32) -> vec4f {
  var r = 0.0; var w = 1.0; var f = f0; var a = 1.0; var norm = 0.0;
  var g = vec3f(0.0);
  for (var i = 0; i < 10; i++) {
    if (f * 6.2832 > J.h.w) { break; }
    let sn = snoiseG(p * f + octOff(seed, i));
    let s = 1.0 - abs(sn.x);
    let gs = select(-1.0, 1.0, sn.x < 0.0) * sn.yzw * f;
    let s2 = s * s;
    r += s2 * w * a;
    g += 2.0 * s * gs * w * a;
    norm += a;
    w = clamp(s2 * 1.7, 0.0, 1.0);
    f *= 2.03;
    a *= 0.5;
  }
  return vec4f(r, g) / max(norm, 1e-3);
}
// Schichtvulkane: Kegel mit Gipfelkrater, je Zelle eines 3D-Gitters höchstens einer (Worley-artige Verteilung)
fn volcanoes(d: vec3f, dens: f32, seed: f32) -> vec4f {
  let p = d * 7.0;
  let ip = floor(p);
  var o = vec4f(0.0);
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let c = ip + vec3f(f32(x), f32(y), f32(z));
    let hq = hash33(c * 1.31 + vec3f(1.7, seed * 0.0071, 9.2));
    if (hq.x > dens * 0.35) { continue; }
    let hp = hash33(c + vec3f(seed * 0.0131, 7.1, 3.3));
    let cc = normalize(c + 0.15 + 0.7 * hp);
    let R = 0.035 + 0.05 * hq.y;
    let H = 0.035 + 0.05 * hq.z;
    let dv = d - cc;
    let r = length(dv);
    if (r >= R) { continue; }
    let t = r / R;
    var v = pow(1.0 - t, 1.8);
    var dv_dt = -1.8 * pow(1.0 - t, 0.8);
    let tc = 0.16 + 0.08 * hq.y;
    if (t < tc) { let s = t / tc; v -= 0.55 * (1.0 - s * s); dv_dt += 1.1 * s / tc; }
    o += vec4f(H * v, (H * dv_dt / R) * dv / max(r, 1e-5));
  } } }
  return o;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let px = vec2f(gid.xy) + J.h.xy;
  if (px.x >= J.g.x || px.y >= J.g.y) { return; }
  let N = J.h.w;
  let face = i32(J.h.z);
  let uv = px / (N - 1.0);
  let B = faceBasis(face);
  let st = tan((uv * 2.0 - 1.0) * QPI);
  let P = B.em + st.x * B.ex + st.y * B.ey;
  let il = inverseSqrt(dot(P, P));
  let d = P * il;
  let sea = J.f.z;
  let mode = J.f.x;
  let HC = composite(d, J.a, J.b.xy, 16);
  let MC = composite(d, J.c, J.b.zw, 16);
  var h = HC.x;
  var gh = HC.yzw;
  let m = MC.x;
  gh -= d * dot(gh, d);
  var gDir = gh;
  var belt = 0.0;
  let Mt = J.e;
  if (mode > 0.5) {
    // Kontinente wie im Original (untere Oktaven), Feinrauschen gedämpft, dafür Gebirgsgürtel + Erosion
    let LC = composite(d, J.a, J.b.xy, 4);
    let hL = LC.x;
    let gL = LC.yzw - d * dot(LC.yzw, d);
    let nbG = snoiseG(d * Mt.y + vec3f(J.b.y * 0.37, 5.1, 2.3));
    let nb = nbG.x;
    let gb = nbG.yzw * Mt.y;
    let bl = 1.0 - abs(nb);
    let tb = clamp((bl - 0.55) / 0.4, 0.0, 1.0);
    belt = tb * tb * (3.0 - 2.0 * tb);
    var gBelt = select(-1.0, 1.0, nb < 0.0) * gb * (6.0 * tb * (1.0 - tb) / 0.4);
    gBelt -= d * dot(gBelt, d);
    let RM = ridgedMF(d, Mt.z, J.b.y + 51.0);
    let rm = RM.x;
    let gr = RM.yzw - d * dot(RM.yzw, d);
    let landW = smoothstep(sea - 0.1, sea + 0.06, hL);
    let keep = mix(Mt.w, 0.9, belt);
    h = hL + (h - hL) * keep + landW * Mt.x * belt * (0.3 + 0.7 * rm);
    gh = gL + (gh - gL) * keep + landW * Mt.x * (gBelt * (0.3 + 0.7 * rm) + belt * 0.7 * gr);
    gDir = gL + landW * Mt.x * gBelt * 0.6;
  }
  let Ero = J.d;
  if (mode > 0.5 && Ero.x > 0.0) {
    // Streifen pro Zelle wachsen mit dem Gefälle, aber gesättigt (sonst werden aus Rinnen Riffel)
    let cr = cross(d, gDir);
    let sl = length(cr);
    var dir0 = vec3f(0.0);
    if (sl > 1e-5) { dir0 = cr / sl * (1.4 * tanh(sl * Ero.z * 0.25)); }
    var a = smoothstep(sea - 0.06, sea + 0.12, h) * (0.6 + 0.8 * belt);
    var f = 1.0;
    var sumA = 0.0;
    var acc = vec4f(0.0);
    for (var o = 0; o < 8; o++) {
      if (f32(o) >= J.f.y) { break; }
      let dir = dir0 + cross(d, acc.yzw) * (Ero.w / (6.2831853 * Ero.y));
      let R = octRot(o);
      let e = gullies8(R * (d * (Ero.y * f)) + f32(o) * 19.19, R * dir);
      acc += vec4f(e.x, transpose(R) * e.yzw * (Ero.y * f)) * a;
      sumA += a;
      a *= 0.5;
      f *= 2.0;
    }
    let depth = Ero.x * 0.03;
    h += (acc.x - sumA) * 0.5 * depth;
    let ge = acc.yzw * 0.5 * depth;
    gh += ge - d * dot(ge, d);
  }
  if (mode > 0.5 && J.f.w > 0.0) {
    let Vc = volcanoes(d, J.f.w, J.b.y);
    let lw = smoothstep(sea - 0.02, sea + 0.05, h);
    h += Vc.x * lw;
    gh += (Vc.yzw - d * dot(Vc.yzw, d)) * lw;
  }
  // Gradient in Seitenkoordinaten (∂h/∂u, ∂h/∂v) speichern
  let dPu = (B.ex - d * dot(d, B.ex)) * il * (2.0 * QPI * (1.0 + st.x * st.x));
  let dPv = (B.ey - d * dot(d, B.ey)) * il * (2.0 * QPI * (1.0 + st.y * st.y));
  textureStore(dst, vec2u(px), face, vec4f(h, m, dot(gh, dPu), dot(gh, dPv)));
}
`;

// ---------------------------------------------------------------- Wolkenkarten (Compute), a.x = Seed
const CLOUDGEN = JDECL + /* wgsl */`
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba8unorm, write>;
// Original-Stil: sin(5·n) über viele Oktaven gibt die zelligen Schlieren
fn hisCloud(p: vec3f, seed: f32) -> f32 {
  var n = 0.0;
  var gain = 1.0;
  for (var i = 0; i < 10; i++) {
    let s = sin(snoise(p * gain * 1.3 + seed + f32(i) * 10.0) * 5.0) * 0.5 + 0.5;
    n += s * 0.5 / gain;
    gain *= 2.0;
  }
  return clamp((n - 0.5) * 2.0 + 0.5, 0.0, 1.0);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let px = vec2f(gid.xy) + J.h.xy;
  if (px.x >= J.g.x || px.y >= J.g.y) { return; }
  let seed = J.a.x;
  let face = i32(J.h.z);
  let d = faceDir(face, px / (J.h.w - 1.0));
  let p = d * vec3f(2.3, 3.8, 2.3) + seed;      // nord-süd gestaucht: Wolkenbänder ziehen sich ost-westlich
  let w = vec3f(fbmS(p + 1.3, 4), fbmS(p + 7.1, 4), fbmS(p + 3.7, 4));
  // Fronten: lange, gebogene Wolkenbänder entlang der Kammlinien eines tieffrequenten Rauschens
  let fa = pow(max(1.0 - abs(snoise(d * vec3f(1.1, 1.8, 1.1) + w * 0.7 + seed + 13.0)), 0.0), 5.0);
  let fb = pow(max(1.0 - abs(snoise(d * vec3f(1.1, 1.8, 1.1) + w.yzx * 0.7 + seed + 41.0)), 0.0), 5.0);
  // Großwetterlage: weite klare Hochdruckgebiete neben großen Wolkenfeldern
  let wa = fbmS(d * vec3f(1.3, 2.0, 1.3) + w * 0.5 + seed + 7.0, 4);
  let wb = fbmS(d * vec3f(1.3, 2.0, 1.3) + w.zxy * 0.5 + seed + 29.0, 4);
  let A = fbmS(p + w * 1.2, 8) * 0.75 + wa * 0.7 + fa * 0.2 - 0.07;
  let B = fbmS(p * 1.07 + w.zxy * 1.2 + 21.0, 8) * 0.75 + wb * 0.7 + fb * 0.2 - 0.07;
  let H = hisCloud(d, seed);
  let Dt = fbmS(d * vec3f(17.0, 26.0, 17.0) + w * 2.0 + seed * 1.3, 6) * 0.9 + 0.5;
  textureStore(dst, vec2u(px), face, clamp(vec4f(A * 0.8 + 0.5, B * 0.8 + 0.5, H, Dt), vec4f(0.0), vec4f(1.0)));
}
`;

// ---------------------------------------------------------------- Milchstraße (Würfelkarte, steht fest im Raum)
// Aufbau wie am echten Nachthimmel: helles Band (Scheibe der Galaxie) mit Kern (Bulge), dunkle Staubbahnen
// genau in der Mitte des Bandes, vereinzelte rote Gaswolken (H-alpha) im Band. Alpha = Sterndichte.
// a = (Seed, Helligkeit, -, -), b = Pol der Galaxie, c = Richtung zum Kern, d = Farbton-Verschiebung

// ---------------------------------------------------------------- Atmosphäre: Durchlässigkeits-Tabelle (Compute)
// a = (R, R_oben, H_Rayleigh, H_Mie), b = (β_R, β_M,ext), c = β_Ozon, d = (Ozon-Höhe, -Breite)
const TRANS = JDECL + /* wgsl */`
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
// Durchlässigkeit bis zum oberen Rand, Tabelle über (Höhe, Richtung) nach Bruneton (2017)
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= 256u || gid.y >= 64u) { return; }
  let x = vec2f(gid.xy) / vec2f(255.0, 63.0);
  let R = J.a.x;
  let Rt = J.a.y;
  let H = sqrt(Rt * Rt - R * R);
  let rho = H * x.y;
  let r = sqrt(rho * rho + R * R);
  let dmin = Rt - r;
  let dmax = rho + H;
  let dd = dmin + x.x * (dmax - dmin);
  var mu = 1.0;
  if (dd > 0.0) { mu = clamp((H * H - rho * rho - dd * dd) / (2.0 * r * dd), -1.0, 1.0); }
  var od = vec3f(0.0);
  let dx = dd / 64.0;
  for (var i = 0; i <= 64; i++) {
    let s = f32(i) * dx;
    let ri = sqrt(s * s + 2.0 * r * mu * s + r * r);
    let hh = max(ri - R, 0.0);
    let w = select(1.0, 0.5, i == 0 || i == 64);
    od += w * dx * (J.b.xyz * exp(-hh / J.a.z) + vec3f(J.b.w) * exp(-hh / J.a.w) + J.c.xyz * max(0.0, 1.0 - abs(hh - J.d.x) / J.d.y));
  }
  textureStore(dst, vec2u(gid.xy), vec4f(exp(-od), 1.0));
}
`;

// ---------------------------------------------------------------- Mipmaps (WebGPU hat kein generateMipmap): 2×2-Mittel
const MIP = (fmt) => /* wgsl */`
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<${fmt}, write>;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let n = textureDimensions(dst);
  if (g.x >= n.x || g.y >= n.y) { return; }
  let p = vec2i(g.xy) * 2;
  let l = i32(g.z);
  let c = textureLoad(src, p, l, 0) + textureLoad(src, p + vec2i(1, 0), l, 0) + textureLoad(src, p + vec2i(0, 1), l, 0) + textureLoad(src, p + vec2i(1, 1), l, 0);
  textureStore(dst, vec2i(g.xy), l, c * 0.25);
}
`;

// ---------------------------------------------------------------- Bild: gemeinsame Uniforms und Karten
const UDECL = /* wgsl */`
struct Uf {
  vp: mat4x4f, ivp: mat4x4f,
  m0: vec4f, m1: vec4f, m2: vec4f,       // Planetendrehung (Spalten)
  cam: vec4f,    // Kamera, Zeit
  sun: vec4f,    // Sonnenrichtung, Sonnenstärke
  At: vec4f,     // R, R_oben, H_Rayleigh, H_Mie
  BR: vec4f,     // β_Rayleigh, β_Mie
  BO: vec4f,     // β_Ozon, β_Mie,ext
  Oz: vec4f,     // Ozon-Höhe, -Breite, Mie-g, Schritte
  O: vec4f,      // Original: normalScale, roughness, metalness, ambient
  W: vec4f,      // Wasser: Wellen, Klarheit, Brandung, -
  L: vec4f,      // Land: Relief-Schärfe, Glanz, Feindetail, Terrassen
  L2: vec4f,     // Geländeschatten, Himmelslicht, -, -
  Mq: vec4f,     // Feuchte-Normierung (2), Sonnenlicht (Original), Sonnenradius
  EroRt: vec4f,  // Erosion zur Laufzeit: Stärke, Startfrequenz
  Cl: vec4f,     // Bedeckung, Phase (Zeit/Periode), Wind, Schattenstärke
  Cl2: vec4f,    // Höhe, starre Drehung (Original), Dichte/Deckkraft, Modus
  T: vec4f,      // N Gelände, N Wolken, Meeresspiegel, Sonnenstärke Hintergrund
  Md: vec4f,     // Modus, Palette, Anzeige, Nebel fertig
  Bg: vec4f,     // Nebel, Sterne, N Nebel, -
  Glow: vec4f,
  Fin: vec4f,    // Belichtung, Überstrahlung, Filmkurve, -
  Fl: vec4f,     // Sonne auf dem Bild (uv), Stärke, Seitenverhältnis
  cyc: array<vec4f, 6>,   // Wirbel: Mittelpunkt, Drehwinkel im Zentrum (Vorzeichen = Drehsinn)
  cycB: array<vec4f, 6>,  // Radius, Lebensphase 0..1, Auge (tropischer Wirbelsturm), -
}
@group(0) @binding(0) var<uniform> U: Uf;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tHm: texture_2d_array<f32>;
@group(0) @binding(3) var tBiome: texture_2d<f32>;
@group(0) @binding(4) var tCloud: texture_2d_array<f32>;
@group(0) @binding(5) var tNeb: texture_2d_array<f32>;
@group(0) @binding(6) var tTrans: texture_2d<f32>;
@group(0) @binding(7) var tRiver: texture_2d_array<f32>;
fn modelM() -> mat3x3f { return mat3x3f(U.m0.xyz, U.m1.xyz, U.m2.xyz); }
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
// Bildschirmfüllendes Dreieck; uv wie in GL (y nach oben), Texturen werden mit (u, 1 − v) gelesen
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> VO {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VO;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = p;
  return o;
}
`;

const ATMO = /* wgsl */`
fn transmittance(r0: f32, mu: f32) -> vec3f {
  let R = U.At.x;
  let Rt = U.At.y;
  let r = clamp(r0, R, Rt);
  let H = sqrt(Rt * Rt - R * R);
  let rho = sqrt(max(r * r - R * R, 0.0));
  let disc = r * r * (mu * mu - 1.0) + Rt * Rt;
  let d = max(-r * mu + sqrt(max(disc, 0.0)), 0.0);
  let dmin = Rt - r;
  let dmax = rho + H;
  var uv = vec2f((d - dmin) / max(dmax - dmin, 1e-6), rho / H);
  uv = vec2f(0.5 / 256.0, 0.5 / 64.0) + uv * vec2f(255.0 / 256.0, 63.0 / 64.0);
  return textureSampleLevel(tTrans, samp, uv, 0.0).rgb;
}
// Sonnenlicht an einem Punkt: Luftweg + Planetenschatten mit weichem Rand (Sonnenscheibe)
fn sunTrans(r: f32, mu: f32) -> vec3f {
  let muH = -sqrt(max(1.0 - (U.At.x * U.At.x) / (r * r), 0.0));
  return transmittance(r, mu) * smoothstep(muH - 0.006, muH + 0.006, mu);
}
`;

// ---------------------------------------------------------------- Wolkendichte (Schale + Schatten)
const CLOUDF = /* wgsl */`
// Zonalwind als Winkelgeschwindigkeit: Passat (Ost), Westwinde, polare Ostwinde
fn windOmega(lat: f32) -> f32 {
  let a = abs(lat);
  let u = -0.9 * sin(6.0 * a) + 0.35 * exp(-sq((a - 0.75) / 0.18));
  return u / max(cos(lat), 0.3);
}
// Klimabänder: feuchte ITCZ, trockene Rossbreiten, Sturmbahnen um 55–60°
fn climate(lat: f32) -> f32 {
  let a = abs(lat) * 57.2958;
  return 0.5 * exp(-sq(a / 9.0)) - 0.45 * exp(-sq((a - 24.0) / 9.0)) + 0.35 * exp(-sq((a - 58.0) / 12.0)) - 0.2 * smoothstep(75.0, 90.0, a);
}
fn cloudDensity(d: vec3f, lod: f32) -> f32 {
  let Cl = U.Cl;
  let Cl2 = U.Cl2;
  let Nc = U.T.y;
  if (Cl.x <= 0.0) { return 0.0; }
  if (Cl2.w < 0.5) {
    let c = texDirLod(tCloud, rotY(d, Cl2.y), Nc, lod).b;
    return smoothstep(1.0 - Cl.x, 1.0 - Cl.x + 0.45, c);
  }
  let lat = asin(clamp(d.y, -1.0, 1.0));
  // Wirbel: Tiefdruckgebiete drehen die Wolkenbänder zu Spiralen (innen stärker als außen)
  var q = d;
  var boost = 0.0;
  for (var i = 0; i < 6; i++) {
    let cy = U.cyc[i];
    if (cy.w == 0.0) { continue; }
    let ca = dot(q, cy.xyz);
    if (ca < 0.8) { continue; }
    let ang = acos(min(ca, 1.0));
    let r = U.cycB[i].x;
    let fall = exp(-(ang * ang) / (r * r));
    let a = cy.w * fall;
    q = q * cos(a) + cross(cy.xyz, q) * sin(a) + cy.xyz * dot(cy.xyz, q) * (1.0 - cos(a));
    let env = sin(3.14159 * U.cycB[i].y);
    boost += env * (0.16 * exp(-(ang * ang) / (2.2 * r * r)) - U.cycB[i].z * 0.9 * exp(-(ang * ang) / (0.012 * r * r)));
  }
  let w = windOmega(lat) * Cl.z;
  let ph = fract(Cl.y);
  let ph2 = fract(Cl.y + 0.5);
  let A = texDirLod(tCloud, rotY(q, -w * ph), Nc, lod);
  let B = texDirLod(tCloud, rotY(q, -w * ph2), Nc, lod);
  let wa = 1.0 - abs(2.0 * ph - 1.0);
  let wb = 1.0 - wa;
  // zwei Phasen überblenden, Varianz erhalten: Wolken entstehen und vergehen, statt zu pulsieren
  var c = ((A.r - 0.5) * wa + (B.g - 0.5) * wb) * inverseSqrt(wa * wa + wb * wb) + 0.5;
  var det = A.a * wa + B.a * wb;
  // feine Quellwolken-Struktur beim Heranzoomen (live, damit Wolken nicht verschmieren)
  let pixC = exp2(lod) * 1.5708 / Nc;
  var fq = 90.0;
  for (var i = 0; i < 3; i++) {
    let fade = smoothstep(2.5, 6.0, 1.0 / (fq * pixC));
    if (fade <= 0.0) { break; }
    det += snoise(q * fq + f32(i) * 3.3) * 0.22 * fade * (0.6 - 0.15 * f32(i));
    fq *= 2.3;
  }
  // Gebirge fangen Wolken (Stau), trockene Landflächen haben weniger
  let sea = U.T.z;
  let Tt = texDirLod(tHm, d, U.T.x, lod + log2(U.T.x / Nc) + 1.5);
  let land = smoothstep(sea - 0.01, sea + 0.03, Tt.x);
  c += smoothstep(sea + 0.06, sea + 0.35, Tt.x) * 0.2 + land * (Tt.y - 0.5) * 0.18;
  c += climate(lat) * 0.3 + (det - 0.5) * 0.3 + boost;
  let lo = 1.0 - Cl.x;
  let dn = smoothstep(lo, lo + 0.36, c);
  // dünne Schleier (Zirren) zwischen den dichten Feldern
  let veil = smoothstep(0.6, 0.95, det) * smoothstep(lo - 0.2, lo + 0.1, c) * 0.035;
  return max(dn * sqrt(dn), veil);
}
`;

// ---------------------------------------------------------------- Planet, Wolkenschale, Hintergrund
const PATCH_G = 32;
const SCENE = /* wgsl */`
const PATCH_G = ${PATCH_G}.0;
@group(1) @binding(0) var<uniform> D: vec4f;   // Radius, LOD im Vertex-Shader, Relief-Höhe (Verschiebung), Relief-Höhe (für Wolken)
struct PV { @builtin(position) pos: vec4f, @location(0) obj: vec3f, @location(1) world: vec3f }
@vertex fn vsPlanet(@location(0) aPos: vec3f) -> PV {
  let d = normalize(aPos);
  var disp = 0.0;
  if (D.z > 0.0) { disp = D.z * max(texDirLod(tHm, d, U.T.x, D.y).x - U.T.z, 0.0); }
  let p = d * (D.x + disp);
  var o: PV;
  o.obj = d;
  o.world = modelM() * p;
  o.pos = U.vp * vec4f(o.world, 1.0);
  return o;
}

// Gelände-Kacheln (Quadtree wie CDLOD, Strugar 2009): pro Kachel ein Gitter, fein nahe der Kamera.
// Rand-Schürzen (skirt) verdecken die Spalten zwischen Kacheln verschiedener Stufe.
// Geomorphing (Strugar 2009): nahe der Grenze zur gröberen Kachel wandern die ungeraden Gitterpunkte auf die Linie
// ihrer Nachbarn, und die Mipmap-Stufe hängt nur vom Abstand ab. So haben Nachbarkacheln an der Naht dieselbe Höhe.
@vertex fn vsPatch(@location(0) g: vec3f, @location(1) inst: vec4f) -> PV {
  let M = modelM();
  let d0 = faceDir(i32(inst.x), inst.yz + g.xy * inst.w);
  let dist = length(U.cam.xyz - M * d0);
  let rTile = inst.w * 1.1 * D.y;
  let mk = clamp((dist / rTile - 1.3) / 0.5, 0.0, 1.0);    // Kachel lebt etwa bei dist/rTile ∈ [1, 2]
  let gm = g.xy - fract(g.xy * PATCH_G * 0.5) * (2.0 / PATCH_G) * mk;
  let uv = inst.yz + gm * inst.w;
  let d = faceDir(i32(inst.x), uv);
  let lod = max(log2(U.T.x * dist / (1.1 * D.y * PATCH_G)), 0.0);
  var disp = 0.0;
  if (D.z > 0.0) { disp = D.z * max(texDirLod(tHm, d, U.T.x, lod).x - U.T.z, 0.0); }
  let p = d * (D.x + disp - g.z * (0.02 * inst.w + D.z * 0.3));
  var o: PV;
  o.obj = d;
  o.world = modelM() * p;
  o.pos = U.vp * vec4f(o.world, 1.0);
  return o;
}

fn ggxD(NH: f32, a: f32) -> f32 { let a2 = a * a; let d = NH * NH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
fn smithVis(NL: f32, NV: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = NL * sqrt(a2 + (1.0 - a2) * NV * NV);
  let gl = NV * sqrt(a2 + (1.0 - a2) * NL * NL);
  return 0.5 / max(gv + gl, 1e-5);
}
fn toLin(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn biome(uv: vec2f) -> vec3f { return textureSampleLevel(tBiome, samp, uv, 0.0).rgb; }

// Weitere fBm-Oktaven oberhalb der Karten-Nyquistgrenze, weich ausgeblendet unter ~3 Pixeln
fn detailNoise(d: vec3f, pix: f32, f0: f32, amp: f32) -> vec4f {
  var acc = vec4f(0.0);
  var f = f0;
  for (var i = 0; i < 5; i++) {
    let fade = smoothstep(2.0, 5.0, 1.0 / (f * pix));
    if (fade <= 0.0) { break; }
    let sn = snoiseG(d * f + f32(i) * 17.31);
    let s = 1.0 - abs(sn.x);                     // Grate statt Beulen
    let gs = select(-1.0, 1.0, sn.x < 0.0) * sn.yzw;
    let a = amp / f;
    acc += vec4f((s - 0.6) * a, gs * (f * a)) * fade;
    f *= 2.0;
  }
  return acc;
}

// Horizontverfolgung zur Sonne über die Höhenkarte (weiche Schatten)
fn terrainShadow(d: vec3f, Lo: vec3f, h0: f32, k: f32) -> f32 {
  let N = U.T.x;
  let sea = U.T.z;
  let sinEl = dot(Lo, d);
  if (sinEl < -0.2) { return 0.0; }
  var tv = Lo - d * sinEl;
  let tl = length(tv);
  if (tl < 1e-4) { return 1.0; }
  tv /= tl;
  let tanEl = sinEl / tl;
  let z0 = k * max(h0 - sea, 0.0);
  var sh = 1.0;
  var s = 1.5 / N;
  for (var i = 0; i < 14; i++) {
    let q = d * cos(s) + tv * sin(s);
    let lod = log2(max(s * N / 1.5708 * 0.3, 1.0));
    let zq = k * max(texDirLod(tHm, q, N, lod).x - sea, 0.0);
    let zr = z0 + s * tanEl + 0.5 * s * s;
    sh = min(sh, clamp((zr - zq) / (s * 0.035) + 0.5, 0.0, 1.0));
    if (sh <= 0.0 || zr > k * 1.2) { break; }
    s *= 1.5;
  }
  return sh;
}

// Klimazonen (erdähnliche Palette, lineare Albedo). Rückgabe: (Albedo, Rauigkeit)
fn earthBiome(d: vec3f, h: f32, m: f32, slope: f32, nz: f32) -> vec4f {
  let sea = U.T.z;
  let lat = abs(d.y);
  let elev = max(h - sea, 0.0);
  let temp = 1.0 - 1.25 * pow(lat, 1.35) - elev * 1.6 + nz * 0.08;
  let latDeg = asin(lat) * 57.2958;
  let circ = 0.35 * exp(-sq(latDeg / 10.0)) - 0.35 * exp(-sq((latDeg - 25.0) / 9.0)) + 0.15 * exp(-sq((latDeg - 55.0) / 12.0));
  let moist = clamp(m * 0.8 + circ + 0.08 - elev * 0.3 + nz * 0.05, 0.0, 1.0);
  let desert = mix(vec3f(0.56, 0.41, 0.25), vec3f(0.45, 0.24, 0.12), clamp(nz * 0.8 + 0.5, 0.0, 1.0));
  let steppe = vec3f(0.30, 0.26, 0.14);
  let grass = vec3f(0.12, 0.15, 0.055);
  let forest = vec3f(0.04, 0.075, 0.028);
  let jungle = vec3f(0.022, 0.055, 0.016);
  let taiga = vec3f(0.035, 0.055, 0.042);
  let tundra = vec3f(0.19, 0.18, 0.13);
  var warm = mix(desert, steppe, smoothstep(0.14, 0.3, moist));
  warm = mix(warm, grass, smoothstep(0.3, 0.46, moist));
  warm = mix(warm, forest, smoothstep(0.48, 0.64, moist));
  warm = mix(warm, jungle, smoothstep(0.66, 0.85, moist) * smoothstep(0.55, 0.85, temp));
  let cold = mix(tundra, taiga, smoothstep(0.35, 0.55, moist));
  var alb = mix(cold, warm, smoothstep(0.12, 0.38, temp));
  var rough = 0.86;
  let beach = (1.0 - smoothstep(0.002, 0.008, elev)) * smoothstep(0.1, 0.3, temp) * (1.0 - smoothstep(0.12, 0.3, slope));
  alb = mix(alb, vec3f(0.62, 0.55, 0.40), beach);
  let rk = smoothstep(0.1, 0.28, slope + elev * 0.15);
  let rock = vec3f(0.21, 0.19, 0.17) * (0.75 + 0.5 * fract(h * 131.0 + nz * 0.7));
  alb = mix(alb, rock, rk);
  rough = mix(rough, 0.6, rk);
  let sn = (1.0 - smoothstep(-0.08, 0.02, temp)) * (1.0 - smoothstep(0.3, 0.55, slope));
  alb = mix(alb, vec3f(0.86, 0.88, 0.92), sn);
  rough = mix(rough, 0.32, sn);
  return vec4f(alb, rough);
}

@fragment fn fsPlanet(vin: PV) -> @location(0) vec4f {
  let d = normalize(vin.obj);
  let ddx = dpdx(d);
  let ddy = dpdy(d);
  let N = U.T.x;
  let sea = U.T.z;
  let F = toFace(d, ddx, ddy);
  let T = texFace(tHm, F, N);
  var h = T.x;
  var g = T.z * F.jx + T.w * F.jy;
  let pix = max(max(length(ddx), length(ddy)), 1e-6);
  let lod = log2(max(pix * N / 1.5708, 1.0));
  let M = modelM();
  let Mi = transpose(M);
  let sun = U.sun.xyz;
  let Lo = Mi * sun;
  let Vw = normalize(U.cam.xyz - vin.world);
  let muS = dot(d, Lo);
  let view = i32(U.Md.z);

  // ============================== Original 1:1 ==============================
  if (U.Md.x < 0.5) {
    let alb = biome(vec2f(T.y, h));                        // textureMap = biom(feuchte, höhe)
    // normalMap: Sobel über 8-Bit-Höhe + Bildhelligkeit, Wasser glatt
    let stp = exp2(max(floor(lod), 0.0)) / (N - 1.0);
    var gx = 0.0;
    var gy = 0.0;
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        if (i == 0 && j == 0) { continue; }
        var G = F;
        G.uv = clamp(F.uv + vec2f(f32(i), f32(j)) * stp, vec2f(0.0), vec2f(1.0));
        let Tn = texFaceLod(tHm, G, N, floor(lod));
        let hq = floor(Tn.x * 255.0) / 255.0;
        let b = hq + 0.35 * luma(biome(vec2f(Tn.y, Tn.x)));
        gx += f32(i) * select(1.0, 2.0, j == 0) * b;
        gy += f32(j) * select(1.0, 2.0, i == 0) * b;
      }
    }
    let dB = vec2f(gx, gy) / (8.0 * stp);
    let gB = dB.x * F.jx + dB.y * F.jy;
    let water = h < sea;
    let nO = select(normalize(d - U.O.x * 0.05 * gB), d, water);
    let rmap = select(0.85, 0.25, water);                  // roughnessMap (dient auch als metalnessMap)
    let rough = clamp(U.O.y * rmap, 0.04, 1.0);
    let metal = clamp(U.O.z * rmap, 0.0, 1.0);
    let Nn = normalize(M * nO);
    let L = sun;
    let V = Vw;
    let Hh = normalize(L + V);
    let NL = max(dot(Nn, L), 0.0);
    let NV = max(dot(Nn, V), 1e-3);
    let NH = max(dot(Nn, Hh), 0.0);
    let VH = max(dot(V, Hh), 0.0);
    let diffC = alb * (1.0 - metal);
    let specC = mix(vec3f(0.04), alb, metal);
    let a = rough * rough;
    let Fr = specC + (1.0 - specC) * pow(1.0 - VH, 5.0);
    var col = NL * U.Mq.z * (diffC + Fr * smithVis(NL, NV, a) * ggxD(NH, a) * PI);
    col += U.O.w * diffC;
    if (view == 1) { col = vec3f(h); }
    else if (view == 2) { col = vec3f(T.y); }
    else if (view == 3) { col = nO * 0.5 + 0.5; }
    else if (view == 4) { col = vec3f(rough); }
    else if (view == 5) { col = alb; }
    return vec4f(col, 1.0);
  }

  // ============================== Verbessert ==============================
  let pal = i32(U.Md.y);
  let mN = clamp((T.y - U.Mq.x) / max(U.Mq.y - U.Mq.x, 1e-3), 0.0, 1.0);
  let texAng = 1.5708 / N;
  if (U.L.z > 0.0) {
    let det = detailNoise(d, pix, 0.16 / texAng, U.L.z * 0.9);
    let rug = clamp(length(g) * 0.12, 0.25, 1.6);
    h += det.x * rug;
    g += det.yzw * rug;
  }
  g -= d * dot(g, d);
  // Erosion geht beim Heranzoomen weiter: zwei weitere Rinnen-Oktaven entlang des örtlichen Gefälles
  if (U.EroRt.x > 0.0 && h > sea) {
    var f = U.EroRt.y;
    var a = U.EroRt.x * smoothstep(sea, sea + 0.08, h);
    for (var o = 0; o < 2; o++) {
      let fade = smoothstep(3.0, 7.0, 1.0 / (f * pix));
      if (fade <= 0.0) { break; }
      let cr = cross(d, g);
      let sl = length(cr);
      var dr = vec3f(0.0);
      if (sl > 1e-5) { dr = cr / sl * (1.4 * tanh(sl * 0.22)); }
      let e = gullies8(d * f + f32(o) * 7.77, dr);
      let k = a * fade * 0.5 * 0.03;
      h += (e.x - 1.0) * k;
      let ge = e.yzw * f * k;
      g += ge - d * dot(ge, d);
      a *= 0.5;
      f *= 2.0;
    }
  }
  let depth = sea - h;
  let water = depth > 0.0;
  // Terrassen (Gesteinsschichten) auf dem Land
  if (!water && U.L.w > 0.0) {
    let stp = 0.022;
    let x = (h - sea) / stp + 0.25 * sin(T.y * 40.0);
    let fl = floor(x);
    let fr = x - fl;
    let w = 0.5 - 0.42 * U.L.w;
    let tt = clamp((fr - 0.5 + w) / (2.0 * w), 0.0, 1.0);
    let sm = tt * tt * (3.0 - 2.0 * tt);
    let dsm = 6.0 * tt * (1.0 - tt) / (2.0 * w);
    h = mix(h, sea + (fl + sm) * stp, U.L.w);
    g = mix(g, g * dsm, U.L.w);
  }
  let kN = U.L.x * 0.06;                           // Überhöhung für Normalen und Schatten
  let nL = normalize(d - kN * g);
  let slope = 1.0 - dot(nL, d);
  let nz = snoise(d * 23.0 + 3.7) * 0.6 + snoise(d * 97.0) * 0.25;

  // Licht an diesem Ort: Sonne durch die Luft, Wolken- und Geländeschatten
  let E = sunTrans(U.At.x, muS) * U.sun.w;
  var cs = 1.0;
  if (U.Cl.w > 0.0 && U.Cl.x > 0.0) {
    let tS = Lo - d * muS;
    let pc = normalize(d + tS * (U.Cl2.x / max(muS, 0.12)));
    let cd = cloudDensity(pc, max(lod - 1.0, 0.0));
    cs = mix(1.0, exp(-cd * 3.0 * U.Cl2.z), U.Cl.w);
  }
  var ts = 1.0;
  if (U.L2.x > 0.0 && muS > -0.1) { ts = mix(1.0, terrainShadow(d, Lo, h, kN), U.L2.x); }
  let Esh = E * cs * ts;
  let up = M * d;
  let day = smoothstep(-0.12, 0.25, muS);
  let skyAmb = vec3f(0.30, 0.45, 0.75) * U.L2.y * 0.25 * day * U.sun.w * transmittance(U.At.x, max(muS, 0.05));

  var col: vec3f;
  var albOut = vec3f(0.0);
  var roughOut = 0.0;
  var nOut = nL;
  if (water) {
    // Wellen: Neigungen aus animiertem Rauschen; was unter ein Pixel fällt, wird Rauigkeit (Toksvig/Cox–Munk)
    let tm = U.cam.w;
    var gw = vec3f(0.0);
    var varSub = 0.0;
    var f = 700.0;
    let sAmp = 0.05 * U.W.x;
    for (var i = 0; i < 4; i++) {
      // Wellen erst ab ~3 Pixeln Größe einzeln zeigen, kleinere gehen in die Rauigkeit (kein Pixel-Flackern)
      let fade = smoothstep(3.0, 8.0, 1.0 / (f * pix));
      if (fade > 0.0) {
        let gi = snoiseG(d * f + vec3f(tm * 0.21, tm * 0.13, -tm * 0.17) * (1.0 + f32(i) * 0.6) + f32(i) * 7.1).yzw;
        gw += (gi - d * dot(gi, d)) * (sAmp * fade * 0.6);
      }
      varSub += sAmp * sAmp * 0.36 * (1.0 - fade);
      f *= 2.13;
    }
    let nW = normalize(d - gw);
    nOut = nW;
    let alpha = sqrt(0.0064 + 0.003 * U.W.x + varSub * 2.0);
    let Nn = normalize(M * nW);
    let V = Vw;
    let L = sun;
    let Hh = normalize(V + L);
    let NV = max(dot(Nn, V), 1e-3);
    let NL = max(dot(Nn, L), 0.0);
    let NH = max(dot(Nn, Hh), 0.0);
    let VH = max(dot(V, Hh), 0.0);
    let Fv = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
    let Fs = 0.02 + 0.98 * pow(1.0 - VH, 5.0);
    let spec = Esh * (ggxD(NH, alpha) * smithVis(NL, NV, alpha) * Fs * NL);
    // Himmel spiegeln
    let Rw = reflect(-V, Nn);
    let ru = clamp(dot(Rw, up), 0.0, 1.0);
    let sky = mix(vec3f(0.55, 0.65, 0.8), vec3f(0.12, 0.28, 0.65), sqrt(ru)) * E * 0.05;
    // Wasserkörper: Beer–Lambert, Meeresboden scheint im Flachen durch
    // Schelf: in Küstennähe (geglättete Höhe nahe am Meeresspiegel) bleibt das Wasser flach und hell
    let hB = 0.5 * (texFaceLod(tHm, F, N, max(log2(N / 96.0), 0.0)).x + texFaceLod(tHm, F, N, max(log2(N / 256.0), 0.0)).x);
    let dEff = min(depth, max(sea - hB, 0.0) * 0.7 + depth * 0.1);
    let z = dEff * 2500.0;
    let kap = vec3f(0.45, 0.065, 0.021) / max(U.W.y, 0.05);
    let muV = max(dot(nW, Mi * V), 0.05);
    let muL = max(muS, 0.05);
    let Tz = exp(-kap * z * (1.0 / muV + 1.0 / muL));
    var deep = vec3f(0.004, 0.014, 0.034);
    var bed = vec3f(0.55, 0.49, 0.36);
    if (pal == 0) {
      let tint = toLin(biome(vec2f(T.y, max(sea - 0.02, 0.0))));
      deep = mix(deep, tint * 0.06, 0.45);
      bed = toLin(biome(vec2f(T.y, sea + 0.01))) * 0.9;
    }
    let body = (bed * Tz + deep * (1.0 - Tz)) * Esh * max(muS, 0.0) / PI;
    col = (1.0 - Fv) * body + Fv * sky + spec;
    // Brandung: Schaumlinien laufen auf den Strand
    let zb = depth / 0.006;
    if (U.W.z > 0.0 && zb < 1.0) {
      let band = 1.0 - smoothstep(0.0, 1.0, zb);
      let wv = 0.5 + 0.5 * sin(zb * 18.85 - tm * 1.3 + snoise(d * 900.0) * 2.5);
      var foam = band * smoothstep(0.55, 0.95, wv) * 0.8 + (1.0 - smoothstep(0.0, 0.12, zb)) * 0.7;
      foam *= U.W.z * (0.6 + 0.4 * snoise(d * 2500.0 + tm * 0.4));
      col = mix(col, vec3f(0.8) * Esh * max(muS, 0.0) / PI + skyAmb * 0.8, clamp(foam, 0.0, 1.0));
    }
    col += deep * skyAmb * 0.5;
    albOut = deep;
    roughOut = alpha;
    // Meereis in Polnähe (erdähnliche Palette): Schollen mit Rinnen, rau und hell
    if (pal == 1) {
      let lat = abs(d.y);
      let iceN = snoise(d * 16.0) * 0.045 + snoise(d * 64.0) * 0.02;
      let ice = smoothstep(0.87, 0.9, lat + iceN - depth * 0.3);
      if (ice > 0.0) {
        let fadeL = smoothstep(2.0, 5.0, 1.0 / (140.0 * pix));
        var leads = 0.85;
        if (fadeL > 0.0) { leads = mix(0.85, smoothstep(0.02, 0.1, abs(snoise(d * 140.0 + 5.0))), fadeL); }
        let iceAlb = vec3f(0.72, 0.78, 0.84) * mix(0.55, 1.0, leads);
        let Ni = normalize(M * d);
        let NLi = max(dot(Ni, sun), 0.0);
        let iceCol = Esh * NLi * iceAlb / PI + iceAlb * skyAmb;
        col = mix(col, iceCol, ice);
        albOut = mix(albOut, iceAlb, ice);
      }
    }
  } else {
    var alb: vec3f;
    var rough: f32;
    if (pal == 0) {
      alb = toLin(biome(vec2f(T.y, h)));
      rough = 0.7;
      let rk = smoothstep(0.12, 0.3, slope);
      alb = mix(alb, alb * 0.7 + vec3f(0.03), rk * 0.5);
    } else {
      // Bewuchs und Fels nach der Hangneigung im Größeren, nicht nach jeder kleinen Rinne
      let Tb = texFaceLod(tHm, F, N, lod + 2.0);
      let kB = 0.075;                     // feste Überhöhung: Relief-Regler ändert nur das Licht, nicht den Bewuchs
      let slopeB = 1.0 - dot(normalize(d - kB * (Tb.z * F.jx + Tb.w * F.jy)), d);
      let slope0 = 1.0 - dot(normalize(d - kB * g), d);
      let eb = earthBiome(d, h, mN, mix(slope0, slopeB, 0.7), nz);
      alb = eb.rgb;
      rough = eb.a;
    }
    // Flüsse: Maske aus der Abflussakkumulation; Wasser dunkel und glatt, spiegelt die Sonne
    if (U.W.w > 0.0) {
      let NR = U.W.w;
      let rv = smoothstep(0.3, 0.7, texDirLod(tRiver, d, NR, log2(max(pix * NR / 1.5708, 1.0))).x);
      if (rv > 0.0) {
        alb = mix(alb, vec3f(0.012, 0.03, 0.04), rv);
        rough = mix(rough, 0.07, rv);
      }
    }
    // Kavität: Täler dunkler, Grate heller (Differenz zu einer gröberen Mipmap)
    let hb = texFaceLod(tHm, F, N, lod + 3.0).x;
    let cav = clamp((T.x - hb) * 30.0, -1.0, 1.0);
    let ao = clamp(1.0 + cav * 0.45, 0.45, 1.15);
    rough = clamp(rough * (1.0 - 0.55 * U.L.y), 0.08, 1.0);
    let Nn = normalize(M * nL);
    let V = Vw;
    let L = sun;
    let Hh = normalize(V + L);
    let NL = max(dot(Nn, L), 0.0);
    let NV = max(dot(Nn, V), 1e-3);
    let NH = max(dot(Nn, Hh), 0.0);
    let VH = max(dot(V, Hh), 0.0);
    let a = rough * rough;
    let Fs = 0.04 + 0.96 * pow(1.0 - VH, 5.0);
    let diff = alb * (1.0 - Fs) / PI;
    let spec = vec3f(ggxD(NH, a) * smithVis(NL, NV, a) * Fs);
    col = Esh * NL * (diff + spec);
    col += alb * skyAmb * ao * (0.6 + 0.4 * dot(nL, d));
    albOut = alb;
    roughOut = rough;
  }
  if (view == 1) { col = vec3f(clamp(h, 0.0, 1.0)) * 0.3; }
  else if (view == 2) { col = vec3f(mN) * 0.3; }
  else if (view == 3) { col = (nOut * 0.5 + 0.5) * 0.3; }
  else if (view == 4) { col = vec3f(roughOut) * 0.3; }
  else if (view == 5) { col = albOut * 0.6; }
  return vec4f(col, 1.0);
}

// ---- Wolkenschale
@fragment fn fsCloud(vin: PV) -> @location(0) vec4f {
  let d = normalize(vin.obj);
  let pix = max(max(length(dpdx(d)), length(dpdy(d))), 1e-6);
  let Nc = U.T.y;
  let lod = log2(max(pix * Nc / 1.5708, 1.0));
  var dens = cloudDensity(d, lod);
  // Berge, die über die Wolkenschicht ragen: Wolke dort weich ausblenden (statt harter Dreieckskanten im Tiefentest)
  if (D.w > 0.0) {
    let top = D.w * max(texDirLod(tHm, d, U.T.x, lod + log2(U.T.x / Nc)).x - U.T.z, 0.0);
    dens *= 1.0 - smoothstep(0.6 * U.Cl2.x, U.Cl2.x, top);
  }
  if (dens <= 0.003) { discard; }
  let Mi = transpose(modelM());
  let sun = U.sun.xyz;
  let Lo = Mi * sun;
  let Vw = normalize(U.cam.xyz - vin.world);
  let muS = dot(d, Lo);
  if (U.Cl2.w < 0.5) {
    // Original: weiße, halbtransparente Schicht mit Standardmaterial
    let NL = max(muS, 0.0);
    let a = dens * U.Cl2.z;
    let col = vec3f(1.0) * (NL * U.Mq.z * 0.9 + U.O.w);
    return vec4f(col * a, a);
  }
  // Pseudo-Normale aus dem Dichtegradienten: quellende Oberseiten fangen Licht
  let t1 = normalize(cross(d, select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(d.y) < 0.9)));
  let t2 = cross(d, t1);
  let e = max(pix * 1.5, 1.0 / Nc);
  let dx = cloudDensity(normalize(d + t1 * e), lod) - dens;
  let dy = cloudDensity(normalize(d + t2 * e), lod) - dens;
  let nC = normalize(d - (t1 * dx + t2 * dy) * (0.0025 / e));
  let E = sunTrans(U.At.x + U.Cl2.x, muS) * U.sun.w;
  let tau = dens * 7.0 * U.Cl2.z;
  let muV = max(dot(d, Mi * Vw), 0.03);
  let alpha = 1.0 - exp(-tau / muV);
  let NL = dot(nC, Lo);
  let diffuse = clamp(NL * 0.65 + 0.35, 0.0, 1.0) * smoothstep(-0.2, 0.08, muS);
  let cosT = dot(-Vw, sun);
  let g = 0.65;
  let hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-4), 1.5) / (4.0 * PI);
  let thin = exp(-tau * 0.6);
  var col = E * (0.78 * diffuse / PI + hg * thin * 1.2);
  col += vec3f(0.25, 0.35, 0.5) * 0.03 * U.sun.w * smoothstep(-0.2, 0.3, muS);
  return vec4f(col * alpha, alpha);
}

// ---- Hintergrund: gemeinsamer Himmel (src/sky), dazu die Sonne
@fragment fn fsBg(vin: VO) -> @location(0) vec4f {
  let w = U.ivp * vec4f(vin.uv * 2.0 - 1.0, 1.0, 1.0);
  let dir = normalize(w.xyz / w.w - U.cam.xyz);
  let pix = max(length(fwidth(dir)), 1e-5);
  var col = skyColor(tNeb, samp, dir, pix, select(0.0, U.Bg.z, U.Md.w > 0.5), U.Bg.x, U.Bg.y);
  let c = dot(dir, U.sun.xyz);
  let ang = acos(clamp(c, -1.0, 1.0));
  let sunR = U.Mq.w;
  let sunE = U.T.w;
  let disc = 1.0 - smoothstep(sunR - pix, sunR + pix, ang);
  let limb = sqrt(max(0.0, 1.0 - (ang / sunR) * (ang / sunR)));
  let sunCol = vec3f(1.0, 0.96, 0.9);
  col += sunCol * disc * (0.45 + 0.55 * limb) * sunE * 40.0;
  col += sunCol * sunE * (0.012 * exp(-ang / 0.02) + 0.002 * exp(-ang / 0.15));
  return vec4f(col, 1.0);
}
`;

// ---------------------------------------------------------------- Nachbearbeitung: Luftstreuung bzw. Leuchtsaum, Überstrahlung, Filmkurve
const POST = /* wgsl */`
@group(1) @binding(0) var<uniform> Pp: vec4f;          // Texelgröße, Schwelle, erste Stufe
@group(1) @binding(1) var tSrc: texture_2d<f32>;
@group(1) @binding(2) var tSrc2: texture_2d<f32>;
fn tuvOf(uv: vec2f) -> vec2f { return vec2f(uv.x, 1.0 - uv.y); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
@fragment fn fsComp(vin: VO) -> @location(0) vec4f {
  var col = textureSampleLevel(tSrc, samp, tuvOf(vin.uv), 0.0).rgb;
  let w = U.ivp * vec4f(vin.uv * 2.0 - 1.0, 1.0, 1.0);
  let cam = U.cam.xyz;
  let sun = U.sun.xyz;
  let dir = normalize(w.xyz / w.w - cam);
  let b = dot(cam, dir);
  let c2 = dot(cam, cam);
  if (U.Md.x < 0.5) {
    // Original: Leuchtsaum wie der three.js-glow-Shader, I = (c − n·v)^p
    if (b < 0.0 && U.Glow.w > 0.0) {
      let imp = sqrt(max(c2 - b * b, 0.0));
      let pc = normalize(cam - dir * b);
      let lit = 0.35 + 0.65 * smoothstep(-0.4, 0.6, dot(pc, sun));
      var gl = pow(max(0.0, 1.0 - (imp - 1.0) / 0.09), 3.0) * 0.55;
      if (imp < 1.0) { gl = pow(imp, 10.0) * 0.55; }
      col += U.Glow.rgb * gl * lit * U.Glow.w;
    }
    return vec4f(col, 1.0);
  }
  let R = U.At.x;
  let Rt = U.At.y;
  let disc = b * b - (c2 - Rt * Rt);
  if (disc <= 0.0) { return vec4f(col, 1.0); }
  let sq0 = sqrt(disc);
  let t0 = max(-b - sq0, 0.0);
  var t1 = -b + sq0;
  let dg = b * b - (c2 - R * R);
  if (dg > 0.0) { let tg = -b - sqrt(dg); if (tg > 0.0) { t1 = min(t1, tg); } }
  if (t1 <= t0) { return vec4f(col, 1.0); }
  let NS = i32(U.Oz.w);
  let dt = (t1 - t0) / f32(NS);
  let jit = ign(vin.pos.xy);
  let BR = U.BR.xyz;
  let BO = U.BO.xyz;
  var od = vec3f(0.0);
  var sR = vec3f(0.0);
  var sM = vec3f(0.0);
  for (var i = 0; i < 64; i++) {
    if (i >= NS) { break; }
    let tt = t0 + (f32(i) + jit) * dt;
    let p = cam + dir * tt;
    let r = length(p);
    let hh = max(r - R, 0.0);
    let dR = exp(-hh / U.At.z);
    let dM = exp(-hh / U.At.w);
    let dO = max(0.0, 1.0 - abs(hh - U.Oz.x) / U.Oz.y);
    let ext = BR * dR + vec3f(U.BO.w) * dM + BO * dO;
    let Tv = exp(-(od + ext * dt * 0.5));
    let Ts = sunTrans(r, dot(p, sun) / r);
    sR += Tv * Ts * dR * dt;
    sM += Tv * Ts * dM * dt;
    od += ext * dt;
  }
  let mu = dot(dir, sun);
  let pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let g = U.Oz.z;
  let pM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
  let Ls = U.sun.w * (sR * BR * pR + sM * U.BR.w * pM);
  return vec4f(col * exp(-od) + Ls, 1.0);
}
fn tp(uv: vec2f, o: vec2f) -> vec3f { return textureSampleLevel(tSrc, samp, uv + o * Pp.xy, 0.0).rgb; }
// Erste Stufe mit Karis-Mittel (Jimenez 2014, CoD: Advanced Warfare): jeder Abtastwert zählt mit 1/(1+Helligkeit).
// Einzelne superhelle Pixel (Glanzpunkte auf Wellen und Fels) flackern sonst als Lichtblitze durch die Überstrahlung.
fn karisTap(uv: vec2f, o: vec2f, k: f32, acc: ptr<function, vec4f>) {
  let s = tp(uv, o);
  let w = k / (1.0 + max(s.r, max(s.g, s.b)));
  *acc += vec4f(s * w, w);
}
@fragment fn fsDown(vin: VO) -> @location(0) vec4f {
  let uv = tuvOf(vin.uv);
  if (Pp.w > 0.5) {
    var a = vec4f(0.0);
    karisTap(uv, vec2f(0.0), 0.125, &a);
    karisTap(uv, vec2f(-2.0, 2.0), 0.03125, &a); karisTap(uv, vec2f(2.0, 2.0), 0.03125, &a);
    karisTap(uv, vec2f(-2.0, -2.0), 0.03125, &a); karisTap(uv, vec2f(2.0, -2.0), 0.03125, &a);
    karisTap(uv, vec2f(0.0, 2.0), 0.0625, &a); karisTap(uv, vec2f(-2.0, 0.0), 0.0625, &a);
    karisTap(uv, vec2f(2.0, 0.0), 0.0625, &a); karisTap(uv, vec2f(0.0, -2.0), 0.0625, &a);
    karisTap(uv, vec2f(-1.0, 1.0), 0.125, &a); karisTap(uv, vec2f(1.0, 1.0), 0.125, &a);
    karisTap(uv, vec2f(-1.0, -1.0), 0.125, &a); karisTap(uv, vec2f(1.0, -1.0), 0.125, &a);
    var c = a.rgb / max(a.w, 1e-6);
    let br = max(c.r, max(c.g, c.b));
    var soft = clamp(br - Pp.z + 0.5, 0.0, 1.0);
    soft = soft * soft * 0.5;
    c *= max(soft, br - Pp.z) / max(br, 1e-4);
    return vec4f(min(c, vec3f(60.0)), 1.0);
  }
  var c = tp(uv, vec2f(0.0)) * 0.125
    + (tp(uv, vec2f(-2.0, 2.0)) + tp(uv, vec2f(2.0, 2.0)) + tp(uv, vec2f(-2.0, -2.0)) + tp(uv, vec2f(2.0, -2.0))) * 0.03125
    + (tp(uv, vec2f(0.0, 2.0)) + tp(uv, vec2f(-2.0, 0.0)) + tp(uv, vec2f(2.0, 0.0)) + tp(uv, vec2f(0.0, -2.0))) * 0.0625
    + (tp(uv, vec2f(-1.0, 1.0)) + tp(uv, vec2f(1.0, 1.0)) + tp(uv, vec2f(-1.0, -1.0)) + tp(uv, vec2f(1.0, -1.0))) * 0.125;
  if (Pp.w > 0.5) {
    let br = max(c.r, max(c.g, c.b));
    var soft = clamp(br - Pp.z + 0.5, 0.0, 1.0);
    soft = soft * soft * 0.5;
    c *= max(soft, br - Pp.z) / max(br, 1e-4);
    c = min(c, vec3f(60.0));
  }
  return vec4f(c, 1.0);
}
@fragment fn fsUp(vin: VO) -> @location(0) vec4f {
  let uv = tuvOf(vin.uv);
  let c = tp(uv, vec2f(0.0)) * 4.0
    + (tp(uv, vec2f(-1.0, 0.0)) + tp(uv, vec2f(1.0, 0.0)) + tp(uv, vec2f(0.0, -1.0)) + tp(uv, vec2f(0.0, 1.0))) * 2.0
    + tp(uv, vec2f(-1.0, -1.0)) + tp(uv, vec2f(1.0, -1.0)) + tp(uv, vec2f(-1.0, 1.0)) + tp(uv, vec2f(1.0, 1.0));
  return vec4f(c / 16.0, 1.0);
}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
fn hash12(p: vec2f) -> f32 { var p3 = fract(vec3f(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn flare(uv: vec2f) -> vec3f {
  let s = U.Fl.xy - 0.5;
  let p = uv - 0.5;
  var acc = vec3f(0.0);
  var ks = array<f32, 6>(-0.28, -0.62, 0.22, 0.48, -1.15, 0.85);
  var rads = array<f32, 6>(0.05, 0.025, 0.018, 0.07, 0.11, 0.035);
  var cols = array<vec3f, 6>(vec3f(0.4, 0.6, 1.0), vec3f(0.8, 0.5, 1.0), vec3f(1.0, 0.8, 0.4), vec3f(0.4, 1.0, 0.7), vec3f(0.5, 0.6, 1.0), vec3f(1.0, 0.5, 0.4));
  for (var i = 0; i < 6; i++) {
    let rad = rads[i];
    let dv = (p - s * ks[i]) * vec2f(U.Fl.w, 1.0);
    let r = length(dv);
    let disc = 1.0 - smoothstep(rad * 0.7, rad, r);
    let ring = (1.0 - smoothstep(rad, rad * 1.12, r)) * smoothstep(rad * 0.85, rad, r);
    acc += cols[i] * (disc * 0.04 + ring * 0.07);
  }
  let dv = (p - s) * vec2f(U.Fl.w, 1.0);
  let rs = length(dv);
  acc += vec3f(1.0, 0.9, 0.8) * (0.25 * exp(-rs * 18.0) + 0.05 * exp(-rs * 4.0));
  return acc * U.Fl.z;
}
@fragment fn fsFinal(vin: VO) -> @location(0) vec4f {
  let uv = tuvOf(vin.uv);
  var c = textureSampleLevel(tSrc, samp, uv, 0.0).rgb;
  if (U.Fin.y > 0.0) { c += textureSampleLevel(tSrc2, samp, uv, 0.0).rgb * U.Fin.y; }
  if (U.Fl.z > 0.0) { c += flare(vin.uv); }
  c *= U.Fin.x;
  if (U.Fin.z > 0.5) { c = pow(aces(c), vec3f(1.0 / 2.2)); }
  else { c = clamp(c, vec3f(0.0), vec3f(1.0)); }
  c += (hash12(vin.pos.xy) - 0.5) / 255.0;
  return vec4f(c, 1.0);
}
`;

// ------------------------------------------------------------------ GPU-Objekte
let device, adapter, context, format, P, L;
const OFFSCREEN = Q.has('offscreen');
// Kantenglättung der Szene (MSAA): glättet Planetenrand, Bergsilhouetten und Wolkenränder; Nachbearbeitung läuft auf dem aufgelösten Bild
const MSAA = Number(Q.get('msaa')) === 1 ? 1 : 4;
const GPU_RS = {};
const VF = 3;          // GPUShaderStage.VERTEX | FRAGMENT
const mipLevels = (n) => Math.floor(Math.log2(n)) + 1;
const J_SLOTS = 1024, J_STRIDE = 256;
let jBuf, jSlot = 0;
let uBuf, uData = new Float32Array(172), dPlanet, dCloud, ppDummy, samp;

async function initGPU() {
  if (!navigator.gpu) fail(t('Dieser Browser kann kein WebGPU. Bitte Chrome oder Edge ab 113, Safari ab 26 oder Firefox ab 141 nehmen.', 'This browser has no WebGPU. Please use Chrome or Edge 113+, Safari 26+ or Firefox 141+.'));
  adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) fail(t('Keine WebGPU-Grafikkarte gefunden.', 'No WebGPU adapter found.'));
  const maxTex = adapter.limits.maxTextureDimension2D;
  device = await adapter.requestDevice({ requiredLimits: { maxTextureDimension2D: maxTex } });
  device.lost.then((info) => { if (info.reason !== 'destroyed') fail(t('Die Grafikkarte wurde verloren: ', 'The GPU device was lost: ') + info.message); });
  device.addEventListener('uncapturederror', (e) => console.error('WebGPU: ' + e.error.message));
  // ?offscreen: Bild nur in eine Textur (für Tests ohne Grafikkarte; der Software-Renderer kann kein Canvas zeigen)
  if (OFFSCREEN) format = 'rgba8unorm';
  else {
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
  }
  if (S.res > maxTex) S.res = maxTex;
}

function makeLayouts() {
  const tex = (b, dim) => ({ binding: b, visibility: VF, texture: dim ? { viewDimension: dim } : {} });
  const genL = (fmt, dim) => device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { hasDynamicOffset: true, minBindingSize: 128 } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: fmt, viewDimension: dim } },
  ] });
  const mipL = (fmt) => device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: fmt, viewDimension: '2d-array' } },
  ] });
  L = {
    main: device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: VF, buffer: {} }, { binding: 1, visibility: VF, sampler: {} },
      tex(2, '2d-array'), tex(3), tex(4, '2d-array'), tex(5, '2d-array'), tex(6), tex(7, '2d-array'),
    ] }),
    draw: device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: {} }] }),
    post: device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: {} }, tex(1), tex(2)] }),
    gen16: genL('rgba16float', '2d-array'), gen8: genL('rgba8unorm', '2d-array'), trans: genL('rgba16float', '2d'),
    mip16: mipL('rgba16float'), mip8: mipL('rgba8unorm'),
  };
}

// Pipelines werden parallel und ohne Blockieren übersetzt (createRenderPipelineAsync), wie früher KHR_parallel_shader_compile
function startPipelines() {
  const mods = {
    gen: [COMMON + NOISE + GEN, 'gen'], cloudGen: [COMMON + NOISE + CLOUDGEN, 'cloudGen'], nebGen: [SKY_GEN_WGSL, 'nebGen'],
    trans: [TRANS, 'trans'], mip16: [MIP('rgba16float'), 'mip16'], mip8: [MIP('rgba8unorm'), 'mip8'],
    scene: [UDECL + COMMON + TEXH + NOISE + ATMO + CLOUDF + SCENE + SKY_DRAW_WGSL, 'scene'],
    post: [UDECL + COMMON + TEXH + ATMO + POST, 'post'],
  };
  const M = {};
  for (const [k, [code, label]] of Object.entries(mods)) M[k] = device.createShaderModule({ code, label });
  const pl = (...ls) => device.createPipelineLayout({ bindGroupLayouts: ls });
  const comp = (m, lay, entry = 'main') => device.createComputePipelineAsync({ layout: pl(lay), compute: { module: m, entryPoint: entry } });
  const hdr = 'rgba16float';
  const vtx = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }];
  const vtxPatch = [vtx[0], { arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] }];
  const premul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const add = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
  const rend = (m, vs, fs, layout, fmt, o = {}) => device.createRenderPipelineAsync({
    layout,
    vertex: { module: m, entryPoint: vs, buffers: o.mesh === 'patch' ? vtxPatch : o.mesh ? vtx : [] },
    fragment: { module: m, entryPoint: fs, targets: [{ format: fmt, ...(o.blend ? { blend: o.blend } : {}) }] },
    primitive: { topology: 'triangle-list', cullMode: o.mesh ? 'back' : 'none' },
    ...(o.ms && MSAA > 1 ? { multisample: { count: MSAA } } : {}),
    ...(o.depth ? { depthStencil: { format: 'depth24plus', depthWriteEnabled: o.depth === 'write', depthCompare: o.depth === 'always' ? 'always' : 'less' } } : {}),
  });
  const scene = pl(L.main, L.draw), post = pl(L.main, L.post);
  const list = {
    gen: comp(M.gen, L.gen16), cloudGen: comp(M.cloudGen, L.gen8), nebGen: comp(M.nebGen, L.gen16, 'skyGen'), trans: comp(M.trans, L.trans),
    mip16: comp(M.mip16, L.mip16), mip8: comp(M.mip8, L.mip8),
    bg: rend(M.scene, 'vsFull', 'fsBg', scene, hdr, { depth: 'always', ms: true }),
    planet: rend(M.scene, 'vsPatch', 'fsPlanet', scene, hdr, { mesh: 'patch', depth: 'write', ms: true }),
    cloud: rend(M.scene, 'vsPlanet', 'fsCloud', scene, hdr, { mesh: true, depth: 'always', blend: premul, ms: true }),
    comp: rend(M.post, 'vsFull', 'fsComp', post, hdr),
    down: rend(M.post, 'vsFull', 'fsDown', post, hdr),
    up: rend(M.post, 'vsFull', 'fsUp', post, hdr, { blend: add }),
    fin: rend(M.post, 'vsFull', 'fsFinal', post, format),
  };
  return { list, mods: M };
}

function texArray(N, fmt, levels, extra = 0) {
  return device.createTexture({ size: [N, N, 6], format: fmt, mipLevelCount: levels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | extra });
}
const arrView = (tx) => tx.createView({ dimension: '2d-array' });
// Schreibziel für Compute: nur die oberste Mip-Ebene
const lvl0 = (tx) => tx.createView({ dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1 });
const ubuf = (size) => device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
let texIds = 0;
const tagged = (tx) => { tx.fgpId = ++texIds; return tx; };

// Würfel-Kugel-Gitter (gleiche Seitenbasis wie im Shader, Kanten treffen sich exakt)
const BASIS = [
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
];
function cubeSphere(G) {
  const nv = (G + 1) * (G + 1);
  const pos = new Float32Array(6 * nv * 3);
  const idx = new Uint32Array(6 * G * G * 6);
  let vi = 0, ii = 0;
  for (let f = 0; f < 6; f++) {
    const [ex, ey, em] = BASIS[f];
    const base = f * nv;
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
      const s = Math.tan((i / G * 2 - 1) * Math.PI / 4), tt = Math.tan((j / G * 2 - 1) * Math.PI / 4);
      const x = em[0] + s * ex[0] + tt * ey[0], y = em[1] + s * ex[1] + tt * ey[1], z = em[2] + s * ex[2] + tt * ey[2];
      const l = Math.hypot(x, y, z);
      pos[vi++] = x / l; pos[vi++] = y / l; pos[vi++] = z / l;
    }
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = base + j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1;
      idx[ii++] = a; idx[ii++] = b; idx[ii++] = d;
      idx[ii++] = a; idx[ii++] = d; idx[ii++] = c;
    }
  }
  const vb = device.createBuffer({ size: pos.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vb, 0, pos);
  const ib = device.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ib, 0, idx);
  return { vb, ib, count: idx.length, G };
}
let meshPlanet, meshCloud;
// Ein Kachel-Gitter (PATCH_G² Zellen) mit Schürze rundherum; z = 1 markiert Schürzen-Punkte
function patchGrid(G) {
  const W = G + 3, pos = new Float32Array(W * W * 3), idx = new Uint32Array((W - 1) * (W - 1) * 6);
  let vi = 0, ii = 0;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const ci = Math.min(Math.max(i - 1, 0), G), cj = Math.min(Math.max(j - 1, 0), G);
    pos[vi++] = ci / G; pos[vi++] = cj / G; pos[vi++] = (i === 0 || j === 0 || i === W - 1 || j === W - 1) ? 1 : 0;
  }
  for (let j = 0; j < W - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx[ii++] = a; idx[ii++] = b; idx[ii++] = d; idx[ii++] = a; idx[ii++] = d; idx[ii++] = c;
  }
  const vb = device.createBuffer({ size: pos.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vb, 0, pos);
  const ib = device.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ib, 0, idx);
  const MAXI = 6144;
  const inst = device.createBuffer({ size: MAXI * 16, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  return { vb, ib, count: idx.length, G, inst, MAXI, data: new Float32Array(MAXI * 4), n: 0 };
}
const faceDirJS = (f, u, v) => {
  const [ex, ey, em] = BASIS[f];
  const s = Math.tan((u * 2 - 1) * Math.PI / 4), t = Math.tan((v * 2 - 1) * Math.PI / 4);
  const x = em[0] + s * ex[0] + t * ey[0], y = em[1] + s * ex[1] + t * ey[1], z = em[2] + s * ex[2] + t * ey[2];
  const l = Math.hypot(x, y, z); return [x / l, y / l, z / l];
};
// Quadtree je Würfelseite: teilen, solange die Kachel nah ist; hinter dem Horizont weglassen.
// eo = Kamera im Planetenraum, pxK = Bildpunkte pro Bogenmaß im Abstand 1
const SPLIT = coarse ? 3.5 : 6;
function buildPatches(M, eo, maxDepth) {
  const el = Math.hypot(eo[0], eo[1], eo[2]);
  const horizon = 1 / el;
  M.n = 0;
  const visit = (f, u0, v0, sz, depth) => {
    const c = faceDirJS(f, u0 + sz / 2, v0 + sz / 2);
    const arc = sz * 1.1;   // halbe Diagonale grob in Bogenmaß
    const cosV = (c[0] * eo[0] + c[1] * eo[1] + c[2] * eo[2]) / el;
    if (cosV < horizon - arc - 0.03) return;
    const dx = eo[0] - c[0], dy = eo[1] - c[1], dz = eo[2] - c[2];
    const dist = Math.hypot(dx, dy, dz);
    if (depth < maxDepth && dist < arc * SPLIT && M.n < M.MAXI - 4) {
      const h = sz / 2;
      visit(f, u0, v0, h, depth + 1); visit(f, u0 + h, v0, h, depth + 1);
      visit(f, u0, v0 + h, h, depth + 1); visit(f, u0 + h, v0 + h, h, depth + 1);
      return;
    }
    if (M.n >= M.MAXI) return;
    M.data.set([f, u0, v0, sz], M.n * 4); M.n++;
  };
  for (let f = 0; f < 6; f++) visit(f, 0, 0, 1, 0);
  device.queue.writeBuffer(M.inst, 0, M.data, 0, M.n * 4);
}

// ------------------------------------------------------------------ Ressourcen
const RS = { nPrev: 128, nFull: 0, fullReady: false, cloudReady: false, nebReady: false, transKey: '', w: 0, h: 0 };
function initResources() {
  samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  jBuf = device.createBuffer({ size: J_SLOTS * J_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  uBuf = ubuf(uData.byteLength);
  dPlanet = ubuf(16); dCloud = ubuf(16); ppDummy = ubuf(16);
  RS.hmPrev = tagged(texArray(RS.nPrev, 'rgba16float', mipLevels(RS.nPrev), GPUTextureUsage.COPY_SRC));
  RS.cloud = texArray(cloudRes, 'rgba8unorm', mipLevels(cloudRes));
  RS.neb = texArray(nebRes, 'rgba16float', 1);
  RS.trans = device.createTexture({ size: [256, 64], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
  RS.biome = device.createTexture({ size: [512, 512], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  const g = (lay, tx) => device.createBindGroup({ layout: lay, entries: [{ binding: 0, resource: { buffer: jBuf, size: 128 } }, { binding: 1, resource: tx }] });
  RS.bgGenPrev = g(L.gen16, lvl0(RS.hmPrev));
  RS.bgCloudGen = g(L.gen8, lvl0(RS.cloud));
  RS.bgNebGen = g(L.gen16, arrView(RS.neb));
  RS.bgTrans = g(L.trans, RS.trans.createView());
  RS.bgDrawPlanet = device.createBindGroup({ layout: L.draw, entries: [{ binding: 0, resource: { buffer: dPlanet } }] });
  RS.bgDrawCloud = device.createBindGroup({ layout: L.draw, entries: [{ binding: 0, resource: { buffer: dCloud } }] });
  RS.views = { cloud: arrView(RS.cloud), neb: arrView(RS.neb), trans: RS.trans.createView(), biome: RS.biome.createView() };
  RS.shown = RS.hmPrev; RS.nShown = RS.nPrev;
  meshPlanet = patchGrid(PATCH_G);
  RS.river = tagged(device.createTexture({ size: [1, 1, 6], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }));
  RS.nRiver = 0;
  meshCloud = cubeSphere(coarse ? 48 : 72);
}
// Bindungen der Szene; neu, sobald die gezeigte Höhenkarte wechselt (Vorschau -> volle Auflösung)
function mainGroup() {
  const key = RS.shown.fgpId + ':' + RS.river.fgpId;
  if (RS.mainKey === key) return RS.mainBG;
  RS.mainKey = key;
  RS.mainBG = device.createBindGroup({ layout: L.main, entries: [
    { binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: samp },
    { binding: 2, resource: arrView(RS.shown) }, { binding: 3, resource: RS.views.biome },
    { binding: 4, resource: RS.views.cloud }, { binding: 5, resource: RS.views.neb }, { binding: 6, resource: RS.views.trans },
    { binding: 7, resource: arrView(RS.river) },
  ] });
  return RS.mainBG;
}

// ------------------------------------------------------------------ Rechen-Aufträge (Compute) mit eigenem Parameterplatz
function makeCtx(enc) { return { enc, used: 0 }; }
function dispatch(ctx, pipe, bg, params, wx, wy, wz = 1) {
  const off = jSlot * J_STRIDE;
  jSlot = (jSlot + 1) % J_SLOTS;
  ctx.used++;
  device.queue.writeBuffer(jBuf, off, params);
  const pass = ctx.enc.beginComputePass();
  pass.setPipeline(pipe);
  pass.setBindGroup(0, bg, [off]);
  pass.dispatchWorkgroups(wx, wy, wz);
  pass.end();
}
function genMips(enc, tx, N, lay, pipe) {
  for (let l = 1; l < tx.mipLevelCount; l++) {
    const n = Math.max(1, N >> l);
    const bg = device.createBindGroup({ layout: lay, entries: [
      { binding: 0, resource: tx.createView({ dimension: '2d-array', baseMipLevel: l - 1, mipLevelCount: 1 }) },
      { binding: 1, resource: tx.createView({ dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 }) },
    ] });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(n / 8), 6);
    pass.end();
  }
}
// Kachel-Parameter: g = Ende, h = (Anfang, Seite, N)
function tileParams(p, face, x, y, w, h, N) { p.set([x + w, y + h, 0, 0, x, y, face, N], 24); return p; }

// ------------------------------------------------------------------ Biom-Bild (Original-Algorithmus, 2D-Canvas)
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (tt) => { tt = (tt + 1) % 1; return tt < 1 / 6 ? p + (q - p) * 6 * tt : tt < 0.5 ? q : tt < 2 / 3 ? p + (q - p) * (2 / 3 - tt) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
function drawBiome(seed, wl) {
  const R = rng(seed + '|biome');
  const rr = (a, b) => a + (b - a) * R();
  const ctx = lutCanvas.getContext('2d');
  const W = 512, H = 512;
  const base = { h: R() * 360, s: rr(0.08, 0.45), l: rr(0.3, 0.58) };
  const colorAngle = rr(0.2, 0.4), satRange = rr(0.15, 0.35), lightRange = rr(0.3, 0.5), circleSize = rr(30, 250);
  const rc = () => hsl(base.h + rr(-1, 1) * colorAngle * 180, clamp(base.s + rr(-satRange, satRange), 0, 1), clamp(base.l + rr(-lightRange, lightRange), 0.05, 0.92));
  const css = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = css(hsl(base.h, base.s, base.l), 1);
  ctx.fillRect(0, 0, W, H);
  const strip = (x, y, w, h) => {
    const g = ctx.createLinearGradient(rr(0, W), rr(0, H), rr(0, W), rr(0, H));
    const c = rc();
    g.addColorStop(rr(0, 0.5), css(c, 0));
    g.addColorStop(0.5, css(c, 0.8));
    g.addColorStop(rr(0.5, 1), css(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  for (let i = 0; i < 5; i++) strip(0, 0, W, H);                       // drawBase
  for (let i = 0; i < 100; i++) {                                       // randomGradientCircle ×100
    const x = rr(0, W), y = rr(0, H) - H * wl, size = rr(10, circleSize);
    const g = ctx.createRadialGradient(x, y, 0, x, y, size);
    const c = rc();
    g.addColorStop(0, css(c, 0.5));
    g.addColorStop(1, css(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const landDetail = Math.round(rr(0, 5));                              // drawDetail
  for (let i = 0; i < 5; i++) {
    const x1 = rr(0, W), y1 = rr(0, H), x2 = rr(0, W), y2 = rr(0, H);
    if (i < landDetail) strip(x1, y1, x2 - x1, y2 - y1); else { rc(); R(); R(); R(); R(); R(); R(); }
  }
  const band = (y1, h, c, a0, a1) => {                                  // drawInland / drawBeach
    const g = ctx.createLinearGradient(0, y1, 0, y1 + h);
    g.addColorStop(0, css(c, a0));
    g.addColorStop(1, css(c, a1));
    ctx.fillStyle = g;
    ctx.fillRect(0, y1, W, h);
  };
  const yw = H - H * wl;
  band(yw - 100, 100, rc(), 0, 0.5);
  band(yw - 7, 7, rc(), 0, 0.3);
  const wc = rc();                                                      // drawWater
  const g = ctx.createLinearGradient(0, yw, 0, H);
  const sc = (k) => [Math.min(255, Math.round(wc[0] * k)), Math.min(255, Math.round(wc[1] * k)), Math.min(255, Math.round(wc[2] * k))];
  g.addColorStop(0, css(sc(1.3), 0.9));
  g.addColorStop(0.2, css(sc(1.0), 0.9));
  g.addColorStop(0.8, css(sc(0.7), 0.9));
  ctx.fillStyle = g;
  ctx.fillRect(0, yw, W, H - yw);
  // unten im Bild = Wasser = v 0, wie beim Hochladen mit UNPACK_FLIP_Y in WebGL
  device.queue.copyExternalImageToTexture({ source: lutCanvas, flipY: true }, { texture: RS.biome }, [512, 512]);
}

// ------------------------------------------------------------------ Erzeugung (in Kacheln, damit die Seite flüssig bleibt)
let jobs = [], jobTotal = 0, jobDone = 0, genToken = 0, regenBusy = 0;
let cdf = null, moistQ = [0, 1];
let seaH = 0.5;
let lutDirty = false;

// Erosions-Oktaven, die die Karte noch auflöst (Zelle ≥ 4 Texel); der Rest läuft live im Pixel
const eroOct = (N) => clamp(Math.floor(Math.log2(N / 213)) + 1, 1, 6);
function genParams(mode, N, erosion) {
  const f = PP.h, m = PP.m;
  return new Float32Array([
    f.res1, f.res2, f.resMix, f.mixScale,
    f.type, PP.noiseSeed, m.type, PP.noiseSeed + 392.253,
    m.res1 * PP.moistM, m.res2, m.resMix, m.mixScale,
    erosion, 34.0, 0.9, 1.0,
    PP.mountains, PP.beltFreq, 7.0, 0.35,
    mode, eroOct(N), seaH, S.volcanoes,
    0, 0, 0, 0, 0, 0, 0, N,
  ]);
}
function queueTiles(N, tile, params, pipe, bg, onDone) {
  const token = genToken;
  for (let f = 0; f < 6; f++) for (let y = 0; y < N; y += tile) for (let x = 0; x < N; x += tile) {
    const w = Math.min(tile, N - x), h = Math.min(tile, N - y);
    jobs.push({ cost: w * h, run: (ctx) => {
      if (token !== genToken) return;
      dispatch(ctx, pipe(), bg(), tileParams(params(), f, x, y, w, h, N), Math.ceil(w / 8), Math.ceil(h / 8));
    } });
    jobTotal += w * h;
  }
  jobs.push({ cost: 0, run: (ctx) => { if (token === genToken) onDone(ctx); } });
}
// Aufträge im Zeitbudget abarbeiten (höchstens so viele, wie Parameterplätze frei sind)
function runJobs(enc, budget) {
  const ctx = makeCtx(enc);
  let spent = 0;
  while (jobs.length && spent < budget && ctx.used < J_SLOTS - 8) { const j = jobs.shift(); j.run(ctx); spent += j.cost; jobDone += j.cost; }
}
function quantile(arr, q) { return arr[clamp(Math.round(q * (arr.length - 1)), 0, arr.length - 1)]; }
function seaFromFraction(fr) {
  if (!cdf) return 0.5;
  if (fr <= 0) return cdf[0] - 0.01;
  if (fr >= 1) return cdf[cdf.length - 1] + 0.01;
  return quantile(cdf, fr);
}
const half = (x) => { const e = (x >> 10) & 31, m = x & 1023, sg = x & 32768 ? -1 : 1; return e === 0 ? sg * m * 5.960464477539063e-8 : e === 31 ? sg * 65504 : sg * (1 + m / 1024) * Math.pow(2, e - 15); };

async function makeFullMap(N) {
  device.pushErrorScope('out-of-memory');
  const tx = texArray(N, 'rgba16float', mipLevels(N));
  const err = await device.popErrorScope();
  if (err) { tx.destroy(); return null; }
  return tagged(tx);
}

// Milchstraße neu (nur der Hintergrund, der Planet bleibt)
function queueSky() {
  // altes Bild bleibt stehen, bis das neue fertig ist (nur bei neuem Seed ausblenden)
  if (RS.nebSeed !== S.seed) RS.nebReady = false;
  RS.nebSeed = S.seed;
  // Gemeinsamer Himmel (src/sky): Lage der Galaxie und Aussehen aus dem Seed
  const prm = skyParams(String(S.seed), { width: S.mwWidth, core: S.mwCore, dust: S.mwDust, hii: S.mwHii, bright: PP.nebBright, hue: PP.nebHue });
  RS.galCore = [prm[8], prm[9], prm[10]];
  queueTiles(nebRes, 256, () => prm.slice(), () => P.nebGen, () => RS.bgNebGen, () => { RS.nebReady = true; });
}

// ------------------------------------------------------------------ Flüsse
// Höhenkarte in mittlerer Auflösung lesen, Senken füllen (Priority-Flood, Barnes et al. 2014),
// Abfluss sammeln (O'Callaghan & Mark 1984) und Flussläufe als weiche Kurven in eine Maske zeichnen.
let riverT = 0, riverToken = 0;
const QP = Math.PI / 4;
function toFaceJS(d) {
  let best = 0, bv = -2;
  for (let f = 0; f < 6; f++) { const em = BASIS[f][2]; const v = em[0] * d[0] + em[1] * d[1] + em[2] * d[2]; if (v > bv) { bv = v; best = f; } }
  return [best, ...faceUvJS(best, d)];
}
function faceUvJS(f, d) {
  const [ex, ey, em] = BASIS[f];
  const z = em[0] * d[0] + em[1] * d[1] + em[2] * d[2];
  const x = ex[0] * d[0] + ex[1] * d[1] + ex[2] * d[2], y = ey[0] * d[0] + ey[1] * d[1] + ey[2] * d[2];
  return [(Math.atan2(x, z) / QP + 1) / 2, (Math.atan2(y, z) / QP + 1) / 2];
}
async function buildRivers() {
  if (!device || !RS.river || S.style === 'orig') return;
  const token = ++riverToken;
  if (!S.rivers) { RS.nRiver = 0; return; }
  const n = coarse ? 256 : 512, NR = coarse ? 1024 : 2048;
  const mode = 1, ero = S.erosion;
  // 1) Höhen auf der GPU erzeugen und zurücklesen
  const tx = device.createTexture({ size: [n, n, 6], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const bg = device.createBindGroup({ layout: L.gen16, entries: [{ binding: 0, resource: { buffer: jBuf, size: 128 } }, { binding: 1, resource: tx.createView({ dimension: '2d-array' }) }] });
  const enc = device.createCommandEncoder();
  const ctx = makeCtx(enc);
  for (let f = 0; f < 6; f++) dispatch(ctx, P.gen, bg, tileParams(genParams(mode, n, ero), f, 0, 0, n, n, n), n / 8, n / 8);
  const rb = device.createBuffer({ size: n * 8 * n * 6, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  enc.copyTextureToBuffer({ texture: tx }, { buffer: rb, bytesPerRow: n * 8, rowsPerImage: n }, [n, n, 6]);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const hb = new Uint16Array(rb.getMappedRange().slice(0));
  rb.unmap(); rb.destroy(); tx.destroy();
  if (token !== riverToken) return;
  const C = 6 * n * n, sea = seaH;
  const H = new Float32Array(C), rain = new Float32Array(C);
  for (let i = 0; i < C; i++) { H[i] = half(hb[i * 4]); rain[i] = 0.4 + clamp((half(hb[i * 4 + 1]) - moistQ[0]) / (moistQ[1] - moistQ[0] + 1e-6), 0, 1.2); }
  const n1 = n - 1;
  const idx = (f, i, j) => (f * n + j) * n + i;
  // Nachbar über Seitenkanten hinweg: Richtung bilden, zur passenden Seite zurückrechnen
  const nb = (f, i, j, di, dj) => {
    const a = i + di, b = j + dj;
    if (a >= 0 && a <= n1 && b >= 0 && b <= n1) return idx(f, a, b);
    const [g, u, v] = toFaceJS(faceDirJS(f, a / n1, b / n1));
    return idx(g, clamp(Math.round(u * n1), 0, n1), clamp(Math.round(v * n1), 0, n1));
  };
  // 2) Priority-Flood mit Binärheap; jede Zelle fließt zu der Zelle, von der aus sie erreicht wurde
  const hk = new Float32Array(C + 8), hv = new Int32Array(C + 8);
  let hn = 0;
  const push = (k, v) => { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
  const pop = () => { const v = hv[0], k = hk[--hn], x = hv[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= k) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = k; hv[i] = x; return v; };
  const down = new Int32Array(C).fill(-2), fill = new Float32Array(C), order = new Int32Array(C);
  let seeds = 0;
  for (let c = 0; c < C; c++) if (H[c] < sea) { down[c] = -1; fill[c] = H[c]; push(H[c], c); seeds++; }
  if (!seeds) { let m = 0; for (let c = 1; c < C; c++) if (H[c] < H[m]) m = c; down[m] = -1; fill[m] = H[m]; push(H[m], m); }
  let on = 0;
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  while (hn) {
    const c = pop();
    order[on++] = c;
    const f = (c / (n * n)) | 0, r = c - f * n * n, j = (r / n) | 0, i = r - j * n;
    for (let k = 0; k < 8; k++) {
      const q = nb(f, i, j, DI[k], DJ[k]);
      if (down[q] !== -2) continue;
      down[q] = c;
      fill[q] = Math.max(H[q], fill[c] + 1e-7);
      push(fill[q], q);
    }
  }
  // 3) Abfluss sammeln (von oben nach unten), Hauptzufluss merken
  const acc = new Float32Array(C), up = new Int32Array(C).fill(-1);
  for (let c = 0; c < C; c++) if (H[c] >= sea) acc[c] = rain[c];
  for (let k = on - 1; k >= 0; k--) {
    const c = order[k], d = down[c];
    if (d < 0 || H[c] < sea) continue;
    acc[d] += acc[c];
    if (up[d] < 0 || acc[c] > acc[up[d]]) up[d] = c;
  }
  if (token !== riverToken) return;
  // 4) Maske zeichnen: quadratische Bézier-Kurven durch die Kantenmitten, Breite ~ √Abfluss
  const T = C * 0.00015, sc = (NR - 1) / n1;
  const mask = new Uint8Array(6 * NR * NR);
  const jit = (c) => { const x = Math.sin(c * 12.9898) * 43758.5453, y = Math.sin(c * 78.233) * 12345.6789; return [(x - Math.floor(x) - 0.5) * 0.7, (y - Math.floor(y) - 0.5) * 0.7]; };
  const posOn = (f, c) => {
    const g = (c / (n * n)) | 0, r = c - g * n * n, j = (r / n) | 0, i = r - j * n;
    const J = jit(c);
    if (g === f) return [(i + J[0]) * sc, (j + J[1]) * sc];
    const [u, v] = faceUvJS(f, faceDirJS(g, i / n1, j / n1));
    return [u * n1 * sc, v * n1 * sc];
  };
  const stamp = (f, x, y, w) => {
    const R = Math.ceil(w + 1.5), base = f * NR * NR;
    const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(NR - 1, Math.ceil(x + R));
    const y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(NR - 1, Math.ceil(y + R));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const v = clamp(w + 0.5 - Math.hypot(px - x, py - y), 0, 1) * 255;
      const o = base + py * NR + px;
      if (v > mask[o]) mask[o] = v;
    }
  };
  const wK = NR / 2048;
  for (let c = 0; c < C; c++) {
    if (H[c] < sea || acc[c] < T || down[c] < 0) continue;
    const f = (c / (n * n)) | 0;
    const Pc = posOn(f, c), Pd = posOn(f, down[c]);
    const u = up[c];
    const Pa = u >= 0 && acc[u] >= T ? posOn(f, u) : Pc;
    const A = [(Pa[0] + Pc[0]) / 2, (Pa[1] + Pc[1]) / 2], B = [(Pc[0] + Pd[0]) / 2, (Pc[1] + Pd[1]) / 2];
    const w0 = clamp(0.55 * Math.sqrt(acc[c] / T), 0.7, 5) * wK;
    const w1 = clamp(0.55 * Math.sqrt(acc[down[c]] / T), 0.7, 5) * wK;
    const len = Math.hypot(A[0] - Pc[0], A[1] - Pc[1]) + Math.hypot(B[0] - Pc[0], B[1] - Pc[1]);
    const steps = Math.max(2, Math.ceil(len / 0.7));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), e = t * t;
      stamp(f, a * A[0] + b * Pc[0] + e * B[0], a * A[1] + b * Pc[1] + e * B[1], w0 + (w1 - w0) * t * 0.5);
    }
  }
  if (token !== riverToken) return;
  // 5) Hochladen mit Mipmaps (2×2-Mittel auf der CPU)
  const levels = mipLevels(NR);
  const tex = tagged(device.createTexture({ size: [NR, NR, 6], format: 'r8unorm', mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }));
  let cur = mask, m = NR;
  for (let l = 0; l < levels; l++) {
    const bpr = Math.max(256, m);
    for (let f = 0; f < 6; f++) {
      let data = cur.subarray(f * m * m, (f + 1) * m * m);
      if (bpr !== m) { const pad = new Uint8Array(bpr * m); for (let y = 0; y < m; y++) pad.set(data.subarray(y * m, y * m + m), y * bpr); data = pad; }
      device.queue.writeTexture({ texture: tex, mipLevel: l, origin: [0, 0, f] }, data, { bytesPerRow: bpr, rowsPerImage: m }, [m, m, 1]);
    }
    if (m === 1) break;
    const h2 = m >> 1, nx = new Uint8Array(6 * h2 * h2);
    for (let f = 0; f < 6; f++) for (let y = 0; y < h2; y++) for (let x = 0; x < h2; x++) {
      const o = f * m * m + 2 * y * m + 2 * x;
      nx[f * h2 * h2 + y * h2 + x] = (cur[o] + cur[o + 1] + cur[o + m] + cur[o + m + 1] + 2) >> 2;
    }
    cur = nx; m = h2;
  }
  const old = RS.river;
  RS.river = tex; RS.nRiver = NR;
  if (old) setTimeout(() => old.destroy(), 500);
}

async function regenerate(full) {
  const token = ++genToken;
  jobs = []; jobTotal = 0; jobDone = 0;
  regenBusy++;
  try {
    const mode = S.style === 'orig' ? 0 : 1;
    const ero = mode === 1 ? S.erosion : 0;
    // 1) Vorschau 128² sofort, daraus die Höhenverteilung für den Meeresspiegel
    const n = RS.nPrev;
    const enc = device.createCommandEncoder();
    const ctx = makeCtx(enc);
    for (let f = 0; f < 6; f++) dispatch(ctx, P.gen, RS.bgGenPrev, tileParams(genParams(mode, n, 0), f, 0, 0, n, n, n), n / 8, n / 8);
    genMips(enc, RS.hmPrev, n, L.mip16, P.mip16);
    const rb = device.createBuffer({ size: n * 8 * n * 6, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyTextureToBuffer({ texture: RS.hmPrev }, { buffer: rb, bytesPerRow: n * 8, rowsPerImage: n }, [n, n, 6]);
    device.queue.submit([enc.finish()]);
    RS.shown = RS.hmPrev; RS.nShown = n; RS.fullReady = false;
    await rb.mapAsync(GPUMapMode.READ);
    const hb = new Uint16Array(rb.getMappedRange().slice(0));
    rb.unmap(); rb.destroy();
    if (token !== genToken) return;
    const hs = [], ms = [];
    for (let i = 0; i < 6 * n * n; i += 3) { hs.push(half(hb[i * 4])); ms.push(half(hb[i * 4 + 1])); }
    hs.sort((a, b) => a - b); ms.sort((a, b) => a - b);
    cdf = Float32Array.from(hs);
    moistQ = [quantile(ms, 0.04), quantile(ms, 0.96)];
    if (S.sea < 0) S.sea = PP.water;
    seaH = seaFromFraction(S.sea);
    drawBiome(S.seed, clamp(seaH, 0, 1));
    buildRivers();
    // 2) volle Auflösung
    if (full !== false) {
      let N = S.res;
      if (!RS.hmFull || RS.nFull !== N) {
        if (RS.hmFull) RS.hmFull.destroy();
        RS.hmFull = await makeFullMap(N);
        // zu wenig Grafikspeicher: halbe Auflösung
        while (!RS.hmFull && N > 512) { N = S.res = N >> 1; RS.hmFull = await makeFullMap(N); }
        RS.nFull = N;
        RS.bgGenFull = RS.hmFull && device.createBindGroup({ layout: L.gen16, entries: [{ binding: 0, resource: { buffer: jBuf, size: 128 } }, { binding: 1, resource: lvl0(RS.hmFull) }] });
        if (token !== genToken) return;
      }
      if (RS.hmFull) {
        const full = RS.hmFull;
        queueTiles(N, 256, () => genParams(mode, N, ero), () => P.gen, () => RS.bgGenFull, (c) => {
          genMips(c.enc, full, N, L.mip16, P.mip16);
          RS.shown = full; RS.nShown = N; RS.fullReady = true;
        });
      }
    }
    // 3) Wolken und Nebel gehören zum Seed
    if (RS.cloudSeed !== S.seed) initCyclones(S.seed);
    if (RS.cloudSeed !== S.seed || !RS.cloudReady) {
      RS.cloudSeed = S.seed; RS.cloudReady = false;
      queueTiles(cloudRes, 256, () => new Float32Array([PP.cloudSeed, 0, 0, 0, ...new Array(28).fill(0)]), () => P.cloudGen, () => RS.bgCloudGen, (c) => {
        genMips(c.enc, RS.cloud, cloudRes, L.mip8, P.mip8);
        RS.cloudReady = true;
      });
    }
    if (RS.nebSeed !== S.seed || !RS.nebReady) queueSky();
  } finally { regenBusy--; }
}

function atmoParams() {
  const k = S.thick, Rkm = 6371;
  const scale = Rkm * 1000 / k;
  return {
    HR: 8 / Rkm * k, HM: 1.2 / Rkm * k, Rt: 1 + 60 / Rkm * k,
    bR: [5.802e-6, 13.558e-6, 33.1e-6].map((v) => v * scale * S.atmo),
    bM: 3.996e-6 * scale * S.haze, bMe: 4.44e-6 * scale * S.haze,
    bO: [0.65e-6, 1.881e-6, 0.085e-6].map((v) => v * scale * S.atmo),
    oz: [25 / Rkm * k, 15 / Rkm * k],
  };
}
function updateTrans(enc) {
  const key = `${S.thick}|${S.atmo}|${S.haze}`;
  if (key === RS.transKey) return;
  RS.transKey = key;
  const A = atmoParams();
  const p = new Float32Array(32);
  p.set([1, A.Rt, A.HR, A.HM, ...A.bR, A.bMe, ...A.bO, 0, A.oz[0], A.oz[1], 0, 0]);
  dispatch(makeCtx(enc), P.trans, RS.bgTrans, p, 32, 8);
}

// ------------------------------------------------------------------ Ziele (HDR, Tiefe, Überstrahlung)
function ensureTargets(w, h) {
  if (RS.w === w && RS.h === h) return;
  for (const k of ['scene', 'hdr2', 'depth', 'msaa']) if (RS[k]) RS[k].destroy();
  for (const b of RS.bloom || []) b.tx.destroy();
  RS.w = w; RS.h = h;
  const rt = (W, H, fmt) => device.createTexture({ size: [W, H], format: fmt || 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  RS.scene = rt(w, h); RS.hdr2 = rt(w, h);
  RS.depth = device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  RS.msaa = MSAA > 1 ? device.createTexture({ size: [w, h], format: 'rgba16float', sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT }) : null;
  RS.sceneV = RS.scene.createView(); RS.hdr2V = RS.hdr2.createView(); RS.depthV = RS.depth.createView();
  RS.msaaV = RS.msaa ? RS.msaa.createView() : null;
  if (OFFSCREEN) {
    if (RS.out) RS.out.destroy();
    RS.out = device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    RS.outV = RS.out.createView();
  }
  RS.bloom = [];
  let bw = w >> 1, bh = h >> 1;
  for (let i = 0; i < 6 && bw >= 4 && bh >= 4; i++) {
    const tx = rt(bw, bh);
    RS.bloom.push({ tx, v: tx.createView(), w: bw, h: bh, pd: ubuf(16), pu: ubuf(16) });
    bw >>= 1; bh >>= 1;
  }
  const pg = (buf, a, b) => device.createBindGroup({ layout: L.post, entries: [{ binding: 0, resource: { buffer: buf } }, { binding: 1, resource: a }, { binding: 2, resource: b || a }] });
  RS.pgComp = pg(ppDummy, RS.sceneV);
  RS.pgFinNoBloom = pg(ppDummy, RS.hdr2V);
  RS.pgFin = RS.bloom.length ? pg(ppDummy, RS.hdr2V, RS.bloom[0].v) : RS.pgFinNoBloom;
  RS.bloom.forEach((b, i) => {
    b.gDown = pg(b.pd, i === 0 ? RS.hdr2V : RS.bloom[i - 1].v);
    b.gUp = pg(b.pu, b.v);
  });
}

// ------------------------------------------------------------------ Mathe
const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
// Tiefe 0..1 wie in WebGPU (statt −1..1 in GL)
function persp(fovy, aspect, n, f) {
  const tt = 1 / Math.tan(fovy / 2);
  return new Float32Array([tt / aspect, 0, 0, 0, 0, tt, 0, 0, 0, 0, f / (n - f), -1, 0, 0, n * f / (n - f), 0]);
}
function lookAt(e, c, up) {
  const z = V.norm(V.sub(e, c)), x = V.norm(V.cross(up, z)), y = V.cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, e), -V.dot(y, e), -V.dot(z, e), 1]);
}
function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function inv4(m) {
  const a = m, o = new Float32Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
  const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
  const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
  o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
  o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
  o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
  o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return o;
}
// Drehung des Planeten: erst um die eigene Achse (y), dann Achsneigung (z). Spaltenweise.
function planetMatrix(spin, tilt) {
  const c = Math.cos(spin), s = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);
  const ry = [c, 0, -s, 0, 1, 0, s, 0, c];
  const rz = [ct, st, 0, -st, ct, 0, 0, 0, 1];
  const o = new Float32Array(9);
  for (let col = 0; col < 3; col++) for (let r = 0; r < 3; r++) {
    let v = 0;
    for (let k = 0; k < 3; k++) v += rz[k * 3 + r] * ry[col * 3 + k];
    o[col * 3 + r] = v;
  }
  return o;
}

// ------------------------------------------------------------------ Kamera & Eingabe
const cam = { yaw: 0.25, pitch: 0.12, dist: 3.4, tDist: 3.4, vYaw: 0, vPitch: 0, zoomed: false };
// Abstand so, dass der Planet etwa 78 % der kleineren Bildhälfte füllt
function fitDist(aspect) {
  const hv = S.fov * Math.PI / 360, hh = Math.atan(Math.tan(hv) * aspect);
  return 1 / Math.sin(0.78 * Math.min(hv, hh));
}
const pointers = new Map();
let pinch0 = 0, dist0 = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.classList.add('drag');
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = cam.tDist; }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    const k = 0.0045 * Math.min(1, (cam.dist - 1) / 1.5);
    cam.vYaw = -dx * k; cam.vPitch = dy * k;
    cam.yaw += cam.vYaw; cam.pitch = clamp(cam.pitch + cam.vPitch, -1.45, 1.45);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0 > 0) { cam.tDist = clamp(1 + (dist0 - 1) * pinch0 / d, 1.06, 14); cam.zoomed = true; }
  }
});
const endPtr = (e) => { pointers.delete(e.pointerId); if (!pointers.size) canvas.classList.remove('drag'); pinch0 = 0; };
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.tDist = clamp(1 + (cam.tDist - 1) * Math.exp(e.deltaY * 0.0012), 1.06, 14);
  cam.zoomed = true;
}, { passive: false });

// ------------------------------------------------------------------ Regler-Reaktionen
function changed(it) {
  const k = it.k;
  if (!device) return;
  if (k === 'res' || k === 'erosion' || k === 'volcanoes') { regenerate(); }
  else if (it.regen === 'rivers') { buildRivers(); }
  else if (it.regen === 'sky') queueSky();
  else if (k === 'sea') { seaH = seaFromFraction(S.sea); lutDirty = true; clearTimeout(riverT); riverT = setTimeout(buildRivers, 400); }
  else if (k === 'lang') buildUI();
}
function setStyle(st, already) {
  if (!already && S.style === st) return;
  S.style = st;
  buildUI();
  if (device) regenerate();
}
$('lang').addEventListener('click', () => { setLang(lang === 'de' ? 'en' : 'de'); buildUI(); });
function newSeed(sd) {
  S.seed = String(sd).trim() || randomSeed();
  PP = planetParams(S.seed);
  S.sea = PP.water;
  S.cover = PP.cloudCover;
  try { const u = new URL(location.href); u.searchParams.set('seed', S.seed); history.replaceState(null, '', u); } catch {}
  buildUI();
  if (device) regenerate();
}

// ------------------------------------------------------------------ Wirbel (Tiefdruckgebiete, ein tropischer Wirbelsturm)
// Sie entstehen, drehen sich auf, ziehen mit dem Wind ihrer Breite und lösen sich wieder auf.
const CLOUD_PERIOD = 70;
const cyclones = [];
function windOmegaJS(lat) {
  const a = Math.abs(lat);
  const u = -0.9 * Math.sin(6 * a) + 0.35 * Math.exp(-(((a - 0.75) / 0.18) ** 2));
  return u / Math.max(Math.cos(lat), 0.3);
}
function spawnCyclone(R, birth, tropical) {
  const north = R() < 0.5;
  const lat = (north ? 1 : -1) * (tropical ? 0.2 + R() * 0.2 : 0.55 + R() * 0.5);
  return { R, tropical, lat, lon: R() * Math.PI * 2, birth, life: tropical ? 90 + R() * 60 : 55 + R() * 55,
    s: (north ? -1 : 1) * (tropical ? 5.5 + R() * 2 : 2.2 + R() * 2.2), r: tropical ? 0.045 + R() * 0.025 : 0.1 + R() * 0.09 };
}
function initCyclones(seed) {
  const R = rng(seed + '|cyclones');
  cyclones.length = 0;
  for (let i = 0; i < 6; i++) {
    const c = spawnCyclone(R, 0, i === 0);
    c.birth = simTime - R() * c.life;
    cyclones.push(c);
  }
}
const cycA = new Float32Array(24), cycB = new Float32Array(24);
function updateCyclones() {
  for (let i = 0; i < cyclones.length; i++) {
    let c = cyclones[i];
    let age = simTime - c.birth;
    if (age > c.life || age < 0) { c = cyclones[i] = spawnCyclone(c.R, simTime, c.tropical); age = 0; }
    const lon = c.lon + windOmegaJS(c.lat) * S.wind * 0.35 * age / CLOUD_PERIOD;
    const env = Math.sin(Math.PI * age / c.life);
    cycA.set([Math.cos(c.lat) * Math.sin(lon), Math.sin(c.lat), Math.cos(c.lat) * Math.cos(lon), c.s * env], i * 4);
    cycB.set([c.r, age / c.life, c.tropical ? 1 : 0, 0], i * 4);
  }
}

// ------------------------------------------------------------------ Zeichnen
let spin = 0.6, simTime = 0;
function sunDir() {
  const az = S.sunAz * Math.PI / 180, el = S.sunEl * Math.PI / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}
// Alle Werte für die Shader in einem Puffer (Reihenfolge wie struct Uf)
function fillUniforms(o) {
  const u = uData;
  u.set(o.vp, 0); u.set(o.ivp, 16);
  const m = o.model;
  u.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 32);
  u.set([...o.eye, simTime], 44);
  u.set([...o.sun, o.sunE], 48);
  const A = o.A;
  u.set([1, A.Rt, A.HR, A.HM], 52);
  u.set([...A.bR, A.bM], 56);
  u.set([...A.bO, A.bMe], 60);
  u.set([A.oz[0], A.oz[1], 0.8, coarse ? 16 : 28], 64);
  u.set([S.nscale, S.rough, S.metal, S.ambient], 68);
  u.set([S.waves, S.clarity, S.foam, S.rivers && RS.nRiver && S.style !== 'orig' ? RS.nRiver : 0], 72);
  u.set([S.bump, S.gloss, S.detail, S.terrace], 76);
  u.set([S.shadows, S.ambientP, 0, 0], 80);
  u.set([moistQ[0], moistQ[1], S.sunI, 0.0095], 84);
  u.set([S.erosion * Math.pow(0.5, eroOct(RS.nShown)), 34 * Math.pow(2, eroOct(RS.nShown)), 0, 0], 88);
  u.set(o.clU, 92); u.set(o.clU2, 96);
  u.set([RS.nShown, cloudRes, seaH, o.orig ? 1.2 : o.sunE], 100);
  u.set([o.orig ? 0 : 1, S.palette === 'earth' ? 1 : 0, S.view, RS.nebReady ? 1 : 0], 104);
  u.set([S.nebula, S.stars, nebRes, 0], 108);
  u.set([0.45, 0.7, 1.0, S.glow], 112);
  u.set([o.orig ? 1 : S.exposure * 1.25, o.bloomOn ? S.bloom * 0.12 : 0, o.orig ? 0 : 1, 0], 116);
  u.set(o.fl, 120);
  u.set(cycA, 124); u.set(cycB, 148);
  device.queue.writeBuffer(uBuf, 0, u);
}
function render(enc) {
  const w = canvas.width, h = canvas.height;
  ensureTargets(w, h);
  updateTrans(enc);
  if (lutDirty) { drawBiome(S.seed, clamp(seaH, 0, 1)); lutDirty = false; }
  const orig = S.style === 'orig';
  const A = atmoParams();
  const aspect = w / h, fov = S.fov * Math.PI / 180;
  if (!cam.zoomed) cam.tDist = fitDist(aspect);
  cam.dist += (cam.tDist - cam.dist) * 0.18;
  const eye = [cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch), cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw)];
  const near = Math.max(0.0015, (cam.dist - 1.05) * 0.6), far = cam.dist + 4;
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const proj = persp(fov, aspect, near, far);
  const vp = mul4(proj, view), ivp = inv4(vp);
  const model = planetMatrix(spin, S.tilt * Math.PI / 180);
  const sun = sunDir();
  const sunE = orig ? 1 : 3.2;
  const cloudOn = RS.cloudReady && S.cover > 0;
  updateCyclones();
  const clU = [cloudOn ? S.cover : 0, simTime / CLOUD_PERIOD, S.wind * 0.35, orig ? 0 : S.cloudShadow];
  const clU2 = [orig ? 0.006 : S.cloudH, spin * 0.12, orig ? S.cloudOpO : S.cloudOp, orig ? 0 : 1];
  const bloomOn = !orig && S.bloom > 0 && RS.bloom.length > 1;

  // Sonne auf dem Bild und ob der Planet sie verdeckt (für die Blendenflecke)
  const far4 = mul4(vp, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, eye[0] + sun[0] * 50, eye[1] + sun[1] * 50, eye[2] + sun[2] * 50, 1]));
  const cw = far4[15];
  let fl = [0, 0, 0, aspect];
  if (cw > 0 && S.flare > 0) {
    const sx = far4[12] / cw * 0.5 + 0.5, sy = far4[13] / cw * 0.5 + 0.5;
    const toC = V.norm([-eye[0], -eye[1], -eye[2]]);
    const alpha = Math.asin(Math.min(1, 1.01 / cam.dist));
    const beta = Math.acos(clamp(V.dot(sun, toC), -1, 1));
    const vis = clamp((beta - alpha + 0.012) / 0.024, 0, 1);
    const onScreen = clamp(1.4 - Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5)) * 2, 0, 1);
    fl = [sx, sy, vis * onScreen * S.flare * (orig ? 0.9 : 0.5), aspect];
  }
  fillUniforms({ vp, ivp, model, eye, sun, sunE, A, orig, clU, clU2, bloomOn, fl });
  device.queue.writeBuffer(dPlanet, 0, new Float32Array([1, SPLIT, orig ? 0 : S.relief, 0]));
  device.queue.writeBuffer(dCloud, 0, new Float32Array([1 + clU2[0], 0, 0, orig ? 0 : S.relief]));
  const g0 = mainGroup();

  // Hintergrund, Planet, Wolken
  const sp = enc.beginRenderPass({
    colorAttachments: [RS.msaaV ? { view: RS.msaaV, resolveTarget: RS.sceneV, loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'discard' } : { view: RS.sceneV, loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }],
    depthStencilAttachment: { view: RS.depthV, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
  });
  sp.setBindGroup(0, g0);
  sp.setBindGroup(1, RS.bgDrawPlanet);
  sp.setPipeline(P.bg);
  sp.draw(3);
  sp.setPipeline(P.planet);
  {
    // Kamera in den Planetenraum (Modellmatrix ist eine Drehung: transponiert = invers)
    const eo = [0, 1, 2].map((c) => model[c * 3] * eye[0] + model[c * 3 + 1] * eye[1] + model[c * 3 + 2] * eye[2]);
    buildPatches(meshPlanet, eo, Math.max(2, Math.round(Math.log2(RS.nShown / PATCH_G)) + 1));
  }
  sp.setVertexBuffer(0, meshPlanet.vb);
  sp.setVertexBuffer(1, meshPlanet.inst);
  sp.setIndexBuffer(meshPlanet.ib, 'uint32');
  sp.drawIndexed(meshPlanet.count, meshPlanet.n);
  if (cloudOn && S.view === 0) {
    sp.setPipeline(P.cloud);
    sp.setBindGroup(1, RS.bgDrawCloud);
    sp.setVertexBuffer(0, meshCloud.vb);
    sp.setIndexBuffer(meshCloud.ib, 'uint32');
    sp.drawIndexed(meshCloud.count);
  }
  sp.end();

  const full = (view, pipe, group, load) => {
    const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: load ? 'load' : 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }] });
    p.setPipeline(pipe);
    p.setBindGroup(0, g0);
    p.setBindGroup(1, group);
    p.draw(3);
    p.end();
  };
  // Luft / Leuchtsaum
  full(RS.hdr2V, P.comp, RS.pgComp);

  // Überstrahlung
  if (bloomOn) {
    let sw = w, sh = h;
    RS.bloom.forEach((b, i) => {
      device.queue.writeBuffer(b.pd, 0, new Float32Array([1 / sw, 1 / sh, 1.2 / Math.max(S.exposure, 0.05), i === 0 ? 1 : 0]));
      device.queue.writeBuffer(b.pu, 0, new Float32Array([1 / b.w, 1 / b.h, 0, 0]));
      full(b.v, P.down, b.gDown);
      sw = b.w; sh = b.h;
    });
    for (let i = RS.bloom.length - 1; i > 0; i--) full(RS.bloom[i - 1].v, P.up, RS.bloom[i].gUp, true);
  }
  full(OFFSCREEN ? RS.outV : context.getCurrentTexture().createView(), P.fin, bloomOn ? RS.pgFin : RS.pgFinNoBloom);
}

// ------------------------------------------------------------------ Schleife
let last = performance.now(), budget = 256 * 256 * 2, fpsAcc = 0, fpsN = 0, fpsT = 0;
// Bildauflösung: fest oder automatisch (hält etwa 40–60 Bilder pro Sekunde)
const urlScale = Number(Q.get('scale')) || 0;
let dynScale = 1, perfT = 0, perfAcc = 0, perfN = 0;
function resize() {
  const r = canvas.getBoundingClientRect();
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (urlScale) dpr *= urlScale;
  else if (S.quality > 0) dpr *= S.quality;
  else {
    dpr *= dynScale;
    const px = r.width * r.height * dpr * dpr;
    const cap = coarse ? 3.6e6 : 17e6;
    if (px > cap) dpr *= Math.sqrt(cap / px);
  }
  const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function adaptScale(dt, now) {
  if (S.quality > 0 || urlScale || jobs.length) return;
  perfAcc += dt; perfN++;
  if (now - perfT < 1200) return;
  const ms = 1000 * perfAcc / Math.max(perfN, 1);
  perfAcc = 0; perfN = 0; perfT = now;
  // Starke Grafikkarten: über 100 % hinaus (Supersampling), bis die Bildrate gegen 60 fällt
  const top = coarse ? 1 : 2;
  if (ms > (coarse ? 24 : 17.5) && dynScale > 0.45) dynScale = Math.max(0.45, dynScale * 0.85);
  else if (ms < (coarse ? 14 : 11) && dynScale < top) dynScale = Math.min(top, dynScale * 1.08);
}
function step(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  adaptScale(dt, now);
  resize();
  if (!pointers.size) {
    cam.yaw += cam.vYaw; cam.pitch = clamp(cam.pitch + cam.vPitch, -1.45, 1.45);
    cam.vYaw *= 0.92; cam.vPitch *= 0.92;
  }
  if (S.rotate) spin += S.spin * Math.PI / 180 * dt * Math.pow(clamp((cam.dist - 1) / 1.2, 0, 1), S.spinZoom);
  simTime += dt;
  const enc = device.createCommandEncoder();
  // Erzeugung im Zeitbudget
  if (jobs.length) {
    budget = dt < 0.03 ? Math.min(budget * 1.3, 8e6) : dt > 0.05 ? Math.max(budget * 0.6, 32768) : budget;
    runJobs(enc, budget);
  }
  const gb = $('genbar');
  if (jobs.length) {
    gb.hidden = false;
    $('gen-text').textContent = `${t('Erzeuge Planet', 'Generating planet')} ${Math.round(100 * jobDone / Math.max(jobTotal, 1))} %`;
    $('gen-fill').style.width = `${100 * jobDone / Math.max(jobTotal, 1)}%`;
  } else gb.hidden = true;
  if (!OFFSCREEN) render(enc);          // im Testmodus nur für Fotos zeichnen
  device.queue.submit([enc.finish()]);
  fpsAcc += dt; fpsN++;
  if (now - fpsT > 500) { $('fps').textContent = `${Math.round(fpsN / Math.max(fpsAcc, 1e-3))} fps`; fpsAcc = 0; fpsN = 0; fpsT = now; }
  requestAnimationFrame(step);
}

// Offscreen-Bild zurücklesen und als PNG liefern
async function readOut(enc) {
  const w = RS.w, h = RS.h, bpr = Math.ceil(w * 4 / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  enc.copyTextureToBuffer({ texture: RS.out }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
  buf.unmap(); buf.destroy();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

// Schnittstelle für Tests und Bildschirmfotos
const planetsApi = {
  S, get busy() { return jobs.length > 0 || regenBusy > 0; },
  set(k, v) { S[k] = v; if (k === 'style') { buildUI(); regenerate(); } else if (k === 'seed') newSeed(v); else changed({ k }); buildUI(); },
  async finish() {
    while (regenBusy > 0 || jobs.length) {
      if (regenBusy > 0) { await new Promise((r) => setTimeout(r, 20)); continue; }
      const enc = device.createCommandEncoder();
      runJobs(enc, Infinity);
      device.queue.submit([enc.finish()]);
    }
    await device.queue.onSubmittedWorkDone();
  },
  shot(opt = {}) {
    if (opt.spin !== undefined) spin = opt.spin;
    if (opt.time !== undefined) simTime = opt.time;
    if (opt.yaw !== undefined) cam.yaw = opt.yaw;
    if (opt.pitch !== undefined) cam.pitch = opt.pitch;
    // Kamera auf das Zentrum der Milchstraße richten (für Testbilder)
    if (opt.core && RS.galCore) { const c = RS.galCore; cam.yaw = Math.atan2(-c[0], -c[2]); cam.pitch = clamp(Math.asin(-c[1]), -1.45, 1.45); }
    if (opt.dist !== undefined) { cam.dist = cam.tDist = opt.dist; cam.zoomed = true; }
    else if (!cam.zoomed) { cam.dist = cam.tDist = fitDist(canvas.width / canvas.height); }
    const enc = device.createCommandEncoder();
    render(enc);
    if (!OFFSCREEN) { device.queue.submit([enc.finish()]); return canvas.toDataURL('image/png'); }
    return readOut(enc);
  },
};

S.sea = S.sea < 0 ? PP.water : S.sea;
if (!Q.get('cover')) S.cover = PP.cloudCover;
buildUI();
// Start, sobald alle Pipelines übersetzt sind
async function boot() {
  await initGPU();
  makeLayouts();
  const { list, mods } = startPipelines();
  const names = Object.keys(list);
  let done = 0;
  const show = () => {
    $('genbar').hidden = false;
    $('gen-text').textContent = `${t('Übersetze Shader', 'Compiling shaders')} ${done}/${names.length}`;
    $('gen-fill').style.width = `${100 * done / names.length}%`;
  };
  show();
  try {
    const res = await Promise.all(names.map((k) => list[k].then((p) => { done++; show(); return p; })));
    P = Object.fromEntries(names.map((k, i) => [k, res[i]]));
  } catch (e) {
    const msgs = [];
    for (const [k, m] of Object.entries(mods)) {
      const info = await m.getCompilationInfo();
      for (const x of info.messages) if (x.type === 'error') msgs.push(`${k}:${x.lineNum}:${x.linePos} ${x.message}`);
    }
    console.error(msgs.join('\n'));
    fail('Shader: ' + (msgs.slice(0, 6).join('\n') || String(e.message || e)));
  }
  initResources();
  window.planets = planetsApi;
  regenerate();
  requestAnimationFrame(step);
}
boot().catch((e) => { if (!$('status').textContent) fail(String(e.message || e)); });
