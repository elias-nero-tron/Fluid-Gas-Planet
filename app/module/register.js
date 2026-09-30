// Liste aller Module und ihrer Versionen. Neue Version = neuer Ordner + eine Zeile hier. Alte Versionen bleiben wählbar.
// Statische Imports: im gebauten Einzeldatei-Stand sind alle Versionen enthalten und sofort wählbar.
import * as gg1 from './gaseous-giganticus/v1/modul.js';
import * as jasper1 from './jasper-r/v1/modul.js';
export const MODULE = {
  'gaseous-giganticus': { name: 'Gasriese: Gaseous Giganticus', versionen: { v1: gg1 } },
  'jasper-r': { name: 'Gasriese: Partikel nach jasper-r', versionen: { v1: jasper1 } },
};
