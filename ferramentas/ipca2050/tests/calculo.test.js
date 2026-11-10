// Testes do cálculo. Rodar na pasta ferramentas/ipca2050:  node --test
// Todos os valores são FICTÍCIOS. Os esperados vieram de uma implementação
// independente em Python, não deste módulo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    diasEntre, mediaGeometrica, taxaMediaPonderada, aliquotaIR,
    calcularLote, aportesFuturos, datasDoGrafico, simular, aporteParaMeta,
} from '../calculo.js';

const TABELA_IR = [
    { ateDias: 180, aliquota: 0.225 },
    { ateDias: 360, aliquota: 0.20 },
    { ateDias: 720, aliquota: 0.175 },
    { ateDias: null, aliquota: 0.15 },
];

function perto(atual, esperado, tolerancia = 1e-6) {
    assert.ok(Math.abs(atual - esperado) <= tolerancia, `${atual} != ${esperado}`);
}

test('dias corridos entre datas', () => {
    assert.equal(diasEntre('2030-01-01', '2034-01-01'), 1461);
    assert.equal(diasEntre('2030-01-01', '2030-01-01'), 0);
    assert.equal(diasEntre('2030-03-01', '2030-02-28'), -1);
});

test('faixas de IR nos limites', () => {
    assert.equal(aliquotaIR(180, TABELA_IR), 0.225);
    assert.equal(aliquotaIR(181, TABELA_IR), 0.20);
    assert.equal(aliquotaIR(360, TABELA_IR), 0.20);
    assert.equal(aliquotaIR(361, TABELA_IR), 0.175);
    assert.equal(aliquotaIR(720, TABELA_IR), 0.175);
    assert.equal(aliquotaIR(721, TABELA_IR), 0.15);
});

test('média geométrica', () => {
    perto(mediaGeometrica([0.10, 0]), Math.sqrt(1.1) - 1, 1e-12);
    perto(mediaGeometrica([0.05, 0.05, 0.05]), 0.05, 1e-12);
});

test('taxa média ponderada pelo valor', () => {
    perto(taxaMediaPonderada([{ valor: 1000, taxa: 0.06 }, { valor: 3000, taxa: 0.07 }]), 0.0675, 1e-12);
    assert.equal(taxaMediaPonderada([]), null);
});

test('lote longo (4 anos exatos, IR 15%)', () => {
    const r = calcularLote({ data: '2030-01-01', valor: 1000, taxa: 0.06 }, '2034-01-01',
        { inflacao: 0.04, custodiaAnual: 0.002, tabelaIR: TABELA_IR });
    perto(r.anos, 4, 1e-12);
    perto(r.bruto, 1476.9194784587778);
    perto(r.custodia, 11.779956997979792);
    perto(r.ir, 69.77092821911971);
    perto(r.liquido, 1395.3685932416784);
});

test('lote curto (180 dias, IR 22,5%)', () => {
    const r = calcularLote({ data: '2030-01-01', valor: 500, taxa: 0.07 }, '2030-06-30',
        { inflacao: 0.05, custodiaAnual: 0.002, tabelaIR: TABELA_IR });
    perto(r.bruto, 529.5330622628186);
    perto(r.custodia, 0.5221866822217278);
    perto(r.ir, 6.527447005634307);
    perto(r.liquido, 522.4834285749627);
});

test('lote no dia do resgate vale o investido; lote futuro vale zero', () => {
    const p = { inflacao: 0.05, custodiaAnual: 0.002, tabelaIR: TABELA_IR };
    assert.equal(calcularLote({ data: '2030-01-01', valor: 500, taxa: 0.07 }, '2030-01-01', p).liquido, 500);
    assert.equal(calcularLote({ data: '2030-01-02', valor: 500, taxa: 0.07 }, '2030-01-01', p).liquido, 0);
});

test('aportes futuros: do mês seguinte até julho/2050, dia 15', () => {
    const lista = aportesFuturos({ hoje: '2026-11-09', dia: 15, ultimoMes: '2050-07', valor: 100, taxa: 0.06 });
    assert.equal(lista[0].data, '2026-12-15');
    assert.equal(lista.at(-1).data, '2050-07-15');
    assert.equal(lista.length, 1 + 23 * 12 + 7);
    // virada de ano
    assert.equal(aportesFuturos({ hoje: '2026-12-20', dia: 15, ultimoMes: '2027-02', valor: 1, taxa: 0 })[0].data, '2027-01-15');
});

