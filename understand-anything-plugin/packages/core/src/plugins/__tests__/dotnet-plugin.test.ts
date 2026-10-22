import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DotNetPlugin } from "../dotnet-plugin.js";
import { PluginRegistry } from "../registry.js";

const helper = fileURLToPath(new URL("../../../../../tools/dotnet-analyzer/bin/Release/net10.0/DotNetAnalyzer.dll", import.meta.url));
let root: string;

describe.skipIf(!existsSync(helper))("Roslyn provider integration", () => {
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ua-roslyn-test-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function analyze(files: Record<string, string>, csharp = false) {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(root, name), source);
    const plugin = new DotNetPlugin({ projectRoot: root, helperPath: helper, csharp });
    plugin.prepare(Object.keys(files));
    return { plugin, results: Object.fromEntries(Object.entries(files).filter(([name]) => plugin.supports(name))
      .map(([name, source]) => [name, plugin.analyzeFile(name, source)])) };
  }

  it("registers VB without replacing the C# default", () => {
    const registry = new PluginRegistry();
    const plugin = new DotNetPlugin({ projectRoot: root });
    registry.register(plugin);
    expect(registry.getLanguageForFile("Form.vb")).toBe("vbnet");
    expect(registry.getPluginForFile("Form.vb")).toBe(plugin);
    expect(plugin.supports("Type.cs")).toBe(false);
  });

  it("preserves partial type identity, generics, events, imports and fields", () => {
    writeFileSync(join(root, "Demo.vbproj"), '<Project><PropertyGroup><RootNamespace>Demo</RootNamespace></PropertyGroup></Project>');
    const { results } = analyze({
      "Form.vb": "Option Strict Off\nImports Tasks = System.Threading.Tasks\nFriend Class Sample\nPublic Async Function Fetch(Of T)(ByVal value As T) As Tasks.Task(Of T)\nAwait Tasks.Task.Delay(1)\nReturn value\nEnd Function\nPrivate Sub Press(sender As Object, e As System.EventArgs) Handles Button.Click\nEnd Sub\nEnd Class",
      "Form.Designer.vb": "Partial Class Sample\nPublic WithEvents Button As Object\nPublic Sub New()\nInitializeComponent()\nEnd Sub\nPrivate Sub InitializeComponent()\nEnd Sub\nEnd Class",
    });
    const form = results["Form.vb"].dotNet!;
    const designer = results["Form.Designer.vb"].dotNet!;
    expect(form.syntaxStatus).toBe("complete");
    expect(form.semanticStatus).toBe("syntax-only");
    expect(form.declarations.find(fact => fact.kind === "class")!.typeIdentity).toBe("Demo.Sample`0");
    expect(designer.declarations.find(fact => fact.kind === "class")!.typeIdentity).toBe("Demo.Sample`0");
    expect(designer.declarations.find(fact => fact.name === "Button")!.withEvents).toBe(true);
    expect(form.events).toEqual([expect.objectContaining({ handler: "Press", receiver: "Button", eventName: "Click", evidence: "syntax" })]);
    expect(results["Form.vb"].functions[0]).toMatchObject({ name: "Fetch", owner: "Sample", returnType: "Tasks.Task(Of T)" });
    expect(designer.calls[0]).toMatchObject({ caller: "New", expression: "InitializeComponent", resolved: false });
  });

  it("keeps recovered syntax explicitly incomplete", () => {
    const { results } = analyze({ "Broken.vb": "Class Broken\nSub Run(\nEnd Class" });
    expect(results["Broken.vb"].dotNet!.syntaxStatus).toBe("recovered");
    expect(results["Broken.vb"].dotNet!.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
  });

  it("handles Unicode and bracketed identifiers through UTF-8 JSON", () => {
    const { results } = analyze({ "Unicode.vb": "Class [Class]\nPublic Sub Caf\u00e9()\nEnd Sub\nEnd Class" });
    expect(results["Unicode.vb"].dotNet!.syntaxStatus).toBe("complete");
    expect(results["Unicode.vb"].functions[0].name).toBe("Caf\u00e9");
  });

  it("extracts C# nested types, enums, delegates and overloads when enabled", () => {
    const { results } = analyze({ "Types.cs": "namespace Demo; public enum State { On } public delegate void Handler(); public class Outer { public class Inner {} public int Run(int value) => value; public string Run(string value) => value; }" }, true);
    const facts = results["Types.cs"].dotNet!;
    expect(facts.syntaxStatus).toBe("complete");
    expect(facts.declarations.map(fact => fact.name)).toEqual(expect.arrayContaining(["State", "Handler", "Outer", "Inner", "Run"]));
    const methods = facts.declarations.filter(fact => fact.name === "Run");
    expect(new Set(methods.map(fact => fact.identity)).size).toBe(2);
    expect(methods[0].signature).not.toContain("=>");
  });

  it("distinguishes generic type arity", () => {
    const { results } = analyze({ "Types.vb": "Class Box\nEnd Class\nClass Box(Of T)\nEnd Class" });
    expect(results["Types.vb"].dotNet!.declarations.map(fact => fact.typeIdentity)).toEqual(["Box`0", "Box`1"]);
  });

  it("selects the active conditional branch", () => {
    const { results } = analyze({ "Conditional.vb": "#If DEBUG Then\nClass DebugOnly\nEnd Class\n#Else\nClass ReleaseOnly\nEnd Class\n#End If" });
    expect(results["Conditional.vb"].classes.map(type => type.name)).toEqual(["DebugOnly"]);
  });

  it("rejects stale source instead of reusing cached declarations", () => {
    const { plugin } = analyze({ "Form.vb": "Class Sample\nEnd Class" });
    expect(() => plugin.analyzeFile("Form.vb", "Class Changed\nEnd Class")).toThrow(/stale/);
    writeFileSync(join(root, "Form.vb"), "Class Changed\nEnd Class");
    plugin.prepare(["Form.vb"]);
    expect(plugin.analyzeFile("Form.vb", "Class Changed\nEnd Class").classes[0].name).toBe("Changed");
  });

  it("rejects missing helper and out-of-root paths", () => {
    const plugin = new DotNetPlugin({ projectRoot: root, helperPath: join(root, "absent.dll") });
    expect(() => plugin.prepare(["Form.vb"])).toThrow(/not built/);
    const outside = join(tmpdir(), "outside.vb");
    const bounded = new DotNetPlugin({ projectRoot: root, helperPath: helper });
    bounded.prepare([outside]);
    expect(() => bounded.analyzeFile(outside, "")).toThrow();
  });
});