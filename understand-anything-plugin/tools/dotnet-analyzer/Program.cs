using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.VisualBasic;
using CS = Microsoft.CodeAnalysis.CSharp.Syntax;
using VB = Microsoft.CodeAnalysis.VisualBasic.Syntax;

Console.InputEncoding = new UTF8Encoding(false);
Console.OutputEncoding = new UTF8Encoding(false);
var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
try
{
    var request = JsonSerializer.Deserialize<Request>(Console.In.ReadToEnd(), jsonOptions)
        ?? throw new ArgumentException("Missing request");
    if (request.ProtocolVersion != 1) throw new ArgumentException("Unsupported protocol version");
    var results = request.Files.Select(Analyzer.Analyze).ToArray();
    Console.Write(JsonSerializer.Serialize(new { protocolVersion = 1, provider = "roslyn", providerVersion = typeof(SyntaxTree).Assembly.GetName().Version!.ToString(), results }, jsonOptions));
}
catch (Exception error)
{
    Console.Error.WriteLine(error.Message);
    Environment.ExitCode = 1;
}

record Request(int ProtocolVersion, InputFile[] Files);
record InputFile(string Path, string Source, string? ProjectPath, string? Configuration, string? ProjectIdentity);
record Declaration(string Kind, string Name, string Owner, string Namespace, string Identity, string TypeIdentity,
    string ContainingTypeIdentity, int[] LineRange, string[] Parameters, string? ReturnType, string Signature, bool Partial,
    string[] Modifiers, bool WithEvents, string[] BaseTypes);

