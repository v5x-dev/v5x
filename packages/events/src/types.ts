/** A value accepted by date filters. Strings must use RFC 3339 format. */
export type DateInput = Date | string;

export type EventType = "tournament" | "league" | "workshop" | "virtual";

export type EventLevel =
  | "World"
  | "National"
  | "Regional"
  | "State"
  | "Signature"
  | "Other";

/** Event levels accepted by the API's event-list filters. */
export type EventLevelFilter = Exclude<EventLevel, "Regional">;

export type Grade =
  | "College"
  | "High School"
  | "Middle School"
  | "Elementary School";

export type SkillType = "driver" | "programming" | "package_delivery_time";

/** Skill types accepted by the API's skills-list filters. */
export type SkillTypeFilter = Exclude<SkillType, "package_delivery_time">;

export interface Coordinates {
  lat?: number;
  lon?: number;
}

export interface Location {
  venue?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  region?: string;
  postcode?: string;
  country?: string;
  coordinates?: Coordinates;
}

export type NamedLocations = Record<string, Location>;

export interface IdInfo {
  id: number;
  name: string;
  code?: string | null;
}

export interface Division {
  id?: number;
  name?: string;
  order?: number;
}

export interface Event {
  id: number;
  sku: string;
  name: string;
  start?: string;
  end?: string;
  season: IdInfo;
  program: IdInfo;
  location: Location;
  locations?: NamedLocations[];
  divisions?: Division[];
  level?: EventLevel;
  ongoing?: boolean;
  awards_finalized?: boolean;
  event_type?: EventType;
}

export interface Program {
  id?: number;
  abbr?: string;
  name?: string;
}

export interface Team {
  id: number;
  number: string;
  team_name?: string;
  robot_name?: string;
  organization?: string;
  location?: Location;
  registered?: boolean;
  program: IdInfo;
  grade?: Grade;
}

export interface AllianceTeam {
  team?: IdInfo;
  sitting?: boolean;
}

export interface Alliance {
  color: "red" | "blue";
  score: number;
  teams: AllianceTeam[];
}

export interface Match {
  id: number;
  event: IdInfo;
  division: IdInfo;
  round: number;
  instance: number;
  matchnum: number;
  scheduled?: string;
  started?: string;
  field?: string;
  scored: boolean;
  name: string;
  alliances: Alliance[];
}

export interface Ranking {
  id?: number;
  event?: IdInfo;
  division?: IdInfo;
  rank?: number;
  team?: IdInfo;
  wins?: number;
  losses?: number;
  ties?: number;
  wp?: number;
  ap?: number;
  sp?: number;
  high_score?: number;
  average_points?: number;
  total_points?: number;
}

export interface Skill {
  id?: number;
  event?: IdInfo;
  team?: IdInfo;
  type?: SkillType;
  season?: IdInfo;
  division?: IdInfo;
  rank?: number;
  score?: number;
  attempts?: number;
}

export interface TeamAwardWinner {
  division?: IdInfo;
  team?: IdInfo;
}

export interface Award {
  id?: number;
  event?: IdInfo;
  order?: number;
  title?: string;
  qualifications?: string[];
  designation?: "tournament" | "division" | null;
  classification?:
    | "champion"
    | "finalist"
    | "semifinalist"
    | "quarterfinalist"
    | null;
  teamWinners?: TeamAwardWinner[];
  individualWinners?: string[];
}

export interface Season {
  id?: number;
  name?: string;
  program?: IdInfo;
  start?: string;
  end?: string;
  years_start?: number;
  years_end?: number;
}

export interface ApiErrorBody {
  code?: number;
  message?: string;
}

export interface PageMeta {
  current_page?: number;
  first_page_url?: string;
  from?: number | null;
  last_page?: number;
  last_page_url?: string;
  next_page_url?: string | null;
  path?: string;
  per_page?: number;
  prev_page_url?: string | null;
  to?: number | null;
  total?: number;
}

export interface PaginatedResponse<T> {
  meta: PageMeta;
  data: T[];
}

export interface PaginationOptions {
  /** One-indexed page number. */
  page?: number;
  /** Number of results per page. The API maximum is 250. */
  perPage?: number;
}

export interface ListEventsOptions extends PaginationOptions {
  ids?: readonly number[];
  skus?: readonly string[];
  teams?: readonly number[];
  seasons?: readonly number[];
  start?: DateInput;
  end?: DateInput;
  region?: string;
  levels?: readonly EventLevelFilter[];
  myEvents?: boolean;
  eventTypes?: readonly EventType[];
}

export interface ListEventTeamsOptions extends PaginationOptions {
  numbers?: readonly string[];
  registered?: boolean;
  grades?: readonly Grade[];
  countries?: readonly string[];
  myTeams?: boolean;
}

export interface ListEventSkillsOptions extends PaginationOptions {
  teams?: readonly number[];
  types?: readonly SkillTypeFilter[];
}

export interface ListEventAwardsOptions extends PaginationOptions {
  teams?: readonly number[];
  winners?: readonly string[];
}

export interface ListDivisionMatchesOptions extends PaginationOptions {
  teams?: readonly number[];
  rounds?: readonly number[];
  instances?: readonly number[];
  matchNumbers?: readonly number[];
}

export interface ListDivisionRankingsOptions extends PaginationOptions {
  teams?: readonly number[];
  ranks?: readonly number[];
}

export interface ListTeamsOptions extends PaginationOptions {
  ids?: readonly number[];
  numbers?: readonly string[];
  events?: readonly number[];
  registered?: boolean;
  programs?: readonly number[];
  grades?: readonly Grade[];
  countries?: readonly string[];
  myTeams?: boolean;
}

export interface ListTeamEventsOptions extends PaginationOptions {
  skus?: readonly string[];
  seasons?: readonly number[];
  start?: DateInput;
  end?: DateInput;
  levels?: readonly EventLevelFilter[];
}

export interface ListTeamMatchesOptions extends PaginationOptions {
  events?: readonly number[];
  seasons?: readonly number[];
  rounds?: readonly number[];
  instances?: readonly number[];
  matchNumbers?: readonly number[];
}

export interface ListTeamRankingsOptions extends PaginationOptions {
  events?: readonly number[];
  ranks?: readonly number[];
  seasons?: readonly number[];
}

export interface ListTeamSkillsOptions extends PaginationOptions {
  events?: readonly number[];
  types?: readonly SkillTypeFilter[];
  seasons?: readonly number[];
}

export interface ListTeamAwardsOptions extends PaginationOptions {
  events?: readonly number[];
  seasons?: readonly number[];
}

export interface ListProgramsOptions extends PaginationOptions {
  ids?: readonly number[];
}

export interface ListSeasonsOptions extends PaginationOptions {
  ids?: readonly number[];
  programs?: readonly number[];
  teams?: readonly number[];
  start?: DateInput;
  end?: DateInput;
  active?: boolean;
}

export interface ListSeasonEventsOptions extends PaginationOptions {
  skus?: readonly string[];
  teams?: readonly number[];
  start?: DateInput;
  end?: DateInput;
  levels?: readonly EventLevelFilter[];
}
