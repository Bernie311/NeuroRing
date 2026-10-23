param([Parameter(Mandatory=$true)][string]$PackageDir,
      [Parameter(Mandatory=$true)][string]$FixtureDir,
      [Parameter(Mandatory=$true)][string]$ResultDir)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$report=[ordered]@{passed=$false;checks=@();environment=@{};artifactSha256=$env:NEURORING_TEST_SHA256}
$exe=Join-Path $PackageDir 'NeuroRing.exe'
$script:address=$null
$script:runtimeFile=$null
$blocker=$null
function Passed([string]$name) { $report.checks+= $name; Write-Output ('PASS '+$name) }
function Assert([bool]$condition,[string]$message) { if (-not $condition) { throw $message } }
function Spawn-App([string[]]$Arguments=@('--no-browser')) {
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$exe
    $info.Arguments=[string]::Join(' ',$Arguments)
    $info.WorkingDirectory=$env:TEMP
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    return [Diagnostics.Process]::Start($info)
}
function Launch([string[]]$Arguments=@('--no-browser')) {
    $process=Spawn-App -Arguments $Arguments
    Assert ($process.WaitForExit(30000)) 'Launcher timed out'
    Assert ($process.ExitCode -eq 0) ('Launcher failed: '+$process.ExitCode)
}
function Get-State { return Invoke-RestMethod -Uri ($script:address+'/api/state') -TimeoutSec 4 }
function Await-State([scriptblock]$condition) {
    $limit=[DateTime]::UtcNow.AddSeconds(20)
    do {
        $value=Get-State
        if (& $condition $value) { return $value }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $limit)
    throw ('Unexpected state: '+($value | ConvertTo-Json -Depth 4 -Compress))
}
function Read-Runtime {
    $items=@(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'NeuroRing') -Filter '.neuroring-runtime.json' -Recurse -File)
    Assert ($items.Count -eq 1) 'Expected one runtime record for the new user'
    $script:runtimeFile=$items[0].FullName
    $saved=Get-Content -LiteralPath $script:runtimeFile -Raw | ConvertFrom-Json
    $script:address='http://127.0.0.1:'+$saved.port
    return $saved
}
function Stop-App {
    Launch -Arguments @('--stop','--no-browser')
    Assert (-not (Test-Path -LiteralPath $script:runtimeFile)) 'Runtime file remained after stop'
    $alive=$false
    try { $null=Invoke-RestMethod -Uri ($script:address+'/api/health') -TimeoutSec 1; $alive=$true } catch {}
    Assert (-not $alive) 'Service remained available after stop'
}
try {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=New-Object Security.Principal.WindowsPrincipal($identity)
    Assert (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'Test must run as a standard user'
    # Alternate-credential processes may inherit the runner's environment.
    # Resolve the newly loaded profile by its actual token SID before testing.
    $profileKey='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\'+$identity.User.Value
    $env:USERPROFILE=(Get-ItemProperty -LiteralPath $profileKey).ProfileImagePath
    $env:USERNAME=$identity.Name.Split('\')[-1]
    $env:LOCALAPPDATA=Join-Path $env:USERPROFILE 'AppData\Local'
    $env:APPDATA=Join-Path $env:USERPROFILE 'AppData\Roaming'
    $env:TEMP=Join-Path $env:LOCALAPPDATA 'Temp'
    $env:TMP=$env:TEMP
    $env:PSModulePath=(Join-Path $env:USERPROFILE 'Documents\WindowsPowerShell\Modules')+';'+(Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')+';'+(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules')
    New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
    $report.environment=@{user=$env:USERNAME;isAdministrator=$false;os=(Get-CimInstance Win32_OperatingSystem).Caption;profile=$env:USERPROFILE;computer=$env:COMPUTERNAME}
    $report.environment.packageAcl=(Get-Acl -LiteralPath $PackageDir).Sddl
    $report.environment.exeAcl=(Get-Acl -LiteralPath $exe).Sddl
    $report.environment.exeReadableBytes=[IO.File]::ReadAllBytes($exe).Length
    $report.environment.workingDirectory=(Get-Location).Path
    $env:PATH=Join-Path $env:SystemRoot 'System32'
    Remove-Item Env:PYTHONHOME,Env:PYTHONPATH,Env:VIRTUAL_ENV,Env:NEURORING_DATA_DIR -ErrorAction SilentlyContinue
    $env:NEURORING_CODEX_HOME=Join-Path $env:LOCALAPPDATA 'NeuroRingAcceptance\codex'
    $env:CODEX_HOME=$env:NEURORING_CODEX_HOME
    Assert (-not (Get-Command python.exe,node.exe,git.exe -ErrorAction SilentlyContinue)) 'Developer tools leaked into PATH'
    Assert (-not (Test-Path -LiteralPath $env:NEURORING_CODEX_HOME)) 'Profile must start with no Codex data'
    $wrote=$false
    try { [IO.File]::WriteAllText((Join-Path $PackageDir 'write-probe'),'test'); $wrote=$true } catch {}
    Assert (-not $wrote) 'Package directory must be read-only to the test user'
    Passed 'Fresh standard Windows user; no Codex data; no developer tools on PATH; read-only app folder'

    $blocker=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
    $blocker.Start()
    $occupied=$blocker.LocalEndpoint.Port
    $launchArgs=@('--no-browser','--port',[string]$occupied)
    $one=Spawn-App -Arguments $launchArgs
    $two=Spawn-App -Arguments $launchArgs
    Assert ($one.WaitForExit(30000) -and $two.WaitForExit(30000)) 'Concurrent launch timed out'
    Assert ($one.ExitCode -eq 0 -and $two.ExitCode -eq 0) 'Concurrent launch failed'
    $saved=Read-Runtime
    Assert ($saved.port -ne $occupied) 'Occupied port was not avoided'
    $health=Invoke-RestMethod -Uri ($script:address+'/api/health') -TimeoutSec 3
    Assert ($health.app -eq 'codex-live-screen' -and $health.instance) 'Health identity mismatch'
    Launch
    $again=Read-Runtime
    Assert ($again.pid -eq $saved.pid -and $again.port -eq $saved.port) 'Repeat launch started a second service'
    $services=@(Get-CimInstance Win32_Process -Filter "Name='NeuroRing.exe'" | Where-Object { $_.ExecutablePath -eq $exe })
    Assert ($services.Count -eq 1) 'Expected exactly one packaged background process'
    $dll=(Get-Process -Id $saved.pid).Modules | Where-Object ModuleName -eq 'python311.dll' | Select-Object -First 1
    Assert ($dll.FileName -eq (Join-Path $PackageDir '_internal\python311.dll')) 'Runtime did not load bundled Python'
    Passed 'Concurrent/repeated launch reuses one process; occupied port fallback; bundled Python DLL loaded'

    $null=Await-State { param($s) $s.code -eq 'missing' }
    Assert (-not (Test-Path -LiteralPath $env:NEURORING_CODEX_HOME)) 'Missing-data handling wrote Codex files'
    Passed 'Missing Codex produces onboarding without creating a database'
    foreach ($route in @('/','/app.js','/style.css','/instruments.js','/instruments.css','/task-band.js','/task-band.css','/theme.js','/theme.css')) {
        $response=Invoke-WebRequest -UseBasicParsing -Uri ($script:address+$route) -TimeoutSec 5
        Assert ($response.StatusCode -eq 200 -and $response.RawContentLength -gt 0) ('Missing resource '+$route)
    }
    $rejected=$false
    try { $null=Invoke-WebRequest -UseBasicParsing -Uri ($script:address+'/api/state') -Headers @{Origin='https://example.com'} -TimeoutSec 3 } catch { $rejected=([int]$_.Exception.Response.StatusCode -eq 403) }
    Assert $rejected 'Cross-origin API access was accepted'
    Passed 'All packaged web assets available; cross-origin API rejected'

    New-Item -ItemType Directory -Path $env:NEURORING_CODEX_HOME -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $env:NEURORING_CODEX_HOME '.codex-global-state.json'),'{}')
    [IO.File]::WriteAllText((Join-Path $env:NEURORING_CODEX_HOME 'state_5.sqlite'),'invalid database')
    $null=Await-State { param($s) $s.code -eq 'incompatible' }
    Copy-Item -LiteralPath (Join-Path $FixtureDir 'state_5.sqlite'),(Join-Path $FixtureDir '.codex-global-state.json') -Destination $env:NEURORING_CODEX_HOME -Force
    $fixtureHash=(Get-FileHash -LiteralPath (Join-Path $env:NEURORING_CODEX_HOME 'state_5.sqlite')).Hash
    $data=Await-State { param($s) $s.ok -and $s.threads.Count -eq 3 }
    Assert (-not $data.connection.connected) 'Fresh VM unexpectedly connected to Codex IPC'
    Assert (@($data.threads | Where-Object status -eq 'active').Count -eq 0) 'Offline tasks were falsely marked active'
    Assert ((Get-FileHash -LiteralPath (Join-Path $env:NEURORING_CODEX_HOME 'state_5.sqlite')).Hash -eq $fixtureHash) 'Read-only fixture database changed'
    Passed 'Incompatible data recovers automatically; synthetic records stay offline/unknown; database unchanged'

    $desktop=[Environment]::GetFolderPath('Desktop')
    New-Item -ItemType Directory -Path $desktop -Force | Out-Null
    Launch -Arguments @('--shortcut','--no-browser')
    $link=Join-Path $desktop 'NeuroRing Portable.lnk'
    Assert (Test-Path -LiteralPath $link) 'Desktop shortcut missing'
    $shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($link)
    Assert ($shortcut.TargetPath -eq $exe) 'Shortcut target mismatch'
    Passed 'Desktop shortcut created without administrator privileges'

    $edge=Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path -LiteralPath $edge)) { $edge=Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }
    Assert (Test-Path -LiteralPath $edge) 'Browser unavailable on test image'
    $profile=Join-Path $env:LOCALAPPDATA 'NeuroRingAcceptance\edge-profile'
    $screenshot=Join-Path $ResultDir 'isolated-desktop.png'
    $domFile=Join-Path $ResultDir 'page.html'
    $browserArgs=@('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--window-size=1366,768','--virtual-time-budget=5000',('--user-data-dir="'+$profile+'"'),('--screenshot="'+$screenshot+'"'),'--dump-dom',$script:address)
    $browser=Start-Process -FilePath $edge -ArgumentList $browserArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $domFile -RedirectStandardError (Join-Path $ResultDir 'browser.log')
    Assert ($browser.WaitForExit(45000)) 'Headless browser timed out'
    Assert (Test-Path -LiteralPath $screenshot) 'Browser screenshot missing'
    Assert ((Get-Item -LiteralPath $screenshot).Length -gt 10000) 'Browser screenshot unexpectedly empty'
    $dom=Get-Content -LiteralPath $domFile -Raw -Encoding UTF8
    Assert ($dom.Contains('Synthetic demo task')) 'Browser did not render fixture tasks'
    Passed 'Edge renders the packaged dashboard and synthetic task data in the isolated user session'

    # Exercise the ordinary entry point too; the server is already available.
    $normal=Spawn-App -Arguments @()
    Assert ($normal.WaitForExit(30000) -and $normal.ExitCode -eq 0) 'Normal browser-opening launch failed'
    Assert ((Read-Runtime).pid -eq $saved.pid) 'Normal launch failed to reuse the service'
    Passed 'Ordinary EXE entry point requests browser opening and reuses the service'
    Stop-App
    $probe=New-Object Net.Sockets.TcpClient
    $probe.Connect('127.0.0.1',$occupied);$probe.Dispose()
    Passed 'Stop exits the service and leaves the unrelated occupied port alive'
    [IO.File]::WriteAllText($script:runtimeFile,'corrupt runtime record')
    Launch $launchArgs
    $restarted=Read-Runtime
    $null=Await-State { param($s) $s.ok -eq $true }
    Stop-App
    Passed 'Corrupt runtime record is recoverable; restart and second stop succeed'
    $report.passed=$true
} catch {
    $report.error=$_.Exception.Message
    $report.detail=$_.ScriptStackTrace
    Write-Output ('FAIL '+$report.error)
} finally {
    if ($blocker) { $blocker.Stop() }
    try { Launch -Arguments @('--stop','--no-browser') } catch {}
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $ResultDir 'report.json') -Encoding UTF8
}
if (-not $report.passed) { exit 1 }
