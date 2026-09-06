/**
 * The app stylesheet — shape only, never colour.
 *
 * Adwaita already knows what a card, a dim label and an error look like, and
 * every colour this app needs is either a named Adwaita class (`error`,
 * `warning`, `accent`) or one of libadwaita's own named colours. A palette here
 * would be a second definition of "this source failed" living next to the
 * sentence that says so — and it would be the definition that stops following
 * the system when somebody switches to dark.
 *
 * So what is below is geometry: how big a card is, where its picture sits, how
 * the grid breathes. Those have no equivalent in the platform stylesheet
 * because they are this app's own proportions.
 */
export const APP_CSS = `
.numeric {
  font-feature-settings: "tnum" 1;
  font-family: monospace;
}

/* One offer. The picture is flush to three edges; the text block below it does
   the breathing, so a wall of cards reads as a wall of PHOTOS with captions
   rather than a table that happens to have images in it. */
.offer-card {
  /* A GtkButton brings its own padding, and it put a border of card-coloured
     nothing between the photograph and the card's edge. A picture that stops
     short of its own frame is the detail that makes a grid look unfinished. */
  padding: 0;
  border-radius: 12px;
  background-color: @card_bg_color;
  box-shadow: 0 1px 2px transparent;
  transition: box-shadow 150ms ease, background-color 150ms ease;
}

.offer-card:hover {
  box-shadow: 0 2px 8px alpha(black, 0.14);
}

/* The picture keeps its box whether or not anything arrived: a card that grows
   when its image lands makes the whole grid jump under the pointer, and a card
   that has no box for one hides the difference between "no photo in this ad"
   and "the photo has not come yet". */
.offer-thumb {
  border-radius: 12px 12px 0 0;
  background-color: alpha(@window_fg_color, 0.06);
  min-height: 168px;
}

.offer-body {
  padding: 10px 12px 12px 12px;
}

.offer-price {
  font-size: 1.15em;
  font-weight: 700;
}

/* The market a row came from, as a quiet pill. In the grid it is the only thing
   standing between a 40 € card and a 120 € one, so it is never dimmed away. */
/* Sits ON the photograph, so it carries its own ground rather than borrowing
   the card's — over a white product shot a translucent light pill is invisible,
   and over a dark one a dark pill is. */
.offer-source {
  padding: 2px 9px;
  border-radius: 999px;
  background-color: alpha(@window_bg_color, 0.85);
  color: @window_fg_color;
  font-size: 0.82em;
  font-weight: 600;
}

.offer-grid {
  padding: 4px;
}

/* The band of numbers under a source heading. Monospaced digits so the
   quartiles line up column-wise between one source block and the next. */
.band {
  font-feature-settings: "tnum" 1;
  font-family: monospace;
}
`;
