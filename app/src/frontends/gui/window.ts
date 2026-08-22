/**
 * The window: two views, a switcher, and nothing between them.
 *
 *   Adw.ToolbarView
 *   ├─ HeaderBar [ ViewSwitcher: Suche · Quellen ]        [ ☰ ]
 *   └─ Adw.ViewStack
 *      ├─ Suche    — one panel per source, settling as each answers
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

import type { Context } from '../../core/context.ts';
import { APP_NAME } from './constants.ts';
import { ProvidersView } from './views/providers-view.ts';
import { SearchView } from './views/search-view.ts';

export class MainWindow extends Adw.ApplicationWindow {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerWindow' }, this);
  }

  private readonly stack = new Adw.ViewStack();
  private readonly providersView: ProvidersView;
  private providersLoaded = false;

  constructor(app: Adw.Application, context: Context, hooks: { view?: string; query?: string }) {
    super({ application: app, title: APP_NAME, defaultWidth: 980, defaultHeight: 720 });

    this.providersView = new ProvidersView(context);
    const searchView = new SearchView(context);

    this.stack.add_titled_with_icon(searchView, 'suche', 'Suche', 'system-search-symbolic');
    this.stack.add_titled_with_icon(this.providersView, 'quellen', 'Quellen', 'network-server-symbolic');

    const header = new Adw.HeaderBar();
    header.set_title_widget(new Adw.ViewSwitcher({ stack: this.stack, policy: Adw.ViewSwitcherPolicy.WIDE }));

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

    this.set_content(toolbar);

    this.stack.connect('notify::visible-child-name', () => this.onViewShown());
    if (hooks.view) this.stack.set_visible_child_name(hooks.view);
    this.onViewShown();
    if (hooks.query) searchView.runQuery(hooks.query);
  }

  private onViewShown(): void {
    if (this.stack.get_visible_child_name() !== 'quellen' || this.providersLoaded) return;
    this.providersLoaded = true;
    void this.providersView.refresh();
  }
}
