# Code Signing for ReefVPN

## Current: Self-signed (development)
Run: `powershell -ExecutionPolicy Bypass -File scripts/sign.ps1`

## Production: EV Code Signing Certificate
For production releases, purchase an EV code signing certificate:

1. **DigiCert** — ~$500/year, removes SmartScreen warnings
2. **Sectigo** — ~$300/year
3. **SSL.com** — ~$200/year

### Steps:
1. Purchase certificate
2. Receive .pfx file
3. Sign with: `signtool sign /f cert.pfx /p PASSWORD /tr http://timestamp.digicert.com /td sha256 ReefVPN_1.0.0_x64-setup.exe`
4. Update CI/CD to auto-sign on release

### Tauri auto-signing:
Add to tauri.conf.json:
```json
"bundle": {
  "windows": {
    "certificateThumbprint": "YOUR_CERT_THUMBPRINT",
    "digestAlgorithm": "sha256",
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```
