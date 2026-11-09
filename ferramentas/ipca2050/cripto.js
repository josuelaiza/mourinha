// ================================================================== //
// == CRIPTOGRAFIA DO SIMULADOR (só Web Crypto API)                == //
// ================================================================== //
// Esquema híbrido:
//  - Par RSA-OAEP 3072 bits, SHA-256 (MGF1 também SHA-256, rótulo vazio).
//  - Cada aporte: chave AES-256-GCM aleatória cifra o JSON do aporte;
//    essa chave vai embrulhada (wrap) com a chave pública.
//    Entrada: { id, wrappedKey, iv, ciphertext }, tudo em base64.
//  - Chave privada (PKCS8) cifrada com AES-256-GCM, chave derivada da
//    senha por PBKDF2-SHA256 (600.000 iterações, salt de 16 bytes, IV de 12).
//
// A chave privada em claro só existe na memória deste navegador, nunca sai dele.
// No IndexedDB ela fica como CryptoKey NÃO extraível: o navegador usa,
// mas nem o próprio código da página consegue exportar os bytes.

const subtle = globalThis.crypto.subtle;

export const ITERACOES_PBKDF2 = 600000;
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

export function paraBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let texto = '';
    for (let i = 0; i < u8.length; i += 0x8000) texto += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(texto);
}

export function deBase64(texto) {
    return Uint8Array.from(atob(texto), c => c.charCodeAt(0));
}

async function chaveDaSenha(senha, salt, iteracoes, usos) {
    const base = await subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: iteracoes, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, usos,
    );
}

// Gera o par de chaves e devolve o conteúdo do keys.json
export async function gerarChaves(senha) {
    const par = await subtle.generateKey(
        { ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
        true, ['wrapKey', 'unwrapKey'],
    );
    const spki = await subtle.exportKey('spki', par.publicKey);
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', par.privateKey));

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const chave = await chaveDaSenha(senha, salt, ITERACOES_PBKDF2, ['encrypt']);
    const cifrado = await subtle.encrypt({ name: 'AES-GCM', iv }, chave, pkcs8);
    pkcs8.fill(0); // apaga a cópia em claro (melhor esforço)

    return {
        publicKeySpki: paraBase64(spki),
        encryptedPrivateKey: {
            salt: paraBase64(salt),
            iv: paraBase64(iv),
            iterations: ITERACOES_PBKDF2,
            ciphertext: paraBase64(cifrado),
        },
    };
}

export class SenhaIncorreta extends Error {
    constructor() { super('Senha incorreta.'); this.name = 'SenhaIncorreta'; }
}

// Abre a chave privada com a senha. Devolve CryptoKey não extraível.
export async function abrirChavePrivada(keys, senha) {
    const e = keys.encryptedPrivateKey;
    const chave = await chaveDaSenha(senha, deBase64(e.salt), e.iterations, ['decrypt']);
    let pkcs8;
    try {
        pkcs8 = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: deBase64(e.iv) }, chave, deBase64(e.ciphertext)));
    } catch {
        throw new SenhaIncorreta(); // GCM não autentica: senha errada (ou arquivo alterado)
    }
    try {
        return await subtle.importKey('pkcs8', pkcs8, RSA, false, ['unwrapKey']);
    } finally {
        pkcs8.fill(0);
    }
}

// Decifra uma entrada do data.json -> { data, valor, taxa }
export async function decifrarEntrada(chavePrivada, entrada) {
    const aes = await subtle.unwrapKey(
        'raw', deBase64(entrada.wrappedKey), chavePrivada, { name: 'RSA-OAEP' },
        { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const claro = await subtle.decrypt({ name: 'AES-GCM', iv: deBase64(entrada.iv) }, aes, deBase64(entrada.ciphertext));
    return JSON.parse(new TextDecoder().decode(claro));
}

// ------------------------------------------------------------------ //
// "Lembrar neste dispositivo" (IndexedDB). Quem chama trata as falhas.
// Guardamos junto a chave pública, para descartar a chave lembrada se
// o keys.json do site for trocado por outro par.
// ------------------------------------------------------------------ //

const BANCO = 'ipca2050', LOJA = 'chaves', ITEM = 'privada';

function abrirBanco() {
    return new Promise((resolve, reject) => {
        const pedido = indexedDB.open(BANCO, 1);
        pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA);
        pedido.onsuccess = () => resolve(pedido.result);
        pedido.onerror = () => reject(pedido.error);
    });
}

async function naLoja(modo, acao) {
    const banco = await abrirBanco();
    try {
        return await new Promise((resolve, reject) => {
            const tx = banco.transaction(LOJA, modo);
            const pedido = acao(tx.objectStore(LOJA));
            tx.oncomplete = () => resolve(pedido.result);
            tx.onerror = tx.onabort = () => reject(tx.error);
        });
    } finally {
        banco.close();
    }
}

export function lembrarChave(chavePrivada, publicKeySpki) {
    return naLoja('readwrite', loja => loja.put({ chave: chavePrivada, publicKeySpki }, ITEM));
}

export async function chaveLembrada(publicKeySpki) {
    const item = await naLoja('readonly', loja => loja.get(ITEM));
    if (!item) return null;
    if (item.publicKeySpki !== publicKeySpki) {
        await esquecerChave();
        return null;
    }
    return item.chave;
}

export function esquecerChave() {
    return naLoja('readwrite', loja => loja.delete(ITEM));
}
