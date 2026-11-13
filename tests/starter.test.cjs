'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'INICIAR_TESTE_ENVIO.ps1');
const quote = value => "'" + value.replaceAll("'", "''") + "'";

function powershell(command) {
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], {
    cwd: root, encoding: 'utf8', timeout: 15000
  });
  assert.ifError(result.error);
  return result;
}

test('parser literal, whitelist, comentarios e aspas sem expansao', () => {
  const lines = [
    '# comentario', 'APP_ADMIN_KEY="literal$HOME`x#segredo" # comentario',
    "META_ACCESS_TOKEN='token#literal'", 'META_PHONE_NUMBER_ID=123456 # comentario',
    'META_GRAPH_VERSION=v25.0', 'APP_TEST_RECIPIENT=ignorado', 'UNKNOWN=$(throw "executado")'
  ];
  const command = `. ${quote(script)}; $values = ConvertFrom-TestEnv @(${lines.map(quote).join(',')}); $values | ConvertTo-Json -Compress`;
  const result = powershell(command);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    APP_ADMIN_KEY: 'literal$HOME`x#segredo', META_ACCESS_TOKEN: 'token#literal',
    META_PHONE_NUMBER_ID: '123456', META_GRAPH_VERSION: 'v25.0'
  });
});

test('parser rejeita duplicatas e aspas incompletas sem revelar valores', () => {
  for (const lines of [['APP_ADMIN_KEY=segredoFixture', 'APP_ADMIN_KEY=outro'], ['META_ACCESS_TOKEN="segredoFixture']]) {
    const result = powershell(`. ${quote(script)}; try { ConvertFrom-TestEnv @(${lines.map(quote).join(',')}) | Out-Null; exit 9 } catch { Write-Output 'rejeitado'; exit 0 }`);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /rejeitado/);
    assert.doesNotMatch(result.stdout + result.stderr, /segredoFixture/);
  }
});

test('versao aceita URL oficial e rejeita origens diferentes sem expor URL', () => {
  const official = 'https://graph.facebook.com/v24.7/META_PHONE_NUMBER_ID/messages?access_token=segredoFixture';
  const result = powershell(`. ${quote(script)}; $values = ConvertFrom-TestEnv @(${quote('META_GRAPH_VERSION=' + official)}); if ($values['META_GRAPH_VERSION'] -cne 'v24.7') { exit 9 }`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /URL da Meta identificada; usando apenas a versao da API\./);
  assert.doesNotMatch(result.stdout + result.stderr, /https:|segredoFixture|META_PHONE_NUMBER_ID|v24\.7/);
  for (const value of [
    'v24.7',
    'https://graph.facebook.com.evil.invalid/v24.7/',
    'https://graph.facebook.com@evil.invalid/v24.7/',
    'https://evil.invalid/v24.7/',
    'http://graph.facebook.com/v24.7/',
    'https://graph.facebook.com/anything/v24.7/',
    'https://graph.facebook.com/v24.7suffix'
  ]) {
    const unchanged = powershell(`. ${quote(script)}; $values = ConvertFrom-TestEnv @(${quote('META_GRAPH_VERSION=' + value)}); if ($values['META_GRAPH_VERSION'] -cne ${quote(value)}) { exit 9 }; if (($values['META_GRAPH_VERSION'] -cmatch '^v[0-9]+\\.[0-9]+$') -ne ${value === 'v24.7' ? '$true' : '$false'}) { exit 8 }`);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(unchanged.stdout.trim(), '');
  }
});

