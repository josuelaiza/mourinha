#!/usr/bin/env python3
"""Acrescenta um aporte CIFRADO ao data.json do simulador de patrimônio.

Uso:
    python add_aporte.py --data AAAA-MM-DD --valor 100.00 --taxa 0.0650      (Tesouro IPCA+ 2050)
    python add_aporte.py --tipo fii --data AAAA-MM-DD --cotas 10 --preco 9.80 (FII)

Só precisa da chave pública (keys.json). O aporte em claro existe apenas na
memória deste processo: não é gravado em arquivo nem impresso na tela.

Formato (o mesmo que a página decifra com a Web Crypto API):
  - chave AES-256-GCM aleatória cifra o JSON do aporte:
      IPCA+: {"data", "valor", "taxa"}   (sem "tipo", como os primeiros aportes)
      FII:   {"tipo": "fii", "data", "cotas", "preco"}
    o tipo vai dentro da parte cifrada: o repo não mostra qual investimento é;
  - a chave AES vai embrulhada com RSA-OAEP (SHA-256, MGF1-SHA-256, sem rótulo);
  - entrada: {"id", "wrappedKey", "iv", "ciphertext"}, tudo em base64
    (o ciphertext do AES-GCM já leva a tag de 16 bytes no final).

Requer a biblioteca `cryptography` (pip install cryptography).
"""

import argparse
import base64
import json
import os
import secrets
import sys
import tempfile
import uuid
from datetime import date
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PASTA = Path(__file__).resolve().parent.parent


def b64(dados: bytes) -> str:
    return base64.b64encode(dados).decode("ascii")


def ler_data(texto: str) -> str:
    try:
        if len(texto) != 10:
            raise ValueError
        return date.fromisoformat(texto).isoformat()
    except ValueError:
        raise argparse.ArgumentTypeError("use o formato AAAA-MM-DD")


def ler_valor(texto: str) -> float:
    try:
        valor = float(texto)
    except ValueError:
        raise argparse.ArgumentTypeError("use ponto como separador decimal, ex.: 100.50")
    if not valor > 0:
        raise argparse.ArgumentTypeError("o valor precisa ser maior que zero")
    return valor


def ler_taxa(texto: str) -> float:
    try:
        taxa = float(texto)
    except ValueError:
        raise argparse.ArgumentTypeError("use decimal, ex.: 0.0650 para 6,50%")
    if not 0 < taxa < 1:
        raise argparse.ArgumentTypeError("a taxa vai em decimal (6,50% = 0.0650)")
    return taxa


def ler_cotas(texto: str) -> int:
    try:
        cotas = int(texto)
    except ValueError:
        raise argparse.ArgumentTypeError("cotas são um número inteiro, ex.: 10")
    if cotas <= 0:
        raise argparse.ArgumentTypeError("as cotas precisam ser mais que zero")
    return cotas


def carregar_chave_publica(caminho: Path) -> rsa.RSAPublicKey:
    keys = json.loads(caminho.read_text(encoding="utf-8"))
    chave = serialization.load_der_public_key(base64.b64decode(keys["publicKeySpki"]))
    if not isinstance(chave, rsa.RSAPublicKey) or chave.key_size != 3072:
        raise SystemExit("keys.json não tem uma chave pública RSA de 3072 bits.")
    return chave


