import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  StructuralAnalysis,
  DefinitionInfo,
  ServiceInfo,
  EndpointInfo,
  StepInfo,
  ResourceInfo,
  SectionInfo,
} from "../types.js";
import { LanguageRegistry } from "../languages/language-registry.js";
import { createHash } from "node:crypto";

interface FileMeta {
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
}

interface FileAnalysisMeta extends FileMeta {
  summaries: Record<string, string>; // function/class name -> summary
  fileSummary: string;
}

interface NonCodeFileMeta extends FileMeta {
  nodeType: GraphNode["type"];
}

interface NonCodeFileAnalysisMeta extends NonCodeFileMeta {
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
  sections?: SectionInfo[];
}

const KIND_TO_NODE_TYPE: Record<string, GraphNode["type"]> = {
  table: "table",
  view: "table",
  index: "table",
  message: "schema",
  type: "schema",
  enum: "schema",
  resource: "resource",
  module: "resource",
  service: "service",
  deployment: "service",
  job: "pipeline",
  stage: "pipeline",
  target: "pipeline",
  route: "endpoint",
  query: "endpoint",
  mutation: "endpoint",
  variable: "config",
  output: "config",
};

export class GraphBuilder {
  private readonly nodes: GraphNode[] = [];
  private readonly edges: GraphEdge[] = [];
  private readonly languages = new Set<string>();
  private readonly nodeIds = new Set<string>();
  private readonly edgeKeys = new Set<string>();
  private readonly projectName: string;
  private readonly gitHash: string;
  private readonly languageRegistry: LanguageRegistry;

  constructor(projectName: string, gitHash: string, languageRegistry?: LanguageRegistry) {
    this.projectName = projectName;
    this.gitHash = gitHash;
    this.languageRegistry = languageRegistry ?? LanguageRegistry.createDefault();
  }

  private detectLanguage(filePath: string): string {
    return this.languageRegistry.getForFile(filePath)?.id ?? "unknown";
  }

  private static basename(filePath: string): string {
    return filePath.split("/").pop() ?? filePath;
  }

  addFile(filePath: string, meta: FileMeta): void {
    const lang = this.detectLanguage(filePath);
    if (lang !== "unknown") {
      this.languages.add(lang);
    }

    const name = GraphBuilder.basename(filePath);

    const id = `file:${filePath}`;
    this.nodeIds.add(id);
    this.nodes.push({
      id,
      type: "file",
      name,
      filePath,
      summary: meta.summary,
      tags: meta.tags,
      complexity: meta.complexity,
    });
  }

  addFileWithAnalysis(
    filePath: string,
    analysis: StructuralAnalysis,
    meta: FileAnalysisMeta,
  ): void {
    if (analysis.dotNet) {
      this.addDotNetFile(filePath, analysis, meta);
      return;
    }
    const lang = this.detectLanguage(filePath);
    if (lang !== "unknown") {
      this.languages.add(lang);
    }

    const fileName = GraphBuilder.basename(filePath);
    const fileId = `file:${filePath}`;

    // Create the file node
    this.nodeIds.add(fileId);
    this.nodes.push({
      id: fileId,
      type: "file",
      name: fileName,
      filePath,
      summary: meta.fileSummary,
      tags: meta.tags,
      complexity: meta.complexity,
    });

    // Create function nodes with "contains" edges
    for (const fn of analysis.functions) {
      const funcId = `function:${filePath}:${fn.name}`;
      this.nodeIds.add(funcId);
      this.nodes.push({
        id: funcId,
        type: "function",
        name: fn.name,
        filePath,
        lineRange: fn.lineRange,
        summary: meta.summaries[fn.name] ?? "",
        tags: [],
        complexity: meta.complexity,
      });

      this.edges.push({
        source: fileId,
        target: funcId,
        type: "contains",
        direction: "forward",
        weight: 1,
      });
    }

    // Create class nodes with "contains" edges
    for (const cls of analysis.classes) {
      const classId = `class:${filePath}:${cls.name}`;
      this.nodeIds.add(classId);
      this.nodes.push({
        id: classId,
        type: "class",
        name: cls.name,
        filePath,
        lineRange: cls.lineRange,
        summary: meta.summaries[cls.name] ?? "",
        tags: [],
        complexity: meta.complexity,
      });

      this.edges.push({
        source: fileId,
        target: classId,
        type: "contains",
        direction: "forward",
        weight: 1,
      });
    }
  }

