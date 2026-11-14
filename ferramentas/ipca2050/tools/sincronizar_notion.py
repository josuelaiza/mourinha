#!/usr/bin/env python3
"""Traz os aportes NOVOS do Notion para o data.json, já cifrados.

Roda no GitHub Actions (todo dia e pelo botão "Sincronizar" do site):
    NOTION_TOKEN=... python sincronizar_notion.py
    NOTION_TOKEN=... python sincronizar_notion.py --profunda   (refaz tudo)

O que ele lê no Notion (ids em config.json → "sincronizacao" → "notion"):
  - "ipca": o banco do Tesouro IPCA+: Data (título, dd/mm/aaaa), Valor (R$),
    Taxa fixa (decimal)
  - "paginaFii": a página FII. Cada banco dentro dela é um FII, e o NOME do
    banco é o ticker (ex.: ABCD11). Colunas: Data (título, dd/mm/aaaa), Cotas,
    Valor (R$ TOTAL pago) e Origem ("Aporte" ou "Rendimento"; vazio = Aporte)
  - "paginaAcoes": a página Ações. Cada página dentro dela é uma ação, e o
    NOME da página é o ticker COM F (ex.: ABCD4F). Dentro de cada uma, dois
    bancos, reconhecidos pelas colunas (não pelo nome):
      * compras e vendas (tem a coluna "Operação"): Data, Operação ("Compra"
        ou "Venda"), Quantidade e Valor total (positivos; a Operação dá o
        sentido) e Origem (só compra; vazio = Aporte)
      * proventos (tem a coluna "Tipo"): Data, Tipo ("Dividendo" ou "JCP") e
        Valor líquido (o que caiu na conta)
Um FII novo é um banco novo na página FII; uma ação nova é uma página nova na
página Ações. Nada muda no site. Nome fora do formato de ticker é ignorado e
contado (e a profunda não roda), para um erro de digitação não virar um ticker.

Cada linha nova é cifrada do mesmo jeito que o add_aporte.py (só com a chave
pública). Para não importar a mesma linha duas vezes, o data.json guarda em
"importados" o SHA-256 do id de cada página do Notion já trazida: não revela
valor nenhum, e o id do Notion é aleatório, não dá para adivinhar.

Na sincronização normal só entram linhas novas: editar ou apagar uma linha
no Notion depois de sincronizada não muda o data.json. A sincronização
PROFUNDA (--profunda) apaga todas as entradas e refaz tudo a partir do que
está no Notion agora. Por segurança ela não grava nada se algum banco der
erro, se a página FII ou a página Ações não tiver nada dentro, se TODOS os
bancos vierem vazios quando antes havia entradas, se algum nome estiver fora
do formato ou se alguma linha estiver incompleta (para um erro de digitação
não apagar um aporte).

A saída (que fica nos registros públicos do Actions) só mostra contagens,
nunca valores nem tickers. Linhas com dados faltando ou estranhos são puladas
e contadas.

Para testes, --paginas lê a estrutura de um arquivo JSON local em vez da API:
    {"ipca": [<página do Notion>, ...],
     "fii": [{"titulo": "ABCD11", "paginas": [...]}],
     "acoes": [{"titulo": "ABCD4F", "bancos": [
         {"titulo": "...", "colunas": ["Data", "Operação", ...], "paginas": [...]}]}]}
"""

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from add_aporte import PASTA, carregar_chave_publica, cifrar, gravar_atomico  # noqa: E402

API = "https://api.notion.com/v1"
VERSAO_API = "2022-06-28"
TICKER_FII = r"[A-Z]{4}\d{2}"
TICKER_ACAO = r"[A-Z]{4}\d{1,2}F"  # sempre com F (fracionário)


class LinhaInvalida(ValueError):
    pass


def marca(id_pagina: str) -> str:
    return hashlib.sha256(id_pagina.replace("-", "").lower().encode("ascii")).hexdigest()


