# OpenCode external notify - no third-party modules (tray balloon ~4s).
# Env from OpenCode: OPENCODE_NOTIFY_KIND, OPENCODE_QUESTION_PREVIEW, OPENCODE_SESSION_ID, etc.
# Seeded to %USERPROFILE%\.config\opencode\msg.ps1 on Windows when missing.

$title = "OpenCode"
$body = if (-not [string]::IsNullOrWhiteSpace($env:OPENCODE_QUESTION_PREVIEW)) {
  $env:OPENCODE_QUESTION_PREVIEW
} else {
  switch ($env:OPENCODE_NOTIFY_KIND) {
    "question" { "Your input is needed" }
    "idle" { "Ready for your input" }
    default { "Notification" }
  }
}
if ($body.Length -gt 256) {
  $body = $body.Substring(0, 252) + "..."
}

# Optional: use BurntToast if you install it ( Install-Module BurntToast -Scope CurrentUser )
if (Get-Module -ListAvailable -Name BurntToast) {
  Import-Module BurntToast
  New-BurntToastNotification -Text $title, $body
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = [System.Drawing.SystemIcons]::Information
$ni.Text = $title
$ni.Visible = $true
$ni.ShowBalloonTip(4000, $title, $body, [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Seconds 5
$ni.Visible = $false
$ni.Dispose()
