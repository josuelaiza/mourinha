// Testes do cálculo. Rodar na pasta ferramentas/ipca2050:  node --test
// Todos os valores são FICTÍCIOS. Os esperados vieram de uma implementação
// independente em Python, não deste módulo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    diasEntre, mediaGeometrica, taxaMediaPonderada, aliquotaIR,
    calcularLote, aportesFuturos, datasDoGrafico, simular, aporteParaMeta,
    simularFii, fiiPorAno, primeiraData, deflator, mediasMensais, tickerCotacao, carteiraAcoes,
    analiseRebalanceamento, sugerirRebalanceamento, passosRebalanceamento, caixaRebalanceamento, comprasComAporte,
    resultadoPorAcao, apuracaoMensal, resumoAnual, anosDeclaracao, ultimoDiaUtil,
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

test('médias mensais de aporte: desde o primeiro aporte e último ano', () => {
    // jan R$ 1.000, fev nada, mar R$ 500 (FII 50 × 10), olhando em março
    const curto = mediasMensais({
        aportes: [{ data: '2030-01-05', valor: 1000, taxa: 0.07 }],
        aportesFii: [{ data: '2030-03-20', cotas: 50, preco: 10 }],
        hoje: '2030-03-25',
    });
    perto(curto.real, 500);
    perto(curto.ultimoAno, 500); // menos de 12 meses: igual à média desde o início
    assert.equal(curto.meses, 3);

    // 14 meses (jan/2030 a fev/2031): só fev/2030..fev/2031 entram no último ano
    const longo = mediasMensais({
        aportes: [
            { data: '2030-01-10', valor: 1400, taxa: 0.07 },
            { data: '2031-02-10', valor: 1200, taxa: 0.07 },
        ],
        aportesFii: [{ data: '2030-06-10', cotas: 1, preco: 999, origem: 'rendimento' }], // não conta
        hoje: '2031-02-28',
    });
    perto(longo.real, 2600 / 14);
    perto(longo.ultimoAno, 1200 / 12);

    assert.equal(mediasMensais({ aportes: [], aportesFii: [], hoje: '2030-01-01' }), null);
});

test('ações: ticker fracionário consulta a cotação sem o F', () => {
    assert.equal(tickerCotacao('ABCD4F'), 'ABCD4');
    assert.equal(tickerCotacao('ABCD11F'), 'ABCD11');
    assert.equal(tickerCotacao('ABCD4'), 'ABCD4');
});

test('ações: carteira agrupa por ticker, com preço médio, lucro e parte do total atual', () => {
    const aportes = [
        { ticker: 'AAAA4F', quantidade: 10, valor: 100 },
        { ticker: 'BBBB3', quantidade: 5, valor: 50 },
        { ticker: 'AAAA4F', quantidade: 10, valor: 140 }, // segunda compra: preço médio 12
    ];
    const c = carteiraAcoes(aportes, { AAAA4: 13, BBBB3: 8 });
    const a = c.posicoes.find(p => p.ticker === 'AAAA4F');
    assert.equal(a.quantidade, 20);
    perto(a.precoMedio, 12);
    perto(a.atual, 260);
    perto(a.lucro, 20);
    perto(a.lucroPct, 20 / 240);
    const b = c.posicoes.find(p => p.ticker === 'BBBB3');
    perto(b.lucro, -10);
    perto(c.investido, 290);
    perto(c.atual, 300);
    perto(c.lucro, 10);
    perto(a.parte + b.parte, 1);
    perto(a.parte, 260 / 300);

    // sem a cotação de uma ação: ela fica sem atual e o total atual não é somado
    const parcial = carteiraAcoes(aportes, { AAAA4: 13 });
    assert.equal(parcial.atual, null);
    assert.equal(parcial.posicoes.find(p => p.ticker === 'BBBB3').atual, null);
    assert.equal(parcial.posicoes.find(p => p.ticker === 'AAAA4F').parte, null);
    perto(parcial.investido, 290);
});

