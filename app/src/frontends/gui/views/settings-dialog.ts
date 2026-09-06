/**
 * The settings, which are one decision and one disclosure.
 *
 * The decision is the layout, and the row says what it costs rather than
 * offering two words and letting somebody find out. A grid over all sources is
 * the easier thing to look at; it also pools an auction's current bid with a
 * dealer's asking price, and the sections layout is the one where the price
 * bands mean anything. Both are honest views of the same results, which is
 * exactly why this is a setting.
 *
 * The disclosure is the photographs. Until 2026-09-06 this program fetched no
 * images at all, and that was a promise printed in its README. It now does, and
 * a person is entitled to read the terms of that in the app rather than in a
 * commit message: which host is contacted, what is kept (nothing), and that the
 * same gate still applies.
 */

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import { layoutOf, type ResultLayout } from '@troedler/store';

import { setResultLayout } from '../../../core/actions/index.ts';
import type { Context } from '../../../core/context.ts';

/** Index in the combo ⟺ the stored value. One list, so they cannot drift. */
const LAYOUTS: readonly ResultLayout[] = ['grid', 'sections'];

export class SettingsDialog extends Adw.PreferencesDialog {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerSettingsDialog' }, this);
  }

  constructor(context: Context, onLayoutChanged: (layout: ResultLayout) => void) {
    super({ title: 'Einstellungen' });

    const page = new Adw.PreferencesPage();

    const results = new Adw.PreferencesGroup({ title: 'Ergebnisse' });
    const layout = new Adw.ComboRow({
      title: 'Anordnung',
      subtitle:
        'Das Raster zeigt alle Treffer zusammen, günstigste zuerst — jede Karte nennt ihren Markt. ' +
        'Sektionen halten die Quellen getrennt; nur dort sind die Preisbänder aussagekräftig, ' +
        'weil ein Auktionsgebot und ein Forderungspreis nicht dieselbe Art Zahl sind.',
      useMarkup: false,
      model: Gtk.StringList.new(['Raster über alle Quellen', 'Sektionen je Quelle']),
    });
    layout.set_subtitle_lines(0);
    layout.set_selected(LAYOUTS.indexOf(layoutOf(context.config)));
    layout.connect('notify::selected', () => {
      const chosen = LAYOUTS[layout.get_selected()];
      if (!chosen) return;
      setResultLayout(context, chosen);
      onLayoutChanged(chosen);
    });
    results.add(layout);
    page.add(results);

    const images = new Adw.PreferencesGroup({ title: 'Bilder' });
    const note = new Adw.ActionRow({ useMarkup: false });
    note.set_title('Fotos werden geladen, nie gespeichert');
    note.set_subtitle(
      'Für jede Karte holt Trödler das erste Bild direkt vom Bildserver des Marktplatzes. ' +
        'Dabei gelten dieselben Regeln wie für eine Suche: abgeschaltete Quellen und Hosts, ' +
        'die widersprochen haben, werden nicht angefragt, ein Verbot in der robots.txt wird ' +
        'befolgt, und eine vom Betreiber verlangte Wartezeit wird eingehalten. Die Bilder ' +
        'landen im Fenster und nirgends sonst — nicht auf der Festplatte, nicht in der ' +
        'Datenbank. Der Bildserver sieht dabei, wie jeder Webserver, deine IP-Adresse.',
    );
    note.set_title_lines(0);
    note.set_subtitle_lines(0);
    images.add(note);
    page.add(images);

    this.add(page);
  }
}
