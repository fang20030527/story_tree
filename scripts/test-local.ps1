param([switch]$SkipChecks)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = Join-Path $env:LOCALAPPDATA 'context-reader-tools'
$npmBin = Join-Path $toolRoot 'npm\package\bin'
$env:Path = $npmBin + ';' + $env:Path
$pgRoot = Join-Path $toolRoot 'postgres'
$pgData = Join-Path $pgRoot 'test-data'
$pgCtl = Join-Path $pgRoot 'package\native\bin\pg_ctl.exe'
if (!(Test-Path -LiteralPath $pgCtl)) {
    throw 'Local PostgreSQL is missing. See docs/local-testing.md.'
}
& $pgCtl -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) {
    Start-Process -FilePath (Join-Path $pgRoot 'package\native\bin\postgres.exe') `
        -ArgumentList '-D', ('"' + $pgData + '"') -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $pgRoot 'stdout.log') `
        -RedirectStandardError (Join-Path $pgRoot 'stderr.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $connection = [System.Net.Sockets.TcpClient]::new()
        try {
            $connection.Connect('127.0.0.1', 55432)
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 200
        } finally {
            $connection.Dispose()
        }
    }
    if (!$ready) { throw 'Local test PostgreSQL did not start.' }
}
$env:TEST_DATABASE_URL = 'postgresql://context_reader@127.0.0.1:55432/postgres'
if (!$SkipChecks) {
    Push-Location $projectRoot
    try {
        & (Join-Path $npmBin 'npm.cmd') run check
        if ($LASTEXITCODE -ne 0) { throw 'Project checks failed.' }
    } finally {
        Pop-Location
    }
}
