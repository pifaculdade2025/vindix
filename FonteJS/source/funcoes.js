import { executeQueryDBPrincipal, executeQueryEmpresa } from "./conexaoBD.js";
import { gerarToken, limparCacheUsuario } from "./auth.js"
import bcrypt from "bcrypt";
import crypto from 'crypto';

const SALT_ROUNDS = 12;
const HASH_FAKE = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), SALT_ROUNDS);

export function handleError(res, err, context = '') {
    console.error(`[${context}]`, err); 
    res.status(500).json({ erro: 'Erro interno do servidor' });
}

export async function validarLogin(req, res){
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ erro: 'Usuário e senha são obrigatórios' });
    }

    if (senha.length > 60) {
        return res.status(400).json({ erro: 'Entrada inválida' });
    }

    if (usuario.length < 3 || usuario.length > 100){
        return res.status(400).json({ erro: 'Usuário inválido' });
    }

    try {
        const result = await executeQueryDBPrincipal('SELECT ID, SENHA, NOME, COALESCE(TOKEN_VERSION, 0) TOKEN_VERSION FROM USUARIOS WHERE LOGIN = ?', [usuario]);
        
        const hashReal = result.length > 0 ? result[0].senha : HASH_FAKE;

        const senhaCorreta = await bcrypt.compare(senha, hashReal);

        if (!senhaCorreta || result.length === 0) {
            return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
        }

        const resultPermissoes = await executeQueryEmpresa(
            `SELECT ID_PERMISSAO FROM PERMISSOES_USUARIOS WHERE ID_USUARIO = ?`,
            [result[0].id],
            result[0].id
        );

        if (resultPermissoes.length === 0) {
            return res.status(403).json({ erro: 'Usuário não tem permissões configuradas' });
        }

        const permissoes = resultPermissoes.map(r => r.id_permissao);

        const token = gerarToken(result[0].id, result[0].token_version, permissoes);
        return res.json({ token, nome: result[0].nome, permissoes });

    } catch(err) {
        return handleError(res, err, 'validarLogin');
    }
}

