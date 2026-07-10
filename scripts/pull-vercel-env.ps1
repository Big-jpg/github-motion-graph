# scripts/pull-vercel-env.ps1
<#
Pull production env vars from Vercel into a local .env file for testing.
Requirements:
  - Install Vercel CLI: `npm i -g vercel` or use `npx vercel`.
  - Export a non-sensitive token in the environment or rely on interactive login.
    Prefer: $env:VERCEL_TOKEN='your_token'
  - (Optional) Set --project to target a specific project.

Usage:
  $env:VERCEL_TOKEN='xxx'
  ./scripts/pull-vercel-env.ps1 -Project my-project -Environment production -Out '.env.local'
#>

param(
  [string]$Project = '',
  [string]$Environment = 'production',
  [string]$Out = '.env.local',
  [string]$Token = $env:VERCEL_TOKEN
)

if (-not (Get-Command vercel -ErrorAction SilentlyContinue) -and -not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Error "Vercel CLI not found. Install it: npm i -g vercel or use npx vercel"
  exit 2
}

function IsValidVercelToken($token) {
  if (-not $token) { return $false }
  if ($token -match '[\.-]') { return $false }
  return $true
}

$cmd = @('env','pull',$Out,'--environment',$Environment)
if ($Project) { $cmd += @('--project', $Project) }
if ($Token) {
  if (IsValidVercelToken $Token) {
    $cmd += @('--token', $Token)
  } else {
    Write-Warning "VERCEL_TOKEN appears invalid for use with --token. Use a Vercel personal access token, not an OIDC token from .env.local. Falling back to logged-in CLI authentication."
  }
}

Write-Host "Pulling Vercel env vars ($Environment) into $Out"
try {
  if (Get-Command vercel -ErrorAction SilentlyContinue) {
    & vercel @cmd
  } else {
    & npx vercel @cmd
  }
  Write-Host "Done. $Out created. Ensure this file is ignored by git."
} catch {
  Write-Error "Failed to pull Vercel env: $_"
  exit 1
}
