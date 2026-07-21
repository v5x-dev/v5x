import type {
  Alliance,
  AllianceTeam,
  Award,
  Coordinates,
  Division,
  Event,
  IdInfo,
  Location,
  Match,
  NamedLocations,
  PageMeta,
  PaginatedResponse,
  Program,
  Ranking,
  Season,
  Skill,
  Team,
  TeamAwardWinner,
} from "./types.js";

export type Validator<T> = (value: unknown) => value is T;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNull(value: unknown): value is null {
  return value === null;
}

function isOptional(
  object: Record<string, unknown>,
  key: string,
  validate: Validator<unknown>,
): boolean {
  return object[key] === undefined || validate(object[key]);
}

function isNullable<T>(validate: Validator<T>): Validator<T | null> {
  return (value): value is T | null => isNull(value) || validate(value);
}

function isArrayOf<T>(validate: Validator<T>): Validator<T[]> {
  return (value): value is T[] =>
    Array.isArray(value) && value.every((item) => validate(item));
}

function isStringRecord<T>(
  validate: Validator<T>,
): Validator<Record<string, T>> {
  return (value): value is Record<string, T> =>
    isObject(value) && Object.values(value).every((item) => validate(item));
}

function isOneOf<const T extends string>(values: readonly T[]): Validator<T> {
  return (value): value is T =>
    typeof value === "string" && values.includes(value as T);
}

const isOptionalString = (object: Record<string, unknown>, key: string) =>
  isOptional(object, key, isString);
const isOptionalNullableString = (
  object: Record<string, unknown>,
  key: string,
) => isOptional(object, key, isNullable(isString));
const isOptionalNumber = (object: Record<string, unknown>, key: string) =>
  isOptional(object, key, isNumber);
const isOptionalBoolean = (object: Record<string, unknown>, key: string) =>
  isOptional(object, key, isBoolean);

const isEventLevel = isOneOf([
  "World",
  "National",
  "Regional",
  "State",
  "Signature",
  "Other",
] as const);
const isEventType = isOneOf([
  "tournament",
  "league",
  "workshop",
  "virtual",
] as const);
const isGrade = isOneOf([
  "College",
  "High School",
  "Middle School",
  "Elementary School",
] as const);
const isSkillType = isOneOf([
  "driver",
  "programming",
  "package_delivery_time",
] as const);

function isCoordinates(value: unknown): value is Coordinates {
  return (
    isObject(value) &&
    isOptionalNumber(value, "lat") &&
    isOptionalNumber(value, "lon")
  );
}

function isLocation(value: unknown): value is Location {
  return (
    isObject(value) &&
    isOptionalString(value, "venue") &&
    isOptionalString(value, "address_1") &&
    isOptionalNullableString(value, "address_2") &&
    isOptionalString(value, "city") &&
    isOptionalNullableString(value, "region") &&
    isOptionalNullableString(value, "postcode") &&
    isOptionalString(value, "country") &&
    isOptional(value, "coordinates", isCoordinates)
  );
}

const isNamedLocations = isStringRecord(
  isLocation,
) satisfies Validator<NamedLocations>;

export function isIdInfo(value: unknown): value is IdInfo {
  return (
    isObject(value) &&
    isNumber(value.id) &&
    isString(value.name) &&
    isOptional(value, "code", isNullable(isString))
  );
}

function isDivision(value: unknown): value is Division {
  return (
    isObject(value) &&
    isOptionalNumber(value, "id") &&
    isOptionalString(value, "name") &&
    isOptionalNumber(value, "order")
  );
}

export function isEvent(value: unknown): value is Event {
  return (
    isObject(value) &&
    isNumber(value.id) &&
    isString(value.sku) &&
    isString(value.name) &&
    isIdInfo(value.season) &&
    isIdInfo(value.program) &&
    isLocation(value.location) &&
    isOptionalString(value, "start") &&
    isOptionalString(value, "end") &&
    isOptional(value, "locations", isNamedLocations) &&
    isOptional(value, "divisions", isArrayOf(isDivision)) &&
    isOptional(value, "level", isEventLevel) &&
    isOptionalBoolean(value, "ongoing") &&
    isOptionalBoolean(value, "awards_finalized") &&
    isOptional(value, "event_type", isNullable(isEventType))
  );
}

export function isProgram(value: unknown): value is Program {
  return (
    isObject(value) &&
    isOptionalNumber(value, "id") &&
    isOptionalString(value, "abbr") &&
    isOptionalString(value, "name")
  );
}

export function isTeam(value: unknown): value is Team {
  return (
    isObject(value) &&
    isNumber(value.id) &&
    isString(value.number) &&
    isIdInfo(value.program) &&
    isOptionalString(value, "team_name") &&
    isOptionalString(value, "robot_name") &&
    isOptionalString(value, "organization") &&
    isOptional(value, "location", isLocation) &&
    isOptionalBoolean(value, "registered") &&
    isOptional(value, "grade", isGrade)
  );
}

