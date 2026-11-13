// ================================================================== //
// == CÁLCULO DO SIMULADOR TESOURO IPCA+ 2050                      == //
// ================================================================== //
// Funções puras (sem tela, sem rede): a página e os testes usam as mesmas.
//
// Datas sempre como texto 'YYYY-MM-DD' e contadas em UTC, para o fuso
// e o horário de verão não mudarem a contagem de dias.
//
// Anos = dias corridos / 365,25. É uma aproximação (ignora o calendário
// exato de anos bissextos), aceitável para uma projeção de décadas.

export const DIAS_POR_ANO = 365.25;
const MS_POR_DIA = 86400000;

// 'YYYY-MM-DD' -> dia contado em UTC (milissegundos)
function paraUtc(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    if (!m) throw new Error(`Data inválida: ${texto}`);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function paraTexto(utc) {
    return new Date(utc).toISOString().slice(0, 10);
}

export function diasEntre(inicio, fim) {
    return Math.round((paraUtc(fim) - paraUtc(inicio)) / MS_POR_DIA);
}

// Data local do aparelho em 'YYYY-MM-DD'
export function hojeLocal(agora = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

// Média geométrica de taxas anuais (decimais): ((1+t1)...(1+tn))^(1/n) - 1
export function mediaGeometrica(taxas) {
    if (!taxas.length) throw new Error('Sem taxas para a média.');
    const produto = taxas.reduce((acc, t) => acc * (1 + t), 1);
    return Math.pow(produto, 1 / taxas.length) - 1;
}

// Média das taxas ponderada pelo valor; null se não há aportes
export function taxaMediaPonderada(aportes) {
    const total = aportes.reduce((s, a) => s + a.valor, 0);
    if (total <= 0) return null;
    return aportes.reduce((s, a) => s + a.valor * a.taxa, 0) / total;
}

// Tabela em ordem crescente: [{ ateDias: 180, aliquota: 0.225 }, ..., { ateDias: null, aliquota: 0.15 }]
export function aliquotaIR(dias, tabela) {
    for (const faixa of tabela) {
        if (faixa.ateDias === null || dias <= faixa.ateDias) return faixa.aliquota;
    }
    throw new Error('Tabela de IR sem faixa final (ateDias: null).');
}

// Um lote (aporte) resgatado na data `resgate`.
// p = { inflacao, custodiaAnual, tabelaIR }
export function calcularLote(lote, resgate, p) {
    const dias = diasEntre(lote.data, resgate);
    // Lote que ainda não existe na data do resgate (aporte futuro no gráfico)
    if (dias < 0) return { dias: 0, anos: 0, bruto: 0, custodia: 0, ir: 0, liquido: 0, investido: 0 };
    const anos = dias / DIAS_POR_ANO;
    const bruto = lote.valor * Math.pow((1 + p.inflacao) * (1 + lote.taxa), anos);
    const custodia = bruto * (1 - Math.pow(1 - p.custodiaAnual, anos));
    const ir = Math.max(0, bruto - custodia - lote.valor) * aliquotaIR(dias, p.tabelaIR);
    return { dias, anos, bruto, custodia, ir, liquido: bruto - custodia - ir, investido: lote.valor };
}

// Um aporte por mês no dia `dia`, do mês seguinte ao de `hoje` até `ultimoMes` ('YYYY-MM')
export function aportesFuturos({ hoje, dia, ultimoMes, valor, taxa }) {
    const [ano0, mes0] = hoje.split('-').map(Number);
    const [anoF, mesF] = ultimoMes.split('-').map(Number);
    const lista = [];
    let ano = ano0, mes = mes0 + 1;
    if (mes > 12) { mes = 1; ano++; }
    while (ano < anoF || (ano === anoF && mes <= mesF)) {
        const ultimoDiaDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
        const d = Math.min(dia, ultimoDiaDoMes);
        lista.push({ data: `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`, valor, taxa });
        mes++;
        if (mes > 12) { mes = 1; ano++; }
    }
    return lista;
}

function somar(lotes, resgate, p) {
    const s = { bruto: 0, liquido: 0, investido: 0 };
    for (const lote of lotes) {
        const r = calcularLote(lote, resgate, p);
        s.bruto += r.bruto;
        s.liquido += r.liquido;
        s.investido += r.investido;
    }
    return s;
}

// Pontos do gráfico: hoje, depois todo dia `dia` de cada mês até o vencimento.
// Em cada ponto, o valor é o de um resgate naquela data (custódia e IR
// contados até ali); aportes futuros entram só a partir da data deles.
export function datasDoGrafico(hoje, vencimento, dia) {
    const datas = [hoje];
    const [anoV, mesV] = vencimento.split('-').map(Number);
    let [ano, mes] = hoje.split('-').map(Number);
    for (;;) {
        mes++;
        if (mes > 12) { mes = 1; ano++; }
        if (ano > anoV || (ano === anoV && mes > mesV)) break;
        const d = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        if (paraUtc(d) > paraUtc(vencimento)) break;
        datas.push(d);
    }
    if (datas[datas.length - 1] !== vencimento) datas.push(vencimento);
    return datas;
}

// Inflação futura usada em toda a página: média geométrica da série do config.json
export function inflacaoProjetada(config) {
    return mediaGeometrica(config.ipcaAnual.map(x => x.taxa));
}

// Data mais antiga de uma ou mais listas de aportes ({ data }); null se todas vazias
export function primeiraData(...listas) {
    let menor = null;
    for (const lista of listas) for (const a of lista) if (menor === null || a.data < menor) menor = a.data;
    return menor;
}

// Média mensal do dinheiro aportado (IPCA+, compras de FII com origem Aporte e
// ações: compra soma, venda desconta no mês dela; compras com rendimento do fundo
// ou com dividendos não contam, como no total aportado).
//   real:      total ÷ meses do mês do primeiro aporte até o mês atual, contando os dois
//              e também os meses sem aporte
//   ultimoAno: o mesmo, só com o mês atual e os 11 anteriores (ou menos meses,
//              se o primeiro aporte foi há menos de 12 meses)
// Sem aportes: null.
export function mediasMensais({ aportes, aportesFii = [], aportesAcoes = [], hoje }) {
    const mes = data => { const [a, m] = data.split('-').map(Number); return a * 12 + (m - 1); };
    const lista = [
        ...aportes.map(a => ({ data: a.data, valor: a.valor })),
        ...aportesFii.filter(a => a.origem !== 'rendimento').map(a => ({ data: a.data, valor: a.cotas * a.preco })),
        ...aportesAcoes.filter(a => a.operacao === 'venda' || a.origem !== 'rendimento')
            .map(a => ({ data: a.data, valor: a.operacao === 'venda' ? -a.valor : a.valor })),
    ];
    if (!lista.length) return null;
    const meses = lista.map(a => mes(a.data));
    const fim = Math.max(mes(hoje), ...meses);
    const inicio = Math.min(...meses);
    const total = lista.reduce((s, a) => s + a.valor, 0);
    const desde = fim - 11;
    const totalAno = lista.reduce((s, a, i) => s + (meses[i] >= desde ? a.valor : 0), 0);
    const quantos = fim - inicio + 1;
    return { real: total / quantos, ultimoAno: totalAno / Math.min(12, quantos), meses: quantos };
}

// Ticker para consultar a cotação: o "F" do fim (mercado fracionário) é a mesma ação.
export function tickerCotacao(ticker) {
    return /^[A-Z]{4}\d{1,2}F$/.test(ticker) ? ticker.slice(0, -1) : ticker;
}

// Carteira de ações, separada do resto do patrimônio.
// aportes: [{ data, ticker, quantidade, valor, operacao?, origem? }], valores sempre
// positivos; operacao "venda" subtrai. Processado em ordem de data (preço médio).
// Regra da Receita (custo médio): a compra soma quantidade e custo; a venda tira
// quantidade × preço médio do custo, sem mudar o preço médio, e o que passar disso
// é lucro (ou prejuízo) realizado.
//   investido = custo das ações que sobraram (o da declaração)
//   liquido   = dinheiro do bolso: compras com origem Aporte − vendas
// cotacoes: { TICKER_SEM_F: preço }. Sem cotação: atual/lucro null, e o total atual
// também (não dá para somar). Ações vendidas por inteiro saem da lista.
export function carteiraAcoes(aportes, cotacoes = {}) {
    const porTicker = new Map();
    let liquido = 0;
    const ordenados = [...aportes].sort((x, y) => (x.data || '').localeCompare(y.data || ''));
    for (const a of ordenados) {
        const p = porTicker.get(a.ticker) || { ticker: a.ticker, quantidade: 0, investido: 0, lucroRealizado: 0 };
        if (a.operacao === 'venda') {
            const vendida = Math.min(a.quantidade, p.quantidade);
            const custoBaixado = p.quantidade > 0 ? p.investido * (vendida / p.quantidade) : 0;
            p.lucroRealizado += a.valor - custoBaixado;
            p.quantidade -= vendida;
            p.investido = p.quantidade > 0 ? p.investido - custoBaixado : 0;
            liquido -= a.valor;
        } else {
            p.quantidade += a.quantidade;
            p.investido += a.valor;
            if (a.origem !== 'rendimento') liquido += a.valor;
        }
        porTicker.set(a.ticker, p);
    }
    const todas = [...porTicker.values()];
    const posicoes = todas.filter(p => p.quantidade > 0).map(p => {
        const cotacao = cotacoes[tickerCotacao(p.ticker)];
        const atual = typeof cotacao === 'number' ? p.quantidade * cotacao : null;
        return {
            ...p,
            precoMedio: p.investido / p.quantidade,
            cotacao: atual === null ? null : cotacao,
            atual,
            lucro: atual === null ? null : atual - p.investido,
            lucroPct: atual === null ? null : (atual - p.investido) / p.investido,
        };
    });
    const investido = posicoes.reduce((s, p) => s + p.investido, 0);
    const completo = posicoes.length > 0 && posicoes.every(p => p.atual !== null);
    const atual = completo ? posicoes.reduce((s, p) => s + p.atual, 0) : null;
    for (const p of posicoes) p.parte = atual ? p.atual / atual : null;
    return {
        posicoes,
        investido,
        liquido,
        lucroRealizado: todas.reduce((s, p) => s + p.lucroRealizado, 0),
        atual,
        lucro: atual === null ? null : atual - investido,
        lucroPct: atual === null || !investido ? null : (atual - investido) / investido,
    };
}

// ------------------------------------------------------------------
// Ações: vendas, proventos e imposto de renda
// proventos = [{ data, ticker, provento: 'dividendo' | 'jcp', valor }] (valor líquido recebido)
// ------------------------------------------------------------------
const centavos = v => Math.round(v * 100) / 100;

// Percorre compras e vendas em ordem de data (custo médio, como pede a Receita).
// Só as operações até `ate` (aaaa-mm-dd), se informado.
// Devolve { porTicker: Map(ticker → { quantidade, investido }), vendas: [{ data, ticker, valor, lucro }] }
function percorrerAcoes(aportes, ate) {
    const porTicker = new Map(), vendas = [];
    const ordenados = [...aportes].filter(a => !ate || a.data <= ate).sort((x, y) => (x.data || '').localeCompare(y.data || ''));
    for (const a of ordenados) {
        const p = porTicker.get(a.ticker) || { quantidade: 0, investido: 0 };
        if (a.operacao === 'venda') {
            const vendida = Math.min(a.quantidade, p.quantidade);
            const custoBaixado = p.quantidade > 0 ? p.investido * (vendida / p.quantidade) : 0;
            vendas.push({ data: a.data, ticker: a.ticker, valor: a.valor, lucro: a.valor - custoBaixado });
            p.quantidade -= vendida;
            p.investido = p.quantidade > 0 ? p.investido - custoBaixado : 0;
        } else {
            p.quantidade += a.quantidade;
            p.investido += a.valor;
        }
        porTicker.set(a.ticker, p);
    }
    return { porTicker, vendas };
}

// Resultado de cada ação, inclusive as já vendidas por inteiro:
// resultado = lucro das vendas + proventos + (valor atual − aportado).
// resultado = null se a ação ainda está na carteira e falta a cotação.
export function resultadoPorAcao(aportes, proventos, cotacoes = {}) {
    const { porTicker, vendas } = percorrerAcoes(aportes);
    const linhas = new Map();
    const linha = ticker => {
        if (!linhas.has(ticker)) linhas.set(ticker, { ticker, lucroVendas: 0, proventos: 0 });
        return linhas.get(ticker);
    };
    for (const t of porTicker.keys()) linha(t);
    for (const v of vendas) linha(v.ticker).lucroVendas += v.lucro;
    for (const p of proventos) linha(p.ticker).proventos += p.valor;
    const lista = [...linhas.values()].map(l => {
        const pos = porTicker.get(l.ticker) || { quantidade: 0, investido: 0 };
        const cotacao = cotacoes[tickerCotacao(l.ticker)];
        const latente = pos.quantidade === 0 ? 0 : typeof cotacao === 'number' ? pos.quantidade * cotacao - pos.investido : null;
        return { ...l, quantidade: pos.quantidade, resultado: latente === null ? null : l.lucroVendas + l.proventos + latente };
    });
    return {
        linhas: lista,
        lucroVendas: lista.reduce((s, l) => s + l.lucroVendas, 0),
        proventos: lista.reduce((s, l) => s + l.proventos, 0),
    };
}

// Domingo de Páscoa (algoritmo de Meeus), em UTC
function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(ano, mes - 1, dia));
}

