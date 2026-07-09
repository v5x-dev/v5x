import { expect, test } from "bun:test";
import { ProgramIniConfig } from "./VexIniConfig";

test("serializes every project and program property", () => {
  const config = new ProgramIniConfig();
  config.project = {
    version: "2",
    ide: "A deliberately long IDE name",
    file: "robot.v5code",
  };
  config.program = {
    version: "3",
    name: "Competition",
    slot: 4,
    icon: "competition.bmp",
    iconalt: "alternate.bmp",
    description: "Match program",
    date: "2026-07-08T12:34:56.000Z",
    timezone: "-05:00",
  };

  const content = config.createIni();

  expect(content).toContain(
    `[project]
version      = "2"
ide          = "A deliberately l"
file         = "robot.v5code"`,
  );
  expect(content).toContain(
    `[program]
version      = "3"
name         = "Competition"
slot         = "4"
icon         = "competition.bmp"
iconalt      = "alternate.bmp"
description  = "Match program"
date         = "2026-07-08T12:34:56.000Z"
timezone     = "-05:00"`,
  );
});

test("serializes an empty description and omits an empty alternate icon", () => {
  const config = new ProgramIniConfig();
  config.program.date = "2026-07-08T12:34:56.000Z";

  const content = config.createIni();

  expect(content).toContain('description  = ""');
  expect(content).not.toContain("iconalt");
});

test("omits empty controller sections", () => {
  const config = new ProgramIniConfig();
  config.program.date = "2026-07-08T12:34:56.000Z";

  const content = config.createIni();

  expect(content).not.toContain("[controller_1]");
  expect(content).not.toContain("[controller_2]");
});

test("serializes populated controller sections", () => {
  const config = new ProgramIniConfig();
  config.program.date = "2026-07-08T12:34:56.000Z";
  config.controller1 = { axis: "1" };
  config.controller2 = { button: "A" };

  const content = config.createIni();

  expect(content).toContain(`[controller_1]
axis         = "1"`);
  expect(content).toContain(`[controller_2]
button       = "A"`);
});

test("preserves values without nonstandard escaping", () => {
  const config = new ProgramIniConfig();
  config.program.name = 'robot"name';
  config.program.description = String.raw`C:\robot`;
  config.program.date = "2026-07-08T12:34:56.000Z";

  const content = config.createIni();

  expect(content).toContain('name         = "robot"name"');
  expect(content).toContain(String.raw`description  = "C:\robot"`);
  expect(content).not.toContain("\\x");
});