export async function carregarUsuarios(req, res) {
    const usuario = req.usuario;

    try {
        const result = await executeQueryDBPrincipal(
            'SELECT ID, EMPRESA, NOME, UPDATED_AT FROM USUARIOS WHERE EMPRESA = (SELECT EMPRESA FROM USUARIOS U WHERE U.ID = ?)',
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
        return res.status(400).json({ erro: 'Senha deve ter no mínimo 8 caracteres' });
    }

    if (senha.length > 60) {
        return res.status(400).json({ erro: 'Senha deve ter no maximo 60 caracteres' });
    }

    if (!/^[a-zA-Z0-9._@-]{3,64}$/.test(login)) {
        return res.status(400).json({ erro: 'Login inválido' });
    }

    if (login.length < 3 || login.length > 100){
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

export async function carregarPermissoes(req, res) {    
    try {
        const result = await executeQueryDBPrincipal(
            ' SELECT * FROM PERMISSOES ',
            []
        );        
        res.status(200).json(result);
    } catch(err){
        return handleError(res, err, 'carregarPermissoes');
    }
}

export async function carregarPermissoesUsuario(req, res) {
    const usuarioLogado = req.usuario;
    const usuario = req.query.usuario;  

    try {
        const check = await executeQueryDBPrincipal(
            'SELECT 1 FROM USUARIOS WHERE ID=? AND EMPRESA=(SELECT EMPRESA FROM USUARIOS WHERE ID=?)',
            [usuario, usuarioLogado]
        );
        if (check.length === 0) {
            return res.status(403).json({ erro: 'Sem permissão' });
        }

        const result = await executeQueryEmpresa(
            ' SELECT '+
            '    PERMISSOES_USUARIOS.ID, '+
            '    PERMISSOES_USUARIOS.ID_USUARIO, '+ 
            '    PERMISSOES_USUARIOS.ID_PERMISSAO '+ 
            ' FROM PERMISSOES_USUARIOS  ' +
            ' WHERE PERMISSOES_USUARIOS.ID_USUARIO = ? '+
            ' ORDER BY PERMISSOES_USUARIOS.ID_PERMISSAO ',
            [usuario],
            usuarioLogado
        );

        return res.status(200).json(result);

    } catch(err) {
        return handleError(res, err, 'carregarPermissoesUsuario');
    }      
}

export async function adicionarPermissoes(req, res) {   
    const usuarioLogado = req.usuario; 
    const { usuario, permissao } = req.body;      

    if (!usuario || !permissao) {
        return res.status(400).json({ erro: 'Informe o usuario e a permissão'});
    }

    try {
        const check = await executeQueryDBPrincipal(
            'SELECT 1 FROM USUARIOS WHERE ID=? AND EMPRESA=(SELECT EMPRESA FROM USUARIOS WHERE ID=?)',
            [usuario, usuarioLogado]
        );
        if (check.length === 0) {
            return res.status(403).json({ erro: 'Sem permissão' });
        }

        const perm = await executeQueryDBPrincipal(
            'SELECT ID FROM PERMISSOES WHERE ID=?',
            [permissao]
        );
        if (perm.length===0) {
            return res.status(400).json({erro:'Permissão inexistente'});
        }    

        await executeQueryEmpresa(
            'INSERT INTO PERMISSOES_USUARIOS (ID, ID_USUARIO, ID_PERMISSAO) VALUES ((SELECT COALESCE(MAX(ID), 0) + 1 FROM PERMISSOES_USUARIOS), ?, ?) ',
            [usuario, permissao],
            usuarioLogado
        );
        res.status(201).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'adicionarPermissoes');
    }
}

export async function excluirPermissao(req, res) {
    const usuarioLogado = req.usuario;
    const { idPermissao } = req.body;

    if (!idPermissao) {
        return res.status(400).json({ erro: 'Informe qual permissão deseja excluir'});
    }

    try {
        await executeQueryDBPrincipal(
            'UPDATE USUARIOS SET TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1 WHERE ID = (SELECT ID_USUARIO FROM PERMISSOES_USUARIOS WHERE ID = ?)',
            [idPermissao]
        );

        await executeQueryEmpresa(
            'DELETE FROM PERMISSOES_USUARIOS WHERE ID = ?',
            [idPermissao],
            usuarioLogado        
        );
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'excluirPermissao');
    }
}

export async function alterarNome(req, res) {
    const usuarioLogado = req.usuario;
    const { usuario, novonome,  updatedAt } = req.body;

    if (!usuario) {
        return res.status(400).json({ erro: 'Informe o usuário que deseja alterar '});
    }

    if (!novonome || novonome.length > 100) {
        return res.status(400).json({ erro: 'Informe um nome valido' });
    }

    try {
        const resultUpdate = await executeQueryDBPrincipal(
            ' UPDATE USUARIOS SET NOME = ?, UPDATED_AT = UPDATED_AT+1 '+
            ' WHERE ID = ? AND UPDATED_AT = ?'+
            ' AND EMPRESA=(SELECT EMPRESA FROM USUARIOS WHERE ID=?) RETURNING ID ',
            [novonome, usuario, updatedAt, usuarioLogado]
        );

        if (!resultUpdate || resultUpdate.length === 0) {
            return res.status(409).json({ erro: 'Registro alterado por outro usuário. Recarregue e tente novamente.'});
        }

        return res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'alterarNome');
    }
}

export async function alterarSenha(req, res) {
    const usuario = req.usuario; 
    const { senhaAtual, novaSenha, updatedAt } = req.body;
 
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
        const resultUpdate = await executeQueryDBPrincipal(
            'UPDATE USUARIOS SET SENHA = ?, TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1, UPDATED_AT = UPDATED_AT + 1 WHERE ID = ? AND UPDATED_AT = ? RETURNING ID',
            [novoHash, usuario, updatedAt]
        );

        if (!resultUpdate || resultUpdate.length === 0) {
            return res.status(409).json({ erro: 'Registro alterado por outro usuário. Recarregue e tente novamente.' });
        }

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

export async function carregarCadastros(req, res) {
    const usuario = req.usuario;

    const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
    const por_pagina = Math.min(100, parseInt(req.query.por_pagina) || 50);
    const offset = (pagina - 1) * por_pagina;

    try {
        const result = await executeQueryEmpresa(
            ' SELECT FIRST ? SKIP ? '+
            '    CADASTROS.ID, '+
            '    CADASTROS.NOME, '+
            '    CADASTROS.TELEFONE, '+
            '    CADASTROS.DT_NASC, '+
            '    CADASTROS.DT_CADASTRO, '+
            '    CADASTROS.REGISTRO_PROFISSIONAL, '+
            '    CADASTROS.TIPO, '+
            '    CADASTROS.CPF, '+
            '    CADASTROS.DIAGNOSTICO '+
            ' FROM CADASTROS '+
            ' ORDER BY CADASTROS.ID ',
            [por_pagina, offset],
            usuario
        );

        return res.status(200).json(result);

    } catch(err) {
        return handleError(res, err, 'carregarCadastros');
    }    
}

export async function carregarEspecialidades(req, res) {
    const usuario = req.usuario;
    
    try {
        const result = await executeQueryEmpresa(
            'SELECT ID, DESCRICAO, INATIVO, ID_COR FROM ESPECIALIDADES ',
            [],
            usuario
        );

        return res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'carregarEspecialidades')
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