// Dias sem expediente bancário: fins de semana, feriados nacionais,
// Carnaval (segunda e terça), Sexta-feira Santa, Corpus Christi e 31/12.
function semExpediente(d) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) return true;
    const md = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25', '12-31'].includes(md)) return true;
    const p = pascoa(d.getUTCFullYear()).getTime(), dia = 86400000;
    return [-48, -47, -2, 60].some(n => d.getTime() === p + n * dia);
}

// Último dia útil do mês (mes = 1..12), aaaa-mm-dd
export function ultimoDiaUtil(ano, mes) {
    const d = new Date(Date.UTC(ano, mes, 0));
    while (semExpediente(d)) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

export const LIMITE_ISENCAO_ACOES = 20000;
export const ALIQUOTA_ACOES = 0.15;
export const DARF_MINIMO = 10;

// Apuração mês a mês (só os meses com venda), operações comuns:
// - vendas do mês até R$ 20 mil: lucro isento (não usa o prejuízo guardado);
// - acima disso: 15% sobre o lucro menos o prejuízo acumulado;
// - prejuízo de qualquer mês fica guardado para abater lucro tributável depois;
// - DARF abaixo de R$ 10 não se paga: fica para o mês seguinte.
// Prazo do DARF (código 6015): último dia útil do mês seguinte.
export function apuracaoMensal(aportes) {
    const meses = new Map();
    for (const v of percorrerAcoes(aportes).vendas) {
        const mes = v.data.slice(0, 7);
        const m = meses.get(mes) || { mes, vendas: 0, lucro: 0 };
        m.vendas += v.valor;
        m.lucro += v.lucro;
        meses.set(mes, m);
    }
    let prejuizo = 0, pendente = 0;
    return [...meses.values()].sort((x, y) => x.mes.localeCompare(y.mes)).map(m => {
        const lucro = centavos(m.lucro);
        const isento = m.vendas <= LIMITE_ISENCAO_ACOES;
        let compensado = 0, imposto = 0;
        if (lucro < 0) prejuizo = centavos(prejuizo - lucro);
        else if (!isento) {
            compensado = Math.min(prejuizo, lucro);
            prejuizo = centavos(prejuizo - compensado);
            imposto = centavos((lucro - compensado) * ALIQUOTA_ACOES);
        }
        const total = centavos(pendente + imposto);
        const darf = total >= DARF_MINIMO ? total : 0;
        pendente = darf ? 0 : total;
        const [ano, mes] = m.mes.split('-').map(Number);
        return {
            mes: m.mes, vendas: centavos(m.vendas), lucro, isento, compensado, imposto, darf, pendente,
            prazo: darf ? ultimoDiaUtil(mes === 12 ? ano + 1 : ano, mes === 12 ? 1 : mes + 1) : null,
            prejuizoAcumulado: prejuizo,
        };
    });
}

// Anos com alguma operação ou provento, do mais recente para o mais antigo
export function anosDeclaracao(aportes, proventos) {
    return [...new Set([...aportes, ...proventos].map(a => Number(a.data.slice(0, 4))))].sort((a, b) => b - a);
}

// O que lançar na declaração de um ano:
// - Bens e Direitos (03/01): custo de cada ação em 31/12 do ano anterior e do ano;
// - Rendimentos Isentos 09: dividendos; 20: lucro dos meses isentos;
// - Tributação Exclusiva 10: JCP.
export function resumoAnual(aportes, proventos, ano) {
    const antes = percorrerAcoes(aportes, `${ano - 1}-12-31`).porTicker;
    const fim = percorrerAcoes(aportes, `${ano}-12-31`).porTicker;
    const bens = [...fim.keys()].map(ticker => ({
        ticker,
        anterior: antes.has(ticker) ? centavos(antes.get(ticker).investido) : 0,
        atual: centavos(fim.get(ticker).investido),
    })).filter(b => b.anterior > 0 || b.atual > 0);
    const somarPorTicker = tipo => {
        const m = new Map();
        for (const p of proventos) {
            if (p.provento !== tipo || !p.data.startsWith(`${ano}-`)) continue;
            m.set(p.ticker, (m.get(p.ticker) || 0) + p.valor);
        }
        const lista = [...m].map(([ticker, valor]) => ({ ticker, valor: centavos(valor) }));
        return { lista, total: centavos(lista.reduce((s, x) => s + x.valor, 0)) };
    };
    const lucroIsento = centavos(apuracaoMensal(aportes)
        .filter(m => m.mes.startsWith(`${ano}-`) && m.isento && m.lucro > 0)
        .reduce((s, m) => s + m.lucro, 0));
    return { ano, bens, dividendos: somarPorTicker('dividendo'), jcp: somarPorTicker('jcp'), lucroIsento };
}

// ------------------------------------------------------------------
// Rebalanceador de ações (lógica do rebalanceador do usuário, sem mudança).
// itens = [{ p: preço, q: quantidade }], na ordem da tabela.
// Meta de cada ação = partes iguais (1 ÷ número de ações).
// Gatilho: a diferença entre o maior e o menor peso chegar a `gatilho` pontos.
// ------------------------------------------------------------------
export function analiseRebalanceamento(itens, gatilho) {
    const total = itens.reduce((a, s) => a + s.p * s.q, 0);
    const pesos = itens.map(s => (total > 0 ? (s.p * s.q / total) * 100 : 0));
    const maior = Math.max(...pesos), menor = Math.min(...pesos);
    const spread = maior - menor;
    return { total, pesos, maior, menor, spread, disparou: total > 0 && spread >= gatilho - 0.005 };
}

// Quantidades sugeridas: vende o que passou da meta (até voltar a ela; se nada
// passar o bastante para vender uma ação inteira, vende 1 da maior) e, com o
// caixa, compra uma a uma a de menor peso que couber, sem recomprar a vendida.
export function sugerirRebalanceamento(itens, meta) {
    const T = itens.reduce((a, s) => a + s.p * s.q, 0);
    const q = itens.map(s => s.q);
    let caixa = 0;
    const vendidas = new Set();
    itens.forEach((s, i) => {
        if (s.p * s.q / T > meta) {
            const alvo = Math.round(meta * T / s.p);
            if (alvo < s.q) { caixa += (s.q - alvo) * s.p; q[i] = alvo; vendidas.add(i); }
        }
    });
    if (!vendidas.size) {
        let k = 0;
        itens.forEach((s, i) => { if (s.p * s.q > itens[k].p * itens[k].q) k = i; });
        if (q[k] > 0) { q[k]--; caixa += itens[k].p; vendidas.add(k); }
    }
    for (;;) {
        let b = -1, bw = 1e9;
        itens.forEach((s, i) => {
            if (vendidas.has(i) || s.p > caixa + 0.005) return;
            const w = s.p * q[i] / T;
            if (w < bw) { bw = w; b = i; }
        });
        if (b < 0) break;
        q[b]++;
        caixa -= itens[b].p;
    }
    return q;
}

// Compras com um aporte, sem vender nada: uma ação por vez, sempre a de menor
// peso (menor valor na carteira) que ainda cabe no que resta, até não caber
// nenhuma. A sobra fica menor que o preço da ação mais barata.
export function comprasComAporte(itens, aporte) {
    const q = itens.map(s => s.q);
    let caixa = aporte > 0 ? aporte : 0;
    for (;;) {
        let b = -1, menor = Infinity;
        itens.forEach((s, i) => {
            if (s.p > caixa + 0.005) return;
            const valor = s.p * q[i];
            if (valor < menor) { menor = valor; b = i; }
        });
        if (b < 0) break;
        q[b]++;
        caixa -= itens[b].p;
    }
    const sobra = Math.max(0, caixa);
    return { q, usado: (aporte > 0 ? aporte : 0) - sobra, sobra };
}

// Passos para ir de `ref` até `alvo`: primeiro as vendas, depois as compras.
export function passosRebalanceamento(alvo, ref) {
    const passos = [];
    alvo.forEach((t, i) => { if (t < ref[i]) passos.push({ i, tipo: 'vender', quantidade: ref[i] - t }); });
    alvo.forEach((t, i) => { if (t > ref[i]) passos.push({ i, tipo: 'comprar', quantidade: t - ref[i] }); });
    return passos;
}

// Caixa que as vendas geram e quanto sobra depois de todas as compras.
export function caixaRebalanceamento(itens, alvo) {
    const total = itens.reduce((a, s) => a + s.p * s.q, 0);
    const vendas = itens.reduce((a, s, i) => a + Math.max(0, s.q - alvo[i]) * s.p, 0);
    const sobra = total - itens.reduce((a, s, i) => a + s.p * alvo[i], 0);
    return { vendas, sobra };
}

// Divisor que leva R$ da data `fim` para R$ da data `base`, pela inflação projetada
export function deflator(inflacao, base, fim) {
    return Math.pow(1 + inflacao, Math.max(0, diasEntre(base, fim)) / DIAS_POR_ANO);
}

// config = conteúdo do config.json; aportes = [{ data, valor, taxa }] já decifrados.
// Opcionais: dataBaseReal (base do valor real; padrão = primeiro aporte daqui, ou hoje)
// e dataAlvo (devolve em `naData` o valor se resgatado nessa data).
export function simular({ aportes, hoje, config, aporteMensal, dataBaseReal: baseDada, dataAlvo }) {
    const inflacao = inflacaoProjetada(config);
    const p = { inflacao, custodiaAnual: config.custodiaAnual, tabelaIR: config.aliquotasIR };
    const venc = config.vencimento;

    const taxaMedia = taxaMediaPonderada(aportes);
    const futuros = taxaMedia === null ? null : aportesFuturos({
        hoje, dia: config.diaAporteFuturo, ultimoMes: config.ultimoMesAporteFuturo,
        valor: aporteMensal, taxa: taxaMedia,
    });

    const anosAteVenc = Math.max(0, diasEntre(hoje, venc)) / DIAS_POR_ANO;

    // Valor real em R$ da data do PRIMEIRO aporte: base fixa, que não anda
    // com o calendário (daqui a anos continua comparável com o que foi aportado).
    // Sem aportes ainda, a base é hoje. A página passa a base de todos os
    // investimentos juntos, para os valores reais serem comparáveis entre si.
    const dataBaseReal = baseDada || primeiraData(aportes) || hoje;
    const divisor = deflator(inflacao, dataBaseReal, venc);
    const cenario = lotes => {
        const s = somar(lotes, venc, p);
        return { ...s, real: s.liquido / divisor };
    };

    const existentes = cenario(aportes);
    const todos = futuros ? aportes.concat(futuros) : null;
    const comAportes = todos ? cenario(todos) : null;

    // Valor real que cada R$ 1 de aporte mensal acrescenta no vencimento.
    // Bruto, custódia e IR de um lote são proporcionais ao valor dele, então o
    // valor real é linear no aporte mensal: real = existentes + aporte × isto.
    const realPorRealMensal = futuros
        ? cenario(futuros.map(f => ({ ...f, valor: 1 }))).real
        : null;

    const serie = datasDoGrafico(hoje, venc, config.diaAporteFuturo).map(data => {
        const a = somar(aportes, data, p);
        const b = todos ? somar(todos, data, p) : null;
        return {
            data,
            existentesBruto: a.bruto, existentesLiquido: a.liquido,
            comAportesBruto: b ? b.bruto : null, comAportesLiquido: b ? b.liquido : null,
        };
    });

    // Valor se resgatado em `dataAlvo` (até o vencimento), no cenário com aportes
    // mensais quando há taxa média; aportes posteriores à data não contam.
    const naData = dataAlvo ? somar(todos || aportes, dataAlvo < venc ? dataAlvo : venc, p) : null;

    return {
        inflacao, taxaMedia, anosAteVenc, dataBaseReal,
        totalAportado: aportes.reduce((s, a) => s + a.valor, 0),
        numeroAportes: aportes.length,
        numeroAportesFuturos: futuros ? futuros.length : 0,
        existentes, comAportes, realPorRealMensal, naData, serie,
    };
}

// Todo dia `dia` de cada mês, do mês seguinte ao de `inicio` até `fim` (inclusive)
function datasMensais(inicio, fim, dia) {
    const lista = [];
    let [ano, mes] = inicio.split('-').map(Number);
    for (;;) {
        mes++;
        if (mes > 12) { mes = 1; ano++; }
        const ultimoDiaDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
        const d = `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimoDiaDoMes)).padStart(2, '0')}`;
        if (d > fim) return lista;
        lista.push(d);
    }
}

// ------------------------------------------------------------------ //
// FII (ex.: MXRF11)
// ------------------------------------------------------------------ //
// aportes = [{ data, cotas, preco }]. Modelo de FII de recebíveis (CRI):
// - a cota fica parada no preço da última compra (aporte ou reinvestimento);
// - todo dia `dia`, do mês que vem até a data final, o fundo paga
//   `rendimentoPorCota` (R$, o valor que ele paga hoje) por cota que você tem;
//   taxa mensal = rendimento por cota ÷ preço da cota;
// - rendimento + aporte do mês + a sobra guardada compram cotas INTEIRAS, como
//   na corretora; o troco fica guardado (sem render) e entra no mês seguinte.
// Sem imposto: rendimento de FII é isento para pessoa física e a ideia é não vender.
// Ganho real equivalente = quanto essa taxa rende acima da inflação projetada.
// Renda gastável = só a parte do ganho real: gastando só ela, o patrimônio
// mantém o poder de compra (zero se o rendimento nem cobre a inflação).
export function simularFii({ aportes, hoje, dataFinal, inflacao, rendimentoPorCota, aporteMensal, dia, dataBaseReal }) {
    if (!aportes.length) return null;
    const preco = [...aportes].sort((a, b) => a.data.localeCompare(b.data)).at(-1).preco;
    const cotasHoje = aportes.reduce((s, a) => s + a.cotas, 0);
    // Compras com rendimento do fundo (origem "rendimento") contam nas cotas,
    // mas não no investido: investido = só o dinheiro que saiu do bolso.
    const investido = aportes.filter(a => a.origem !== 'rendimento').reduce((s, a) => s + a.cotas * a.preco, 0);
    const reinvestido = aportes.filter(a => a.origem === 'rendimento').reduce((s, a) => s + a.cotas * a.preco, 0);
    const porCota = rendimentoPorCota > 0 ? rendimentoPorCota : 0;
    const taxaMensal = porCota / preco;
    const ganhoRealEquivalente = Math.pow(1 + taxaMensal, 12) / (1 + inflacao) - 1;
    const taxaGastavel = Math.max(0, (1 + taxaMensal) / Math.pow(1 + inflacao, 1 / 12) - 1);
    const aporte = aporteMensal > 0 ? aporteMensal : 0;
    // folga contra erro de ponto flutuante (ex.: 10,999999 cotas que são 11)
    const inteiras = valor => Math.floor(valor / preco + 1e-9);

    let cotas = cotasHoje, sobra = 0, rendimentos = 0;
    const meses = datasMensais(hoje, dataFinal, dia).map(data => {
        const rendimento = cotas * porCota;
        rendimentos += rendimento;
        const cotasDoRendimento = inteiras(sobra + rendimento);
        const disponivel = sobra + rendimento + aporte;
        const cotasCompradas = inteiras(disponivel);
        sobra = disponivel - cotasCompradas * preco;
        cotas += cotasCompradas;
        return { data, rendimento, cotasDoRendimento, aporte, cotasCompradas, sobra, cotas, patrimonio: cotas * preco + sobra };
    });

    const patrimonio = cotas * preco + sobra;
    const divisor = deflator(inflacao, dataBaseReal || primeiraData(aportes), dataFinal);
    const rendaMensal = cotas * preco * taxaMensal;
    const rendaGastavel = cotas * preco * taxaGastavel;
    return {
        preco, cotasHoje, investido, reinvestido, patrimonioHoje: cotasHoje * preco, taxaMensal, ganhoRealEquivalente,
        cotasFinal: cotas, sobra, patrimonio, real: patrimonio / divisor,
        numeroAportesFuturos: aporte ? meses.length : 0, aportadoFuturo: aporte * meses.length, rendimentos,
        rendaMensal, rendaMensalReal: rendaMensal / divisor,
        rendaGastavel, rendaGastavelReal: rendaGastavel / divisor,
        meses,
    };
}

// Linhas do mês a mês agrupadas por ano: totais do ano e a posição no fim dele
export function fiiPorAno(meses) {
    const anos = [];
    for (const m of meses) {
        const ano = m.data.slice(0, 4);
        let g = anos.at(-1);
        if (!g || g.ano !== ano) anos.push(g = { ano, rendimento: 0, cotasDoRendimento: 0, aporte: 0, cotasCompradas: 0, meses: [] });
        g.rendimento += m.rendimento;
        g.cotasDoRendimento += m.cotasDoRendimento;
        g.aporte += m.aporte;
        g.cotasCompradas += m.cotasCompradas;
        g.sobra = m.sobra;
        g.cotas = m.cotas;
        g.patrimonio = m.patrimonio;
        g.meses.push(m);
    }
    return anos;
}

// Aporte mensal que leva o valor real no vencimento exatamente até `meta`
// (arredondado para cima no centavo). 0 se os aportes existentes já bastam;
// null se não dá para calcular (sem taxa média ou sem meses de aporte pela frente).
export function aporteParaMeta(resultado, meta) {
    const falta = meta - resultado.existentes.real;
    if (falta <= 0) return 0;
    if (!resultado.realPorRealMensal) return null;
    return Math.ceil((falta / resultado.realPorRealMensal) * 100 - 1e-9) / 100;
}
