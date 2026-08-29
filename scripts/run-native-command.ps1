param(
  [Parameter(Mandatory = $true)]
  [string] $Payload
)

$bytes = [Convert]::FromBase64String($Payload)
$spec = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
& ([string] $spec.command) @([string[]] $spec.args)
exit $LASTEXITCODE