  private addDotNetFile(filePath: string, analysis: StructuralAnalysis, meta: FileAnalysisMeta): void {
    const facts = analysis.dotNet!;
    this.addFile(filePath, { ...meta, summary: meta.fileSummary });
    const fileId = `file:${filePath}`;
    const typeKinds = new Set(["class", "module", "struct", "interface", "record", "enum"]);
    const key = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
    const typeId = (identity: string) => `dotnet-type:${key(facts.context.projectIdentity + "|" + (filePath.toLowerCase().endsWith(".vb") ? identity.toLowerCase() : identity))}`;
    const declarationIds = new Map<string, string>();
    const contains = (source: string, target: string) => {
      const edgeKey = `contains|${source}|${target}`;
      if (this.edgeKeys.has(edgeKey)) return;
      this.edgeKeys.add(edgeKey);
      this.edges.push({ source, target, type: "contains", direction: "forward", weight: 1 });
    };
    for (const declaration of facts.declarations) {
      const isType = typeKinds.has(declaration.kind);
      const id = isType ? typeId(declaration.typeIdentity) : `dotnet-member:${key(filePath + "|" + declaration.identity)}`;
      declarationIds.set(declaration.identity, id);
      if (!this.nodeIds.has(id)) {
        this.nodeIds.add(id);
        this.nodes.push({
          id, type: isType ? "class" : ["method", "constructor", "operator", "delegate"].includes(declaration.kind) ? "function" : "resource",
          name: declaration.name, filePath, lineRange: declaration.lineRange,
          summary: meta.summaries[declaration.name] ?? `${declaration.kind}: ${declaration.signature}`,
          tags: ["dotnet", declaration.kind, "syntax-only", ...(declaration.withEvents ? ["with-events"] : [])],
          complexity: meta.complexity,
          languageNotes: [declaration.typeIdentity, ...declaration.baseTypes.map(base => `Base/interface syntax: ${base}`),
            facts.syntaxStatus === "complete" ? "Syntax parsed; semantic binding not performed." : "Recovered syntax; declarations may be incomplete."].join("\n"),
        });
      } else if (isType) {
        const existing = this.nodes.find(node => node.id === id)!;
        if (/\.designer\./i.test(existing.filePath ?? "") && !/\.designer\./i.test(filePath)) {
          existing.filePath = filePath;
          existing.lineRange = declaration.lineRange;
        }
      }
      contains(fileId, id);
    }
    for (const declaration of facts.declarations) {
      const parent = typeId(declaration.containingTypeIdentity);
      const child = declarationIds.get(declaration.identity)!;
      if (parent !== child && this.nodeIds.has(parent)) contains(parent, child);
    }
    for (const event of facts.events) {
      const handler = facts.declarations.find(declaration => declaration.name === event.handler && declaration.owner === event.owner
        && declaration.lineRange[0] <= event.line && declaration.lineRange[1] >= event.line);
      if (!handler) continue;
      const eventId = `dotnet-event:${key(facts.context.projectIdentity + "|" + handler.containingTypeIdentity + "|" + event.receiver + "." + event.eventName)}`;
      if (!this.nodeIds.has(eventId)) {
        this.nodeIds.add(eventId);
        this.nodes.push({ id: eventId, type: "concept", name: `${event.receiver}.${event.eventName}`, filePath,
          lineRange: [event.line, event.line], summary: "Event expression from a VB Handles clause; target is not semantically bound.",
          tags: ["dotnet", "event", "syntax-only"], complexity: "simple" });
      }
      this.edges.push({ source: declarationIds.get(handler.identity)!, target: eventId, type: "subscribes", direction: "forward",
        weight: 1, description: "Declared Handles relationship (syntax evidence, not runtime call order)." });
    }
  }

  addImportEdge(fromFile: string, toFile: string): void {
    const key = `imports|file:${fromFile}|file:${toFile}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push({
      source: `file:${fromFile}`,
      target: `file:${toFile}`,
      type: "imports",
      direction: "forward",
      weight: 0.7,
    });
  }

  addCallEdge(
    callerFile: string,
    callerFunc: string,
    calleeFile: string,
    calleeFunc: string,
  ): void {
    const key = `calls|function:${callerFile}:${callerFunc}|function:${calleeFile}:${calleeFunc}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push({
      source: `function:${callerFile}:${callerFunc}`,
      target: `function:${calleeFile}:${calleeFunc}`,
      type: "calls",
      direction: "forward",
      weight: 0.8,
    });
  }