test('datas do gráfico começam hoje e terminam no vencimento', () => {
    const d = datasDoGrafico('2029-11-09', '2030-08-15', 15);
    assert.equal(d[0], '2029-11-09');
    assert.equal(d[1], '2029-12-15');
    assert.equal(d.at(-1), '2030-08-15');
    assert.equal(d.length, 1 + 9);
});

const CONFIG_FICTICIO = {
    vencimento: '2030-08-15',
    ipcaAnual: [{ ano: 1, taxa: 0.10 }, { ano: 2, taxa: 0 }],
    custodiaAnual: 0.002,
    aliquotasIR: TABELA_IR,
    diaAporteFuturo: 15,
    ultimoMesAporteFuturo: '2030-07',
};

test('simulação completa com dados fictícios', () => {
    const r = simular({
        hoje: '2029-11-09',
        config: CONFIG_FICTICIO,
        aporteMensal: 700,
        aportes: [
            { data: '2029-11-09', valor: 1000, taxa: 0.06 },
            { data: '2029-11-09', valor: 3000, taxa: 0.07 },
        ],
    });
    perto(r.inflacao, 0.04880884817015163, 1e-12);
    perto(r.taxaMedia, 0.0675, 1e-12);
    assert.equal(r.totalAportado, 4000);
    assert.equal(r.numeroAportes, 2);
    assert.equal(r.numeroAportesFuturos, 8);
    perto(r.existentes.bruto, 4360.512779466507);
    perto(r.existentes.liquido, 4283.079647426632);
    perto(r.existentes.real, 4129.9713093120245);
    perto(r.comAportes.bruto, 10204.025707229834);
    perto(r.comAportes.liquido, 10071.863935285563);
    perto(r.comAportes.real, 9711.822452103119);
    // o último ponto do gráfico é o próprio vencimento
    perto(r.serie.at(-1).comAportesLiquido, r.comAportes.liquido, 1e-9);
    perto(r.serie.at(-1).existentesBruto, r.existentes.bruto, 1e-9);
});

test('valor real fica em R$ da data do primeiro aporte, mesmo anos depois', () => {
    const r = simular({
        hoje: '2030-02-01', // depois do primeiro aporte
        config: CONFIG_FICTICIO,
        aporteMensal: 700,
        aportes: [
            { data: '2030-01-20', valor: 3000, taxa: 0.07 }, // fora de ordem de propósito
            { data: '2029-11-09', valor: 1000, taxa: 0.06 },
        ],
    });
    assert.equal(r.dataBaseReal, '2029-11-09');
    assert.equal(r.numeroAportesFuturos, 5);
    perto(r.existentes.liquido, 4225.273080755658);
    perto(r.existentes.real, 4074.2311686904527);
    perto(r.comAportes.liquido, 7802.232576850858);
    perto(r.comAportes.real, 7523.324183414136);
});

test('sem aportes: cenário com aportes mensais fica vazio', () => {
    const r = simular({ hoje: '2029-11-09', config: CONFIG_FICTICIO, aporteMensal: 700, aportes: [] });
    assert.equal(r.taxaMedia, null);
    assert.equal(r.comAportes, null);
    assert.equal(r.existentes.liquido, 0);
    assert.equal(r.serie[0].comAportesLiquido, null);
});

test('aporte mensal para a meta: valor real é linear no aporte e o resultado bate a meta', () => {
    const base = {
        hoje: '2029-11-09',
        config: CONFIG_FICTICIO,
        aportes: [
            { data: '2029-11-09', valor: 1000, taxa: 0.06 },
            { data: '2029-11-09', valor: 3000, taxa: 0.07 },
        ],
    };
    const r = simular({ ...base, aporteMensal: 700 });
    // linearidade: existentes + 700 × (real por R$ 1/mês) = cenário com aportes
    perto(r.existentes.real + 700 * r.realPorRealMensal, r.comAportes.real, 1e-9);

    const meta = 9000; // fictícia
    const aporte = aporteParaMeta(r, meta);
    assert.ok(simular({ ...base, aporteMensal: aporte }).comAportes.real >= meta);
    assert.ok(simular({ ...base, aporteMensal: aporte - 0.01 }).comAportes.real < meta);
    // não depende do aporte mensal que está na tela
    assert.equal(aporteParaMeta(simular({ ...base, aporteMensal: 50 }), meta), aporte);

    // existentes já passam da meta
    assert.equal(aporteParaMeta(r, 1000), 0);
    // sem aportes não há taxa média para projetar
    assert.equal(aporteParaMeta(simular({ ...base, aportes: [], aporteMensal: 700 }), meta), null);
});
