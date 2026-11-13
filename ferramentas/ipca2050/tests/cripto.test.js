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

test('aporte de ação: tipo e ticker vão dentro da parte cifrada e a página decifra', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'ipca2050-teste-'));
    try {
        const keys = await gerarChaves(SENHA_FICTICIA);
        const caminhoKeys = join(pasta, 'keys.json');
        const caminhoData = join(pasta, 'data.json');
        writeFileSync(caminhoKeys, JSON.stringify(keys));
        writeFileSync(caminhoData, JSON.stringify({ version: 1, entries: [] }));
        const saida = rodarScript(['--tipo', 'acao', '--data', '2031-05-20', '--ticker', 'abcd4f', '--quantidade', '7', '--valor', '123.45', '--keys', caminhoKeys, '--arquivo', caminhoData]);
        assert.ok(!saida.includes('123.45') && !saida.includes('ABCD'), 'o script imprimiu o aporte');
        const dados = JSON.parse(readFileSync(caminhoData, 'utf8'));
        const texto = JSON.stringify(dados);
        assert.ok(!texto.includes('acao') && !texto.includes('ABCD'), 'tipo ou ticker em claro no data.json');
        const chave = await abrirChavePrivada(keys, SENHA_FICTICIA);
        assert.deepEqual(await decifrarEntrada(chave, dados.entries[0]), { tipo: 'acao', data: '2031-05-20', ticker: 'ABCD4F', quantidade: 7, valor: 123.45 });

        const base = ['--tipo', 'acao', '--data', '2031-05-20', '--keys', caminhoKeys, '--arquivo', caminhoData];
        assert.throws(() => rodarScript([...base, '--ticker', 'ABCD4', '--quantidade', '7'])); // falta o valor
        assert.throws(() => rodarScript([...base, '--ticker', 'XPTO', '--quantidade', '7', '--valor', '10'])); // ticker inválido
        assert.throws(() => rodarScript([...base, '--ticker', 'ABCD4', '--quantidade', '7', '--valor', '10', '--taxa', '0.06']));
        assert.throws(() => rodarScript(['--data', '2031-05-20', '--valor', '10', '--taxa', '0.06', '--ticker', 'ABCD4', '--keys', caminhoKeys, '--arquivo', caminhoData]));
    } finally {
        rmSync(pasta, { recursive: true, force: true });
    }
});

// Sincronização Notion -> data.json, com páginas FICTÍCIAS no formato da API do Notion
const SINCRONIZAR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'sincronizar_notion.py');
const titulo = t => ({ title: [{ plain_text: t }] });
const num = n => ({ number: n });
const paginaIpca = (id, data, valor, taxa) => ({ id, properties: { Data: titulo(data), Valor: num(valor), 'Taxa fixa': num(taxa) } });
const paginaFii = (id, data, cotas, valor, origem) => ({ id, properties: { Data: titulo(data), Cotas: num(cotas), Valor: num(valor), Origem: { select: origem ? { name: origem } : null } } });

