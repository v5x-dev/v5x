import type { Event, Team } from "./types.js";

const EVENTS_URL = "https://events.vex.com";

export function getEventUrl(eventOrSku: Pick<Event, "sku"> | string): string {
  const sku = typeof eventOrSku === "string" ? eventOrSku : eventOrSku.sku;
  return `${EVENTS_URL}/${encodeURIComponent(sku)}.html`;
}

export function getTeamUrl(
  team: Pick<Team, "number" | "program">,
): string | null {
  const programCode = team.program.code?.trim();
  if (programCode === undefined || programCode.length === 0) return null;
  return `${EVENTS_URL}/teams/${encodeURIComponent(programCode)}/${encodeURIComponent(team.number)}`;
}
