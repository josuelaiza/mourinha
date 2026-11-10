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
// a cota fica parada no preço do último aporte e o rendimento mensal é
// (1 + inflação) × (1 + ganho real) ao ano, em taxa mensal equivalente,
// todo reinvestido em mais cotas (frações aceitas). Aportes mensais no dia
// `dia`, do mês que vem até a data final. Sem imposto: rendimento de FII é
// isento para pessoa física e a ideia é não vender.
// Renda gastável = só a parte do ganho real: gastando só ela, o patrimônio
// mantém o poder de compra.
export function simularFii({ aportes, hoje, dataFinal, inflacao, ganhoReal, aporteMensal, dia, dataBaseReal }) {
    if (!aportes.length) return null;
    const preco = [...aportes].sort((a, b) => a.data.localeCompare(b.data)).at(-1).preco;
    const cotasHoje = aportes.reduce((s, a) => s + a.cotas, 0);
    const investido = aportes.reduce((s, a) => s + a.cotas * a.preco, 0);
    const taxaMensal = Math.pow((1 + inflacao) * (1 + ganhoReal), 1 / 12) - 1;
    const taxaGastavel = Math.pow(1 + ganhoReal, 1 / 12) - 1;
    const MES = DIAS_POR_ANO / 12;

    let cotas = cotasHoje, anterior = hoje, numeroAportesFuturos = 0, rendimentos = 0;
    const render = ate => {
        const r = cotas * preco * (Math.pow(1 + taxaMensal, diasEntre(anterior, ate) / MES) - 1);
        rendimentos += r;
        cotas += r / preco;
        anterior = ate;
    };
    for (const d of datasMensais(hoje, dataFinal, dia)) {
        render(d);
        if (aporteMensal > 0) { cotas += aporteMensal / preco; numeroAportesFuturos++; }
    }
    if (dataFinal > anterior) render(dataFinal);

    const patrimonio = cotas * preco;
    const divisor = deflator(inflacao, dataBaseReal || primeiraData(aportes), dataFinal);
    return {
        preco, cotasHoje, investido, patrimonioHoje: cotasHoje * preco,
        cotasFinal: cotas, patrimonio, real: patrimonio / divisor,
        numeroAportesFuturos, aportadoFuturo: numeroAportesFuturos * aporteMensal, rendimentos,
        rendaMensal: patrimonio * taxaMensal, rendaMensalReal: patrimonio * taxaMensal / divisor,
        rendaGastavel: patrimonio * taxaGastavel, rendaGastavelReal: patrimonio * taxaGastavel / divisor,
    };
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
