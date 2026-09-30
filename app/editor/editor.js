// Editor: baut das Menü aus den Beschreibungen der Module mit dem bewährten Reglerpanel (panel.js).
// Kein Modul baut eigene Oberfläche. Regel-Beschreibung eines Moduls:
//   { k, label, min, max, step, abschnitt, hilfe, fx }  Schieberegler
//   { k, label, typ: 'haken', abschnitt, hilfe }         Haken
//   { label, typ: 'knopf', aktion, hilfe }               Knopf
//   { label, typ: 'datei', aktion(file), hilfe }         Bild laden
import { Panel } from './panel.js';

const formel = (fx) => (fx ? `<code class="fx">${fx}</code>` : '');

// Abschnitt „Verfahren“: Modul und Version (gleiche Bauteile/Klassen wie das Panel)
function verfahrenAbschnitt(module, wahl, wechseln) {
  const d = document.createElement('details'); d.open = true;
  d.innerHTML = '<summary>Verfahren</summary><p class="note">Jedes Verfahren ist ein eigenes Modul mit eigener Quelle; ältere Versionen bleiben wählbar.</p>';
  const zeile = (label, opts, wert, aendern) => {
    const row = document.createElement('div'); row.className = 'row row-select wahl';
    const id = `wahl-${label}`;
    row.innerHTML = `<label for="${id}">${label}</label><span></span><select id="${id}">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
    const sel = row.querySelector('select'); sel.value = wert; sel.onchange = () => aendern(sel.value);
    d.append(row);
  };
  zeile('Modul', module.map(([i, n]) => [i, n]), wahl.modul, (v) => wechseln(v, module.find((m) => m[0] === v)[2].at(-1)));
  zeile('Version', module.find((m) => m[0] === wahl.modul)[2].map((v) => [v, v]), wahl.version, (v) => wechseln(wahl.modul, v));
  return d;
}

export function editorStarten(aside) {
  const status = document.getElementById('fps');
  const fehler = document.getElementById('fehler');
  const quelle = document.getElementById('quelle');
  const titel = document.getElementById('titel');
  const toggle = document.getElementById('panel-toggle');
  toggle.onclick = () => { const o = aside.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(o)); };
  let koerper = null;
  return {
    status: (t) => { if (status.textContent !== t) status.textContent = t; },
    fehler: (t) => { fehler.textContent = t; },
    zeigen(module, wahl, info, beschreibung, werte, standard, geaendert, wechseln) {
      titel.textContent = info.name;
      quelle.textContent = `Quelle: ${info.quelle}`;
      koerper?.remove();
      koerper = document.createElement('div');
      aside.append(koerper);
      koerper.append(verfahrenAbschnitt(module, wahl, wechseln));
      const p = new Panel(koerper, werte, geaendert, standard);
      const knoepfe = beschreibung.filter((r) => r.typ === 'knopf' || r.typ === 'datei');
      if (knoepfe.length) {
        p.section('Ablauf');
        const k = beschreibung.filter((r) => r.typ === 'knopf');
        if (k.length) p.buttons(k.map((r, i) => [`knopf-${i}`, r.label, r.aktion]), Object.fromEntries(k.map((r, i) => [`knopf-${i}`, r.hilfe ?? ''])));
        beschreibung.filter((r) => r.typ === 'datei').forEach((r, i) => p.file(`datei-${i}`, r.label, r.hilfe ?? '', r.aktion));
        beschreibung.filter((r) => r.typ === 'haken' && r.abschnitt === 'Ablauf').forEach((r) => p.toggle(r.k, r.label, r.hilfe ?? ''));
      }
      const regler = beschreibung.filter((r) => r.k && !(r.typ === 'haken' && r.abschnitt === 'Ablauf'));
      for (const a of [...new Set(regler.map((r) => r.abschnitt ?? 'Regler'))]) {
        p.section(a);
        for (const r of regler.filter((x) => (x.abschnitt ?? 'Regler') === a)) {
          const hint = `${r.hilfe ?? ''}${formel(r.fx)}`;
          if (r.typ === 'haken') p.toggle(r.k, r.label, hint);
          else p.range(r.k, r.label, r.min, r.max, r.step, hint);
        }
      }
    },
  };
}
