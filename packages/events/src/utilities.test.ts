import { describe, expect, test } from "bun:test";
import {
  getAlliance,
  getEventUrl,
  getMatchOutcome,
  getMatchShortName,
  getMatchTeams,
  getTeamOutcome,
  getTeamUrl,
  programs,
  rounds,
  type Match,
} from "./index.js";

const redTeam = { id: 1, name: "123A" };
const redSitting = { id: 2, name: "123B" };
const blueTeam = { id: 3, name: "456A" };

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: 1,
    event: { id: 1, name: "Event" },
    division: { id: 1, name: "Division" },
    round: rounds.qualification,
    instance: 2,
    matchnum: 3,
    scored: true,
    name: "Qualification 3",
    alliances: [
      {
        color: "red",
        score: 20,
        teams: [{ team: redTeam }, { team: redSitting, sitting: true }, {}],
      },
      { color: "blue", score: 10, teams: [{ team: blueTeam }] },
    ],
    ...overrides,
  };
}

describe("domain constants", () => {
  test("exports stable round and program identifiers", () => {
    expect(rounds).toEqual({
      practice: 1,
      qualification: 2,
      quarterfinals: 3,
      semifinals: 4,
      finals: 5,
      roundOf16: 6,
      topN: 15,
      roundRobin: 16,
    });
    expect(programs).toMatchObject({ V5RC: 1, VIQRC: 41, VAIRC: 57 });
  });
});

describe("URL helpers", () => {
  test("creates encoded event URLs from SKUs and event objects", () => {
    expect(getEventUrl("RE VRC/1")).toBe(
      "https://events.vex.com/RE%20VRC%2F1.html",
    );
    expect(getEventUrl({ sku: "RE-123" })).toBe(
      "https://events.vex.com/RE-123.html",
    );
  });

  test("creates team URLs only when a program code is available", () => {
    expect(
      getTeamUrl({
        number: "123 A",
        program: { id: 1, name: "V5RC", code: "V5RC" },
      }),
    ).toBe("https://events.vex.com/teams/V5RC/123%20A");
    expect(
      getTeamUrl({ number: "123A", program: { id: 1, name: "V5RC" } }),
    ).toBeNull();
    expect(
      getTeamUrl({
        number: "123A",
        program: { id: 1, name: "V5RC", code: "  " },
      }),
    ).toBeNull();
  });
});

describe("match helpers", () => {
  test("finds alliances without asserting they exist", () => {
    expect(getAlliance(match(), "red")?.score).toBe(20);
    expect(getAlliance(match({ alliances: [] }), "blue")).toBeUndefined();
  });

  test("determines decided, tied, unscored, and incomplete outcomes", () => {
    expect(getMatchOutcome(match())?.winner.color).toBe("red");
    expect(
      getMatchOutcome(
        match({
          alliances: [
            { color: "red", score: 10, teams: [] },
            { color: "blue", score: 10, teams: [] },
          ],
        }),
      ),
    ).toBeNull();
    expect(getMatchOutcome(match({ scored: false }))).toBeNull();
    expect(
      getMatchOutcome(
        match({ alliances: [{ color: "red", score: 10, teams: [] }] }),
      ),
    ).toBeNull();
  });

  test("determines team outcomes and returns null for absent teams", () => {
    expect(getTeamOutcome(match(), "123A")).toBe("win");
    expect(getTeamOutcome(match(), "456A")).toBe("loss");
    expect(getTeamOutcome(match({ scored: false }), "123A")).toBe("unscored");
    expect(
      getTeamOutcome(
        match({
          alliances: [
            { color: "red", score: 10, teams: [{ team: redTeam }] },
            { color: "blue", score: 10, teams: [{ team: blueTeam }] },
          ],
        }),
        "123A",
      ),
    ).toBe("tie");
    expect(getTeamOutcome(match(), "999Z")).toBeNull();
    expect(
      getTeamOutcome(
        match({
          alliances: [{ color: "red", score: 10, teams: [{ team: redTeam }] }],
        }),
        "123A",
      ),
    ).toBeNull();
  });

  test("omits sitting and missing teams by default", () => {
    expect(getMatchTeams(match())).toEqual([redTeam, blueTeam]);
    expect(getMatchTeams(match(), { includeSitting: true })).toEqual([
      redTeam,
      redSitting,
      blueTeam,
    ]);
  });

  test.each([
    [rounds.practice, "P 3"],
    [rounds.qualification, "Q 3"],
    [rounds.quarterfinals, "QF 2-3"],
    [rounds.semifinals, "SF 2-3"],
    [rounds.finals, "F 2-3"],
    [rounds.roundOf16, "R16 2-3"],
    [rounds.topN, "F 3"],
    [rounds.roundRobin, "RR 2-3"],
    [999, "Qualification 3"],
  ])("formats round %p as %s", (round, expected) => {
    expect(getMatchShortName(match({ round }))).toBe(expected);
  });
});
