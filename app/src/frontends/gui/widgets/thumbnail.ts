/**
 * The photograph on a card.
 *
 * This widget is where the Leitplanke that changed on 2026-09-06 actually
 * touches the screen, so the terms of it are repeated here rather than left in
 * AGENTS.md: the bytes come through `HttpClient.image`, which runs the same
 * compliance gate as a search — an opt-out host, a switched-off source and a
 * `Disallow:` on the image path all refuse here too — honours the operator's
 * `Crawl-delay`, and hands back a `Uint8Array`. That array becomes a texture
 * and then a widget. **Nothing writes it anywhere**, and there is no code path
 * in this file that could.
 *
 * Three things it refuses to do, each with a reason that is not style:
 *
 *  - **Change size when the picture arrives.** The box is the same height
 *    empty, loading, loaded and failed. A grid whose cards grow as images land
 *    moves the card under the pointer while somebody is reading it.
 *  - **Look identical for "this ad has no photo" and "the photo did not come".**
 *    The first gets a quiet icon, the second gets nothing but keeps its box.
 *    Same failure class the reports were built against: an absence and a
 *    failure must not render the same.
 *  - **Retry.** A refusal from an image host is a decision, exactly as it is
 *    for a search, and this file has no loop that could turn into one.
 */

import Adw from '@girs/adw-1';
import Gdk from '@girs/gdk-4.0';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import type { Listing, ProviderId } from '@troedler/core';

import type { Context } from '../../../core/context.ts';

/**
 * Decoded textures, keyed by URL and shared by every card in the process.
 *
 * Switching between the grid and the sections rebuilds every card, and a search
 * re-run often returns the same offers. Without this, both would refetch
 * pictures the process is already holding — impolite towards the host and slow
 * for no reason. It is memory only: nothing here is ever written to disk, and
 * the process forgets all of it on exit.
 */
const textures = new Map<string, Gdk.Texture>();

/** Bounded, so a long session over many searches cannot grow without end. */
const MAX_CACHED = 400;

/** URLs already tried and refused, so a failure is not re-requested per rebuild. */
const failed = new Set<string>();

function remember(url: string, texture: Gdk.Texture): void {
  if (textures.size >= MAX_CACHED) {
    // Oldest first — Map keeps insertion order, and the oldest card is the one
    // furthest from what somebody is looking at now.
    const oldest = textures.keys().next();
    if (!oldest.done) textures.delete(oldest.value);
  }
  textures.set(url, texture);
}

export class Thumbnail extends Adw.Bin {
  static {
    GObject.registerClass({ GTypeName: 'TroedlerThumbnail' }, this);
  }

  private readonly clamp = new Adw.Clamp();
  private readonly picture = new Gtk.Picture({
    contentFit: Gtk.ContentFit.COVER,
    canShrink: true,
    hexpand: true,
    vexpand: true,
  });

  constructor(context: Context, listing: Listing, height: number, maxWidth: number) {
    super({ cssClasses: ['offer-thumb'], heightRequest: height, overflow: Gtk.Overflow.HIDDEN });
    // A `Gtk.Picture` reports its paintable's INTRINSIC width as its natural
    // width, and a homogeneous `Gtk.FlowBox` sizes every child to the widest
    // natural width it can find. One 1600 px eBay photograph therefore made
    // every card 450 px wide and the grid two columns — measured, not guessed:
    // the first build of this screen showed two tiles at 980 px where four fit.
    // `Adw.Clamp` is what caps a natural width in this toolkit.
    this.clamp.set_maximum_size(maxWidth);

    const url = listing.images[0];
    if (!url) {
      // Said, not left blank: this ad carries no photograph, which is a fact
      // about the ad and not a thing that went wrong.
      this.clamp.set_child(
        new Gtk.Image({
          iconName: 'image-missing-symbolic',
          pixelSize: 32,
          halign: Gtk.Align.CENTER,
          valign: Gtk.Align.CENTER,
          cssClasses: ['dim-label'],
        }),
      );
      this.set_child(this.clamp);
      return;
    }

    this.clamp.set_child(this.picture);
    this.set_child(this.clamp);

    const cached = textures.get(url);
    if (cached) {
      this.picture.set_paintable(cached);
      return;
    }
    if (failed.has(url)) return;

    void this.load(context, url, listing.provider);
  }

  /**
   * Fetch and show, or leave the box as it is.
   *
   * `await` straight through: GJS drains promises on the GTK main loop, so the
   * line after the await is already back on the thread that owns the widget —
   * no `GLib.idle_add`, same as the search itself.
   */
  private async load(context: Context, url: string, provider: ProviderId): Promise<void> {
    try {
      const bytes = await context.http.image(url, { provider, enabled: true });
      // Decoding is where a body that lied about its Content-Type finally shows
      // up, so it is inside the try with the fetch rather than after it.
      const texture = Gdk.Texture.new_from_bytes(bytes);
      remember(url, texture);
      this.picture.set_paintable(texture);
    } catch {
      // Deliberately silent on screen. A grid of eighty cards cannot carry
      // eighty error sentences, and the one place this belongs — a source that
      // is refusing us wholesale — is the source report, which says it already.
      failed.add(url);
    }
  }
}