def cifrar(chave_publica: rsa.RSAPublicKey, payload: dict) -> dict:
    claro = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    chave_aes = AESGCM.generate_key(bit_length=256)
    iv = secrets.token_bytes(12)
    cifrado = AESGCM(chave_aes).encrypt(iv, claro, None)
    embrulhada = chave_publica.encrypt(
        chave_aes,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    return {
        "id": str(uuid.uuid4()),  # aleatório: não revela a data do aporte
        "wrappedKey": b64(embrulhada),
        "iv": b64(iv),
        "ciphertext": b64(cifrado),
    }


def gravar_atomico(caminho: Path, conteudo: dict) -> None:
    texto = json.dumps(conteudo, ensure_ascii=False, indent=2) + "\n"
    fd, temporario = tempfile.mkstemp(dir=caminho.parent, prefix=".data-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(texto)
        os.replace(temporario, caminho)
    except BaseException:
        os.unlink(temporario)
        raise


def avisar_ipca_atrasado(caminho_config: Path, hoje: date) -> None:
    """Avisa (sem bloquear) se o config.json não tem o IPCA do ano passado.

    O IBGE divulga o IPCA de dezembro por volta do dia 10 de janeiro; a partir
    daí a média dos últimos 10 anos completos já pode ser atualizada.
    """
    try:
        cfg = json.loads(caminho_config.read_text(encoding="utf-8"))
        ultimo = max((x["ano"] for x in cfg.get("ipcaAnual", [])), default=None)
    except (OSError, ValueError, KeyError, TypeError):
        print(f"AVISO: não consegui ler o IPCA de {caminho_config}.")
        return
    if ultimo is None or ultimo < hoje.year - 1:
        print(
            f"AVISO: o config.json tem IPCA até {ultimo}; o de {hoje.year - 1} já deve estar "
            "publicado (IBGE, por volta de 10 de janeiro). Atualize a inflação do simulador."
        )


def main() -> None:
    # no Windows, saída redirecionada sai em cp1252 e estraga os acentos
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Acrescenta um aporte cifrado ao data.json.")
    p.add_argument("--tipo", choices=["ipca", "fii"], default="ipca", help="investimento (padrão: ipca)")
    p.add_argument("--data", required=True, type=ler_data, help="data do aporte, AAAA-MM-DD")
    p.add_argument("--valor", type=ler_valor, help="IPCA+: valor em reais, ex.: 100.50")
    p.add_argument("--taxa", type=ler_taxa, help="IPCA+: taxa real em decimal, ex.: 0.0650")
    p.add_argument("--cotas", type=ler_cotas, help="FII: quantidade de cotas, ex.: 10")
    p.add_argument("--preco", type=ler_valor, help="FII: preço pago por cota, ex.: 9.80")
    p.add_argument("--keys", type=Path, default=PASTA / "keys.json", help="caminho do keys.json")
    p.add_argument("--arquivo", type=Path, default=PASTA / "data.json", help="caminho do data.json")
    p.add_argument("--config", type=Path, default=PASTA / "config.json", help="caminho do config.json (só para o aviso do IPCA)")
    args = p.parse_args()
    if args.tipo == "ipca":
        if args.valor is None or args.taxa is None or args.cotas is not None or args.preco is not None:
            p.error("IPCA+ usa --valor e --taxa (sem --cotas/--preco)")
        payload = {"data": args.data, "valor": args.valor, "taxa": args.taxa}
    else:
        if args.cotas is None or args.preco is None or args.valor is not None or args.taxa is not None:
            p.error("FII usa --cotas e --preco (sem --valor/--taxa)")
        payload = {"tipo": "fii", "data": args.data, "cotas": args.cotas, "preco": args.preco}

    if not args.keys.exists():
        raise SystemExit(f"Não achei {args.keys}. Crie as chaves pela página primeiro.")
    chave = carregar_chave_publica(args.keys)

    dados = json.loads(args.arquivo.read_text(encoding="utf-8"))
    if dados.get("version") != 1 or not isinstance(dados.get("entries"), list):
        raise SystemExit("data.json em formato inesperado (esperava version 1 e lista entries).")

    entrada = cifrar(chave, payload)
    dados["entries"].append(entrada)
    gravar_atomico(args.arquivo, dados)
    print(f"Aporte cifrado acrescentado (id {entrada['id']}). Total de entradas: {len(dados['entries'])}.")
    avisar_ipca_atrasado(args.config, date.today())


if __name__ == "__main__":
    sys.exit(main())
