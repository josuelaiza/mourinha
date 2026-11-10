// Testes do cálculo. Rodar na pasta ferramentas/ipca2050:  node --test
// Todos os valores são FICTÍCIOS. Os esperados vieram de uma implementação
// independente em Python, não deste módulo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    diasEntre, mediaGeometrica, taxaMediaPonderada, aliquotaIR,
    calcularLote, aportesFuturos, datasDoGrafico, simular, aporteParaMeta,
    simularFii, fiiPorAno, primeiraData, deflator,
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

// FII: cota a R$ 10 pagando R$ 0,10 = 1% ao mês, para dar para conferir à mão.

test('FII mês a mês: cotas inteiras, troco guardado para o mês seguinte', () => {
    const r = simularFii({
        aportes: [{ data: '2030-01-05', cotas: 60, preco: 9 }, { data: '2030-01-10', cotas: 40, preco: 10 }],
        hoje: '2030-01-10', dataFinal: '2030-04-20', inflacao: 0, rendimentoPorCota: 0.10, aporteMensal: 25, dia: 15,
        dataBaseReal: '2030-01-05',
    });
    assert.equal(r.preco, 10); // preço do último aporte
    assert.equal(r.cotasHoje, 100);
    assert.equal(r.investido, 940);
    assert.equal(r.patrimonioHoje, 1000);
    // conta à mão (cota a R$ 10, aporte de R$ 25):
    // fev: rende 10,00 -> só ele compra 1; 10 + 25 = 35 compra 3, sobra 5   (103 cotas)
    // mar: rende 10,30 -> 5 + 10,30 compra 1; 15,30 + 25 compra 4, sobra 0,30 (107)
    // abr: rende 10,70 -> 0,30 + 10,70 = 11 compra 1; 36 compra 3, sobra 6   (110)
    assert.deepEqual(r.meses.map(m => m.data), ['2030-02-15', '2030-03-15', '2030-04-15']);
    assert.deepEqual(r.meses.map(m => m.cotasDoRendimento), [1, 1, 1]);
    assert.deepEqual(r.meses.map(m => m.cotasCompradas), [3, 4, 3]);
    assert.deepEqual(r.meses.map(m => m.cotas), [103, 107, 110]);
    perto(r.meses[0].rendimento, 10, 1e-9);
    perto(r.meses[1].rendimento, 10.3, 1e-9);
    perto(r.meses[2].rendimento, 10.7, 1e-9);
    perto(r.meses[1].sobra, 0.3, 1e-9);
    perto(r.sobra, 6, 1e-9);
    perto(r.patrimonio, 1106, 1e-9);
    perto(r.meses[2].patrimonio, 1106, 1e-9);
    perto(r.rendimentos, 31, 1e-9);
    assert.equal(r.numeroAportesFuturos, 3);
    assert.equal(r.aportadoFuturo, 75);
    perto(r.taxaMensal, 0.01, 1e-12);
    perto(r.ganhoRealEquivalente, Math.pow(1.01, 12) - 1, 1e-12);
    // renda no fim é sobre as cotas (não sobre o troco); inflação 0 -> real = nominal
    perto(r.rendaMensal, 11, 1e-9);
    perto(r.rendaGastavel, 11, 1e-9);
    perto(r.real, 1106, 1e-9);
});

test('FII: rendimento abaixo do preço da cota vai juntando até comprar', () => {
    const r = simularFii({
        aportes: [{ data: '2030-01-15', cotas: 30, preco: 10 }],
        hoje: '2030-01-15', dataFinal: '2030-05-15', inflacao: 0, rendimentoPorCota: 0.10, aporteMensal: 0, dia: 15,
    });
    // rende 3,00 por mês: compra a 1ª cota no 4º mês (3+3+3+3 = 12), sobra 2
    assert.deepEqual(r.meses.map(m => m.cotasDoRendimento), [0, 0, 0, 1]);
    assert.deepEqual(r.meses.map(m => m.cotasCompradas), [0, 0, 0, 1]);
    perto(r.sobra, 2, 1e-9);
    assert.equal(r.numeroAportesFuturos, 0);
});

