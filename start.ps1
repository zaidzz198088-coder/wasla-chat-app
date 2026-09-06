# start.ps1
# شغّل هذا الملف بالضغط عليه يمين -> Run with PowerShell
# يقوم تلقائيا بتثبيت المتطلبات (أول مرة فقط) ثم تشغيل السيرفر وفتح المتصفح

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "   برنامج المراسلات - وصلة" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

# 1) التحقق من وجود Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host ""
    Write-Host "لا يوجد Node.js مثبت على جهازك." -ForegroundColor Red
    Write-Host "حمّله أولاً من: https://nodejs.org (اختر النسخة LTS) ثم شغّل هذا الملف مرة أخرى." -ForegroundColor Yellow
    Read-Host "اضغط Enter للخروج"
    exit 1
}
Write-Host "Node.js موجود: $(node -v)" -ForegroundColor Green

# 2) تثبيت المكتبات (أول مرة فقط، أو إذا حدثت package.json)
if (-not (Test-Path "$root\node_modules")) {
    Write-Host ""
    Write-Host "تثبيت المكتبات المطلوبة لأول مرة (يحتاج اتصال بالإنترنت)..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "فشل تثبيت المكتبات. تأكد من اتصالك بالإنترنت." -ForegroundColor Red
        Read-Host "اضغط Enter للخروج"
        exit 1
    }
}

# 3) تشغيل السيرفر وفتح المتصفح تلقائيا
Write-Host ""
Write-Host "تشغيل السيرفر..." -ForegroundColor Green
Start-Process "http://localhost:3000"
node server.js
