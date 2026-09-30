// Editor: zeichnet alle Bedienelemente aus den Beschreibungen der Module. Kein Modul baut eigene Oberfläche.
// Regel-Typen: { k, label, min, max, step } Schieberegler · { k, label, typ: 'haken' } · { label, typ: 'knopf', aktion }
//              · { label, typ: 'datei', aktion(file) }
export function editorStarten(el) {
  el.innerHTML = '<div class="status"></div><div class="fehler"></div><h2>Verfahren</h2><div class="auswahl"></div><div class="quelle"></div><h2>Regler</h2><div class="regler"></div>';
  const [status, fehler, auswahl, quelle, regler] = ['.status', '.fehler', '.auswahl', '.quelle', '.regler'].map((s) => el.querySelector(s));
  const wahl = (label, opts, wert, aendern) => {
    const l = document.createElement('label'); l.className = 'wahl';
    l.innerHTML = `<span>${label}</span><select>${opts.map(([v, t]) => `<option value="${v}"${v === wert ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    l.querySelector('select').onchange = (e) => aendern(e.target.value);
    return l;
  };
  return {
    status: (t) => { status.textContent = t; },
    fehler: (t) => { fehler.textContent = t; },
    // module: [[id, name, [versionen]]]
    auswahlZeigen(module, id, version, aendern) {
      auswahl.replaceChildren(
        wahl('Modul', module.map(([i, n]) => [i, n]), id, (neu) => aendern(neu, module.find((m) => m[0] === neu)[2].at(-1))),
        wahl('Version', module.find((m) => m[0] === id)[2].map((v) => [v, v]), version, (neu) => aendern(id, neu)));
    },
    modulZeigen(info, beschreibung, werte, geaendert) {
      quelle.textContent = `Quelle: ${info.quelle}`;
      regler.replaceChildren(...beschreibung.map((r) => {
        const l = document.createElement('label');
        if (r.typ === 'knopf' || r.typ === 'datei') {
          const b = document.createElement('button'); b.textContent = r.label;
          if (r.typ === 'knopf') b.onclick = r.aktion;
          else {
            const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*'; f.hidden = true;
            f.onchange = (e) => e.target.files[0] && r.aktion(e.target.files[0]);
            b.onclick = () => f.click(); l.append(f);
          }
          l.append(b); return l;
        }
        if (r.typ === 'haken') {
          l.className = 'haken';
          l.innerHTML = `<input type="checkbox"${werte[r.k] ? ' checked' : ''}> ${r.label}`;
          l.querySelector('input').onchange = (e) => { werte[r.k] = e.target.checked; geaendert(r.k); };
          return l;
        }
        l.className = 'regler';
        l.innerHTML = `<span>${r.label}</span><input type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${werte[r.k]}"><output>${werte[r.k]}</output>`;
        const [inp, out] = [l.querySelector('input'), l.querySelector('output')];
        inp.oninput = () => { werte[r.k] = Number(inp.value); out.textContent = inp.value; geaendert(r.k); };
        return l;
      }));
    },
  };
}