test('FII: ganho real equivalente, renda gastável, valor real e agrupamento por ano', () => {
    const r = simularFii({
        aportes: [{ data: '2030-11-15', cotas: 1000, preco: 10 }],
        hoje: '2030-11-15', dataFinal: '2032-02-15', inflacao: 0.05, rendimentoPorCota: 0.09, aporteMensal: 100, dia: 15,
    });
    perto(r.taxaMensal, 0.009, 1e-15);
    perto(r.ganhoRealEquivalente, Math.pow(1.009, 12) / 1.05 - 1, 1e-12);
    perto(r.meses[0].rendimento, 90, 1e-9); // 1000 cotas × R$ 0,09
    perto(r.real, r.patrimonio / Math.pow(1.05, diasEntre('2030-11-15', '2032-02-15') / 365.25), 1e-9);
    perto(r.rendaMensal, r.cotasFinal * 0.09, 1e-9);
    perto(r.rendaGastavel, r.cotasFinal * 10 * (1.009 / Math.pow(1.05, 1 / 12) - 1), 1e-9);

    const anos = fiiPorAno(r.meses);
    assert.deepEqual(anos.map(a => a.ano), ['2030', '2031', '2032']);
    assert.deepEqual(anos.map(a => a.meses.length), [1, 12, 2]);
    perto(anos[1].rendimento, r.meses.slice(1, 13).reduce((s, m) => s + m.rendimento, 0), 1e-9);
    assert.equal(anos[1].aporte, 1200);
    assert.equal(anos[1].cotasCompradas, r.meses.slice(1, 13).reduce((s, m) => s + m.cotasCompradas, 0));
    assert.equal(anos[2].cotas, r.cotasFinal);
    perto(anos[2].patrimonio, r.patrimonio, 1e-9);
});

test('FII: rendimento abaixo da inflação não tem renda gastável', () => {
    const r = simularFii({
        aportes: [{ data: '2030-01-15', cotas: 100, preco: 10 }],
        hoje: '2030-01-15', dataFinal: '2031-01-15', inflacao: 0.10, rendimentoPorCota: 0.05, aporteMensal: 0, dia: 15,
    });
    assert.ok(r.ganhoRealEquivalente < 0);
    assert.equal(r.rendaGastavel, 0);
    assert.ok(r.rendaMensal > 0);
});

test('FII: data final hoje não projeta nada; sem aportes devolve null', () => {
    const base = { hoje: '2030-01-15', inflacao: 0.05, rendimentoPorCota: 0.10, aporteMensal: 500, dia: 15 };
    const r = simularFii({ ...base, aportes: [{ data: '2030-01-15', cotas: 3, preco: 10 }], dataFinal: '2030-01-15' });
    assert.equal(r.patrimonio, 30);
    assert.equal(r.meses.length, 0);
    assert.equal(r.numeroAportesFuturos, 0);
    assert.equal(simularFii({ ...base, aportes: [], dataFinal: '2031-01-15' }), null);
});

test('panorama: base real comum e valor do IPCA numa data alvo', () => {
    assert.equal(primeiraData([{ data: '2030-05-01' }], [{ data: '2030-02-01' }, { data: '2031-01-01' }]), '2030-02-01');
    assert.equal(primeiraData([], []), null);
    perto(deflator(0.05, '2030-01-01', '2034-01-01'), Math.pow(1.05, 4), 1e-12);
    assert.equal(deflator(0.05, '2030-01-01', '2029-01-01'), 1);

    const base = {
        hoje: '2029-11-09', config: CONFIG_FICTICIO, aporteMensal: 700,
        aportes: [{ data: '2029-11-09', valor: 1000, taxa: 0.06 }, { data: '2029-11-09', valor: 3000, taxa: 0.07 }],
    };
    // base dada mais antiga deixa o real menor, na proporção da inflação do intervalo
    const r0 = simular(base);
    const r1 = simular({ ...base, dataBaseReal: '2028-11-09' });
    perto(r1.existentes.real, r0.existentes.real / deflator(r0.inflacao, '2028-11-09', '2029-11-09'), 1e-9);
    // na data do vencimento, naData = cenário com aportes; datas além dele ficam no vencimento
    perto(simular({ ...base, dataAlvo: CONFIG_FICTICIO.vencimento }).naData.liquido, r0.comAportes.liquido, 1e-9);
    perto(simular({ ...base, dataAlvo: '2099-01-01' }).naData.liquido, r0.comAportes.liquido, 1e-9);
    // no próprio dia dos aportes, vale o investido
    perto(simular({ ...base, dataAlvo: '2029-11-09' }).naData.liquido, 4000, 1e-9);
});

test('FII: compra com rendimento conta nas cotas, não no investido', () => {
    const r = simularFii({
        aportes: [
            { data: '2030-01-10', cotas: 10, preco: 10 },
            { data: '2030-02-10', cotas: 1, preco: 10.5, origem: 'rendimento' },
        ],
        hoje: '2030-02-10', dataFinal: '2030-02-10', inflacao: 0, rendimentoPorCota: 0.1, aporteMensal: 0, dia: 15,
    });
    assert.equal(r.cotasHoje, 11);
    assert.equal(r.investido, 100);
    assert.equal(r.reinvestido, 10.5);
    assert.equal(r.preco, 10.5); // preço da compra mais recente, qualquer origem
    assert.equal(r.patrimonioHoje, 115.5);
});
