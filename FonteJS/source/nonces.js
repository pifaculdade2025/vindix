import crypto from 'crypto';

const nonces = new Map();
const TTL_MS = 10 * 60 * 1000; 

export function criarNonce(usuario) {
    const nonce = crypto.randomBytes(16).toString('hex');
    nonces.set(nonce, { usuario, expira: Date.now() + TTL_MS });
    return nonce;
}

export function consumirNonce(nonce) {
    const entry = nonces.get(nonce);
    if (!entry) return null;
    nonces.delete(nonce); 
    if (Date.now() > entry.expira) return null;
    return entry.usuario;
}

setInterval(() => {
    const agora = Date.now();
    for (const [k, v] of nonces.entries()) {
        if (agora > v.expira) nonces.delete(k);
    }
}, 5 * 60 * 1000);