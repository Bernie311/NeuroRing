param([Parameter(Mandatory=$true)][string]$Archive,
      [Parameter(Mandatory=$true)][string]$ExpectedSha256)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
# This setup changes local users/ACLs and is deliberately restricted to a
# disposable GitHub-hosted runner. Never invoke it on a maintainer workstation.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or -not $env:RUNNER_TEMP) {
    throw 'Run only in a disposable GitHub Actions Windows VM.'
}
$archivePath=(Resolve-Path -LiteralPath $Archive).Path
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'Candidate ZIP hash mismatch' }
$tempBase=[IO.Path]::GetFullPath($env:RUNNER_TEMP)
$root=[IO.Path]::GetFullPath((Join-Path $tempBase ('NeuroRingAcceptance-'+[guid]::NewGuid().ToString('N').Substring(0,8))))
if (-not $root.StartsWith($tempBase+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test path' }
New-Item -ItemType Directory -Path $root | Out-Null
$extract=Join-Path $root '中文 空格路径'
Expand-Archive -LiteralPath $archivePath -DestinationPath $extract
$package=Join-Path $extract 'NeuroRing'
$fixture=Join-Path $root 'fixture'
$results=Join-Path $root 'results'
New-Item -ItemType Directory -Path $results | Out-Null
& python (Join-Path $PSScriptRoot 'make_test_fixture.py') $fixture
if ($LASTEXITCODE -ne 0) { throw 'Fixture generation failed' }
$childScript=Join-Path $root 'test-user.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'test_portable_user.ps1') -Destination $childScript
$testName='nrtest'+[guid]::NewGuid().ToString('N').Substring(0,8)
$password=ConvertTo-SecureString ('Nr!9aA'+[guid]::NewGuid().ToString('N')) -AsPlainText -Force
$user=New-LocalUser -Name $testName -Password $password -AccountNeverExpires -PasswordNeverExpires -Description 'Disposable NeuroRing acceptance test'
Add-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-545') -Member $user
$sid=$user.SID.Value
& icacls $root /grant ('*'+$sid+':(OI)(CI)M') /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare isolated user test directory' }
& icacls $package /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' ('*'+$sid+':(OI)(CI)RX') /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict package folder to read/execute' }
# Apply inheritable rules to the directory, then let files inherit them.
# Applying (OI)(CI) with /inheritance:r to every file can leave files with
# no applicable allow ACE for the standard user.
& icacls (Join-Path $package '*') /reset /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot inherit package read/execute permissions' }
[ordered]@{directory=(Get-Acl -LiteralPath $package).Sddl;executable=(Get-Acl -LiteralPath (Join-Path $package 'NeuroRing.exe')).Sddl} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $results 'package-acl.json') -Encoding UTF8
$credential=[Management.Automation.PSCredential]::new(($env:COMPUTERNAME+'\'+$testName),$password)
$shell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$childScript+'"'),'-PackageDir',('"'+$package+'"'),'-FixtureDir',('"'+$fixture+'"'),'-ResultDir',('"'+$results+'"'))
$env:NEURORING_TEST_SHA256=$ExpectedSha256.ToLowerInvariant()
$exit=1
try {
    $child=Start-Process -FilePath $shell -ArgumentList $arguments -Credential $credential -LoadUserProfile -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $results 'test-output.txt') -RedirectStandardError (Join-Path $results 'test-errors.txt')
    if (-not $child.WaitForExit(240000)) { throw 'Isolated account acceptance timed out' }
    $exit=$child.ExitCode
} finally {
    $evidence=Join-Path $env:GITHUB_WORKSPACE 'isolated-results'
    New-Item -ItemType Directory -Path $evidence -Force | Out-Null
    Copy-Item -LiteralPath $results -Destination (Join-Path $evidence 'acceptance') -Recurse
    [ordered]@{image=$env:ImageOS;imageVersion=$env:ImageVersion;runnerOs=$env:RUNNER_OS;runId=$env:GITHUB_RUN_ID;sha256=$ExpectedSha256;account=$testName} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'runner.json') -Encoding UTF8
    if (Test-Path -LiteralPath (Join-Path $results 'test-output.txt')) { Get-Content -LiteralPath (Join-Path $results 'test-output.txt') }
    if (Test-Path -LiteralPath (Join-Path $results 'test-errors.txt')) { Get-Content -LiteralPath (Join-Path $results 'test-errors.txt') }
}
if ($exit -ne 0) { throw ('Isolated account test failed with exit code '+$exit) }
$report=Get-Content -LiteralPath (Join-Path $results 'report.json') -Raw | ConvertFrom-Json
if (-not $report.passed) { throw 'Acceptance report did not pass' }
Write-Output 'Isolated Windows VM acceptance passed.'