test('CheckOnly usa fixture UTF8, nao expoe valores nem altera ambiente ou dados', () => {
  const temporary = fs.mkdtempSync(path.join(__dirname, 'starter-fixture-'));
  const fixture = path.join(temporary, 'config.fixture');
  const dataParent = path.join(root, 'server', 'data', 'manual-send-tests');
  const before = fs.existsSync(dataParent) ? fs.readdirSync(dataParent) : [];
  try {
    fs.writeFileSync(fixture, '\ufeff# acentuação\nAPP_ADMIN_KEY="segredoFixture"\nMETA_ACCESS_TOKEN=tokenFixture\nMETA_PHONE_NUMBER_ID=987654321\nMETA_GRAPH_VERSION=v25.0\n');
    const result = powershell(`$env:APP_ADMIN_KEY='herdado'; $env:META_APP_SECRET='preservado'; . ${quote(script)} -CheckOnly -FixtureEnvFile ${quote(fixture)}; function Test-PortAvailable { param([int]$Port); return $true }; $checkExit=Invoke-ManualSendTest; if ($env:APP_ADMIN_KEY -ne 'herdado' -or $env:META_APP_SECRET -ne 'preservado') { throw 'ambiente alterado' }; exit $checkExit`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /APP_ADMIN_KEY: presente=True; formato=True/);
    assert.match(result.stdout, /META_GRAPH_VERSION: presente=True; formato=True/);
    assert.match(result.stdout, /porta8082Livre=True/);
    assert.doesNotMatch(result.stdout + result.stderr, /segredoFixture|tokenFixture|987654321|v25\.0|spring-boot:run/);
    assert.deepEqual(fs.existsSync(dataParent) ? fs.readdirSync(dataParent) : [], before);
    fs.writeFileSync(fixture, 'APP_ADMIN_KEY=segredoFixture\nMETA_ACCESS_TOKEN=tokenFixture\nMETA_PHONE_NUMBER_ID=abc\nMETA_GRAPH_VERSION=invalid\n');
    const invalid = powershell(`. ${quote(script)} -CheckOnly -FixtureEnvFile ${quote(fixture)}; function Test-PortAvailable { param([int]$Port); return $true }; exit (Invoke-ManualSendTest)`);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /META_PHONE_NUMBER_ID: presente=True; formato=False/);
    assert.doesNotMatch(invalid.stdout + invalid.stderr, /segredoFixture|tokenFixture/);
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.join(root, 'tests'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('porta parametrizada chega a verificacao sem iniciar servicos', () => {
  const command = `. ${quote(script)} -CheckOnly -Port 9123; function ConvertFrom-TestEnv { return @{ APP_ADMIN_KEY='fixture'; META_ACCESS_TOKEN='fixture'; META_PHONE_NUMBER_ID='123'; META_GRAPH_VERSION='v24.7' } }; function Test-PortAvailable { param([int]$Port); if ($Port -ne 9123) { throw 'porta incorreta' }; return $false }; $FixtureEnvFile=${quote(script)}; $result=Invoke-ManualSendTest; if ($result -ne 1) { exit 9 }`;
  const result = powershell(command);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /porta9123Livre=False/);
  assert.doesNotMatch(result.stdout, /spring-boot:run|Abra http/);
  const invalid = powershell(`$ErrorActionPreference='Stop'; try { & ${quote(script)} -CheckOnly -Port 1023 } catch { exit 1 }; exit 0`);
  assert.notEqual(invalid.status, 0);
});

test('saida Maven vai ao host e nao contamina o codigo de retorno', () => {
  const source = fs.readFileSync(script, 'utf8');
  const invocation = source.match(/^\s*(& \$maven\.Source spring-boot:run\s*\|\s*Out-Host)\s*$/m);
  assert.ok(invocation, 'A chamada Maven deve encaminhar stdout ao host.');
  assert.match(source, /Out-Host\s*\r?\n\s*return \$LASTEXITCODE/);
  const result = powershell(`function Invoke-FixtureMaven { param([string]$Goal); if ($Goal -ne 'spring-boot:run') { throw 'goal incorreto' }; Write-Output 'LOG_MAVEN_FIXTURE'; $global:LASTEXITCODE=7 }; $maven=@{Source='Invoke-FixtureMaven'}; function Invoke-FixtureStarter { ${invocation[1]}; return $LASTEXITCODE }; $code=Invoke-FixtureStarter; if ($code -isnot [int] -or $code -ne 7) { throw 'stdout contaminou retorno' }; Write-Output 'RETORNO_INTEIRO_OK'`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LOG_MAVEN_FIXTURE/);
  assert.match(result.stdout, /RETORNO_INTEIRO_OK/);
});

test('fixture fora da raiz e fixture no modo execucao sao recusadas antes da leitura', () => {
  for (const command of [
    `& ${quote(script)} -CheckOnly -FixtureEnvFile 'C:\\fixture-fora-do-projeto'; exit $LASTEXITCODE`,
    `& ${quote(script)} -FixtureEnvFile ${quote(path.join(root, 'inexistente.fixture'))}; exit $LASTEXITCODE`
  ]) {
    const result = powershell(command);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Falha no starter/);
  }
});