test('sincronização: importa só linhas novas, cifradas, sem repetir e sem mostrar valores', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'ipca2050-teste-'));
    try {
        const keys = await gerarChaves(SENHA_FICTICIA);
        const arq = n => join(pasta, n);
        writeFileSync(arq('keys.json'), JSON.stringify(keys));
        writeFileSync(arq('config.json'), JSON.stringify({ sincronizacao: { notion: { ipca: 'x', fii: 'y' } } }));
        writeFileSync(arq('data.json'), JSON.stringify({ version: 1, entries: [] }));
        const paginas = {
            ipca: [
                paginaIpca('11111111-1111-4111-8111-111111111111', '15/02/2031', 1234.56, 0.0612),
                paginaIpca('22222222-2222-4222-8222-222222222222', '2031-02-15', 10, 0.06), // data fora do formato
                { ...paginaIpca('33333333-3333-4333-8333-333333333333', '15/03/2031', 10, 0.06), archived: true },
            ],
            fii: [
                paginaFii('44444444-4444-4444-8444-444444444444', '16/02/2031', 3, 29.61),
                paginaFii('55555555-5555-4555-8555-555555555555', '16/02/2031', 2.5, 20), // cota fracionada
            ],
        };
        writeFileSync(arq('paginas.json'), JSON.stringify(paginas));
        const rodar = () => execFileSync(PYTHON, [SINCRONIZAR, '--keys', arq('keys.json'), '--arquivo', arq('data.json'), '--config', arq('config.json'), '--paginas', arq('paginas.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

        const saida = rodar();
        assert.match(saida, /2 aporte\(s\) novo\(s\).*2 linha\(s\) ignorada\(s\)/);
        assert.ok(!/1234|29[.,]61|2031/.test(saida), 'a saída mostrou valores');
        const dados = JSON.parse(readFileSync(arq('data.json'), 'utf8'));
        assert.equal(dados.entries.length, 2);
        assert.equal(dados.importados.length, 2);
        assert.ok(!/1234|29\.61|fii|2031/.test(JSON.stringify(dados)), 'valor em claro no data.json');
        const chave = await abrirChavePrivada(keys, SENHA_FICTICIA);
        assert.deepEqual(await decifrarEntrada(chave, dados.entries[0]), { data: '2031-02-15', valor: 1234.56, taxa: 0.0612 });
        assert.deepEqual(await decifrarEntrada(chave, dados.entries[1]), { tipo: 'fii', data: '2031-02-16', cotas: 3, preco: 9.87 });

        // rodar de novo não duplica; uma linha nova entra
        paginas.fii.push(paginaFii('66666666-6666-4666-8666-666666666666', '15/04/2031', 1, 9.9, 'Rendimento'));
        paginas.fii.push(paginaFii('77777777-7777-4777-8777-777777777777', '16/04/2031', 1, 9.9, 'Aporte'));
        writeFileSync(arq('paginas.json'), JSON.stringify(paginas));
        assert.match(rodar(), /^2 aporte\(s\) novo\(s\)/);
        assert.match(rodar(), /^0 aporte\(s\) novo\(s\)/);
        const depois = JSON.parse(readFileSync(arq('data.json'), 'utf8'));
        assert.equal(depois.entries.length, 4);
        assert.ok(!/rendimento/i.test(JSON.stringify(depois)), 'origem em claro no data.json');
        assert.deepEqual(await decifrarEntrada(chave, depois.entries[2]), { tipo: 'fii', data: '2031-04-15', cotas: 1, preco: 9.9, origem: 'rendimento' });
        assert.deepEqual(await decifrarEntrada(chave, depois.entries[3]), { tipo: 'fii', data: '2031-04-16', cotas: 1, preco: 9.9 });
    } finally {
        rmSync(pasta, { recursive: true, force: true });
    }
});

test('cifrarEntrada (chave pública) volta com decifrarEntrada (privada)', async () => {
    const { cifrarEntrada } = await import('../cripto.js');
    const keys = await gerarChaves(SENHA_FICTICIA);
    const entrada = await cifrarEntrada(keys.publicKeySpki, { token: 'ficticio_123' });
    assert.ok(!JSON.stringify(entrada).includes('ficticio'));
    const chave = await abrirChavePrivada(keys, SENHA_FICTICIA);
    assert.deepEqual(await decifrarEntrada(chave, entrada), { token: 'ficticio_123' });
});

test('add_aporte: --origem rendimento só para FII', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'ipca2050-teste-'));
    try {
        const keys = await gerarChaves(SENHA_FICTICIA);
        const k = join(pasta, 'keys.json'), d = join(pasta, 'data.json');
        writeFileSync(k, JSON.stringify(keys));
        writeFileSync(d, JSON.stringify({ version: 1, entries: [] }));
        rodarScript(['--tipo', 'fii', '--data', '2031-05-15', '--cotas', '2', '--preco', '9.5', '--origem', 'rendimento', '--keys', k, '--arquivo', d]);
        const chave = await abrirChavePrivada(keys, SENHA_FICTICIA);
        const e = JSON.parse(readFileSync(d, 'utf8')).entries[0];
        assert.deepEqual(await decifrarEntrada(chave, e), { tipo: 'fii', data: '2031-05-15', cotas: 2, preco: 9.5, origem: 'rendimento' });
        assert.throws(() => rodarScript(['--data', '2031-05-15', '--valor', '10', '--taxa', '0.06', '--origem', 'rendimento', '--keys', k, '--arquivo', d]));
    } finally {
        rmSync(pasta, { recursive: true, force: true });
    }
});

const sel = nome => ({ select: nome ? { name: nome } : null });
const paginaAcao = (id, data, ticker, operacao, qtd, valor, origem) => ({
    id, properties: { Data: titulo(data), Ticker: sel(ticker), 'Operação': sel(operacao), Quantidade: num(qtd), 'Valor total': num(valor), Origem: sel(origem) },
});

