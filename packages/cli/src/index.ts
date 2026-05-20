#!/usr/bin/env bun

import packageJson from "../package.json";
import pc from "picocolors";

console.log(pc.redBright(`v5x ${packageJson.version}`));
console.log("modern cli for v5 development");
