param(
    [ValidateSet("no_registrado","faq","ticket_y_consulta","interactivo","todos")]
    [string]$Scenario = "todos",
    [string]$ChatUrl  = "http://localhost:3000/chat"
)

function Write-Sep  { Write-Host ("-" * 60) -ForegroundColor DarkGray }
function Write-Head([string]$t) { Write-Host ""; Write-Sep; Write-Host "  $t" -ForegroundColor Cyan; Write-Sep }
function Write-U([string]$m)    { Write-Host "  [VOS]    $m" -ForegroundColor Yellow }
function Write-A([string]$m)    { $m -split "`n" | ForEach-Object { Write-Host "  [AGENTE] $_" -ForegroundColor Green } }
function Write-I([string]$m)    { Write-Host "  [INFO]   $m" -ForegroundColor DarkCyan }
function Write-OK([string]$m)   { Write-Host "  [OK]     $m" -ForegroundColor Green }
function Write-ERR([string]$m)  { Write-Host "  [ERROR]  $m" -ForegroundColor Red }

function Send-Msg([string]$Msg,[string]$Tid) {
    $b = "{`"message`":`"$($Msg -replace '"','\"')`",`"threadId`":`"$Tid`"}"
    try {
        $r = Invoke-RestMethod -Uri $ChatUrl -Method POST -Body $b -ContentType "application/json" -TimeoutSec 60
        return $r.reply
    } catch {
        Write-ERR "HTTP error: $($_.Exception.Message)"
        return $null
    }
}

function Turn([string]$Msg,[string]$Tid) {
    Write-U $Msg
    $r = Send-Msg $Msg $Tid
    if ($r) { Write-A $r }
    Write-Host ""
    Start-Sleep -Milliseconds 400
    return $r
}

# --- Verificar servidor ---
Write-Host ""
Write-Host "  === TEST AGENTE SOPORTE FULLMINDTECH ===" -ForegroundColor Cyan
Write-Host ""
Write-I "Verificando servidor en $ChatUrl..."
try {
    $b = "{`"message`":`"ping`",`"threadId`":`"healthcheck`"}"
    Invoke-RestMethod -Uri $ChatUrl -Method POST -Body $b -ContentType "application/json" -TimeoutSec 5 | Out-Null
    Write-OK "Servidor activo"
} catch {
    Write-ERR "Servidor no responde. Asegurate de que este corriendo npm run start:dev"
    exit 1
}

# ============================================================
# ESCENARIO 1 - NO REGISTRADO
# ============================================================
function Run-E1 {
    Write-Head "ESCENARIO 1 - Persona que NO esta registrada en el sistema"
    Write-I "Simula alguien que no sabe nada y escribe por primera vez"
    $t = "TEST-NOREG-$(Get-Random -Maximum 9999)"
    Turn "hola buenas" $t | Out-Null
    Turn "me dijeron que les escriba aca cuando tenga un problema con el sistema" $t | Out-Null
    Turn "no tengo ni idea que es eso, nunca me lo dieron" $t | Out-Null
    Turn "como puedo recuperar mi codigo de cliente?" $t | Out-Null
}

# ============================================================
# ESCENARIO 2 - CLIENTE REGISTRADO + PREGUNTA FRECUENTE
# TechNova -> Telefono: +5491100000001
# ============================================================
function Run-E2 {
    Write-Head "ESCENARIO 2 - Cliente registrado haciendo pregunta frecuente"
    Write-I "Numero: 5491100000001 (TechNova - registrado en Plane)"
    $t = "5491100000001"
    Turn "buenas tardes" $t | Out-Null
    Turn "como hago para exportar un reporte?" $t | Out-Null
    Turn "perfecto, me quedo claro, gracias" $t | Out-Null
}

# ============================================================
# ESCENARIO 3 - CLIENTE REGISTRADO + PROBLEMA + TICKET
# RetailPlus -> Telefono: +5491100000002
# ============================================================
function Run-E3 {
    Write-Head "ESCENARIO 3 - Problema real, no se resuelve, se crea ticket"
    Write-I "Numero: 5491100000002 (RetailPlus SRL - registrado en Plane)"
    $t = "5491100000002"
    Turn "hola" $t | Out-Null
    Turn "tengo un problema, no puedo ingresar al sistema" $t | Out-Null
    Turn "me dice que mi usuario no existe pero antes funcionaba bien" $t | Out-Null
    Turn "probe varias veces y sigue sin funcionar" $t | Out-Null
    $r = Turn "ninguno de esos pasos funciono" $t
    
    # Intentar obtener el ID del ticket de la respuesta
    $ticketId = $null
    if ($r -match '#(\d+)|SOT-\d+|[A-Z]{2,5}-\d+') { $ticketId = $Matches[0] }

    # Escenario 4 - consulta de estado (nueva conversacion)
    Write-Head "ESCENARIO 4 - Consultar estado de un ticket existente"
    $t2 = "5491100000002-consulta"
    Turn "hola, quiero saber el estado de mi ticket" $t2 | Out-Null
    if ($ticketId) {
        Write-I "Ticket detectado de la conv anterior: $ticketId"
        Turn "el numero es $ticketId" $t2 | Out-Null
    } else {
        Turn "no me acuerdo el numero exacto" $t2 | Out-Null
    }
}

# ============================================================
# ESCENARIO INTERACTIVO
# ============================================================
function Run-Interactivo {
    Write-Head "MODO INTERACTIVO - Escribi vos, responde el agente"
    Write-I "Comandos: 'nuevo' = nueva conversacion, 'salir' = terminar"
    $t = "INT-$(Get-Random -Maximum 9999)"
    Write-I "ThreadId actual: $t"
    Write-Host ""
    while ($true) {
        $in = Read-Host "  Vos"
        if ($in -eq "salir") { break }
        if ($in -eq "nuevo") { $t = "INT-$(Get-Random -Maximum 9999)"; Write-I "Nueva conv: $t"; continue }
        if ([string]::IsNullOrWhiteSpace($in)) { continue }
        $r = Send-Msg $in $t
        if ($r) { Write-A $r }
        Write-Host ""
    }
}

switch ($Scenario) {
    "no_registrado"     { Run-E1 }
    "faq"               { Run-E2 }
    "ticket_y_consulta" { Run-E3 }
    "interactivo"       { Run-Interactivo }
    "todos" { Run-E1; Run-E2; Run-E3; Write-Head "TODOS LOS ESCENARIOS COMPLETADOS" }
}
Write-Host ""; Write-I "Test finalizado."; Write-Host ""
