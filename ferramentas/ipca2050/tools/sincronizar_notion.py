#!/usr/bin/env python3
"""Traz os aportes NOVOS do Notion para o data.json, já cifrados.

Roda no GitHub Actions (todo dia e pelo botão "Sincronizar" do site):
    NOTION_TOKEN=... python sincronizar_notion.py

Lê os dois bancos do Notion listados em config.json ("sincronizacao"):
  - Tesouro IPCA+: Data (título, dd/mm/aaaa), Valor (R$), Taxa fixa (decimal)
  - FII:           Data (título, dd/mm/aaaa), Cotas, Valor (R$ TOTAL pago) e
                   Origem (seleção: "Aporte" ou "Rendimento"; vazio = Aporte)
e cifra cada linha nova do mesmo jeito que o add_aporte.py (só com a chave
pública). Para não importar a mesma linha duas vezes, o data.json guarda em
"importados" o SHA-256 do id de cada página do Notion já trazida: não revela
valor nenhum, e o id do Notion é aleatório, não dá para adivinhar.

Só entram linhas novas: editar ou apagar uma linha no Notion depois de
sincronizada não muda o data.json.

A saída (que fica nos registros públicos do Actions) só mostra contagens,
nunca valores. Linhas com dados faltando ou estranhos são puladas e contadas.

Para testes, --paginas lê as páginas de um arquivo JSON local em vez da API:
    {"ipca": [<página do Notion>, ...], "fii": [...]}
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from add_aporte import PASTA, carregar_chave_publica, cifrar, gravar_atomico  # noqa: E402

API = "https://api.notion.com/v1"
VERSAO_API = "2022-06-28"


class LinhaInvalida(ValueError):
    pass


def marca(id_pagina: str) -> str:
    return hashlib.sha256(id_pagina.replace("-", "").lower().encode("ascii")).hexdigest()


def consultar_banco(token: str, banco: str):
    """Todas as páginas (não arquivadas) de um banco do Notion, com paginação."""
    corpo = {"page_size": 100}
    while True:
        pedido = urllib.request.Request(
            f"{API}/databases/{banco}/query",
            data=json.dumps(corpo).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": VERSAO_API,
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(pedido, timeout=30) as resposta:
                pagina = json.load(resposta)
        except urllib.error.HTTPError as e:
            dica = " (a integração tem acesso a esse banco? o token está certo?)" if e.code in (401, 403, 404) else ""
            raise SystemExit(f"Notion respondeu HTTP {e.code} ao ler um banco{dica}.")
        yield from pagina["results"]
        if not pagina.get("has_more"):
            return
        corpo["start_cursor"] = pagina["next_cursor"]


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


def aporte_ipca(props: dict) -> dict:
    data = _data(props.get("Data"))
    valor = _numero(props.get("Valor"))
    taxa = _numero(props.get("Taxa fixa"))
    if not valor > 0 or not 0 < taxa < 1:
        raise LinhaInvalida("valor ou taxa fora do esperado")
    return {"data": data, "valor": valor, "taxa": taxa}


def aporte_fii(props: dict) -> dict:
    data = _data(props.get("Data"))
    cotas = _numero(props.get("Cotas"))
    valor = _numero(props.get("Valor"))
    if cotas <= 0 or cotas != int(cotas) or not valor > 0:
        raise LinhaInvalida("cotas ou valor fora do esperado")
    cotas = int(cotas)
    aporte = {"tipo": "fii", "data": data, "cotas": cotas, "preco": round(valor / cotas, 6)}
    # compra feita com rendimento do fundo: conta nas cotas, não no total aportado
    origem = ((props.get("Origem") or {}).get("select") or {}).get("name", "")
    if origem.strip().lower().startswith("rend"):
        aporte["origem"] = "rendimento"
    return aporte


LEITORES = {"ipca": aporte_ipca, "fii": aporte_fii}


def sincronizar(paginas_por_tipo: dict, dados: dict, chave) -> tuple[int, int]:
    """Acrescenta em `dados` as páginas ainda não importadas. Devolve (novos, ignoradas)."""
    importados = dados.setdefault("importados", [])
    ja = set(importados)
    novos = ignoradas = 0
    for tipo, paginas in paginas_por_tipo.items():
        ler = LEITORES[tipo]
        for pagina in paginas:
            if pagina.get("archived") or pagina.get("in_trash"):
                continue
            m = marca(pagina["id"])
            if m in ja:
                continue
            try:
                payload = ler(pagina.get("properties", {}))
            except LinhaInvalida:
                ignoradas += 1
                continue
            dados["entries"].append(cifrar(chave, payload))
            importados.append(m)
            ja.add(m)
            novos += 1
    return novos, ignoradas


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Traz aportes novos do Notion para o data.json (cifrados).")
    p.add_argument("--keys", type=Path, default=PASTA / "keys.json")
    p.add_argument("--arquivo", type=Path, default=PASTA / "data.json")
    p.add_argument("--config", type=Path, default=PASTA / "config.json")
    p.add_argument("--paginas", type=Path, help="só para testes: páginas do Notion num JSON local")
    args = p.parse_args()

    cfg = json.loads(args.config.read_text(encoding="utf-8")).get("sincronizacao", {})
    bancos = cfg.get("notion", {})
    if args.paginas:
        paginas = json.loads(args.paginas.read_text(encoding="utf-8"))
    else:
        token = os.environ.get("NOTION_TOKEN", "").strip()
        if not token:
            raise SystemExit("Falta o segredo NOTION_TOKEN.")
        paginas = {tipo: list(consultar_banco(token, banco)) for tipo, banco in bancos.items()}

    chave = carregar_chave_publica(args.keys)
    dados = json.loads(args.arquivo.read_text(encoding="utf-8"))
    if dados.get("version") != 1 or not isinstance(dados.get("entries"), list):
        raise SystemExit("data.json em formato inesperado (esperava version 1 e lista entries).")

    novos, ignoradas = sincronizar(paginas, dados, chave)
    if novos:
        gravar_atomico(args.arquivo, dados)
    print(f"{novos} aporte(s) novo(s) cifrado(s); {ignoradas} linha(s) ignorada(s) por dados incompletos.")

    saida = os.environ.get("GITHUB_OUTPUT")
    if saida:
        with open(saida, "a", encoding="utf-8") as f:
            f.write(f"novos={novos}\n")


if __name__ == "__main__":
    main()
