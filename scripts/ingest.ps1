# scripts/ingest.ps1
# Usage:
#   $env:INGEST_SECRET='shh'; ./scripts/ingest.ps1 -Username Big-jpg
# Optional environment variable:
#   INGEST_URL (default: https://github-motion-graph.vercel.app/api/ingest)

param(
  [string]$Username,
  [ValidateSet('public', 'private', 'all')][string]$Visibility = 'public',
  [switch]$ExcludeForks,
  [switch]$DefaultBranchOnly,
  [string[]]$Branches,
  [string[]]$RepositoryNames,
  [ValidateSet('OWNER', 'COLLABORATOR', 'ORGANIZATION_MEMBER')]
  [string[]]$Affiliations = @('OWNER', 'COLLABORATOR', 'ORGANIZATION_MEMBER')
)

$Url = if ($env:INGEST_URL) {
  $env:INGEST_URL
} else {
  'https://github-motion-graph.vercel.app/api/ingest'
}
$IngestSecret = $env:INGEST_SECRET

if (-not $IngestSecret) {
  Write-Error "INGEST_SECRET environment variable is required. Set it with: $env:INGEST_SECRET='your_secret'"
  exit 2
}

if ($Username) {
  Write-Host "Posting ingest request for authenticated viewer '$Username' to $Url"
} else {
  Write-Host "Posting ingest request for the authenticated GH_TOKEN viewer to $Url"
}

$payload = @{
  visibility = $Visibility
  includeForks = -not $ExcludeForks.IsPresent
  allBranches = -not $DefaultBranchOnly.IsPresent
  affiliations = $Affiliations
}
if ($Username) {
  $payload.username = $Username
}
if ($Branches -and $Branches.Count -gt 0) {
  $payload.branches = $Branches
}
if ($RepositoryNames -and $RepositoryNames.Count -gt 0) {
  $payload.repositoryNames = $RepositoryNames
}
$body = $payload | ConvertTo-Json -Depth 4
try {
  $resp = Invoke-RestMethod -Uri $Url -Method Post -Headers @{ Authorization = "Bearer $IngestSecret" } -ContentType 'application/json' -Body $body -ErrorAction Stop
  $resp | ConvertTo-Json -Depth 5
  if ($resp.success -ne $true) {
    Write-Host "Ingestion did not complete successfully. Review the failure list above." -ForegroundColor Red
    exit 1
  }
} catch {
  if ($_.Exception.Response) {
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $text = $reader.ReadToEnd()
    Write-Error "HTTP error: $text"
  } else {
    Write-Error $_.Exception.Message
  }
  exit 1
}
