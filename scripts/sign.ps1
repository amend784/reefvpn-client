# Self-sign the ReefVPN executable
# For production, replace with a real code signing certificate

$cert = New-SelfSignedCertificate -Type CodeSigning -Subject "CN=ReefVPN" -CertStoreLocation Cert:\CurrentUser\My
$password = ConvertTo-SecureString -String "ReefVPN2026" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath ".\reefvpn-sign.pfx" -Password $password

# Sign the exe
Set-AuthenticodeSignature -FilePath ".\src-tauri\target\release\bundle\nsis\ReefVPN_1.0.0_x64-setup.exe" -Certificate $cert -TimestampServer "http://timestamp.digicert.com"

Write-Host "Signed successfully!"