test('rebalanceador: gatilho pela diferença entre o maior e o menor peso', () => {
    const r = analiseRebalanceamento([{ p: 10, q: 10 }, { p: 10, q: 5 }, { p: 10, q: 5 }], 8);
    perto(r.total, 200);
    perto(r.pesos[0], 50);
    perto(r.spread, 25);
    assert.equal(r.disparou, true);
    assert.equal(analiseRebalanceamento([{ p: 10, q: 10 }, { p: 10.7, q: 10 }], 8).disparou, false);
    assert.equal(analiseRebalanceamento([{ p: 10, q: 0 }, { p: 10, q: 0 }], 8).disparou, false);
});

test('rebalanceador: vende o excesso e compra a de menor peso com o caixa', () => {
    // calculado à mão: A vai a 7 (round(1/3 × 200 ÷ 10)), caixa 30 compra B, C, B
    const itens = [{ p: 10, q: 10 }, { p: 10, q: 5 }, { p: 10, q: 5 }];
    const alvo = sugerirRebalanceamento(itens, 1 / 3);
    assert.deepEqual(alvo, [7, 7, 6]);
    assert.deepEqual(passosRebalanceamento(alvo, [10, 5, 5]), [
        { i: 0, tipo: 'vender', quantidade: 3 },
        { i: 1, tipo: 'comprar', quantidade: 2 },
        { i: 2, tipo: 'comprar', quantidade: 1 },
    ]);
    const caixa = caixaRebalanceamento(itens, alvo);
    perto(caixa.vendas, 30);
    perto(caixa.sobra, 0);
});

test('rebalanceador: sem venda inteira possível, vende 1 da maior', () => {
    // A pesa 58,8%, mas round(0,5 × 170 ÷ 100) = 1 = o que já tem: vende 1 de A
    const itens = [{ p: 100, q: 1 }, { p: 1, q: 70 }];
    assert.deepEqual(sugerirRebalanceamento(itens, 0.5), [0, 170]);
});

test('aporte: compra a de menor peso que cabe, uma por vez, até não caber nenhuma', () => {
    // valores na carteira 100, 50, 50 (preços 10, 10, 25) e aporte de R$ 60; o critério é o menor valor
    const itens = [{ p: 10, q: 10 }, { p: 10, q: 5 }, { p: 25, q: 2 }];
    // passo a passo à mão: B(50)→60 [50 sobra]; C(50)→75 [25]; B(60)→70 [15]; B(70)→80 [5]; nada cabe
    const r = comprasComAporte(itens, 60);
    assert.deepEqual(r.q, [10, 8, 3]);
    perto(r.usado, 55);
    perto(r.sobra, 5);
    // aporte vazio, zero ou negativo: não compra nada
    assert.deepEqual(comprasComAporte(itens, 0).q, [10, 5, 2]);
    assert.deepEqual(comprasComAporte(itens, -5).q, [10, 5, 2]);
    perto(comprasComAporte(itens, 0).sobra, 0);
});

