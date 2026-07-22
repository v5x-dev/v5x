export const rounds = {
  practice: 1,
  qualification: 2,
  quarterfinals: 3,
  semifinals: 4,
  finals: 5,
  roundOf16: 6,
  topN: 15,
  roundRobin: 16,
} as const;

export type Round = (typeof rounds)[keyof typeof rounds];

export const programs = {
  V5RC: 1,
  VURC: 4,
  WORKSHOP: 37,
  VIQRC: 41,
  NRL: 43,
  ADC: 44,
  TVRC: 46,
  TVIQRC: 47,
  VRAD: 51,
  BellAVR: 55,
  FAC: 56,
  VAIRC: 57,
} as const;

export type ProgramAbbreviation = keyof typeof programs;
export type KnownProgramId = (typeof programs)[ProgramAbbreviation];
