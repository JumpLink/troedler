/**
 * The window: two views, a switcher, and nothing between them.
 *
 *   Adw.ToolbarView
 *   ├─ HeaderBar [ ViewSwitcher: Suche · Quellen ]        [ ⚙ ]
 *   └─ Adw.ViewStack
 *      ├─ Suche    — cards, as a grid or grouped by source, settling as each answers
 *      └─ Quellen  — the switches, and the refusal that guards two of them
 *
 * Two views take a switcher, not a sidebar. `createNavShell` from
 * @gjsify/adwaita-app is the right thing the day a third view lands; for two it
 * would spend a third of the width on a list of two words.
 *
 * The sources view probes the network to fill in "bereit" versus "an, aber
 * nicht konfiguriert", so it is refreshed when it is first shown rather than at
 * startup — opening the app should not fire a keyset check at eBay.
 */

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import type { ResultLayout } from '@troedler/store';

import type { Context } from '../../core/context.ts';
import { APP_NAME } from './constants.ts';
import { ProvidersView } from './views/providers-view.ts';
import { SearchView } from './views/search-view.ts';
import { SettingsDialog } from './views/settings-dialog.ts';

export class MainWindow extends Adw.ApplicationWindow {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerWindow' }, this);
  }

  private readonly stack = new Adw.ViewStack();
  private readonly providersView: ProvidersView;
  private providersLoaded = false;

  constructor(
    app: Adw.Application,
    context: Context,
    hooks: { view?: string; query?: string; layout?: ResultLayout },
  ) {
    super({ application: app, title: APP_NAME, defaultWidth: 980, defaultHeight: 720 });

    this.providersView = new ProvidersView(context);
    const searchView = new SearchView(context);

    this.stack.add_titled_with_icon(searchView, 'suche', 'Suche', 'system-search-symbolic');
    this.stack.add_titled_with_icon(this.providersView, 'quellen', 'Quellen', 'network-server-symbolic');

    const header = new Adw.HeaderBar();
    header.set_title_widget(new Adw.ViewSwitcher({ stack: this.stack, policy: Adw.ViewSwitcherPolicy.WIDE }));

    // A settings button rather than a hamburger: there is exactly one thing in
    // there, and a menu whose only entry is „Einstellungen" is a click in front
    // of a click.
    const settings = new Gtk.Button({
      iconName: 'preferences-system-symbolic',
      tooltipText: 'Einstellungen',
    });
    settings.connect('clicked', () => {
      // The dialog writes the config and reloads the context; the window is
      // what knows which view has to re-lay itself afterwards.
      new SettingsDialog(context, (layout) => searchView.setLayout(layout)).present(this);
    });
    header.pack_end(settings);

    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(header);
    toolbar.set_content(this.stack);

    // A bottom switcher for narrow windows, which is the Adwaita answer to the
    // wide one running out of room rather than a second navigation.
    const bottom = new Adw.ViewSwitcherBar({ stack: this.stack });
    toolbar.add_bottom_bar(bottom);
    const breakpoint = Adw.Breakpoint.new(Adw.BreakpointCondition.parse('max-width: 600px'));
    breakpoint.add_setter(bottom, 'reveal', true);
    breakpoint.add_setter(header.get_title_widget()!, 'visible', false);
    this.add_breakpoint(breakpoint);

    // The query bar used to stack under a breakpoint, and the breakpoint is gone
    // rather than moved: the row no longer needs one. It carried five controls
    // beside the entry, and below 700 px the entry absorbed the whole deficit and
    // rendered the query as the `⊗` clear glyph — 57 px of entry and 13 px of
    // inner `GtkText` at 600 px, measured. The fix the stack came with was right
    // about the width and wrong about the height: six rows of controls, a
    // full-width „Suchen", a full-width „Stopp" and then a per-source block of
    // seven lines, which is nearly all of a 600 px window with no results on it.
    //
    // The filters now live in a popover, so what is left beside the entry is a
    // 34 px filter button and one run button — 156 px between them, against the
    // 509 px the five controls asked for. That is why no breakpoint is needed
    // here and why `width-chars: 12` on the entry is a floor that holds from
    // 360 px upwards instead of a floor that only holds once the row has room.
    // The 600 px breakpoint above is the Adwaita one (bottom switcher) and is
    // about navigation, not about the entry.

    this.set_content(toolbar);

    this.stack.connect('notify::visible-child-name', () => this.onViewShown());
    if (hooks.view) this.stack.set_visible_child_name(hooks.view);
    this.onViewShown();
    if (hooks.query) searchView.runQuery(hooks.query);
    // AFTER the query, deliberately: this is the re-lay path the settings dialog
    // triggers, and re-laying nothing would prove nothing.
    if (hooks.layout) searchView.setLayout(hooks.layout);
  }

  private onViewShown(): void {
    if (this.stack.get_visible_child_name() !== 'quellen' || this.providersLoaded) return;
    this.providersLoaded = true;
    void this.providersView.refresh();
  }
}