test('ações: venda tira custo pelo preço médio; líquido do bolso e lucro realizado', () => {
    // exemplo da conversa: 10 a R$ 10, 10 a R$ 14 (preço médio 12), vende 5 a R$ 15
    const aportes = [
        { data: '2031-01-10', ticker: 'AAAA4F', quantidade: 10, valor: 100 },
        { data: '2031-02-10', ticker: 'AAAA4F', quantidade: 10, valor: 140 },
        { data: '2031-03-10', ticker: 'AAAA4F', quantidade: 5, valor: 75, operacao: 'venda' },
    ];
    const c = carteiraAcoes(aportes, { AAAA4: 16 });
    const a = c.posicoes[0];
    assert.equal(a.quantidade, 15);
    perto(a.precoMedio, 12);
    perto(c.investido, 180);
    perto(c.liquido, 165);
    perto(c.lucroRealizado, 15);
    perto(c.atual, 240);
    perto(c.lucro, 60); // não realizado: 240 − 180

    // ordem por data, mesmo vindo embaralhado; venda com prejuízo
    const prejuizo = carteiraAcoes([aportes[1], { ...aportes[2], valor: 40 }, aportes[0]]);
    perto(prejuizo.lucroRealizado, -20);
    perto(prejuizo.liquido, 200);
    perto(prejuizo.investido, 180);

    // compra com dividendos: entra no custo e na quantidade, não no bolso; venda total sai da lista
    const c2 = carteiraAcoes([
        { data: '2031-01-10', ticker: 'BBBB3', quantidade: 2, valor: 20 },
        { data: '2031-01-20', ticker: 'BBBB3', quantidade: 1, valor: 11, origem: 'rendimento' },
        { data: '2031-01-10', ticker: 'CCCC3', quantidade: 3, valor: 30 },
        { data: '2031-02-10', ticker: 'CCCC3', quantidade: 3, valor: 36, operacao: 'venda' },
    ]);
    assert.deepEqual(c2.posicoes.map(p => p.ticker), ['BBBB3']);
    perto(c2.investido, 31);
    perto(c2.liquido, 20 + 30 - 36);
    perto(c2.lucroRealizado, 6);
});

// ------------------------------------------------------------------ IR das ações
// Carteira fictícia; esperados calculados à mão (custo médio, regra da Receita).
const OPERACOES_IR = [
    { data: '2031-01-05', ticker: 'AAAA4F', quantidade: 100, valor: 1000 },
    { data: '2031-01-06', ticker: 'BBBB3', quantidade: 50, valor: 500 },
    { data: '2031-01-07', ticker: 'CCCC3', quantidade: 2000, valor: 20000 },
    { data: '2031-02-10', ticker: 'AAAA4F', quantidade: 20, valor: 160, operacao: 'venda' },   // custo 200: prejuízo 40
    { data: '2031-03-15', ticker: 'AAAA4F', quantidade: 30, valor: 450, operacao: 'venda' },   // custo 300: lucro 150, isento
    { data: '2031-04-20', ticker: 'CCCC3', quantidade: 1500, valor: 21000, operacao: 'venda' }, // custo 15000: lucro 6000, tributável
    { data: '2031-06-01', ticker: 'DDDD3', quantidade: 2100, valor: 21000 },
    { data: '2031-06-20', ticker: 'DDDD3', quantidade: 2100, valor: 21040, operacao: 'venda' }, // lucro 40: imposto 6, abaixo de R$ 10
    { data: '2031-07-10', ticker: 'CCCC3', quantidade: 500, valor: 5000, operacao: 'venda' },   // lucro 0
    { data: '2031-08-01', ticker: 'EEEE3', quantidade: 2100, valor: 21000 },
    { data: '2031-08-15', ticker: 'EEEE3', quantidade: 2100, valor: 21030, operacao: 'venda' }, // lucro 30: 4,50 + 6 pendentes
];
const PROVENTOS_IR = [
    { data: '2031-03-01', ticker: 'AAAA4F', provento: 'dividendo', valor: 12.34 },
    { data: '2031-05-01', ticker: 'AAAA4F', provento: 'jcp', valor: 8.5 },
    { data: '2031-06-01', ticker: 'BBBB3', provento: 'dividendo', valor: 5 },
    { data: '2032-01-10', ticker: 'BBBB3', provento: 'dividendo', valor: 3 },
];

