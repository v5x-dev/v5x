import { rounds } from "./constants.js";
import type { Alliance, IdInfo, Match } from "./types.js";

export interface MatchOutcome {
  winner: Alliance;
  loser: Alliance;
}

export type TeamOutcome = "win" | "loss" | "tie" | "unscored";

export interface MatchTeamsOptions {
  includeSitting?: boolean;
}

export function getAlliance(
  match: Match,
  color: Alliance["color"],
): Alliance | undefined {
  return match.alliances.find((alliance) => alliance.color === color);
}

export function getMatchOutcome(match: Match): MatchOutcome | null {
  if (!match.scored) return null;

  const red = getAlliance(match, "red");
  const blue = getAlliance(match, "blue");
  if (red === undefined || blue === undefined || red.score === blue.score) {
    return null;
  }

  return red.score > blue.score
    ? { winner: red, loser: blue }
    : { winner: blue, loser: red };
}

export function getTeamOutcome(
  match: Match,
  teamNumber: string,
): TeamOutcome | null {
  const alliance = match.alliances.find((candidate) =>
    candidate.teams.some((entry) => entry.team?.name === teamNumber),
  );
  if (alliance === undefined) return null;
  if (!match.scored) return "unscored";

  const red = getAlliance(match, "red");
  const blue = getAlliance(match, "blue");
  if (red === undefined || blue === undefined) return null;
  if (red.score === blue.score) return "tie";

  const outcome = getMatchOutcome(match);
  if (outcome === null) return null;
  return outcome.winner.color === alliance.color ? "win" : "loss";
}

export function getMatchTeams(
  match: Match,
  options: MatchTeamsOptions = {},
): IdInfo[] {
  return match.alliances.flatMap((alliance) =>
    alliance.teams.flatMap((entry) => {
      if (entry.team === undefined) return [];
      if (!options.includeSitting && entry.sitting === true) return [];
      return [entry.team];
    }),
  );
}

export function getMatchShortName(match: Match): string {
  const instanceMatch = `${match.instance}-${match.matchnum}`;
  switch (match.round) {
    case rounds.practice:
      return `P ${match.matchnum}`;
    case rounds.qualification:
      return `Q ${match.matchnum}`;
    case rounds.quarterfinals:
      return `QF ${instanceMatch}`;
    case rounds.semifinals:
      return `SF ${instanceMatch}`;
    case rounds.finals:
      return `F ${instanceMatch}`;
    case rounds.roundOf16:
      return `R16 ${instanceMatch}`;
    case rounds.topN:
      return `F ${match.matchnum}`;
    case rounds.roundRobin:
      return `RR ${instanceMatch}`;
    default:
      return match.name;
  }
}
