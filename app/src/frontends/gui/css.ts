/**
 * The app stylesheet — deliberately almost empty.
 *
 * Adwaita already knows what a card, a dim label and an error look like, and
 * every colour this app needs is a named Adwaita class (`error`, `warning`,
 * `accent`) rather than a hex value of its own. A palette here would be a second
 * definition of "this source failed" living next to the sentence that says so.
 *
 * What is left is the one thing Adwaita has no class for: prices lining up.
 */
export const APP_CSS = `
.numeric {
  font-feature-settings: "tnum" 1;
  font-family: monospace;
}
`;