test('ações: resultado por ação soma vendas, proventos e o latente; vendidas por inteiro entram', () => {
    const r = resultadoPorAcao(OPERACOES_IR, PROVENTOS_IR, { AAAA4: 12, BBBB3: 9 });
    const de = t => r.linhas.find(l => l.ticker === t);
    perto(de('AAAA4F').lucroVendas, 110);
    perto(de('AAAA4F').proventos, 20.84);
    perto(de('AAAA4F').resultado, 110 + 20.84 + (50 * 12 - 500));
    perto(de('BBBB3').resultado, 8 + (450 - 500));
    assert.equal(de('CCCC3').quantidade, 0);
    perto(de('CCCC3').resultado, 6000);
    perto(r.lucroVendas, 6180);
    perto(r.proventos, 28.84);
    assert.deepEqual(r.linhas.map(l => l.ticker), ['AAAA4F', 'BBBB3', 'CCCC3', 'DDDD3', 'EEEE3']);

    // sem a cotação de uma ação ainda na carteira: o resultado dela fica sem valor
    const sem = resultadoPorAcao(OPERACOES_IR, PROVENTOS_IR, { AAAA4: 12 });
    assert.equal(sem.linhas.find(l => l.ticker === 'BBBB3').resultado, null);
    perto(sem.linhas.find(l => l.ticker === 'CCCC3').resultado, 6000);
});

test('ações: apuração mensal com isenção, prejuízo guardado e DARF mínimo', () => {
    const m = apuracaoMensal(OPERACOES_IR);
    assert.deepEqual(m.map(x => x.mes), ['2031-02', '2031-03', '2031-04', '2031-06', '2031-07', '2031-08']);
    const [fev, mar, abr, jun, jul, ago] = m;
    assert.deepEqual([fev.lucro, fev.isento, fev.darf, fev.prejuizoAcumulado], [-40, true, 0, 40]);
    // lucro isento não consome o prejuízo guardado
    assert.deepEqual([mar.lucro, mar.isento, mar.imposto, mar.prejuizoAcumulado], [150, true, 0, 40]);
    assert.deepEqual([abr.vendas, abr.isento, abr.compensado, abr.imposto, abr.darf, abr.prazo, abr.prejuizoAcumulado],
        [21000, false, 40, 894, 894, '2031-05-30', 0]);
    assert.deepEqual([jun.imposto, jun.darf, jun.pendente, jun.prazo], [6, 0, 6, null]);
    assert.deepEqual([jul.lucro, jul.isento, jul.darf, jul.pendente], [0, true, 0, 6]);
    assert.deepEqual([ago.imposto, ago.darf, ago.pendente, ago.prazo], [4.5, 10.5, 0, '2031-09-30']);
});

test('ações: último dia útil pula fim de semana, feriados móveis e 31/12', () => {
    assert.equal(ultimoDiaUtil(2031, 5), '2031-05-30');  // 31 é sábado
    assert.equal(ultimoDiaUtil(2031, 12), '2031-12-30'); // 31/12 sem expediente
    assert.equal(ultimoDiaUtil(2028, 2), '2028-02-25');  // 28 e 29 são Carnaval
    assert.equal(ultimoDiaUtil(2029, 3), '2029-03-29');  // 30 é Sexta-feira Santa
});

test('ações: resumo anual para a declaração', () => {
    assert.deepEqual(anosDeclaracao(OPERACOES_IR, PROVENTOS_IR), [2032, 2031]);
    const a = resumoAnual(OPERACOES_IR, PROVENTOS_IR, 2031);
    assert.deepEqual(a.bens, [
        { ticker: 'AAAA4F', anterior: 0, atual: 500 },
        { ticker: 'BBBB3', anterior: 0, atual: 500 },
    ]);
    assert.deepEqual(a.dividendos, { lista: [{ ticker: 'AAAA4F', valor: 12.34 }, { ticker: 'BBBB3', valor: 5 }], total: 17.34 });
    assert.deepEqual(a.jcp, { lista: [{ ticker: 'AAAA4F', valor: 8.5 }], total: 8.5 });
    assert.equal(a.lucroIsento, 150);
    const b = resumoAnual(OPERACOES_IR, PROVENTOS_IR, 2032);
    assert.deepEqual(b.bens.map(x => [x.ticker, x.anterior, x.atual]), [['AAAA4F', 500, 500], ['BBBB3', 500, 500]]);
    assert.equal(b.dividendos.total, 3);
    assert.equal(b.lucroIsento, 0);
});
