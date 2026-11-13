param(
    [switch]$CheckOnly,
    [ValidateRange(1024, 65535)]
    [int]$Port = 8082,
    [Parameter(DontShow = $true)]
    [string]$FixtureEnvFile
)

$ErrorActionPreference = 'Stop'
$script:TestRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$script:AllowedKeys = @('APP_ADMIN_KEY', 'META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_GRAPH_VERSION')

function Assert-TestPath {
    param([string]$Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    $prefix = $script:TestRoot.TrimEnd('\') + '\'
    if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Caminho fora do projeto.'
    }
    $current = $script:TestRoot
    $parts = @('') + $full.Substring($prefix.Length).Split('\')
    foreach ($part in $parts) {
        if ($part) { $current = [System.IO.Path]::Combine($current, $part) }
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Links e juncoes nao sao permitidos.'
            }
        }
    }
    return $full
}

function ConvertFrom-TestEnv {
    param([string[]]$Lines)
    $values = @{}
    foreach ($line in $Lines) {
        if ($line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$') { continue }
        $name = $Matches[1]
        $tail = $Matches[2]
        if ($script:AllowedKeys -cnotcontains $name) { continue }
        if ($values.ContainsKey($name) -or $tail -notmatch '^=\s*(.*)$') {
            throw 'Configuracao invalida ou duplicada em uma variavel permitida.'
        }
        $raw = $Matches[1]
        if ($raw.StartsWith('"')) {
            if ($raw -notmatch '^"([^"\r\n]*)"\s*(?:#.*)?$') { throw 'Valor entre aspas invalido.' }
            $value = $Matches[1]
        } elseif ($raw.StartsWith("'")) {
            if ($raw -notmatch "^'([^'\r\n]*)'\s*(?:#.*)?$") { throw 'Valor entre aspas invalido.' }
            $value = $Matches[1]
        } else {
            $value = ($raw -replace '\s+#.*$', '').Trim()
            if ($value.StartsWith('#')) { $value = '' }
        }
        if ($name -ceq 'META_GRAPH_VERSION' -and
            $value -cmatch '^https://graph\.facebook\.com/(?<version>v\d+\.\d+)(?:[/?#]|$)') {
            $value = $Matches['version']
            Write-Host 'URL da Meta identificada; usando apenas a versao da API.'
        }
        if ($name -ceq 'META_GRAPH_VERSION' -and
            $value -cmatch '^https://graph\.facebook\.com/(?<version>v\d+\.\d+)(?:[/?#]|$)') {
            $value = $Matches['version']
            Write-Host 'URL da Meta identificada; usando apenas a versao da API.'
        }
        $values[$name] = $value
    }
    return ,$values
}

function Test-PortAvailable {
    param([int]$Port)
    foreach ($endpoint in [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()) {
        if ($endpoint.Port -eq $Port) { return $false }
    }
    return $true
}

function Invoke-ManualSendTest {
    $envFile = Join-Path $script:TestRoot '.env'
    if ($FixtureEnvFile) {
        if (-not $CheckOnly) { throw 'Fixture permitida somente com -CheckOnly.' }
        $envFile = $FixtureEnvFile
    }
    $envFile = Assert-TestPath $envFile
    $encoding = New-Object System.Text.UTF8Encoding($false, $true)
    $values = ConvertFrom-TestEnv ([System.IO.File]::ReadAllLines($envFile, $encoding))
    $valid = $true
    foreach ($name in $script:AllowedKeys) {
        $present = $values.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace($values[$name])
        $format = $present
        if ($name -eq 'META_PHONE_NUMBER_ID') { $format = $present -and $values[$name] -cmatch '^[0-9]+$' }
        if ($name -eq 'META_GRAPH_VERSION') { $format = $present -and $values[$name] -cmatch '^v[0-9]+\.[0-9]+$' }
        Write-Host ('{0}: presente={1}; formato={2}' -f $name, $present, $format)
        if (-not $format) { $valid = $false }
    }
    $java = Get-Command java.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $maven = Get-Command mvn.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $portFree = Test-PortAvailable -Port $Port
    Write-Host ('Java disponivel={0}; Maven disponivel={1}; porta{2}Livre={3}' -f [bool]$java, [bool]$maven, $Port, $portFree)
    if (-not $valid -or -not $java -or -not $maven -or -not $portFree) { return 1 }
    if ($CheckOnly) { return 0 }

    $javaVersion = & $java.Source --version 2>&1
    $javaExit = $LASTEXITCODE
    $mavenVersion = & $maven.Source -version 2>&1
    $mavenExit = $LASTEXITCODE
    if ($javaExit -ne 0 -or $mavenExit -ne 0 -or
        ($javaVersion -join "`n") -notmatch '(?:openjdk|java)\s+(\d+)' -or [int]$Matches[1] -lt 21) {
        throw 'Java 21 ou superior e Maven 3.9 ou superior sao necessarios.'
    }
    if (($mavenVersion -join "`n") -notmatch 'Apache Maven (\d+)\.(\d+)' -or
        ([int]$Matches[1] -lt 3) -or ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -lt 9)) {
        throw 'Maven 3.9 ou superior e necessario.'
    }

    $server = Assert-TestPath (Join-Path $script:TestRoot 'server')
    $data = Assert-TestPath (Join-Path $server ('data\manual-send-tests\' + [guid]::NewGuid().ToString('N')))
    [System.IO.Directory]::CreateDirectory($data) | Out-Null
    $stateFile = Assert-TestPath (Join-Path $data 'bot-state.json')
    [System.IO.File]::WriteAllText($stateFile, '{"active":false}', (New-Object System.Text.UTF8Encoding($false)))

    $overrides = @{
        APP_DATA_DIR = $data
        SERVER_ADDRESS = '127.0.0.1'
        SERVER_PORT = [string]$Port
        META_WEBHOOK_VERIFY_TOKEN = $null
        META_APP_SECRET = $null
        APP_TEST_RECIPIENT = $null
    }
    foreach ($name in $script:AllowedKeys) { $overrides[$name] = $values[$name] }
    $previous = @{}
    foreach ($name in $overrides.Keys) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
        foreach ($name in $overrides.Keys) { [Environment]::SetEnvironmentVariable($name, $overrides[$name], 'Process') }
        Write-Host 'Teste manual isolado; bot pausado, sem resposta automatica ou agendamentos.'
        Write-Host ('Abra http://127.0.0.1:{0}/index.html quando o servidor estiver pronto.' -f $Port)
        Write-Host 'Informe APP_ADMIN_KEY somente no campo local de administracao, sem compartilhar a chave.'
        Write-Host 'Verifique a conexao; preencha o destinatario e clique para enviar hello_world (nao o rascunho).'
        Write-Host 'Nenhuma mensagem e enviada por este starter. Ctrl+C encerra o servidor.'
        Push-Location -LiteralPath $server
        try {
            & $maven.Source spring-boot:run | Out-Host
            return $LASTEXITCODE
        } finally {
            Pop-Location
        }
    } finally {
        foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        exit (Invoke-ManualSendTest)
    } catch {
        Write-Host 'Falha no starter: confira o arquivo de configuracao, formatos, ferramentas e caminhos locais. Nenhum segredo sera exibido.'
        exit 1
    }
}
