/**
 * HTML parsing and CSS selectors — behind one façade, on purpose.
 *
 * Nothing else in this repository imports `htmlparser2`, `css-select` or
 * `domutils`. Every adapter goes through the six functions below, so replacing
 * the parser is one file's work rather than six adapters' worth.
 *
 * // gjsify gap (unfixed): `@gjsify/domparser` is an XML parser with a minimal
 * // DOM — `parseFromString` ignores the MIME type, there is no void-element
 * // set, no implicit closing, no raw-text mode and no entity decoding, and
 * // `querySelectorAll` compares tag NAMES only, so `.class` and `[attr]`
 * // return nothing. Measured 2026-08-21 against a real 329 KB results page:
 * // `article` → 27 hits, `.aditem` → 0, `[data-adid]` → 0, and `28&#034;`
 * // came through undecoded. That is why the npm parsers are here.
 * //
 * // The upstream fix is under way (HTML5 tokenizer + selector engine in
 * // @gjsify/domparser). When it lands, this file becomes a thin adapter over
 * // `new DOMParser().parseFromString(html, 'text/html')` and the three npm
 * // dependencies come out — that is the whole reason the façade is this
 * // narrow. Re-measure at the next gjsify bump instead of trusting this note.
 *
 * Measured, not assumed: `htmlparser2@12` + `css-select@7` run unmodified
 * under gjsify/GJS and return byte-identical results to Node on the same
 * input — 27/27 items, entities decoded. `htmlparser2` was chosen over
 * `parse5` on bundle size (107 KB vs 213 KB for the same probe) and over
 * `node-html-parser` because it shares a DOM shape with `css-select` and
 * `domutils` instead of re-implementing selectors itself.
 */

import { selectAll, selectOne } from 'css-select';
import { getAttributeValue, textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';
import type { AnyNode, Document, Element } from 'domhandler';

export type HtmlNode = AnyNode;
export type HtmlElement = Element;
export type HtmlDocument = Document;

export function parseHtml(html: string): HtmlDocument {
  return parseDocument(html);
}

export function queryAll(scope: HtmlNode | HtmlNode[], selector: string): HtmlElement[] {
  return selectAll(selector, scope) as HtmlElement[];
}

export function query(scope: HtmlNode | HtmlNode[], selector: string): HtmlElement | null {
  return selectOne(selector, scope) as HtmlElement | null;
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
  return textContent(node)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function attr(node: HtmlElement | null | undefined, name: string): string | null {
  if (!node) return null;
  return getAttributeValue(node, name) ?? null;
}

/** Text of the first match, or `''`. The shape adapters actually want. */
export function textOf(scope: HtmlNode | HtmlNode[], selector: string): string {
  return text(query(scope, selector));
}
