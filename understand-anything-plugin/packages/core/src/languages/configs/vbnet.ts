import type { LanguageConfig } from "../types.js";

export const vbnetConfig = {
  id: "vbnet",
  displayName: "VB.NET",
  extensions: [".vb"],
  concepts: ["partial classes", "Handles and WithEvents", "async/await", "LINQ", "generics"],
  filePatterns: {
    entryPoints: ["Application.vb", "**/Application.vb"],
    barrels: [],
    tests: ["*Tests.vb", "*Test.vb"],
    config: ["*.vbproj", "*.sln"],
  },
} satisfies LanguageConfig;