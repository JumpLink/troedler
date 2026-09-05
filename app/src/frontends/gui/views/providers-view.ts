/**
 * The sources screen — and the one place this project actually refuses.
 *
 * A marketplace whose terms forbid automated access ships OFF. It is still
 * OFFERED, because troedler does not decide for anybody what they may fetch
 * from their own machine — but switching it on is a deliberate act with the
 * operator's clause in front of the person making it, and the date lands in the
 * config. Removing the refusal would make the project ship a terms violation as
 * a default; removing the source would make it decide for the user instead.
 * Neither is ours to do, and this dialog is where that split lives in the GUI.
 *
 * The dialog quotes the clause instead of linking it, for the same reason the
 * CLI does: a warning nobody reads is not a warning. It names who carries the
 * consequence, too — the request goes out from this machine, under this
 * person's address, for their own search.
 */

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import { confirmDialog, errorDialog } from '@gjsify/adwaita-app';

import { sourceFor } from '@troedler/compliance';
import { providerState } from '@troedler/core';

import { listProviders, setProviderEnabled, type ProviderView } from '../../../core/actions/index.ts';
import type { Context } from '../../../core/context.ts';

export class ProvidersView extends Gtk.Box {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerProvidersView' }, this);
  }

  private readonly context: Context;
  private readonly group = new Adw.PreferencesGroup({
    title: 'Quellen',
    description:
      'Quellen, deren Nutzungsbedingungen automatisierten Abruf untersagen, sind aus. Wer sie einschaltet, ruft sie im eigenen Namen ab.',
  });
  private readonly scroller = new Gtk.ScrolledWindow({
    vexpand: true,
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
  });
  /** Set while a switch is being written back, so the refresh does not fight the user. */
  private busy = false;
  private rows: Gtk.Widget[] = [];

  constructor(context: Context) {
    super({ orientation: Gtk.Orientation.VERTICAL });
    this.context = context;

    const clamp = new Adw.Clamp({
      child: this.group,
      marginTop: 12,
      marginBottom: 12,
      marginStart: 12,
      marginEnd: 12,
    });
    this.scroller.set_child(clamp);
    this.append(this.scroller);
  }

  /**
   * Probe every source and redraw.
   *
   * `listProviders` talks to the network for some of them — a keyset check, a
   * quota read — so this is async and the caller decides when to pay for it.
   */
  async refresh(): Promise<void> {
    const views = await listProviders(this.context);
    // `Adw.PreferencesGroup` owns its internal box, so the rows it was given
    // are the only handle on them — hence the list, rather than walking
    // children that are not ours to walk.
    for (const row of this.rows) this.group.remove(row);
    this.rows = views.map((view) => this.buildRow(view));
    for (const row of this.rows) this.group.add(row);
  }

  private buildRow(view: ProviderView): Gtk.Widget {
    const row = new Adw.ExpanderRow({ useMarkup: false });
    row.set_title(view.label);
    row.set_subtitle(
      `${providerState(view)} · ${view.access === 'official-api' ? 'offizielle API' : 'öffentliches HTML'} · ${view.host}`,
    );

    const toggle = new Gtk.Switch({ active: view.enabled, valign: Gtk.Align.CENTER });
    toggle.connect('state-set', (_widget, state: boolean) => {
      void this.toggle(view, state, toggle);
      // The switch's visible state is set by the write-back, not by the click:
      // an acknowledgement the person declines must leave it where it was, and
      // returning `true` here is what stops GTK flipping it on our behalf.
      return true;
    });
    row.add_suffix(toggle);

    // The problem, then the note, then the facts. A source that is off or
    // unconfigured says WHY on the row itself rather than behind the expander,
    // because that is the sentence a person came here to read.
    if (view.problem) row.add_row(this.detail('Problem', view.problem));
    if (view.note) row.add_row(this.detail('Hinweis', view.note));
    row.add_row(this.detail('Filter beim Anbieter', view.serverFilters.join(', ') || '—'));
    row.add_row(this.detail('Sortierung beim Anbieter', view.serverSorts.join(', ') || '—'));
    row.add_row(
      this.detail('Grenzen', `höchstens ${view.maxResults} Treffer, Cache ${view.cacheTtlSeconds} s`),
    );
    row.add_row(this.detail('Quellendokument', view.termsDoc));
    if (view.disclaimer) row.add_row(this.detail('Pflichthinweis', view.disclaimer));
    return row;
  }

  /**
   * `Adw.PreferencesRow` parses title and subtitle as Pango markup by default,
   * and every string these rows carry is a `@troedler/core` sentence written
   * for people. Justiz-Auktion's ends «`troedler show
   * justiz-auktion:<Auktions-ID>`»; Pango read `<Auktions-ID>` as an unclosed
   * tag, refused the WHOLE string, and left the row blank — the explanation
   * somebody opened the expander to read, gone, with nothing but a Gtk-WARNING
   * on a stderr no one watches. A view may choose classes; it does not get to
   * parse a core sentence.
   *
   * `useMarkup` belongs in the constructor, not in a call after it: the parse
   * happens when the text is assigned, so a row built with `subtitle` in its
   * dict has already refused the string before `set_use_markup(false)` lands.
   * Measured — the warning survived exactly that ordering.
   */
  private detail(title: string, value: string): Adw.ActionRow {
    const row = new Adw.ActionRow({ useMarkup: false });
    row.set_title(title);
    row.set_subtitle(value);
    row.set_subtitle_lines(0);
    row.set_title_lines(0);
    return row;
  }

  private async toggle(view: ProviderView, wanted: boolean, toggle: Gtk.Switch): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // The acknowledgement is asked for HERE rather than inside the action,
      // because the action must stay surface-neutral: the CLI answers it with a
      // flag, this answers it with a dialog, and the rule they both obey is the
      // same one.
      const needsWord =
        wanted && !view.enabledByDefault && !this.context.config.providers[view.id]?.acknowledged;
      if (needsWord && !(await this.acknowledge(view))) {
        toggle.set_active(view.enabled);
        return;
      }
      setProviderEnabled(this.context, view.id, wanted, needsWord);
      // The config on disk changed, and `context.config` is a snapshot taken at
      // startup. Without re-reading it the switch would look right and the next
      // search would ignore it — the exact failure a CLI never sees because it
      // exits.
      this.context.reload();
      await this.refresh();
    } catch (err) {
      await errorDialog(
        this,
        'Die Quelle ließ sich nicht umschalten',
        err instanceof Error ? err.message : String(err),
      );
      toggle.set_active(view.enabled);
    } finally {
      this.busy = false;
    }
  }

  private async acknowledge(view: ProviderView): Promise<boolean> {
    const clause = sourceFor(view.host)?.clause;
    const body = [
      view.note ?? '',
      clause ? `\nKlausel des Anbieters:\n${clause}` : '',
      '\nWer diese Quelle einschaltet, ruft sie vom eigenen Rechner, unter der eigenen Adresse und für die eigene Suche ab — und trägt einen Verstoß gegen diese Bedingungen selbst. troedler stellt die Anfrage nicht von sich aus und trifft die Entscheidung nicht.',
      `\nQuellendokument: ${view.termsDoc}. Das Bestätigungsdatum landet in der Konfiguration.`,
    ]
      .filter(Boolean)
      .join('\n');

    return confirmDialog(this, {
      heading: `${view.label} einschalten?`,
      body,
      confirmLabel: 'Gelesen, einschalten',
      cancelLabel: 'Abbrechen',
      // Destructive styling and a cancel default: the accidental gesture is
      // what this dialog exists for, and handing Enter the "yes" would give the
      // reflex of dismissing a dialog the very decision it is asking about.
      destructive: true,
      defaultResponse: 'cancel',
    });
  }
}
