import { executeQueryDBPrincipal, executeQueryEmpresa } from "./conexaoBD.js";
import { gerarToken, limparCacheUsuario } from "./auth.js"
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export function handleError(res, err, context = '') {
    console.error(`[${context}]`, err); 
    res.status(500).json({ erro: 'Erro interno do servidor' });
}

export async function validarLogin(req, res){
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ erro: 'Usuário e senha são obrigatórios' });
    }

    if (senha.length > 128) {
        return res.status(400).json({ erro: 'Entrada inválida' });
    }

    try {
        const result = await executeQueryDBPrincipal('SELECT ID, SENHA, NOME, COALESCE(TOKEN_VERSION, 0) TOKEN_VERSION FROM USUARIOS WHERE LOGIN = ?', [usuario]);
        
        const hashFake = '$2b$12$invalido.hash.para.evitar.timing.attack.xxxxxxxxxxxxxx';
        const hashReal = result.length > 0 ? result[0].senha : hashFake;

        const senhaCorreta = await bcrypt.compare(senha, hashReal);

        if (!senhaCorreta || result.length === 0) {
            return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
        }

        const token = gerarToken(result[0].id, result[0].token_version);
        return res.json({ token, nome: result[0].nome });

    } catch(err) {
        return handleError(res, err, 'validarLogin');
    }
}

export async function carregarUsuarios(req, res) {
    const usuario = req.usuario;

    try {
        const result = await executeQueryDBPrincipal(
            'SELECT ID, LOGIN, EMPRESA, NOME FROM USUARIOS WHERE EMPRESA = (SELECT EMPRESA FROM USUARIOS U WHERE U.ID = ?)',
            [usuario]
        );

        return res.status(200).json(result);

    } catch(err) {
        return handleError(res, err, 'carregarUsuarios');
    }
}

export async function cadastrarUsuario(req, res) {
    const usuario = req.usuario;
    const { login, senha, nome } = req.body;

    if (!login || !senha || !nome) {
        return res.status(400).json({ erro: 'login, senha e nome são obrigatórios' });
    }
    if (senha.length < 8) {
        return res.status(400).json({ erro: 'Senha deve ter mínimo 8 caracteres' });
    }
    if (!/^[a-zA-Z0-9._@-]{3,64}$/.test(login)) {
        return res.status(400).json({ erro: 'Login inválido' });
    }

    try {
        const resultEmpresa = await getEmpresa(usuario);
        const empresa = resultEmpresa[0].empresa;
        const resultLogin = await executeQueryDBPrincipal('SELECT ID FROM USUARIOS WHERE LOGIN = ?', [login]);

        if (resultLogin.length > 0) {
            return res.status(409).json({ erro: 'Login ja existente' });
        }

        const hash = await bcrypt.hash(senha, SALT_ROUNDS);
        await executeQueryDBPrincipal(
            'INSERT INTO USUARIOS (ID, LOGIN, SENHA, EMPRESA, NOME) VALUES ((SELECT COALESCE(MAX(ID), 0) + 1 FROM USUARIOS), ?, ?, ?, ?)',
            [login, hash, empresa, nome]
        );

        res.status(201).json({ sucesso: true });

    } catch(err) {
        return handleError(res, err, 'cadastrarUsuario');
    }
}

export async function alterarSenha(req, res) {
    const usuario = req.usuario; 
    const { senhaAtual, novaSenha } = req.body;
 
    if (!senhaAtual || !novaSenha) {
        return res.status(400).json({ erro: 'senha Atual e nova Senha são obrigatórios' });
    }
 
    if (novaSenha.length < 8) {
        return res.status(400).json({ erro: 'A nova senha deve ter no mínimo 8 caracteres' });
    }

    try {
        const result = await executeQueryDBPrincipal(
            'SELECT SENHA FROM USUARIOS WHERE ID = ?',
            [usuario]
        );

        if (result.length === 0) {                
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        const correta = await bcrypt.compare(senhaAtual, result[0].senha);

        if (!correta) {
            return res.status(401).json({ erro: 'Senha atual incorreta' });
        }

        const novoHash = await bcrypt.hash(novaSenha, SALT_ROUNDS);
        await executeQueryDBPrincipal(
            'UPDATE USUARIOS SET SENHA = ?, TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1 WHERE ID = ?',
            [novoHash, usuario]
        );

        limparCacheUsuario(usuario);
        res.json({ sucesso: true });
        
    } catch(err) {
        return handleError(res, err, 'alterarSenha');
    }
}

export async function carregarConsultas(req, res){
    const usuario = req.usuario;

    const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
    const por_pagina = Math.min(100, parseInt(req.query.por_pagina) || 50);
    const offset = (pagina - 1) * por_pagina;

    try {
        const result = await executeQueryEmpresa(
            ' SELECT FIRST ? SKIP ? '+
            '    CONSULTAS.ID, '+
            '    PACIENTES.NOME AS PACIENTE, '+
            '    TERAPEUTAS.NOME AS TERAPEUTA, '+
            '    CONSULTAS.DT_HR_SESSAO DATA_HORA, '+
            '    ESPECIALIDADES.DESCRICAO AS ESPECIALIDADE ' +
            ' FROM CONSULTAS  ' +
            '    JOIN CADASTROS PACIENTES ON PACIENTES.ID = CONSULTAS.ID_PACIENTE ' +
            '    JOIN CADASTROS TERAPEUTAS ON TERAPEUTAS.ID = CONSULTAS.ID_TERAPEUTA ' +
            '    JOIN ESPECIALIDADES ON ESPECIALIDADES.ID = CONSULTAS.ID_ESPECIALIDADE ' +
            ' ORDER BY CONSULTAS.DT_HR_SESSAO DESC',
            [por_pagina, offset],
            usuario
        );

        return res.status(200).json(result);

    } catch(err) {
        return handleError(res, err, 'carregarConsultas');
    }    
}

export async function getEmpresa(codUsuario) {
    if (!codUsuario) {
        throw new Error('Usuario não informado');
    }

    const result = await executeQueryDBPrincipal(
        ' SELECT ' +
        '    USUARIOS.EMPRESA, ' +
        '    EMPRESAS.CAMINHO_BD ' +
        ' FROM USUARIOS ' +
        '    JOIN EMPRESAS ON (EMPRESAS.ID = USUARIOS.EMPRESA) ' +
        ' WHERE USUARIOS.ID = ?',
        [codUsuario]
    );

    if (result.length === 0) {
        throw new Error('Não foi encontrado empresa para esse usuario');
    }

    return result;
}