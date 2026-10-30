param(
    [ValidateSet('vscode')][string]$Platform = 'vscode',
    [string]$ProjectRoot,
    [switch]$Check,
    [switch]$Uninstall,
    [switch]$ReplaceLinks,
    [switch]$NoSkills
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PluginRoot = Join-Path $RepoRoot 'understand-anything-plugin'
$StateRoot = Join-Path $HOME '.understand-anything-roslyn-dotnet'
$ManifestPath = Join-Path $StateRoot 'links.json'
$Package = Get-Content -LiteralPath (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json
$PnpmVersion = (($Package.packageManager -split '@')[1] -split '\+')[0]
$LinkRecords = @()
if (Test-Path -LiteralPath $ManifestPath) {
    $LinkRecords = @(Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json)
}

function Save-LinkRecords {
    New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
    ConvertTo-Json -InputObject @($script:LinkRecords) -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
}

function Set-CopilotLink([string]$Link, [string]$Target) {
    $Item = Get-Item -LiteralPath $Link -Force -ErrorAction SilentlyContinue
    $Previous = $null
    if ($Item) {
        if ($Item.LinkType -notin @('Junction', 'SymbolicLink')) { throw "Refusing to replace a real directory: $Link" }
        $Previous = [string]@($Item.Target)[0]
        if ([IO.Path]::GetFullPath($Previous) -eq [IO.Path]::GetFullPath($Target)) { return }
        if (-not $ReplaceLinks) { throw "Conflicting link: $Link -> $Previous. Review it, then use -ReplaceLinks to replace reversibly." }
    }
    $RecordIndex = -1
    for ($Index = 0; $Index -lt $script:LinkRecords.Count; $Index++) {
        if ($script:LinkRecords[$Index].link -eq $Link) { $RecordIndex = $Index; break }
    }
    if ($RecordIndex -lt 0) {
        $script:LinkRecords += [pscustomobject]@{ link = $Link; target = $Target; previous = $Previous }
    } else {
        $script:LinkRecords[$RecordIndex].target = $Target
    }
    Save-LinkRecords
    if ($Item) { $Item.Delete() }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Link) -Force | Out-Null
    New-Item -ItemType Junction -Path $Link -Target $Target | Out-Null
}

if ($Uninstall) {
    foreach ($Record in $LinkRecords) {
        $Item = Get-Item -LiteralPath $Record.link -Force -ErrorAction SilentlyContinue
        if ($Item -and $Item.LinkType -in @('Junction', 'SymbolicLink') -and [string]@($Item.Target)[0] -eq $Record.target) {
            $Item.Delete()
            if ($Record.previous -and (Test-Path -LiteralPath $Record.previous)) {
                New-Item -ItemType Junction -Path $Record.link -Target $Record.previous | Out-Null
            }
        }
    }
    Write-Host 'Copilot links removed where still owned by this installation. Checkout and project data were retained.'
    return
}

foreach ($Command in @('git', 'node', 'dotnet', 'npx.cmd')) { Get-Command $Command -ErrorAction Stop | Out-Null }
$NodeMajor = [int]((& node --version) -replace '^v(\d+).*', '$1')
if ($NodeMajor -lt 22) { throw 'Node.js 22 or newer is required.' }
Push-Location $RepoRoot
try {
    & dotnet --version
    if ($LASTEXITCODE -ne 0) { throw 'Install a .NET SDK matching global.json before setup.' }
    function Invoke-Pnpm([string[]]$Arguments) {
        & npx.cmd --yes "pnpm@$PnpmVersion" @Arguments
        if ($LASTEXITCODE -ne 0) { throw "pnpm failed: $Arguments" }
    }
    if (-not $Check) {
        Invoke-Pnpm @('install', '--frozen-lockfile')
        $Project = Join-Path $PluginRoot 'tools\dotnet-analyzer\DotNetAnalyzer.csproj'
        & dotnet restore $Project --locked-mode
        if ($LASTEXITCODE -ne 0) { throw 'Locked Roslyn restore failed.' }
        & dotnet publish $Project -c Release --no-restore -o (Join-Path $PluginRoot 'tools\dotnet-analyzer\publish')
        if ($LASTEXITCODE -ne 0) { throw 'Roslyn helper publish failed.' }
        foreach ($Name in @('core', 'skill', 'dashboard')) { Invoke-Pnpm @('--filter', "@understand-anything/$Name", 'build') }
    }
    & node (Join-Path $PSScriptRoot 'smoke-dotnet.mjs')
    if ($LASTEXITCODE -ne 0) { throw '.NET smoke checks failed.' }
    if (-not $Check -and -not $NoSkills) {
        $SkillsRoot = Join-Path $PluginRoot 'skills'
        foreach ($Skill in Get-ChildItem -LiteralPath $SkillsRoot -Directory) {
            Set-CopilotLink (Join-Path $HOME ".copilot\skills\$($Skill.Name)") $Skill.FullName
        }
        Set-CopilotLink (Join-Path $HOME '.understand-anything-plugin') $PluginRoot
    }
    if ($ProjectRoot) {
        $ResolvedProject = (Resolve-Path -LiteralPath $ProjectRoot).Path
        if (-not (Test-Path -LiteralPath $ResolvedProject -PathType Container)) { throw 'ProjectRoot must be a directory.' }
        $Sha = [Security.Cryptography.SHA256]::Create()
        try { $Hash = ([BitConverter]::ToString($Sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($ResolvedProject)))).Replace('-', '').Substring(0, 16).ToLowerInvariant() }
        finally { $Sha.Dispose() }
        $OutputRoot = Join-Path $StateRoot "projects\$Hash"
        if (-not $Check) {
            New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
            @{ repoRoot = $RepoRoot; projectRoot = $ResolvedProject; outputRoot = $OutputRoot } | ConvertTo-Json |
                Set-Content -LiteralPath (Join-Path $StateRoot 'config.json') -Encoding UTF8
        }
        Write-Host "Source checkout: $ResolvedProject"
        Write-Host "Separate graph output: $OutputRoot"
        Write-Host "Analyze: node scripts/analyze-dotnet.mjs --project-root `"$ResolvedProject`" --output-root `"$OutputRoot`""
    }
    Write-Host 'Setup verified. Restart VS Code after linking skills. Use node scripts/dotnet-dashboard.mjs after generating a graph.'
} finally {
    Pop-Location
}