static class Analyzer
{
    public static object Analyze(InputFile file)
    {
        var vb = file.Path.EndsWith(".vb", StringComparison.OrdinalIgnoreCase);
        var configuration = file.Configuration ?? "Debug";
        var context = ReadProject(file.ProjectPath, configuration);
        var rootNamespace = vb ? context.RootNamespace : "";
        SyntaxTree tree = vb
            ? VisualBasicSyntaxTree.ParseText(file.Source, VisualBasicParseOptions.Default
                .WithLanguageVersion(VbLanguageVersion(context.LanguageVersion))
                .WithPreprocessorSymbols(context.Symbols.Select(entry => new KeyValuePair<string, object>(entry.Key, entry.Value))), file.Path)
            : CSharpSyntaxTree.ParseText(file.Source, CSharpParseOptions.Default
                .WithLanguageVersion(CsLanguageVersion(context.LanguageVersion))
                .WithPreprocessorSymbols(context.Symbols.Where(entry => entry.Value is true).Select(entry => entry.Key)), file.Path);
        var root = tree.GetRoot();
        var declarations = root.DescendantNodes().Select(node => Describe(node, vb, rootNamespace, file.ProjectIdentity ?? "loose-files"))
            .Where(fact => fact is not null).Cast<Declaration>().ToArray();
        var diagnostics = tree.GetDiagnostics().Select(diagnostic => new
        {
            id = diagnostic.Id, severity = diagnostic.Severity.ToString().ToLowerInvariant(), message = diagnostic.GetMessage(),
            line = diagnostic.Location.GetLineSpan().StartLinePosition.Line + 1,
            column = diagnostic.Location.GetLineSpan().StartLinePosition.Character + 1
        }).ToArray();
        var types = declarations.Where(fact => fact.Kind is "class" or "module" or "struct" or "interface" or "record" or "enum").ToArray();
        var functions = declarations.Where(fact => fact.Kind is "method" or "constructor" or "operator" or "delegate").ToArray();
        var imports = root.DescendantNodes().Where(node => node is VB.ImportsStatementSyntax or CS.UsingDirectiveSyntax)
            .Select(node => new { source = ImportSource(node), specifiers = Array.Empty<string>(), lineNumber = Span(node)[0] }).ToArray();
        var events = root.DescendantNodes().OfType<VB.MethodStatementSyntax>().Where(method => method.HandlesClause is not null)
            .SelectMany(method => method.HandlesClause!.Events.Select(item => new
            { handler = method.Identifier.ValueText, owner = Owner(method, vb), receiver = item.EventContainer.ToString(),
                eventName = item.EventMember.ToString(), line = Span(method)[0], evidence = "syntax" })).ToArray();
        var calls = root.DescendantNodes().Where(node => node is VB.InvocationExpressionSyntax or CS.InvocationExpressionSyntax)
            .Select(node => new { caller = Caller(node), expression = node is VB.InvocationExpressionSyntax invocation ? invocation.Expression.ToString() : ((CS.InvocationExpressionSyntax)node).Expression.ToString(),
                line = Span(node)[0], evidence = "syntax", resolved = false }).ToArray();
        return new
        {
            path = file.Path,
            sourceHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(file.Source))),
            syntaxStatus = diagnostics.Any(diagnostic => diagnostic.severity == "error") ? "recovered" : "complete",
            semanticStatus = "syntax-only",
            context = new { projectPath = file.ProjectPath, projectIdentity = file.ProjectIdentity ?? "loose-files", configuration, rootNamespace, context.LanguageVersion,
                globalImports = context.Imports, context.Diagnostics },
            declarations, events, calls, diagnostics,
            structure = new
            {
                functions = functions.Select(fact => new { fact.Name, fact.LineRange, @params = fact.Parameters, fact.ReturnType, fact.Owner }),
                classes = types.Select(fact => new { fact.Name, fact.LineRange,
                    methods = functions.Where(method => method.Owner == QualifiedOwner(fact)).Select(method => method.Name).ToArray(),
                    properties = declarations.Where(member => member.Owner == QualifiedOwner(fact) && member.Kind is "property" or "field" or "event").Select(member => member.Name).ToArray() }),
                imports, exports = Array.Empty<object>()
            }
        };
    }

    static Declaration? Describe(SyntaxNode node, bool vb, string rootNamespace, string project)
    {
        string kind, name; string[] parameters = []; string? returns = null; SyntaxNode extent = node;
        switch (node)
        {
            case VB.ClassBlockSyntax type: kind = "class"; name = type.ClassStatement.Identifier.ValueText; break;
            case VB.ModuleBlockSyntax type: kind = "module"; name = type.ModuleStatement.Identifier.ValueText; break;
            case VB.StructureBlockSyntax type: kind = "struct"; name = type.StructureStatement.Identifier.ValueText; break;
            case VB.InterfaceBlockSyntax type: kind = "interface"; name = type.InterfaceStatement.Identifier.ValueText; break;
            case VB.EnumBlockSyntax type: kind = "enum"; name = type.EnumStatement.Identifier.ValueText; break;
            case VB.MethodStatementSyntax method:
                kind = "method"; name = method.Identifier.ValueText;
                parameters = method.ParameterList?.Parameters.Select(parameter => parameter.ToString()).ToArray() ?? [];
                returns = method.AsClause?.Type().ToString();
                if (method.Parent is VB.MethodBlockSyntax methodBlock) extent = methodBlock;
                break;
            case VB.SubNewStatementSyntax constructor:
                kind = "constructor"; name = "New";
                parameters = constructor.ParameterList?.Parameters.Select(parameter => parameter.ToString()).ToArray() ?? [];
                if (constructor.Parent is VB.ConstructorBlockSyntax constructorBlock) extent = constructorBlock;
                break;
            case VB.PropertyStatementSyntax property:
                kind = "property"; name = property.Identifier.ValueText; returns = property.AsClause?.Type().ToString();
                parameters = property.ParameterList?.Parameters.Select(parameter => parameter.ToString()).ToArray() ?? [];
                if (property.Parent is VB.PropertyBlockSyntax propertyBlock) extent = propertyBlock;
                break;
            case VB.EventStatementSyntax eventStatement: kind = "event"; name = eventStatement.Identifier.ValueText; break;
            case VB.DelegateStatementSyntax delegateStatement:
                kind = "delegate"; name = delegateStatement.Identifier.ValueText;
                parameters = delegateStatement.ParameterList?.Parameters.Select(parameter => parameter.ToString()).ToArray() ?? [];
                returns = delegateStatement.AsClause?.Type().ToString(); break;
            case VB.ModifiedIdentifierSyntax identifier when identifier.Parent is VB.VariableDeclaratorSyntax { Parent: VB.FieldDeclarationSyntax }:
                kind = "field"; name = identifier.Identifier.ValueText; break;
            case VB.OperatorStatementSyntax operatorStatement:
                kind = "operator"; name = operatorStatement.OperatorToken.ValueText;
                parameters = operatorStatement.ParameterList?.Parameters.Select(parameter => parameter.ToString()).ToArray() ?? [];
                if (operatorStatement.Parent is VB.OperatorBlockSyntax operatorBlock) extent = operatorBlock; break;
            case CS.BaseTypeDeclarationSyntax type:
                kind = type switch { CS.InterfaceDeclarationSyntax => "interface", CS.StructDeclarationSyntax => "struct", CS.EnumDeclarationSyntax => "enum", CS.RecordDeclarationSyntax => "record", _ => "class" };
                name = type.Identifier.ValueText; break;
            case CS.MethodDeclarationSyntax method:
                kind = "method"; name = method.Identifier.ValueText; parameters = method.ParameterList.Parameters.Select(parameter => parameter.ToString()).ToArray(); returns = method.ReturnType.ToString(); break;
            case CS.ConstructorDeclarationSyntax constructor:
                kind = "constructor"; name = constructor.Identifier.ValueText; parameters = constructor.ParameterList.Parameters.Select(parameter => parameter.ToString()).ToArray(); break;
            case CS.PropertyDeclarationSyntax property: kind = "property"; name = property.Identifier.ValueText; returns = property.Type.ToString(); break;
            case CS.EventDeclarationSyntax eventDeclaration: kind = "event"; name = eventDeclaration.Identifier.ValueText; break;
            case CS.DelegateDeclarationSyntax delegateDeclaration:
                kind = "delegate"; name = delegateDeclaration.Identifier.ValueText; parameters = delegateDeclaration.ParameterList.Parameters.Select(parameter => parameter.ToString()).ToArray(); returns = delegateDeclaration.ReturnType.ToString(); break;
            case CS.VariableDeclaratorSyntax identifier when identifier.Parent?.Parent is CS.FieldDeclarationSyntax or CS.EventFieldDeclarationSyntax:
                kind = identifier.Parent.Parent is CS.EventFieldDeclarationSyntax ? "event" : "field"; name = identifier.Identifier.ValueText; break;
            case CS.OperatorDeclarationSyntax operatorDeclaration:
                kind = "operator"; name = operatorDeclaration.OperatorToken.ValueText; parameters = operatorDeclaration.ParameterList.Parameters.Select(parameter => parameter.ToString()).ToArray(); break;
            default: return null;
        }
        var owner = Owner(node, vb);
        var namespaces = node.Ancestors().Reverse().Select(ancestor => ancestor switch
        { VB.NamespaceBlockSyntax ns => ns.NamespaceStatement.Name.ToString(), CS.BaseNamespaceDeclarationSyntax ns => ns.Name.ToString(), _ => null }).Where(value => value is not null);
        var namespaceName = string.Join(".", namespaces);
        if (vb && namespaceName.StartsWith("Global.", StringComparison.OrdinalIgnoreCase)) namespaceName = namespaceName[7..];
        else if (vb) namespaceName = string.Join(".", new[] { rootNamespace, namespaceName }.Where(value => value.Length > 0));
        var signature = node switch { VB.TypeBlockSyntax type => type.BlockStatement.ToString(), VB.EnumBlockSyntax type => type.EnumStatement.ToString(),
            CS.BaseTypeDeclarationSyntax type => TypeKey(type),
            CS.MethodDeclarationSyntax method => method.ReturnType + " " + method.ExplicitInterfaceSpecifier + method.Identifier.ValueText + method.TypeParameterList + method.ParameterList,
            CS.ConstructorDeclarationSyntax constructor => constructor.Identifier.ValueText + constructor.ParameterList.ToString(),
            CS.PropertyDeclarationSyntax property => property.Type + " " + property.ExplicitInterfaceSpecifier + property.Identifier.ValueText,
            CS.EventDeclarationSyntax eventDeclaration => eventDeclaration.Type + " " + eventDeclaration.Identifier.ValueText,
            CS.DelegateDeclarationSyntax delegateDeclaration => delegateDeclaration.ReturnType + " " + delegateDeclaration.Identifier.ValueText + delegateDeclaration.TypeParameterList + delegateDeclaration.ParameterList,
            CS.OperatorDeclarationSyntax operatorDeclaration => operatorDeclaration.ReturnType + " operator " + operatorDeclaration.OperatorToken + operatorDeclaration.ParameterList.ToString(),
            _ => node.ToString().Split('\n')[0].TrimEnd('\r') };
        var containingType = string.Join(".", new[] { namespaceName, string.Join(".", node.Ancestors().Reverse().Select(TypeKey).Where(value => value.Length > 0)) }.Where(value => value.Length > 0));
        var typeIdentity = string.Join(".", new[] { containingType, TypeKey(node) is { Length: > 0 } typeKey ? typeKey : name }.Where(value => value.Length > 0));
        var identity = string.Join("|", project, containingType, kind, signature);
        var tokens = node switch { VB.TypeBlockSyntax type => type.BlockStatement.ChildTokens(), VB.EnumBlockSyntax type => type.EnumStatement.ChildTokens(),
            VB.ModifiedIdentifierSyntax identifier => identifier.Ancestors().OfType<VB.FieldDeclarationSyntax>().First().ChildTokens(), _ => node.ChildTokens() };
        var modifiers = tokens.Where(token => vb ? Microsoft.CodeAnalysis.VisualBasic.VisualBasicExtensions.IsKeyword(token)
            : Microsoft.CodeAnalysis.CSharp.CSharpExtensions.IsKeyword(token)).Select(token => token.ValueText).ToArray();
        var baseTypes = node switch { VB.TypeBlockSyntax type => type.Inherits.SelectMany(statement => statement.Types).Concat(type.Implements.SelectMany(statement => statement.Types)).Select(type => type.ToString()).ToArray(),
            CS.BaseTypeDeclarationSyntax type => type.BaseList?.Types.Select(type => type.Type.ToString()).ToArray() ?? [], _ => Array.Empty<string>() };
        return new(kind, name, owner, namespaceName, identity, typeIdentity, containingType, Span(extent), parameters, returns, signature,
            modifiers.Any(modifier => modifier.Equals("Partial", StringComparison.OrdinalIgnoreCase)), modifiers,
            modifiers.Any(modifier => modifier.Equals("WithEvents", StringComparison.OrdinalIgnoreCase)), baseTypes);
    }

    static string TypeKey(SyntaxNode node) => node switch
    {
        VB.TypeBlockSyntax type => type.BlockStatement.Identifier.ValueText + "`" + (type.BlockStatement.TypeParameterList?.Parameters.Count ?? 0),
        VB.EnumBlockSyntax type => type.EnumStatement.Identifier.ValueText + "`0",
        CS.TypeDeclarationSyntax type => type.Identifier.ValueText + "`" + (type.TypeParameterList?.Parameters.Count ?? 0),
        CS.EnumDeclarationSyntax type => type.Identifier.ValueText + "`0", _ => ""
    };
    static string QualifiedOwner(Declaration fact) => fact.Owner.Length == 0 ? fact.Name : fact.Owner + "." + fact.Name;
    static int[] Span(SyntaxNode node) { var span = node.GetLocation().GetLineSpan(); return [span.StartLinePosition.Line + 1, span.EndLinePosition.Line + 1]; }
    static string ImportSource(SyntaxNode node) => node is CS.UsingDirectiveSyntax directive ? directive.Name?.ToString() ?? directive.ToString() : ((VB.ImportsStatementSyntax)node).ImportsClauses.ToString();
    static string Owner(SyntaxNode node, bool vb) => string.Join(".", node.Ancestors().Reverse().Select(ancestor => ancestor switch
    { VB.TypeBlockSyntax type => type.BlockStatement.Identifier.ValueText, VB.EnumBlockSyntax type => type.EnumStatement.Identifier.ValueText,
        CS.BaseTypeDeclarationSyntax type => type.Identifier.ValueText, _ => null }).Where(value => value is not null));
    static string? Caller(SyntaxNode node) => node.Ancestors().Select(ancestor => ancestor switch
    { VB.MethodBlockSyntax method => method.SubOrFunctionStatement.Identifier.ValueText, VB.ConstructorBlockSyntax => "New",
        CS.MethodDeclarationSyntax method => method.Identifier.ValueText, CS.ConstructorDeclarationSyntax constructor => constructor.Identifier.ValueText, _ => null }).FirstOrDefault(value => value is not null);
    static Microsoft.CodeAnalysis.VisualBasic.LanguageVersion VbLanguageVersion(string? version)
    {
        var parsed = Microsoft.CodeAnalysis.VisualBasic.LanguageVersion.Latest;
        return string.IsNullOrWhiteSpace(version) || Microsoft.CodeAnalysis.VisualBasic.LanguageVersionFacts.TryParse(version, ref parsed)
            ? parsed : throw new ArgumentException("Unsupported VB LangVersion: " + version);
    }
    static Microsoft.CodeAnalysis.CSharp.LanguageVersion CsLanguageVersion(string? version) => string.IsNullOrWhiteSpace(version) ? Microsoft.CodeAnalysis.CSharp.LanguageVersion.Latest
        : Microsoft.CodeAnalysis.CSharp.LanguageVersionFacts.TryParse(version, out var parsed) ? parsed : throw new ArgumentException("Unsupported C# LangVersion: " + version);

    record ProjectContext(string RootNamespace, string? LanguageVersion, string[] Imports, Dictionary<string, object> Symbols, string[] Diagnostics);
    static ProjectContext ReadProject(string? path, string configuration)
    {
        var symbols = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        if (configuration == "Debug") { symbols["DEBUG"] = true; symbols["TRACE"] = true; }
        if (path is null) return new("", null, [], symbols, ["No project XML; defaults used. No MSBuild evaluation performed."]);
        var document = XDocument.Load(path);
        var root = document.Root ?? throw new ArgumentException("Missing project XML root");
        var ns = root.Name.Namespace;
        var properties = root.Elements(ns + "PropertyGroup").Where(group => group.Attribute("Condition") is null).Elements()
            .GroupBy(element => element.Name.LocalName).ToDictionary(group => group.Key, group => group.Last().Value);
        var diagnostics = new List<string> { "Static XML context only; imports/conditions/targets are not evaluated. Semantics unavailable." };
        var configGroups = root.Elements(ns + "PropertyGroup").Where(group => group.Attribute("Condition")?.Value.Contains(configuration + "|", StringComparison.OrdinalIgnoreCase) == true);
        foreach (var property in configGroups.Elements().Where(element => element.Attribute("Condition") is null)) properties[property.Name.LocalName] = property.Value;
        if (properties.TryGetValue("DefineConstants", out var constants))
        {
            foreach (var part in constants.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries))
            {
                var pair = part.Trim().Split('=', 2); var name = pair[0].Trim();
                if (name.Contains("$(")) { diagnostics.Add("Unevaluated DefineConstants: " + name); continue; }
                symbols[name] = pair.Length == 1 ? true : bool.TryParse(pair[1].Trim(), out var boolean) ? boolean
                    : int.TryParse(pair[1].Trim(), out var integer) ? integer : pair[1].Trim().Trim('"');
            }
        }
        string? Value(string key) => properties.GetValueOrDefault(key);
        if (bool.TryParse(Value("DefineDebug"), out var debug)) symbols["DEBUG"] = debug;
        if (bool.TryParse(Value("DefineTrace"), out var trace)) symbols["TRACE"] = trace;
        var rootNamespace = Value("RootNamespace") ?? (root.Attribute("Sdk") is null ? "" : System.IO.Path.GetFileNameWithoutExtension(path));
        if (rootNamespace.Contains("$(")) { diagnostics.Add("Unevaluated RootNamespace; identity is provisional."); rootNamespace = ""; }
        return new(rootNamespace, Value("LangVersion"), root.Descendants(ns + "Import").Select(element => element.Attribute("Include")?.Value)
            .Where(value => value is not null).Cast<string>().ToArray(), symbols, diagnostics.ToArray());
    }
}