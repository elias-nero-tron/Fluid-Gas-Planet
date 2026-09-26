import { t } from './i18n';

// Kleines Reglerpanel ohne Abhängigkeiten. Jeder Regler hat einen Erklärtext, der im
// Kasten "Was passiert hier?" erscheint, sobald man den Regler berührt.

type Settings = Record<string, number | string | boolean>;

interface Binding { key: string; update: () => void; row: HTMLElement }

export class Panel {
  private bindings: Binding[] = [];
  private body: HTMLElement;
  private help: HTMLElement;
  private current: HTMLElement | null = null;

  constructor(
    root: HTMLElement,
    private s: Settings,
    private onChange: (key: string) => void,
    private defaults?: Settings,
  ) {
    this.help = document.createElement('p');
    this.help.className = 'help';
    this.help.id = 'help';
    this.help.textContent = t('Tippe oder fahre über einen Regler, um zu sehen, was er in der Simulation verändert.', 'Tap or hover a control to see what it changes in the simulation.');
    this.body = document.createElement('div');
    this.body.className = 'controls';
    root.append(this.help, this.body);
  }

  section(title: string, note?: string, open = true): this {
    const d = document.createElement('details');
    d.open = open;
    const sum = document.createElement('summary');
    sum.textContent = title;
    d.append(sum);
    if (note) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = note;
      d.append(p);
    }
    this.body.append(d);
    this.current = d;
    return this;
  }

  private row(key: string, label: string, hint: string): { row: HTMLElement; lab: HTMLLabelElement; out: HTMLOutputElement } {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.htmlFor = `ctl-${key}`;
    lab.textContent = label;
    const out = document.createElement('output');
    out.htmlFor = `ctl-${key}`;
    row.append(lab, out);
    const reset = this.defaults && key in this.defaults ? t(' Doppelklick auf den Namen setzt nur diesen Regler zurück.', ' Double-click the name to reset just this control.') : '';
    const show = () => { this.help.innerHTML = `<b>${label}.</b> ${hint}<span class="reset-hint">${reset}</span>`; };
    // Doppelklick auf den Namen: nur diesen Regler auf den Standard zurücksetzen
    lab.addEventListener('dblclick', (e) => {
      if (!this.defaults || !(key in this.defaults)) return;
      e.preventDefault();
      this.s[key] = this.defaults[key];
      this.refresh();
      this.onChange(key);
    });
    row.addEventListener('pointerenter', show);
    row.addEventListener('focusin', show);
    row.addEventListener('pointerdown', show);
    (this.current ?? this.body).append(row);
    return { row, lab, out };
  }

  range(key: string, label: string, min: number, max: number, step: number, hint: string, fmt: (v: number) => string = (v) => String(v)): this {
    const { row, out } = this.row(key, label, hint);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `ctl-${key}`;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    row.append(input);
    const update = () => { input.value = String(this.s[key]); out.textContent = fmt(Number(this.s[key])); };
    input.addEventListener('input', () => { this.s[key] = Number(input.value); out.textContent = fmt(Number(input.value)); this.onChange(key); });
    this.bindings.push({ key, update, row });
    update();
    return this;
  }

  select(key: string, label: string, options: [string, string][], hint: string): this {
    const { row, out } = this.row(key, label, hint);
    out.remove();
    const sel = document.createElement('select');
    sel.id = `ctl-${key}`;
    for (const [value, text] of options) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      sel.append(o);
    }
    row.classList.add('row-select');
    row.append(sel);
    const update = () => { sel.value = String(this.s[key]); };
    sel.addEventListener('change', () => {
      const num = Number(sel.value);
      this.s[key] = typeof this.s[key] === 'number' && !Number.isNaN(num) ? num : sel.value;
      this.onChange(key);
    });
    this.bindings.push({ key, update, row });
    update();
    return this;
  }

  toggle(key: string, label: string, hint: string): this {
    const { row, lab, out } = this.row(key, label, hint);
    out.remove();
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `ctl-${key}`;
    row.classList.add('row-toggle');
    lab.prepend(input);
    const update = () => { input.checked = Boolean(this.s[key]); };
    input.addEventListener('change', () => { this.s[key] = input.checked; this.onChange(key); });
    this.bindings.push({ key, update, row });
    update();
    return this;
  }

  buttons(items: [string, string, () => void][], hints: Record<string, string> = {}): this {
    const row = document.createElement('div');
    row.className = 'row row-buttons';
    for (const [id, text, fn] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = id;
      b.textContent = text;
      b.addEventListener('click', fn);
      if (hints[id]) {
        const show = () => { this.help.innerHTML = `<b>${text}.</b> ${hints[id]}`; };
        b.addEventListener('pointerenter', show);
        b.addEventListener('focus', show);
      }
      row.append(b);
    }
    (this.current ?? this.body).append(row);
    return this;
  }

  file(id: string, label: string, hint: string, onFile: (f: File) => void): this {
    const { row, lab, out } = this.row(id, label, hint);
    out.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.id = `ctl-${id}`;
    input.className = 'file';
    lab.htmlFor = input.id;
    row.classList.add('row-file');
    row.append(input);
    input.addEventListener('change', () => { if (input.files?.[0]) onFile(input.files[0]); input.value = ''; });
    return this;
  }

  /** Beliebiges eigenes Element in den aktuellen Abschnitt setzen. */
  custom(el: HTMLElement): this {
    (this.current ?? this.body).append(el);
    return this;
  }

  /** Blendet Regler ein/aus, z. B. Partikel-Regler nur im Partikel-Modus. */
  visible(key: string, on: boolean) {
    for (const b of this.bindings) if (b.key === key) b.row.hidden = !on;
  }

  refresh() {
    for (const b of this.bindings) b.update();
  }
}