  addNonCodeFile(filePath: string, meta: NonCodeFileMeta): string {
    const lang = this.detectLanguage(filePath);
    if (lang !== "unknown") this.languages.add(lang);
    const name = GraphBuilder.basename(filePath);
    const id = `${meta.nodeType ?? "file"}:${filePath}`;
    this.nodeIds.add(id);
    this.nodes.push({
      id,
      type: meta.nodeType,
      name,
      filePath,
      summary: meta.summary,
      tags: meta.tags,
      complexity: meta.complexity,
    });
    return id;
  }

  addNonCodeFileWithAnalysis(filePath: string, meta: NonCodeFileAnalysisMeta): void {
    const fileId = this.addNonCodeFile(filePath, meta);

    // Create child nodes for definitions (tables, schemas, etc.)
    for (const def of meta.definitions ?? []) {
      this.addChildNode({
        id: `${def.kind}:${filePath}:${def.name}`,
        type: this.mapKindToNodeType(def.kind),
        name: def.name,
        filePath,
        lineRange: def.lineRange,
        summary: `${def.kind}: ${def.name} (${def.fields.length} fields)`,
        tags: [],
        complexity: meta.complexity,
      }, fileId);
    }

    // Create child nodes for services
    for (const svc of meta.services ?? []) {
      this.addChildNode({
        id: `service:${filePath}:${svc.name}`,
        type: "service",
        name: svc.name,
        filePath,
        summary: `Service ${svc.name}${svc.image ? ` (image: ${svc.image})` : ""}`,
        tags: [],
        complexity: meta.complexity,
      }, fileId);
    }

    // Create child nodes for endpoints
    for (const ep of meta.endpoints ?? []) {
      const name = `${ep.method ?? ""} ${ep.path}`.trim();
      this.addChildNode({
        id: `endpoint:${filePath}:${ep.path}`,
        type: "endpoint",
        name,
        filePath,
        lineRange: ep.lineRange,
        summary: `Endpoint: ${name}`,
        tags: [],
        complexity: meta.complexity,
      }, fileId);
    }

    // Create child nodes for steps (pipeline/makefile targets)
    for (const step of meta.steps ?? []) {
      this.addChildNode({
        id: `step:${filePath}:${step.name}`,
        type: "pipeline",
        name: step.name,
        filePath,
        lineRange: step.lineRange,
        summary: `Step: ${step.name}`,
        tags: [],
        complexity: meta.complexity,
      }, fileId);
    }

    // Create child nodes for resources (Terraform, etc.)
    for (const res of meta.resources ?? []) {
      this.addChildNode({
        id: `resource:${filePath}:${res.name}`,
        type: "resource",
        name: res.name,
        filePath,
        lineRange: res.lineRange,
        summary: `Resource: ${res.name} (${res.kind})`,
        tags: [],
        complexity: meta.complexity,
      }, fileId);
    }
  }

  private addChildNode(node: GraphNode, parentId: string): void {
    if (this.nodeIds.has(node.id)) {
      console.warn(`[GraphBuilder] Duplicate node ID "${node.id}" — skipping`);
      return;
    }
    this.nodeIds.add(node.id);
    this.nodes.push(node);
    this.edges.push({ source: parentId, target: node.id, type: "contains", direction: "forward", weight: 1 });
  }

  private mapKindToNodeType(kind: string): GraphNode["type"] {
    const mapped = KIND_TO_NODE_TYPE[kind];
    if (!mapped) {
      console.warn(`[GraphBuilder] Unknown definition kind "${kind}" — falling back to "concept" node type`);
    }
    return mapped ?? "concept";
  }

  build(): KnowledgeGraph {
    return {
      version: "1.0.0",
      project: {
        name: this.projectName,
        languages: [...this.languages].sort((a, b) => a.localeCompare(b)),
        frameworks: [],
        description: "",
        analyzedAt: new Date().toISOString(),
        gitCommitHash: this.gitHash,
      },
      nodes: [...this.nodes],
      edges: [...this.edges],
      layers: [],
      tour: [],
    };
  }
}