# ------------------------------------------------------------------ API do Notion
def _chamar(token: str, caminho: str, corpo: dict | None = None) -> dict:
    pedido = urllib.request.Request(
        f"{API}/{caminho}",
        data=json.dumps(corpo).encode("utf-8") if corpo is not None else None,
        method="POST" if corpo is not None else "GET",
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": VERSAO_API,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(pedido, timeout=30) as resposta:
            return json.load(resposta)
    except urllib.error.HTTPError as e:
        dica = " (a integração tem acesso? o token está certo?)" if e.code in (401, 403, 404) else ""
        raise SystemExit(f"Notion respondeu HTTP {e.code}{dica}. Nada foi gravado.")


def consultar_banco(token: str, banco: str) -> list:
    """Todas as páginas (linhas) de um banco do Notion, com paginação."""
    corpo, linhas = {"page_size": 100}, []
    while True:
        r = _chamar(token, f"databases/{banco}/query", corpo)
        linhas += r["results"]
        if not r.get("has_more"):
            return linhas
        corpo["start_cursor"] = r["next_cursor"]


def filhos(token: str, bloco: str) -> list:
    """Blocos dentro de uma página (subpáginas e bancos), com paginação."""
    lista, cursor = [], None
    while True:
        consulta = {"page_size": 100, **({"start_cursor": cursor} if cursor else {})}
        r = _chamar(token, f"blocks/{bloco}/children?{urllib.parse.urlencode(consulta)}")
        lista += [b for b in r["results"] if not (b.get("archived") or b.get("in_trash"))]
        if not r.get("has_more"):
            return lista
        cursor = r["next_cursor"]


def estrutura_do_notion(token: str, ids: dict) -> dict:
    """Lê o Notion e devolve a estrutura no mesmo formato do --paginas."""
    estrutura = {}
    if ids.get("ipca"):
        estrutura["ipca"] = consultar_banco(token, ids["ipca"])
    if ids.get("paginaFii"):
        estrutura["fii"] = [
            {"titulo": b["child_database"]["title"], "paginas": consultar_banco(token, b["id"])}
            for b in filhos(token, ids["paginaFii"]) if b["type"] == "child_database"
        ]
    if ids.get("paginaAcoes"):
        estrutura["acoes"] = []
        for p in filhos(token, ids["paginaAcoes"]):
            if p["type"] != "child_page":
                continue
            bancos = []
            for b in filhos(token, p["id"]):
                if b["type"] != "child_database":
                    continue
                colunas = list(_chamar(token, f"databases/{b['id']}").get("properties", {}))
                bancos.append({"titulo": b["child_database"]["title"], "colunas": colunas,
                               "paginas": consultar_banco(token, b["id"])})
            estrutura["acoes"].append({"titulo": p["child_page"]["title"], "bancos": bancos})
    return estrutura


# ------------------------------------------------------------------ leitura das linhas
def _texto(prop) -> str:
    if not prop:
        return ""
    partes = prop.get("title") or prop.get("rich_text") or []
    return "".join(p.get("plain_text", "") for p in partes).strip()


def _numero(prop):
    valor = (prop or {}).get("number")
    if not isinstance(valor, (int, float)) or isinstance(valor, bool):
        raise LinhaInvalida("número ausente")
    return float(valor)


def _data(prop) -> str:
    texto = _texto(prop)
    try:
        dia, mes, ano = texto.split("/")
        if len(dia) != 2 or len(mes) != 2 or len(ano) != 4:
            raise ValueError
        return date(int(ano), int(mes), int(dia)).isoformat()
    except ValueError:
        raise LinhaInvalida("data fora do formato dd/mm/aaaa")


def _selecao(prop) -> str:
    return (((prop or {}).get("select") or {}).get("name") or "").strip()


def aporte_ipca(props: dict, _ticker=None) -> dict:
    data = _data(props.get("Data"))
    valor = _numero(props.get("Valor"))
    taxa = _numero(props.get("Taxa fixa"))
    if not valor > 0 or not 0 < taxa < 1:
        raise LinhaInvalida("valor ou taxa fora do esperado")
    return {"data": data, "valor": valor, "taxa": taxa}


def aporte_fii(props: dict, ticker: str) -> dict:
    data = _data(props.get("Data"))
    cotas = _numero(props.get("Cotas"))
    valor = _numero(props.get("Valor"))
    if cotas <= 0 or cotas != int(cotas) or not valor > 0:
        raise LinhaInvalida("cotas ou valor fora do esperado")
    cotas = int(cotas)
    aporte = {"tipo": "fii", "data": data, "ticker": ticker, "cotas": cotas, "preco": round(valor / cotas, 6)}
    # compra feita com rendimento do fundo: conta nas cotas, não no total aportado
    if _selecao(props.get("Origem")).lower().startswith("rend"):
        aporte["origem"] = "rendimento"
    return aporte


def aporte_acao(props: dict, ticker: str) -> dict:
    data = _data(props.get("Data"))
    operacao = _selecao(props.get("Operação")).lower()
    if operacao not in ("compra", "venda"):
        raise LinhaInvalida("operação deve ser Compra ou Venda")
    quantidade = _numero(props.get("Quantidade"))
    valor = _numero(props.get("Valor total"))
    if quantidade <= 0 or quantidade != int(quantidade) or not valor > 0:
        raise LinhaInvalida("quantidade ou valor fora do esperado")
    aporte = {"tipo": "acao", "data": data, "ticker": ticker, "quantidade": int(quantidade), "valor": valor}
    if operacao == "venda":
        aporte["operacao"] = "venda"
    elif _selecao(props.get("Origem")).lower().startswith("rend"):
        aporte["origem"] = "rendimento"  # compra com dividendos: conta no custo, não no bolso
    return aporte


def provento_acao(props: dict, ticker: str) -> dict:
    data = _data(props.get("Data"))
    tipo = _selecao(props.get("Tipo")).lower()
    if tipo not in ("dividendo", "jcp"):
        raise LinhaInvalida("tipo deve ser Dividendo ou JCP")
    valor = _numero(props.get("Valor líquido"))
    if not valor > 0:
        raise LinhaInvalida("valor fora do esperado")
    return {"tipo": "provento", "data": data, "ticker": ticker, "provento": tipo, "valor": valor}


def fontes(estrutura: dict) -> tuple[list, int, list]:
    """Transforma a estrutura em [(leitor, ticker, páginas)].
    Devolve também quantos nomes/bancos ficaram fora do padrão e quais seções
    configuradas vieram sem nada dentro (página FII ou Ações vazia)."""
    lista, problemas, secoes_vazias = [], 0, []
    if "ipca" in estrutura:
        lista.append((aporte_ipca, None, estrutura["ipca"]))
    if "fii" in estrutura:
        if not estrutura["fii"]:
            secoes_vazias.append("FII")
        for banco in estrutura["fii"]:
            ticker = (banco.get("titulo") or "").strip().upper()
            if not re.fullmatch(TICKER_FII, ticker):
                problemas += 1
                continue
            lista.append((aporte_fii, ticker, banco.get("paginas", [])))
    if "acoes" in estrutura:
        if not estrutura["acoes"]:
            secoes_vazias.append("Ações")
        for acao in estrutura["acoes"]:
            ticker = (acao.get("titulo") or "").strip().upper()
            if not re.fullmatch(TICKER_ACAO, ticker):
                problemas += 1
                continue
            for banco in acao.get("bancos", []):
                colunas = set(banco.get("colunas", []))
                if "Operação" in colunas:
                    leitor = aporte_acao
                elif "Tipo" in colunas:
                    leitor = provento_acao
                else:
                    problemas += 1
                    continue
                lista.append((leitor, ticker, banco.get("paginas", [])))
    return lista, problemas, secoes_vazias


def _viva(pagina: dict) -> bool:
    return not (pagina.get("archived") or pagina.get("in_trash"))


def sincronizar(lista: list, dados: dict, chave) -> tuple[int, int]:
    """Acrescenta em `dados` as linhas ainda não importadas. Devolve (novos, ignoradas)."""
    importados = dados.setdefault("importados", [])
    ja = set(importados)
    novos = ignoradas = 0
    for ler, ticker, paginas in lista:
        for pagina in paginas:
            if not _viva(pagina):
                continue
            m = marca(pagina["id"])
            if m in ja:
                continue
            try:
                payload = ler(pagina.get("properties", {}), ticker)
            except LinhaInvalida:
                ignoradas += 1
                continue
            dados["entries"].append(cifrar(chave, payload))
            importados.append(m)
            ja.add(m)
            novos += 1
    return novos, ignoradas


def main() -> None:
    for fluxo in (sys.stdout, sys.stderr):  # mensagens com acento também no Windows
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Traz aportes novos do Notion para o data.json (cifrados).")
    p.add_argument("--keys", type=Path, default=PASTA / "keys.json")
    p.add_argument("--arquivo", type=Path, default=PASTA / "data.json")
    p.add_argument("--config", type=Path, default=PASTA / "config.json")
    p.add_argument("--paginas", type=Path, help="só para testes: a estrutura do Notion num JSON local")
    p.add_argument("--profunda", action="store_true", help="apaga as entradas e refaz tudo a partir do Notion")
    args = p.parse_args()

    ids = json.loads(args.config.read_text(encoding="utf-8")).get("sincronizacao", {}).get("notion", {})
    if args.paginas:
        estrutura = json.loads(args.paginas.read_text(encoding="utf-8"))
    else:
        token = os.environ.get("NOTION_TOKEN", "").strip()
        if not token:
            raise SystemExit("Falta o segredo NOTION_TOKEN.")
        estrutura = estrutura_do_notion(token, ids)
    lista, problemas, secoes_vazias = fontes(estrutura)

    chave = carregar_chave_publica(args.keys)
    dados = json.loads(args.arquivo.read_text(encoding="utf-8"))
    if dados.get("version") != 1 or not isinstance(dados.get("entries"), list):
        raise SystemExit("data.json em formato inesperado (esperava version 1 e lista entries).")
    aviso = f"; {problemas} página(s) ou banco(s) com nome fora do padrão (ignorados)" if problemas else ""

    if args.profunda:
        if problemas:
            raise SystemExit(f"Profunda cancelada: {problemas} página(s) ou banco(s) com nome fora do padrão no Notion. Corrija e rode de novo. Nada foi gravado.")
        if secoes_vazias:
            raise SystemExit(f"Profunda cancelada: a página {' e '.join(secoes_vazias)} veio sem nada dentro. Nada foi gravado.")
        antes = len(dados["entries"])
        # um banco vazio é válido (ex.: apagou as linhas de teste),
        # mas todos vazios com entradas no data.json não
        if antes and not any(_viva(x) for _, _, paginas in lista for x in paginas):
            raise SystemExit("Profunda cancelada: todos os bancos vieram vazios e o data.json tem entradas. Nada foi gravado.")
        refeito = {**dados, "entries": [], "importados": []}
        novos, ignoradas = sincronizar(lista, refeito, chave)
        if ignoradas:
            raise SystemExit(f"Profunda cancelada: {ignoradas} linha(s) com dados incompletos no Notion. Corrija e rode de novo. Nada foi gravado.")
        gravar_atomico(args.arquivo, refeito)
        print(f"Profunda: {antes} entrada(s) apagada(s) e {novos} refeita(s) a partir do Notion.")
        novos = max(novos, 1)  # grava mesmo se a contagem não mudou (uma linha pode ter sido corrigida)
    else:
        novos, ignoradas = sincronizar(lista, dados, chave)
        if novos:
            gravar_atomico(args.arquivo, dados)
        print(f"{novos} aporte(s) novo(s) cifrado(s); {ignoradas} linha(s) ignorada(s) por dados incompletos{aviso}.")

    saida = os.environ.get("GITHUB_OUTPUT")
    if saida:
        with open(saida, "a", encoding="utf-8") as f:
            f.write(f"novos={novos}\n")


if __name__ == "__main__":
    main()
