# VS Code Extension Setup Script for WebdriverIO Tests (PowerShell)
# This script installs required extensions for testing

Write-Host "🔧 Setting up VS Code extensions for testing..." -ForegroundColor Cyan

# Check if VS Code CLI is available
$codeCommand = Get-Command code -ErrorAction SilentlyContinue
if (-not $codeCommand) {
    Write-Host "❌ VS Code CLI not found. Please install VS Code and ensure 'code' command is available." -ForegroundColor Red
    Write-Host "   You can add it via: CMD+Shift+P > 'Shell Command: Install code command in PATH'" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ VS Code CLI found" -ForegroundColor Green

# Function to install extension from VSIX
function Install-FromVsix {
    param(
        [string]$VsixPath,
        [string]$ExtensionName
    )
    
    if (Test-Path $VsixPath) {
        Write-Host "📦 Installing $ExtensionName from VSIX..." -ForegroundColor Yellow
        $result = & code --install-extension $VsixPath --force
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Successfully installed $ExtensionName" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ Failed to install $ExtensionName" -ForegroundColor Red
            return $false
        }
    } else {
        Write-Host "⚠️  VSIX file not found: $VsixPath" -ForegroundColor Yellow
        return $false
    }
}

# Install required extensions
Write-Host "📋 Installing required extensions..." -ForegroundColor Cyan

# Install the shared-state-store extension
$sharedStateVsix = ".\extensions\project-accelerate.shared-state-store.vsix"
$installed = Install-FromVsix -VsixPath $sharedStateVsix -ExtensionName "shared-state-store"

if (-not $installed) {
    Write-Host "💡 To install the shared-state-store extension:" -ForegroundColor Yellow
    Write-Host "   1. Obtain the project-accelerate.shared-state-store.vsix file"
    Write-Host "   2. Place it at: $sharedStateVsix"
    Write-Host "   3. Run this script again"
    Write-Host ""
    Write-Host "🔍 Alternative: Try installing from marketplace (if available):" -ForegroundColor Yellow
    Write-Host "   code --install-extension project-accelerate.shared-state-store"
}

# Check for other VSIX files in extensions directory
Write-Host ""
Write-Host "🔍 Checking for additional extensions..." -ForegroundColor Cyan

if (Test-Path ".\extensions") {
    $vsixFiles = Get-ChildItem -Path ".\extensions" -Filter "*.vsix"
    
    foreach ($vsixFile in $vsixFiles) {
        if ($vsixFile.FullName -ne (Resolve-Path $sharedStateVsix -ErrorAction SilentlyContinue)) {
            $extensionName = $vsixFile.BaseName
            Install-FromVsix -VsixPath $vsixFile.FullName -ExtensionName $extensionName
        }
    }
}

Write-Host ""
Write-Host "🎉 Extension setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Run your tests: npm run wdio"
Write-Host "   2. If tests fail due to missing extensions, check the extensions\ directory"
Write-Host "   3. Consult the extensions\README.md for more help"

# List installed extensions for verification
Write-Host ""
Write-Host "📋 Currently installed extensions (filtered for project-accelerate):" -ForegroundColor Cyan
$extensions = & code --list-extensions | Where-Object { $_ -like "*project-accelerate*" }
if ($extensions) {
    $extensions | ForEach-Object { Write-Host "   $_" }
} else {
    Write-Host "   No project-accelerate extensions found"
} 