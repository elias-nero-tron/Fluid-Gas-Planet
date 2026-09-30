// [G6] Künstliche Wirbel platzieren (Bedingung wörtlich wie im Original). Rückgabe: Daten für den Wirbelpuffer.
function bandTempo(P, lat) {
  const c = Math.cos(lat * P.bands);
  return ((1 - P.poleAtt) + P.poleAtt * Math.cos(lat)) * Math.sign(c) * Math.abs(c) ** P.bandPower * P.bandFactor;
}
export function wirbelErzeugen(P) {
  const out = new Float32Array(200 * 4);
  const n = Math.min(200, Math.round(P.vortices));
  const rs = () => (2 * Math.random() - 1) * (2 * Math.random() - 1);
  for (let k = 0; k < n; k++) {
    let p, r, lat, tries = 0;
    do {
      const z = 1 - 2 * Math.random(), ph = 2 * Math.PI * Math.random(), s = Math.sqrt(1 - z * z);
      p = [s * Math.cos(ph), z, s * Math.sin(ph)];
      r = P.vortexSize + rs() * P.vortexVar;
      lat = Math.asin(p[1]);
    } while (P.bands > 0 && Math.abs(bandTempo(P, lat)) > P.vortexThresh * P.bandFactor && Math.abs(lat) > 15 * Math.PI / 180 && ++tries < 10000);
    const cw = P.bands > 0 ? bandTempo(P, lat + 0.05) < bandTempo(P, lat - 0.05) : Math.random() > 0.5;
    out.set([...p, cw ? Math.abs(r) : -Math.abs(r)], k * 4);
  }
  return { daten: out, n };
}