test('sincronização de ações e profunda: compra, venda, origem e reconstrução a partir do Notion', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'ipca2050-teste-'));
    try {
        const keys = await gerarChaves(SENHA_FICTICIA);
        const arq = n => join(pasta, n);
        writeFileSync(arq('keys.json'), JSON.stringify(keys));
        writeFileSync(arq('config.json'), JSON.stringify({ sincronizacao: { notion: { ipca: 'x', fii: 'y', acoes: 'z' } } }));
        writeFileSync(arq('data.json'), JSON.stringify({ version: 1, entries: [] }));
        const paginas = {
            ipca: [paginaIpca('11111111-1111-4111-8111-111111111111', '15/02/2031', 100, 0.06)],
            fii: [],
            acoes: [
                paginaAcao('a1111111-1111-4111-8111-111111111111', '10/03/2031', 'abcd4f', 'Compra', 10, 123.45, null),
                paginaAcao('a2222222-2222-4222-8222-222222222222', '11/03/2031', 'ABCD4F', 'Venda', 4, 60.5, 'Rendimento'), // origem não vale na venda
                paginaAcao('a3333333-3333-4333-8333-333333333333', '12/03/2031', 'EFGH3', 'Compra', 2, 50, 'Rendimento'),
                paginaAcao('a4444444-4444-4444-8444-444444444444', '12/03/2031', 'EFGH3', '', 2, 50, null), // sem operação
            ],
        };
        const gravar = () => writeFileSync(arq('paginas.json'), JSON.stringify(paginas));
        const rodar = (...extra) => execFileSync(PYTHON, [SINCRONIZAR, '--keys', arq('keys.json'), '--arquivo', arq('data.json'), '--config', arq('config.json'), '--paginas', arq('paginas.json'), ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        gravar();
        assert.match(rodar(), /^4 aporte\(s\) novo\(s\).*1 linha\(s\) ignorada\(s\)/);
        const dados = JSON.parse(readFileSync(arq('data.json'), 'utf8'));
        assert.ok(!/ABCD|EFGH|venda|acao|123\.45/i.test(JSON.stringify(dados)), 'ação em claro no data.json');
        const chave = await abrirChavePrivada(keys, SENHA_FICTICIA);
        assert.deepEqual(await decifrarEntrada(chave, dados.entries[1]), { tipo: 'acao', data: '2031-03-10', ticker: 'ABCD4F', quantidade: 10, valor: 123.45 });
        assert.deepEqual(await decifrarEntrada(chave, dados.entries[2]), { tipo: 'acao', data: '2031-03-11', ticker: 'ABCD4F', quantidade: 4, valor: 60.5, operacao: 'venda' });
        assert.deepEqual(await decifrarEntrada(chave, dados.entries[3]), { tipo: 'acao', data: '2031-03-12', ticker: 'EFGH3', quantidade: 2, valor: 50, origem: 'rendimento' });

        // profunda com linha incompleta: cancela sem gravar
        assert.throws(() => rodar('--profunda'), /linha\(s\) com dados incompletos/);
        assert.equal(JSON.parse(readFileSync(arq('data.json'), 'utf8')).entries.length, 4);

        // corrige a linha, apaga a venda e edita a compra no "Notion": a profunda refaz tudo
        paginas.acoes = [
            paginaAcao('a1111111-1111-4111-8111-111111111111', '10/03/2031', 'ABCD4F', 'Compra', 8, 100, null),
            paginaAcao('a4444444-4444-4444-8444-444444444444', '12/03/2031', 'EFGH3', 'Compra', 2, 50, null),
        ];
        gravar();
        assert.match(rodar('--profunda'), /Profunda: 4 entrada\(s\) apagada\(s\) e 3 refeita\(s\)/);
        const refeito = JSON.parse(readFileSync(arq('data.json'), 'utf8'));
        assert.equal(refeito.entries.length, 3);
        assert.equal(refeito.importados.length, 3);
        assert.deepEqual(await decifrarEntrada(chave, refeito.entries[1]), { tipo: 'acao', data: '2031-03-10', ticker: 'ABCD4F', quantidade: 8, valor: 100 });
        // e a normal seguinte não duplica nada
        assert.match(rodar(), /^0 aporte\(s\) novo\(s\)/);

        // banco de ações vazio é válido (apagou as de teste); todos vazios, não
        paginas.acoes = [];
        gravar();
        assert.match(rodar('--profunda'), /3 entrada\(s\) apagada\(s\) e 1 refeita\(s\)/);
        paginas.ipca = [];
        gravar();
        assert.throws(() => rodar('--profunda'), /todos os bancos vieram vazios/);
        assert.equal(JSON.parse(readFileSync(arq('data.json'), 'utf8')).entries.length, 1);
    } finally {
        rmSync(pasta, { recursive: true, force: true });
    }
});
