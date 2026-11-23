# 本地启动梅野工作台（后端 8080 + 前端 3000）

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $repoRoot "backend"
$webDir = Join-Path $repoRoot "web"
$dataDir = Join-Path $repoRoot ".local\project-workbench-debug"
$goBuildCache = Join-Path $repoRoot ".local\cache\go-build"
$goModuleCache = Join-Path $repoRoot ".local\cache\go-mod"
$localUrl = "http://127.0.0.1:3000"
$healthUrl = "http://127.0.0.1:8080/api/health/live"

$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
    throw "未找到 Bun。请先安装 Bun，再运行本地启动脚本。"
}
$bunExe = $bun.Source

function Test-PortListen([int]$Port) {
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1)
    } catch {
        return $false
    }
}

function Test-Http([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        return $false
    }
}

if ((Test-PortListen 8080) -and (Test-PortListen 3000)) {
    Write-Host "梅野工作台已在本地运行，正在打开浏览器..." -ForegroundColor Green
    Start-Process $localUrl
    exit 0
}

if (-not (Test-PortListen 8080)) {
    Write-Host "启动后端 (8080)..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $dataDir, $goBuildCache, $goModuleCache | Out-Null
    $env:CANVAS_BACKEND_ADDR = "127.0.0.1:8080"
    $env:CANVAS_BACKEND_DATA_DIR = $dataDir
    $env:CANVAS_PUBLIC_BASE_URL = $localUrl
    $env:GOCACHE = $goBuildCache
    $env:GOMODCACHE = $goModuleCache
    Start-Process -FilePath "go" -ArgumentList "run", "./cmd/server" `
        -WorkingDirectory $backendDir `
        -RedirectStandardOutput (Join-Path $repoRoot ".local\backend.stdout.log") `
        -RedirectStandardError (Join-Path $repoRoot ".local\backend.stderr.log") `
        -WindowStyle Hidden | Out-Null
}

if (-not (Test-PortListen 3000)) {
    Write-Host "启动前端 (3000)..." -ForegroundColor Cyan
    $viteBinary = Join-Path $webDir "node_modules\.bin\vite"
    if (-not (Test-Path -LiteralPath $viteBinary)) {
        Write-Host "安装前端依赖..." -ForegroundColor Yellow
        Push-Location $webDir
        try { & $bunExe install --frozen-lockfile } finally { Pop-Location }
    }
    $env:VITE_API_PROXY_TARGET = "http://127.0.0.1:8080"
    Start-Process -FilePath $bunExe -ArgumentList "run", "dev" `
        -WorkingDirectory $webDir `
        -RedirectStandardOutput (Join-Path $repoRoot ".local\web.stdout.log") `
        -RedirectStandardError (Join-Path $repoRoot ".local\web.stderr.log") `
        -WindowStyle Hidden | Out-Null
}

$deadline = (Get-Date).AddMinutes(3)
do {
    Start-Sleep -Seconds 2
    if ((Test-Http $healthUrl) -and (Test-PortListen 3000)) {
        Write-Host "梅野工作台已启动：$localUrl" -ForegroundColor Green
        Start-Process $localUrl
        exit 0
    }
} while ((Get-Date) -lt $deadline)

Write-Host "启动超时，请查看 .local\backend.stderr.log 和 .local\web.stderr.log。" -ForegroundColor Red