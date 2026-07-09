const declarationDirectory = process.argv[2];

if (!declarationDirectory) {
  throw new Error("Expected a declaration output directory.");
}

const reference = '/// <reference types="dom-serial" preserve="true" />\n';

for await (const declaration of new Bun.Glob("**/*.d.ts").scan({
  cwd: declarationDirectory,
})) {
  const declarationPath = `${declarationDirectory}/${declaration}`;
  const contents = await Bun.file(declarationPath).text();

  if (contents.includes("Serial") && !contents.startsWith(reference)) {
    await Bun.write(declarationPath, `${reference}${contents}`);
  }
}
