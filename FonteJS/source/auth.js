import jwt from "jsonwebtoken"
import 'dotenv/config'
import { executeQueryDBPrincipal } from "./conexaoBD.js";
import * as funcoes from "./funcoes.js";

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET não definido");
}

const SECRET = process.env.JWT_SECRET;

const cacheTokenVersion = new Map();
const CACHE_TTL_MS = 30 * 1000;

export function limparCacheUsuario(usuarioId) {
    cacheTokenVersion.delete(usuarioId);
}

export function gerarToken(usuarioId, tokenVersion) {
    return jwt.sign(
        {
            id: usuarioId,
            v: tokenVersion 
        },
        SECRET,
        {
            expiresIn: "1d" 
        }
    )
}

export async function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    const token = authHeader
        ? authHeader.split(' ')[1]
        : req.query.token;

    if (!token) {
        return res.status(401).json({ erro: "Token não enviado" });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, SECRET);
    } catch {
        return res.status(403).json({ erro: "Token inválido" });
    }

    if (!decoded.id) {
        return res.status(401).json({ erro: "Usuario não encontrado na autenticação" });
    }
    if (!Number.isInteger(decoded.id)) {
        return res.status(401).json({ erro: 'Token malformado' });
    }

    const cached = cacheTokenVersion.get(decoded.id);
    if (cached && Date.now() < cached.expira) {
        if (decoded.v !== cached.version) {
            return res.status(401).json({ erro: 'Sessão encerrada' });
        }  
        req.usuario = decoded.id;
        return next();
    }

    try {
        const result = await executeQueryDBPrincipal(
            `SELECT COALESCE(TOKEN_VERSION, 0) TOKEN_VERSION FROM USUARIOS WHERE ID = ?`,
            [decoded.id]
        );

        if (!result || result.length === 0) {
            return res.status(401).json({ erro: 'Usuário não encontrado' });
        }

        cacheTokenVersion.set(decoded.id, {
            version: result[0].token_version,
            expira: Date.now() + CACHE_TTL_MS
        });

        if (decoded.v !== result[0].token_version) {
            return res.status(401).json({ erro: 'Sessão encerrada' });
        }

        req.usuario = parseInt(decoded.id, 10);
        next();

    } catch (err) {
        return funcoes.handleError(res, err, 'autenticarToken');
    }
}