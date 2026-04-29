# =============================================================================
# test-whatsapp.ps1  —  Simula mensajes de WhatsApp al webhook local
# Uso: .\scripts\test-whatsapp.ps1
# =============================================================================

$APP_SECRET  = "64122aaa0e5c6c108aa71aaf45bdd425"
$WEBHOOK_URL = "http://localhost:3000/webhooks/whatsapp"
$FROM_NUMBER = "5491112345678"   # número que simula ser el cliente
$MSG_COUNTER = 1

function Send-WhatsAppMessage {
    param([string]$Text)

    $payload = @{
        object = "whatsapp_business_account"
        entry  = @(@{
            id      = "1372400203832111"
            changes = @(@{
                field = "messages"
                value = @{
                    messaging_product = "whatsapp"
                    metadata = @{
                        display_phone_number = "15550000001"
                        phone_number_id      = "924938824041848"
                    }
                    contacts = @(@{
                        profile = @{ name = "Usuario Test" }
                        wa_id   = $FROM_NUMBER
                    })
                    messages = @(@{
                        from      = $FROM_NUMBER
                        id        = "wamid.test$script:MSG_COUNTER"
                        timestamp = [string][int][double]::Parse((Get-Date -UFormat %s))
                        type      = "text"
                        text      = @{ body = $Text }
                    })
                }
            })
        })
    } | ConvertTo-Json -Depth 10 -Compress

    # Calcular firma HMAC-SHA256
    $keyBytes  = [System.Text.Encoding]::UTF8.GetBytes($APP_SECRET)
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $hmac      = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key  = $keyBytes
    $hash      = $hmac.ComputeHash($bodyBytes)
    $signature = "sha256=" + (($hash | ForEach-Object { $_.ToString("x2") }) -join "")

    $headers = @{
        "Content-Type"       = "application/json"
        "x-hub-signature-256" = $signature
    }

    try {
        $response = Invoke-RestMethod -Uri $WEBHOOK_URL -Method POST -Body $payload -Headers $headers
        Write-Host "  [servidor] $($response | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
    } catch {
        Write-Host "  [error] $($_.Exception.Message)" -ForegroundColor Red
    }

    $script:MSG_COUNTER++
}

# --------------------------------------------------------------------------
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Simulador de WhatsApp — Fullmindtech" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Número simulado : +$FROM_NUMBER" -ForegroundColor Yellow
Write-Host "  Webhook         : $WEBHOOK_URL" -ForegroundColor Yellow
Write-Host "  Escribí 'salir' para terminar" -ForegroundColor Yellow
Write-Host "-----------------------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  La respuesta del agente aparece en los LOGS del servidor NestJS" -ForegroundColor Green
Write-Host "  (la terminal donde corre 'npm run start:dev')" -ForegroundColor Green
Write-Host ""

while ($true) {
    $input = Read-Host "Vos"
    if ($input -eq "salir") { break }
    if ([string]::IsNullOrWhiteSpace($input)) { continue }

    Send-WhatsAppMessage -Text $input
    Write-Host ""
}

Write-Host ""
Write-Host "Simulación finalizada." -ForegroundColor Cyan
