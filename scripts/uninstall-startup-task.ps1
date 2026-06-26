$ErrorActionPreference = "Stop"

$TaskName = "Cloud247"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed startup task: $TaskName"
