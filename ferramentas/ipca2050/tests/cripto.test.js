// Teste cruzado: o add_aporte.py (Python) cifra e o cripto.js (o mesmo da página) decifra.
// Rodar na pasta ferramentas/ipca2050:  node --test
// Usa um par de chaves FICTÍCIO gerado na hora, numa pasta temporária, e valores fictícios.
// Python: o comando `python` do PATH, ou o da variável de ambiente PYTHON.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarChaves, abrirChavePrivada, decifrarEntrada, SenhaIncorreta } from '../cripto.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'add_aporte.py');
const PYTHON = process.env.PYTHON || 'python';
const SENHA_FICTICIA = 'frase ficticia so para o teste automatico';

function rodarScript(args) {
    return execFileSync(PYTHON, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('entrada gerada pelo Python é decifrada pelo cripto.js', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'ipca2050-teste-'));
    try {
        const keys = await gerarChaves(SENHA_FICTICIA);
        const caminhoKeys = join(pasta, 'keys.json');
        const caminhoData = join(pasta, 'data.json');
        writeFileSync(caminhoKeys, JSON.stringify(keys));
        writeFileSync(caminhoData, JSON.stringify({ version: 1, titulo: 'teste', vencimento: '2050-08-15', entries: [] }));

        const saida1 = rodarScript(['--data', '2031-02-15', '--valor', '1234.56', '--taxa', '0.0612', '--keys', caminhoKeys, '--arquivo', caminhoData]);
        rodarScript(['--data', '2032-03-15', '--valor', '10', '--taxa', '0.05', '--keys', caminhoKeys, '--arquivo', caminhoData]);

        // a saída do script não mostra o aporte
        assert.ok(!saida1.includes('1234'), 'o script imprimiu o valor');
        assert.ok(!saida1.includes('2031'), 'o script imprimiu a data');

        const dados = JSON.parse(readFileSync(caminhoData, 'utf8'));
        assert.equal(dados.entries.length, 2);
        const e = dados.entries[0];
        assert.deepEqual(Object.keys(e).sort(), ['ciphertext', 'id', 'iv', 'wrappedKey']);
        assert.ok(!JSON.stringify(dados).includes('1234'), 'valor em claro no data.json');

        const chave = await abrirChavePrivada(keys, SENHA_FICTICIA);
        assert.equal(chave.extractable, false);
        assert.deepEqual(await decifrarEntrada(chave, dados.entries[0]), { data: '2031-02-15', valor: 1234.56, taxa: 0.0612 });
        assert.deepEqual(await decifrarEntrada(chave, dados.entries[1]), { data: '2032-03-15', valor: 10, taxa: 0.05 });
    } finally {
        rmSync(pasta, { recursive: true, force: true });
    }
});

test('senha errada é recusada', async () => {
    const keys = await gerarChaves(SENHA_FICTICIA);
    await assert.rejects(abrirChavePrivada(keys, SENHA_FICTICIA + 'x'), SenhaIncorreta);
});

test('keys.json tem o formato combinado', async () => {
    const keys = await gerarChaves(SENHA_FICTICIA);
    assert.equal(keys.encryptedPrivateKey.iterations, 600000);
    assert.equal(Buffer.from(keys.encryptedPrivateKey.salt, 'base64').length, 16);
    assert.equal(Buffer.from(keys.encryptedPrivateKey.iv, 'base64').length, 12);
    assert.ok(keys.publicKeySpki.length > 500);
});

test('script avisa quando o IPCA do config.json está atrasado', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'ipca2050-teste-'));
    try {
        const caminhoKeys = join(pasta, 'keys.json');
        const caminhoData = join(pasta, 'data.json');
        const caminhoConfig = join(pasta, 'config.json');
        writeFileSync(caminhoKeys, JSON.stringify(await gerarChaves(SENHA_FICTICIA)));
        writeFileSync(caminhoData, JSON.stringify({ version: 1, entries: [] }));
        const base = ['--data', '2031-02-15', '--valor', '10', '--taxa', '0.06', '--keys', caminhoKeys, '--arquivo', caminhoData, '--config', caminhoConfig];

        writeFileSync(caminhoConfig, JSON.stringify({ ipcaAnual: [{ ano: 2016, taxa: 0.05 }] }));
        assert.match(rodarScript(base), /AVISO: o config\.json tem IPCA até 2016/);

        const anoPassado = new Date().getFullYear() - 1;
        writeFileSync(caminhoConfig, JSON.stringify({ ipcaAnual: [{ ano: anoPassado, taxa: 0.05 }] }));
        assert.doesNotMatch(rodarScript(base), /AVISO/);
    } finally {
        rmSync(pasta, { recursive: true, force: true });
    }
});

test('script recusa taxa em porcentagem e data fora do formato', () => {
    assert.throws(() => rodarScript(['--data', '2031-02-15', '--valor', '10', '--taxa', '6.12']));
    assert.throws(() => rodarScript(['--data', '15/02/2031', '--valor', '10', '--taxa', '0.06']));
});

test('aporte de FII: tipo vai dentro da parte cifrada e a página decifra', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'ipca2050-teste-'));
    try {
        const keys = await gerarChaves(SENHA_FICTICIA);
        const caminhoKeys = join(pasta, 'keys.json');
        const caminhoData = join(pasta, 'data.json');
        writeFileSync(caminhoKeys, JSON.stringify(keys));
        writeFileSync(caminhoData, JSON.stringify({ version: 1, entries: [] }));
        const saida = rodarScript(['--tipo', 'fii', '--data', '2031-04-15', '--cotas', '37', '--preco', '9.87', '--keys', caminhoKeys, '--arquivo', caminhoData]);
        assert.ok(!saida.includes('9.87') && !saida.includes('37 '), 'o script imprimiu o aporte');
        const dados = JSON.parse(readFileSync(caminhoData, 'utf8'));
        assert.ok(!JSON.stringify(dados).includes('fii'), 'tipo em claro no data.json');
        const chave = await abrirChavePrivada(keys, SENHA_FICTICIA);
        assert.deepEqual(await decifrarEntrada(chave, dados.entries[0]), { tipo: 'fii', data: '2031-04-15', cotas: 37, preco: 9.87 });

        // misturar campos dos dois tipos é recusado
        assert.throws(() => rodarScript(['--tipo', 'fii', '--data', '2031-04-15', '--cotas', '3', '--preco', '9', '--taxa', '0.06', '--keys', caminhoKeys, '--arquivo', caminhoData]));
        assert.throws(() => rodarScript(['--data', '2031-04-15', '--valor', '10', '--keys', caminhoKeys, '--arquivo', caminhoData]));
        assert.throws(() => rodarScript(['--tipo', 'fii', '--data', '2031-04-15', '--cotas', '2.5', '--preco', '9', '--keys', caminhoKeys, '--arquivo', caminhoData]));
    } finally {
        rmSync(pasta, { recursive: true, force: true });
    }
});
