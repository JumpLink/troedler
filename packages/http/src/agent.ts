/**
 * The user agent — honest, identifiable, contactable.
 *
 * This is a design decision with consequences, not a formality.
 *
 * We do NOT pretend to be Chrome. Spoofing a browser is the first move of
 * "circumventing a technical measure", which is the line that separates a
 * tolerated read from an actionable one, and it is the one line this project
 * will not cross. It also costs nothing worth having: fetching a public search
 * page slowly under a truthful name is not a thing operators are trying to
 * stop.
 *
 * It buys something concrete, too. Several German classified sites name
 * specific bots in robots.txt and grant them access — a permission a
 * generic spoofed Chrome string throws away.
 *
 * And it makes an objection possible. The URL in the string is how an operator
 * who does not want us reaches us; without it, the opt-out list in
 * @troedler/compliance could never be filled in.
 */

export const PROJECT_URL = 'https://github.com/JumpLink/troedler';

export function userAgent(version: string): string {
  return `troedler/${version} (+${PROJECT_URL})`;
}

/**
 * Headers every request carries.
 *
 * `Accept-Encoding` omits `br` deliberately: gjsify's fetch decodes gzip and
 * deflate but has no Brotli codec, and advertising an encoding we cannot
 * decode earns a body we cannot read.
 */
export function baseHeaders(version: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': userAgent(version),
    'Accept-Language': 'de-DE,de;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    ...extra,
  };
}
