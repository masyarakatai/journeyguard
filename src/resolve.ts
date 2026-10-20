import type { Config, JourneyConfig, Language, ResolvedJourney, ResolvedSite, SiteConfig, Stage } from './types.js';
import { PRESETS } from './presets/index.js';
import { describeStep } from './steps.js';
import { ConfigError } from './config.js';
import { parseDuration, slugify } from './util.js';

/**
 * Stable identity of a journey, used for its history and alert state. It depends only on the
 * journey's own definition (name, or preset plus the option that tells two of them apart), never
 * on its position in the file or on whether other journeys are enabled.
 */
export function journeyKey(j: JourneyConfig): string {
  if (j.name) return j.name;
  const o = j.options ?? {};
  const discriminator = [o.path, o.productUrl, o.productHandle].find((v) => typeof v === 'string' && v.trim());
  return discriminator ? `${j.preset} ${String(discriminator)}` : (j.preset ?? 'journey');
}

function resolveJourney(site: SiteConfig, j: JourneyConfig, id: string, fallbackInterval: string, lang: Language): ResolvedJourney {
  let name: string;
  let stages: Stage[];
  let presetInterval: string | undefined;
  let presetRetries: number | undefined;

  if (j.preset) {
    const built = PRESETS[j.preset]!(j.options ?? {}, { name: site.name, url: site.url, lang });
    name = j.name ?? built.name;
    stages = built.stages;
    presetInterval = built.defaultInterval;
    presetRetries = built.defaultRetries;
  } else if (j.stages?.length) {
    name = j.name!;
    stages = j.stages;
  } else {
    name = j.name!;
    // Each step of a flat journey is shown as its own stage, matching how owners think about flows.
    stages = (j.steps ?? []).map((s) => ({ name: describeStep(s), steps: [s] }));
  }

  return {
    id,
    name,
    preset: j.preset,
    stages,
    intervalMs: parseDuration(j.interval ?? presetInterval ?? site.interval ?? fallbackInterval),
    retries: j.retries ?? presetRetries,
  };
}

export function resolveSites(config: Config, filter?: string): ResolvedSite[] {
  const problems: string[] = [];
  const siteIds = new Map<string, string>();
  const resolved = config.sites.map((site) => {
    const id = slugify(site.name);
    if (siteIds.has(id)) problems.push(`sites: "${site.name}" and "${siteIds.get(id)}" would share the id "${id}"; give each site a distinct name`);
    siteIds.set(id, site.name);

    // IDs are assigned to every journey, enabled or not, before anything is filtered out.
    const journeyIds = new Map<string, string>();
    const journeys: ResolvedJourney[] = [];
    site.journeys.forEach((j, i) => {
      const key = journeyKey(j);
      const jid = slugify(key);
      if (journeyIds.has(jid)) {
        problems.push(`sites "${site.name}".journeys[${i}]: two journeys would share the id "${jid}"; give one of them a distinct "name"`);
        return;
      }
      journeyIds.set(jid, key);
      if (j.enabled === false) return;
      journeys.push(resolveJourney(site, j, jid, config.settings.interval, config.settings.language));
    });
    return { id, name: site.name, url: site.url, headers: site.headers ?? {}, journeys };
  });
  if (problems.length) throw new ConfigError(problems);
  return resolved.filter((s) => !filter || s.name.toLowerCase() === filter.toLowerCase() || s.id === slugify(filter));
}