function isAllianceTeam(value: unknown): value is AllianceTeam {
  return (
    isObject(value) &&
    isOptional(value, "team", isIdInfo) &&
    isOptionalBoolean(value, "sitting")
  );
}

function isAlliance(value: unknown): value is Alliance {
  return (
    isObject(value) &&
    isOneOf(["red", "blue"] as const)(value.color) &&
    isNumber(value.score) &&
    isArrayOf(isAllianceTeam)(value.teams)
  );
}

export function isMatch(value: unknown): value is Match {
  return (
    isObject(value) &&
    isNumber(value.id) &&
    isIdInfo(value.event) &&
    isIdInfo(value.division) &&
    isNumber(value.round) &&
    isNumber(value.instance) &&
    isNumber(value.matchnum) &&
    isBoolean(value.scored) &&
    isString(value.name) &&
    isArrayOf(isAlliance)(value.alliances) &&
    isOptionalNullableString(value, "scheduled") &&
    isOptionalString(value, "started") &&
    isOptionalString(value, "field")
  );
}

export function isRanking(value: unknown): value is Ranking {
  return (
    isObject(value) &&
    isOptionalNumber(value, "id") &&
    isOptional(value, "event", isIdInfo) &&
    isOptional(value, "division", isIdInfo) &&
    isOptionalNumber(value, "rank") &&
    isOptional(value, "team", isIdInfo) &&
    isOptionalNumber(value, "wins") &&
    isOptionalNumber(value, "losses") &&
    isOptionalNumber(value, "ties") &&
    isOptionalNumber(value, "wp") &&
    isOptionalNumber(value, "ap") &&
    isOptionalNumber(value, "sp") &&
    isOptionalNumber(value, "high_score") &&
    isOptionalNumber(value, "average_points") &&
    isOptionalNumber(value, "total_points")
  );
}

export function isSkill(value: unknown): value is Skill {
  return (
    isObject(value) &&
    isOptionalNumber(value, "id") &&
    isOptional(value, "event", isIdInfo) &&
    isOptional(value, "team", isIdInfo) &&
    isOptional(value, "type", isSkillType) &&
    isOptional(value, "season", isIdInfo) &&
    isOptional(value, "division", isIdInfo) &&
    isOptionalNumber(value, "rank") &&
    isOptionalNumber(value, "score") &&
    isOptionalNumber(value, "attempts")
  );
}

function isTeamAwardWinner(value: unknown): value is TeamAwardWinner {
  return (
    isObject(value) &&
    isOptional(value, "division", isIdInfo) &&
    isOptional(value, "team", isIdInfo)
  );
}

export function isAward(value: unknown): value is Award {
  return (
    isObject(value) &&
    isOptionalNumber(value, "id") &&
    isOptional(value, "event", isIdInfo) &&
    isOptionalNumber(value, "order") &&
    isOptionalString(value, "title") &&
    isOptional(value, "qualifications", isArrayOf(isString)) &&
    isOptional(
      value,
      "designation",
      isNullable(isOneOf(["tournament", "division"] as const)),
    ) &&
    isOptional(
      value,
      "classification",
      isNullable(
        isOneOf([
          "champion",
          "finalist",
          "semifinalist",
          "quarterfinalist",
        ] as const),
      ),
    ) &&
    isOptional(value, "teamWinners", isArrayOf(isTeamAwardWinner)) &&
    isOptional(value, "individualWinners", isArrayOf(isString))
  );
}

export function isSeason(value: unknown): value is Season {
  return (
    isObject(value) &&
    isOptionalNumber(value, "id") &&
    isOptionalString(value, "name") &&
    isOptional(value, "program", isIdInfo) &&
    isOptionalString(value, "start") &&
    isOptionalString(value, "end") &&
    isOptionalNumber(value, "years_start") &&
    isOptionalNumber(value, "years_end")
  );
}

function isPageMeta(value: unknown): value is PageMeta {
  return (
    isObject(value) &&
    isOptionalNumber(value, "current_page") &&
    isOptionalString(value, "first_page_url") &&
    isOptional(value, "from", isNullable(isNumber)) &&
    isOptionalNumber(value, "last_page") &&
    isOptionalString(value, "last_page_url") &&
    isOptional(value, "next_page_url", isNullable(isString)) &&
    isOptionalString(value, "path") &&
    isOptionalNumber(value, "per_page") &&
    isOptional(value, "prev_page_url", isNullable(isString)) &&
    isOptional(value, "to", isNullable(isNumber)) &&
    isOptionalNumber(value, "total")
  );
}

export function paginated<T>(
  validateItem: Validator<T>,
): Validator<PaginatedResponse<T>> {
  return (value): value is PaginatedResponse<T> =>
    isObject(value) &&
    isArrayOf(validateItem)(value.data) &&
    isPageMeta(value.meta);
}
