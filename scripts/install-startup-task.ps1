$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$TaskName = "Cloud247"

$Action = New-ScheduledTaskAction -Execute "npm.cmd" -Argument "start" -WorkingDirectory $ProjectDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Starts Cloud 24/7 when this Windows user logs in." -Force | Out-Null

Write-Host "Installed startup task: $TaskName"
Write-Host "It will run after you log in to Windows."
