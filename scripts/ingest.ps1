# scripts/ingest.ps1
# Usage:
#   $env:INGEST_SECRET='shh'; ./scripts/ingest.ps1 -Username Big-jpg
# Optional environment variable:
#   INGEST_URL (default: https://github-motion-graph.vercel.app/api/ingest)

param(
  [Parameter(Mandatory=$true)][string]$Username
)

$Url = $env:INGEST_URL -or 'https://github-motion-graph.vercel.app/api/ingest'
$IngestSecret = $env:INGEST_SECRET

if (-not $IngestSecret) {
  Write-Error "INGEST_SECRET environment variable is required. Set it with: $env:INGEST_SECRET='your_secret'"
  exit 2
}

Write-Host "Posting ingest request for '$Username' to $Url"

$body = @{ username = $Username } | ConvertTo-Json
try {
  $resp = Invoke-RestMethod -Uri $Url -Method Post -Headers @{ Authorization = "Bearer $IngestSecret" } -ContentType 'application/json' -Body $body -ErrorAction Stop
  $resp | ConvertTo-Json -Depth 5
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
