// Zweisprachigkeit ohne Bibliothek: t(deutsch, englisch).
// Standard: Browsersprache (Deutsch bei "de…", sonst Englisch), per Knopf umschaltbar.

export type Lang = 'en' | 'de';

function initial(): Lang {
  try {
    const saved = localStorage.getItem('fgp-lang');
    if (saved === 'en' || saved === 'de') return saved;
  } catch { /* Speicher gesperrt: Browsersprache nehmen */ }
  return (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export let lang: Lang = initial();

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem('fgp-lang', l); } catch { /* egal */ }
  document.documentElement.lang = l;
}

export const t = (de: string, en: string) => (lang === 'de' ? de : en);
