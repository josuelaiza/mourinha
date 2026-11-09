#!/usr/bin/env python3
"""Acrescenta um aporte CIFRADO ao data.json do simulador Tesouro IPCA+ 2050.

Uso:
    python add_aporte.py --data AAAA-MM-DD --valor 100.00 --taxa 0.0650

Só precisa da chave pública (keys.json). O aporte em claro existe apenas na
memória deste processo: não é gravado em arquivo nem impresso na tela.

Formato (o mesmo que a página decifra com a Web Crypto API):
  - chave AES-256-GCM aleatória cifra o JSON {"data", "valor", "taxa"};
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


def main() -> None:
    p = argparse.ArgumentParser(description="Acrescenta um aporte cifrado ao data.json.")
    p.add_argument("--data", required=True, type=ler_data, help="data do aporte, AAAA-MM-DD")
    p.add_argument("--valor", required=True, type=ler_valor, help="valor em reais, ex.: 100.50")
    p.add_argument("--taxa", required=True, type=ler_taxa, help="taxa real em decimal, ex.: 0.0650")
    p.add_argument("--keys", type=Path, default=PASTA / "keys.json", help="caminho do keys.json")
    p.add_argument("--arquivo", type=Path, default=PASTA / "data.json", help="caminho do data.json")
    args = p.parse_args()

    if not args.keys.exists():
        raise SystemExit(f"Não achei {args.keys}. Crie as chaves pela página primeiro.")
    chave = carregar_chave_publica(args.keys)

    dados = json.loads(args.arquivo.read_text(encoding="utf-8"))
    if dados.get("version") != 1 or not isinstance(dados.get("entries"), list):
        raise SystemExit("data.json em formato inesperado (esperava version 1 e lista entries).")

    entrada = cifrar(chave, {"data": args.data, "valor": args.valor, "taxa": args.taxa})
    dados["entries"].append(entrada)
    gravar_atomico(args.arquivo, dados)
    print(f"Aporte cifrado acrescentado (id {entrada['id']}). Total de entradas: {len(dados['entries'])}.")


if __name__ == "__main__":
    sys.exit(main())
