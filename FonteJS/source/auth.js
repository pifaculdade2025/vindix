import jwt from "jsonwebtoken"
import 'dotenv/config'
import { executeQueryDBPrincipal, executeQueryEmpresa } from "./conexaoBD.js";
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

// O token só identifica o usuário; as permissões são sempre lidas do banco
export function gerarToken(usuarioId, tokenVersion) {
    return jwt.sign(
        {
            id: usuarioId,
            v: tokenVersion
        },
        SECRET,
        {
            algorithm: 'HS256',
            expiresIn: "1h" 
        }
    )
}

export async function carregarPermissoes(usuarioId) {
    const result = await executeQueryEmpresa(
        'SELECT ID_PERMISSAO FROM PERMISSOES_USUARIOS WHERE ID_USUARIO = ?',
        [usuarioId],
        usuarioId
    );
    return result.map(r => r.id_permissao);
}

// Cadastro de profissional vinculado ao usuário (null se o usuário não é um profissional)
export async function carregarTerapeuta(usuarioId) {
    const [t] = await executeQueryEmpresa(
        "SELECT ID, NOME FROM CADASTROS WHERE ID_USUARIO = ? AND TIPO = 'Terapeuta' AND EXCLUIDO_EM IS NULL",
        [usuarioId],
        usuarioId
    );
    return t ? { id: t.id, nome: t.nome } : null;
}

// Profissional sem acesso total enxerga só o que é dele: req.terapeuta = ID do cadastro dele
export const escopoTerapeuta = (permissoes, terapeuta) => permissoes.includes(1) ? null : (terapeuta?.id ?? null);

// Com a senha redefinida pelo administrador, só é possível criar a senha nova ou sair
const ROTAS_DURANTE_TROCA = new Set(['PUT /usuarios/senha', 'POST /logout']);
const exigirTrocaSenha = res =>
    res.status(403).json({ erro: 'Crie uma nova senha para continuar', trocarSenha: true });

export async function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ erro: "Token não enviado" });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    } catch {
        return res.status(401).json({ erro: "Token inválido" });
    }

    if (!decoded.id) {
        return res.status(401).json({ erro: "Usuário não encontrado na autenticação" });
    }
    if (!Number.isInteger(decoded.id)) {
        return res.status(401).json({ erro: 'Token malformado' });
    }

    const cached = cacheTokenVersion.get(decoded.id);
    if (cached && Date.now() < cached.expira) {
        if (decoded.v !== cached.version) {
            return res.status(401).json({ erro: 'Sessão encerrada' });
        }
        if (cached.trocarSenha && !ROTAS_DURANTE_TROCA.has(`${req.method} ${req.path}`)) {
            return exigirTrocaSenha(res);
        }
        req.usuario = decoded.id;
        req.permissoes = cached.permissoes;
        req.terapeuta = escopoTerapeuta(cached.permissoes, cached.terapeuta);
        return next();
    }

    try {
        const result = await executeQueryDBPrincipal(
            `SELECT COALESCE(TOKEN_VERSION, 0) TOKEN_VERSION, TROCAR_SENHA, INATIVO FROM USUARIOS WHERE ID = ?`,
            [decoded.id]
        );

        if (!result || result.length === 0) {
            return res.status(401).json({ erro: 'Usuário não encontrado' });
        }

        if (result[0].inativo === 1) {
            return res.status(401).json({ erro: 'Sessão encerrada' });
        }

        if (decoded.v !== result[0].token_version) {
            return res.status(401).json({ erro: 'Sessão encerrada' });
        }

        const [permissoes, terapeuta] = await Promise.all([carregarPermissoes(decoded.id), carregarTerapeuta(decoded.id)]);
        const trocarSenha = result[0].trocar_senha === 1;
        cacheTokenVersion.set(decoded.id, {
            version: result[0].token_version,
            permissoes,
            terapeuta,
            trocarSenha,
            expira: Date.now() + CACHE_TTL_MS
        });

        if (trocarSenha && !ROTAS_DURANTE_TROCA.has(`${req.method} ${req.path}`)) {
            return exigirTrocaSenha(res);
        }

        req.usuario = decoded.id;
        req.permissoes = permissoes;
        req.terapeuta = escopoTerapeuta(permissoes, terapeuta);
        next();

    } catch (err) {
        return funcoes.handleError(res, err, 'autenticarToken');
    }
}

export function exigirPermissao(...idsPermissao) {
    return (req, res, next) => {
        const permissoesUsuario = req.permissoes ?? [];
        
        const temAcesso = idsPermissao.some(id => permissoesUsuario.includes(id));
        
        if (!temAcesso) {
            return res.status(403).json({ erro: 'Sem permissão' });
        }
        
        next();
    };
}