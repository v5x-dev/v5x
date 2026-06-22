import { expect, test } from "bun:test";
import { ProgramIniConfig } from "./VexIniConfig";

test("escapes quoted INI values and control characters", () => {
  const config = new ProgramIniConfig();
  config.program.name = 'robot"\nname';

  const content = config.createIni();
  expect(content).toContain('robot\\x22\\x0aname"');
  expect(content).not.toContain('robot"\nname');
});
