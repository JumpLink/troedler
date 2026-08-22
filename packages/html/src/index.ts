/**
 * HTML parsing and CSS selectors — behind one façade, on purpose.
 *
 * Nothing else in this repository imports a parser. Every adapter goes through
 * the six functions below, so replacing the parser is one file's work rather
 * than six adapters' worth. That was not a hypothetical: this file has now been
 * swapped once, and the swap was one file.
 *
 * It used to wrap `htmlparser2` + `css-select` + `domutils`, because
 * `@gjsify/domparser` was an XML parser with a minimal DOM — `parseFromString`
 * ignored the MIME type, there was no void-element set, no implicit closing, no
 * raw-text mode and no entity decoding, and `querySelectorAll` compared tag
 * NAMES only. Measured 2026-08-21 against a real 329 KB results page:
 * `article` → 27 hits, `.aditem` → 0, `[data-adid]` → 0, and `28&#034;` came
 * through undecoded.
 *
 * That gap was fixed at the core rather than worked around here — an HTML5
 * tokenizer, a tree builder and a real CSS Selectors 4 engine, shipped in
 * gjsify 0.42.0 (PR #1250). So the three npm dependencies are gone and this is
 * a thin adapter over the platform's own parser, which is where it belonged.
 *
 * Re-measured at the bump rather than taken on the release note: the adapters'
 * own suites run against it, and the parsers were additionally compared row by
 * row on live pages from every HTML source — see the swap's commit message.
 */

import { DOMParser, type DOMDocument, type DOMElement, type DOMNode } from '@gjsify/domparser';

export type HtmlNode = DOMNode;
export type HtmlElement = DOMElement;
export type HtmlDocument = DOMDocument;
/**
 * What `query`/`queryAll` accept. `DOMDocument extends DOMElement` upstream, so
 * one type covers a whole document and a subtree alike — which is exactly how
 * the adapters use it.
 */
export type HtmlScope = HtmlElement;

const parser = new DOMParser();

export function parseHtml(html: string): HtmlDocument {
  // `'text/html'` is load-bearing and was the whole bug before: the old parser
  // accepted the argument and ignored it, so every page was read as XML — which
  // nests `<li>` inside one another and spills `<script>` contents into the
  // document text.
  return parser.parseFromString(html, 'text/html') as HtmlDocument;
}

export function queryAll(scope: HtmlElement, selector: string): HtmlElement[] {
  return scope.querySelectorAll(selector);
}

export function query(scope: HtmlElement, selector: string): HtmlElement | null {
  return scope.querySelector(selector);
}

/**
 * Text of a node, whitespace collapsed.
 *
 * Collapsing here rather than at each call site because HTML text is full of
 * newlines and non-breaking spaces that survive `.trim()` and then break a
 * price regex in a way that looks like a parser bug.
 */
export function text(node: HtmlNode | null | undefined): string {
  if (!node) return '';
  return (node.textContent ?? '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function attr(node: HtmlElement | null | undefined, name: string): string | null {
  if (!node) return null;
  return node.getAttribute(name);
}

/** Text of the first match, or `''`. The shape adapters actually want. */
export function textOf(scope: HtmlElement, selector: string): string {
  return text(query(scope, selector));
}

/** True when this node is an element — the check adapters need before narrowing. */
export function isElement(node: HtmlNode | null | undefined): node is HtmlElement {
  return node != null && node.nodeType === 1;
}
