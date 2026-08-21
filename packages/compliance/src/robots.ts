/**
 * robots.txt — parsed and ENFORCED, not consulted.
 *
 * This is a gate in front of every outbound request, and it is the single most
 * load-bearing file in the project. Three reasons, in ascending order of how
 * much they cost to get wrong:
 *
 *  1. It is what the operator actually said. The BGH treated a site's declared
 *     wishes as the yardstick for whether automated retrieval is acceptable.
 *  2. The EDPB's scraping guidance makes respecting it part of the data-
 *     protection balancing test, not merely good manners.
 *  3. On kleinanzeigen.de it is not a formality: the price filter, the radius
 *     filter, the sort order, the private/commercial filter and result pages
 *     from six onward are all disallowed. An adapter that builds those URLs
 *     without asking here is not "slightly impolite", it is doing the thing
 *     the operator explicitly forbade — and it will look like a working
 *     feature until someone reads the traffic.
 *
 * Matching follows Google's specification, which is what operators write
 * against: `*` matches any run of characters, a trailing `$` anchors the end,
 * the LONGEST matching rule wins, and Allow beats Disallow when both match at
 * the same length. Getting the tie-break backwards silently opens paths that
 * were meant to be shut.
 */

export interface RobotsRule {
  readonly allow: boolean;
  readonly pattern: string;
  /** Precompiled matcher — robots.txt files run to thousands of rules. */
  readonly regex: RegExp;
}

export interface RobotsGroup {
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
  readonly crawlDelaySeconds: number | null;
}

export interface Robots {
  readonly groups: readonly RobotsGroup[];
  readonly sitemaps: readonly string[];
  /** Raw body hash, so a changed robots.txt is detectable. */
  readonly fetchedAt: string;
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  // Escape everything, then re-open the one wildcard robots.txt defines.
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

export function parseRobots(body: string, fetchedAt: string): Robots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let crawlDelay: number | null = null;
  // A blank line does NOT end a group, but a User-agent line after rules does.
  // Consecutive User-agent lines share one group — that is how a file gives
  // several bots identical treatment, and splitting them loses the rules for
  // all but the last.
  let expectingAgents = true;

  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules, crawlDelaySeconds: crawlDelay });
    agents = [];
    rules = [];
    crawlDelay = null;
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    switch (field) {
      case 'user-agent':
        if (!expectingAgents) {
          flush();
          expectingAgents = true;
        }
        agents.push(value.toLowerCase());
        break;
      case 'allow':
      case 'disallow': {
        expectingAgents = false;
        // "Disallow:" with an empty value means "nothing is disallowed" and must
        // not become a rule matching every path.
        if (field === 'disallow' && value === '') break;
        if (value === '') break;
        rules.push({ allow: field === 'allow', pattern: value, regex: toRegex(value) });
        break;
      }
      case 'crawl-delay': {
        expectingAgents = false;
        const n = Number.parseFloat(value);
        if (Number.isFinite(n)) crawlDelay = n;
        break;
      }
      case 'sitemap':
        sitemaps.push(value);
        break;
      default:
        break;
    }
  }
  flush();
  return { groups, sitemaps, fetchedAt };
}

/**
 * The group that applies to us.
 *
 * Exact user-agent match first, `*` only as the fallback — a site that names
 * our agent explicitly, whether to grant more or less, means it. Several
 * marketplaces do exactly this for named bots, so picking `*` when a specific
 * group exists would ignore a permission that was deliberately granted.
 */
export function groupFor(robots: Robots, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();
  let wildcard: RobotsGroup | null = null;
  let best: { group: RobotsGroup; length: number } | null = null;

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        wildcard ??= group;
        continue;
      }
      if (ua.includes(agent) && (best === null || agent.length > best.length)) {
        best = { group, length: agent.length };
      }
    }
  }
  return best?.group ?? wildcard;
}

export interface RobotsVerdict {
  readonly allowed: boolean;
  /** The rule that decided it, for the error message and for `robots check`. */
  readonly rule: string | null;
  readonly crawlDelaySeconds: number | null;
}

/**
 * Decide one path. `pathAndQuery` must include the query string — robots
 * patterns routinely match on it.
 */
export function isAllowed(robots: Robots, userAgent: string, pathAndQuery: string): RobotsVerdict {
  const group = groupFor(robots, userAgent);
  if (!group) return { allowed: true, rule: null, crawlDelaySeconds: null };

  let winner: RobotsRule | null = null;
  for (const rule of group.rules) {
    if (!rule.regex.test(pathAndQuery)) continue;
    if (winner === null || rule.pattern.length > winner.pattern.length) {
      winner = rule;
    } else if (rule.pattern.length === winner.pattern.length && rule.allow && !winner.allow) {
      // Equal specificity: Allow wins. Spelling this out because the opposite
      // is the intuitive-looking version, and it fails OPEN in the wrong
      // direction — it would block paths the operator meant to permit, which
      // is the failure you notice, unlike the reverse.
      winner = rule;
    }
  }

  if (winner === null) return { allowed: true, rule: null, crawlDelaySeconds: group.crawlDelaySeconds };
  return {
    allowed: winner.allow,
    rule: `${winner.allow ? 'Allow' : 'Disallow'}: ${winner.pattern}`,
    crawlDelaySeconds: group.crawlDelaySeconds,
  };
}
