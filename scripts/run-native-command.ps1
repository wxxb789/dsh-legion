param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $CommandPath,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $CommandArguments
)

& $CommandPath @CommandArguments
exit $LASTEXITCODE
