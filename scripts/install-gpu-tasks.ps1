#Requires -RunAsAdministrator
param(
    [Parameter(Mandatory = $true)][int]$LimitWatts,
    [int]$RestoreWatts = 0,
    [string]$ApplyTaskName = 'MeowyFooocusPowerLimit',
    [string]$RestoreTaskName = 'MeowyFooocusPowerRestore'
)

$smi = Join-Path $env:SystemRoot 'System32\nvidia-smi.exe'
if (-not (Test-Path $smi)) { $smi = 'nvidia-smi.exe' }

if ($RestoreWatts -le 0) {
    $RestoreWatts = [int][double](& $smi --query-gpu=power.default_limit --format=csv,noheader,nounits)
}

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 1)

$apply = New-ScheduledTaskAction -Execute $smi -Argument "-pl $LimitWatts"
Register-ScheduledTask -TaskName $ApplyTaskName -Action $apply -Principal $principal -Settings $settings -Force | Out-Null

$restore = New-ScheduledTaskAction -Execute $smi -Argument "-pl $RestoreWatts"
Register-ScheduledTask -TaskName $RestoreTaskName -Action $restore -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Created '$ApplyTaskName' (-pl $LimitWatts) and '$RestoreTaskName' (-pl $RestoreWatts)."
Write-Host "Set gpu.method to 'scheduled-task' in config.json; the bot can now switch limits without elevation."
