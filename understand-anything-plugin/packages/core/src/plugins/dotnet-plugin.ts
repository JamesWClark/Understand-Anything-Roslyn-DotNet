import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AnalyzerPlugin, StructuralAnalysis } from "../types.js";

const declarationSchema = z.object({
  kind: z.string(), name: z.string(), owner: z.string(), namespace: z.string(), identity: z.string(),
  typeIdentity: z.string(), containingTypeIdentity: z.string(), lineRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  parameters: z.array(z.string()), returnType: z.string().nullable(), signature: z.string(),
  partial: z.boolean(), modifiers: z.array(z.string()), withEvents: z.boolean(), baseTypes: z.array(z.string()),
});
const factSchema = z.object({
  path: z.string(), sourceHash: z.string(), syntaxStatus: z.enum(["complete", "recovered"]),
  semanticStatus: z.literal("syntax-only"),
  context: z.object({ projectPath: z.string().nullable(), projectIdentity: z.string(), configuration: z.string(), rootNamespace: z.string(),
    languageVersion: z.string().nullable(), globalImports: z.array(z.string()), diagnostics: z.array(z.string()) }),
  declarations: z.array(declarationSchema),
  events: z.array(z.object({ handler: z.string(), owner: z.string(), receiver: z.string(), eventName: z.string(), line: z.number().int(), evidence: z.literal("syntax") })),
  calls: z.array(z.object({ caller: z.string().nullable(), expression: z.string(), line: z.number().int(), evidence: z.literal("syntax"), resolved: z.literal(false) })),
  diagnostics: z.array(z.object({ id: z.string(), severity: z.string(), message: z.string(), line: z.number().int(), column: z.number().int() })),
  structure: z.object({
    functions: z.array(z.object({ name: z.string(), lineRange: z.tuple([z.number(), z.number()]), params: z.array(z.string()), returnType: z.string().nullable(), owner: z.string() })),
    classes: z.array(z.object({ name: z.string(), lineRange: z.tuple([z.number(), z.number()]), methods: z.array(z.string()), properties: z.array(z.string()) })),
    imports: z.array(z.object({ source: z.string(), specifiers: z.array(z.string()), lineNumber: z.number() })),
    exports: z.array(z.object({ name: z.string(), lineNumber: z.number() })),
  }),
});
const responseSchema = z.object({ protocolVersion: z.literal(1), provider: z.literal("roslyn"), providerVersion: z.string(), results: z.array(factSchema) });
export type DotNetFacts = Omit<z.infer<typeof factSchema>, "structure"> & { provider: "roslyn"; providerVersion: string; protocolVersion: 1 };

export interface DotNetPluginOptions {
  projectRoot: string;
  helperPath?: string;
  configuration?: string;
  csharp?: boolean;
}

export class DotNetPlugin implements AnalyzerPlugin {
  readonly name = "roslyn-dotnet";
  readonly languages: string[];
  private readonly cache = new Map<string, z.infer<typeof factSchema>>();
  private readonly failures = new Map<string, string>();
  private readonly projects = new Map<string, string | null>();
  private readonly root: string;
  private providerVersion = "";

  constructor(private readonly options: DotNetPluginOptions) {
    this.root = realpathSync(options.projectRoot);
    this.languages = options.csharp ? ["vbnet", "csharp"] : ["vbnet"];
  }

  supports(path: string): boolean {
    const extension = extname(path).toLowerCase();
    return extension === ".vb" || (extension === ".cs" && this.options.csharp === true);
  }

  private absolute(path: string): string {
    const absolute = realpathSync(resolve(this.root, path));
    const within = relative(this.root, absolute);
    if (within.startsWith("..") || isAbsolute(within)) throw new Error(".NET path escapes project root: " + path);
    return absolute;
  }

  private projectFor(path: string): string | null {
    const extension = extname(path).toLowerCase() === ".vb" ? ".vbproj" : ".csproj";
    let directory = dirname(this.absolute(path));
    while (true) {
      const key = directory + extension;
      if (this.projects.has(key)) return this.projects.get(key)!;
      const candidates = readdirSync(directory).filter(name => name.toLowerCase().endsWith(extension));
      if (candidates.length > 1) throw new Error("Ambiguous project context for " + path + "; analyze one project directory at a time");
      if (candidates.length === 1) {
        const project = this.absolute(resolve(directory, candidates[0]));
        this.projects.set(key, project);
        return project;
      }
      if (directory === this.root) return null;
      directory = dirname(directory);
    }
  }

  prepare(paths: string[]): void {
    const selected = [...new Set(paths.filter(path => this.supports(path)))];
    if (selected.length === 0) return;
    for (const path of selected) { this.cache.delete(path); this.failures.delete(path); }
    const toolRoot = fileURLToPath(new URL("../../../../tools/dotnet-analyzer/", import.meta.url));
    const helper = this.options.helperPath ?? process.env.UA_DOTNET_ANALYZER ??
      [resolve(toolRoot, "publish/DotNetAnalyzer.dll"), resolve(toolRoot, "bin/Release/net10.0/DotNetAnalyzer.dll")].find(path => existsSync(path));
    if (!helper || !existsSync(helper)) throw new Error("Roslyn helper not built. Run scripts/setup-dotnet.ps1 or pnpm build:dotnet.");
    for (let start = 0; start < selected.length; start += 32) {
      const files = selected.slice(start, start + 32).flatMap(path => {
        try {
          const bytes = readFileSync(this.absolute(path));
          const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          const projectPath = this.projectFor(path);
          return [{ path, source, projectPath, projectIdentity: projectPath ? relative(this.root, projectPath).split("\\").join("/") : "loose-files",
            configuration: this.options.configuration ?? "Debug" }];
        } catch (error) {
          this.failures.set(path, String(error));
          return [];
        }
      });
      if (files.length === 0) continue;
      const run = spawnSync("dotnet", [helper], { input: JSON.stringify({ protocolVersion: 1, files }),
        encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      if (run.error || run.status !== 0) throw new Error("Roslyn helper failed: " + (run.error?.message ?? run.stderr));
      const response = responseSchema.parse(JSON.parse(run.stdout));
      this.providerVersion = response.providerVersion;
      if (response.results.length !== files.length) throw new Error("Roslyn helper omitted files");
      for (const result of response.results) {
        const input = files.find(file => file.path === result.path);
        if (!input || result.sourceHash !== hash(input.source) || this.cache.has(result.path)) throw new Error("Invalid or duplicate Roslyn result: " + result.path);
        this.cache.set(result.path, result);
      }
    }
  }

  analyzeFile(path: string, content: string): StructuralAnalysis {
    if (this.failures.has(path)) throw new Error(this.failures.get(path));
    const result = this.cache.get(path);
    if (!result || result.sourceHash !== hash(content)) throw new Error("Roslyn cache absent or stale: " + path);
    const { structure, ...facts } = result;
    return {
      ...structure,
      functions: structure.functions.map(({ returnType, ...method }) => ({ ...method, ...(returnType === null ? {} : { returnType }) })),
      dotNet: { ...facts, provider: "roslyn", providerVersion: this.providerVersion, protocolVersion: 1 },
    };
  }
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}