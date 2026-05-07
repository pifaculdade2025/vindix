import {executeQueryDBPrincipal, executeQueryEmpresa, InserirHistorico, InserirHistoricoInsert, InserirHistoricoDelete} from "./conexaoBD.js";
import { gerarToken, limparCacheUsuario } from "./auth.js"
import {decrypt, encrypt, isEncrypted} from "./cripto.js";
import bcrypt from "bcrypt";
import crypto from 'crypto';

const SALT_ROUNDS = 12;
const HASH_FAKE = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), SALT_ROUNDS);

export function handleError(res, err, context = '') {
    console.error(`[${context}]`, err); 
    res.status(500).json({ erro: 'Erro interno do servidor' });
}

const CAMPOS_CRIPTOGRAFADOS = {
    CADASTROS: new Set(['CPF', 'DIAGNOSTICO']),
    CONSULTAS:  new Set(['RESUMO_SESSAO']),
};

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
            'INSERT INTO USUARIOS (LOGIN, SENHA, EMPRESA, NOME) VALUES (?, ?, ?, ?)',
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
    const usuario = parseInt(req.query.usuario, 10);

    if (!Number.isInteger(usuario) || usuario <= 0) {
        return res.status(400).json({ erro: 'ID de usuário inválido' });
    }

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

    if (!Number.isInteger(usuario) || usuario <= 0) {
        return res.status(400).json({ erro: 'ID de usuário inválido' });
    }

    if (!Number.isInteger(permissao) || permissao <= 0) {
        return res.status(400).json({ erro: 'ID de permissao inválido' });
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
            'INSERT INTO PERMISSOES_USUARIOS (ID_USUARIO, ID_PERMISSAO) VALUES (?, ?) ',
            [usuario, permissao],
            usuarioLogado
        );
        
        await InserirHistoricoInsert(usuarioLogado, 'PERMISSOES_USUARIOS');
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
        const result = await executeQueryEmpresa(
            'SELECT ID_USUARIO FROM PERMISSOES_USUARIOS WHERE ID = ?',  
            [idPermissao],
            usuarioLogado
        );

        if (result.length === 0) {                
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        const usuario = result[0].id_usuario;
        const empresa = await getEmpresa(usuarioLogado);

        await executeQueryDBPrincipal(
            'UPDATE USUARIOS SET TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1 WHERE ID = ? AND EMPRESA = ?',
            [usuario, empresa]
        );

        await InserirHistoricoDelete(usuarioLogado, 'PERMISSOES_USUARIOS', idPermissao);
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

export async function HistoricoPermissoesUsuario(req, res) {
    try {
        const result = await getHistorico('PERMISSOES_USUARIOS', req.params.id, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoPermissoesUsuario');
    }       
}

export async function alterarNome(req, res) {
    const usuarioLogado = req.usuario;
    const { usuario, novonome,  updatedAt } = req.body;

    if (!usuario) {
        return res.status(400).json({ erro: 'Informe o usuário que deseja alterar '});
    }

    if (!novonome || novonome.trim().length === 0 || novonome.length > 100) {
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

    if (novaSenha.length > 60) {
        return res.status(400).json({ erro: 'Senha deve ter no máximo 60 caracteres' });
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
            '    CONSULTAS.ENVIADO_GOOGLE, '+
            '    CONSULTAS.RESUMO_SESSAO, '+
            '    CONSULTAS.UPDATED_AT, '+
            '    CONSULTAS.ID_TERAPEUTA, '+
            '    CONSULTAS.ID_ESPECIALIDADE, '+
            '    CONSULTAS.TEMPO_SESSAO, '+
            '    CONSULTAS.ID_PACIENTE, '+
            '    ESPECIALIDADES.DESCRICAO AS ESPECIALIDADE ' +
            ' FROM CONSULTAS  ' +
            '    JOIN CADASTROS PACIENTES ON PACIENTES.ID = CONSULTAS.ID_PACIENTE ' +
            '    JOIN CADASTROS TERAPEUTAS ON TERAPEUTAS.ID = CONSULTAS.ID_TERAPEUTA ' +
            '    JOIN ESPECIALIDADES ON ESPECIALIDADES.ID = CONSULTAS.ID_ESPECIALIDADE ' +
            ' ORDER BY CONSULTAS.DT_HR_SESSAO DESC',
            [por_pagina, offset],   
            usuario
        );
        const descriptografado = result.map(r => ({
            ...r,
            resumo_sessao: isEncrypted(r.resumo_sessao) ? decrypt(r.resumo_sessao) : r.resumo_sessao,
        }));
        return res.status(200).json(descriptografado);

    } catch(err) {
        return handleError(res, err, 'carregarConsultas');
    }    
}

export async function AdicionarConsultas(req, res) {
    const usuario = req.usuario;    

    try {
        const result = await executeQueryEmpresa(
            "INSERT INTO CONSULTAS (ID_PACIENTE, ID_TERAPEUTA, RESUMO_SESSAO, DT_HR_SESSAO, ID_ESPECIALIDADE, ENVIADO_GOOGLE, TEMPO_SESSAO, UPDATED_AT) "+
            " VALUES (?, ?, ?, ?, ?, 'N', ?, 1) ",
            [req.body.id_paciente, req.body.id_terapeuta, encrypt(req.body.resumo_sessao), req.body.dt_hr_sessao, req.body.id_especialidade, req.body.tempo_sessao],
            usuario
        );
        await InserirHistoricoInsert(usuario, 'CONSULTAS');
        res.status(201).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'AdicionarConsultas');
    }  
}

export async function alterarConsultas(req, res) {
    const usuario = req.usuario;

    try {
        const { updatedAt, campos } = req.body;

        if (!updatedAt) {
            return res.status(400).json({ erro: 'updatedAt é obrigatório' });
        }

        await InserirHistorico(usuario, 'CONSULTAS', req.params.id, campos);
  
        const setClauses = [];
        const valores = [];
        
        const CAMPOS_PERMITIDOS = new Set([
            'ID_PACIENTE', 'ID_TERAPEUTA', 'RESUMO_SESSAO', 'DT_HR_SESSAO', 'ID_ESPECIALIDADE', 'TEMPO_SESSAO'
        ]);

        for (const [campo, valor] of Object.entries(campos)) {
            if (campo.toUpperCase() === 'UPDATED_AT') {
                continue;
            }
            if (!CAMPOS_PERMITIDOS.has(campo.toUpperCase())) {
                return res.status(400).json({ erro: `Campo inválido: ${campo}` });
            }
            setClauses.push(`${campo} = ?`);
            valores.push(valor);
        }

        if (setClauses.length === 0) {
            return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
        }

        valores.push(req.params.id);
        valores.push(req.body.updatedAt);

        const result = await executeQueryEmpresa(
            `UPDATE CONSULTAS SET UPDATED_AT = UPDATED_AT + 1, ${setClauses.join(', ')} WHERE ID = ? AND UPDATED_AT = ? RETURNING ID `,
            valores,
            usuario
        );

        if (result.length === 0) {
            res.status(409).json({ erro: 'Registro desatualizado, tente novamente' });
        }
        else {
            res.status(200).json({ sucesso: true });
        }

    } catch(err) {
        return handleError(res, err, 'alterarConsultas');
    }    
}

export async function excluirConsultas(req, res) {
    const usuario = req.usuario;

    try {
        await InserirHistoricoDelete(usuario, 'CONSULTAS', req.params.id);
        await executeQueryEmpresa(
            'DELETE FROM CONSULTAS WHERE ID = ?',
            [req.params.id],
            usuario        
        );        
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'excluirConsultas');
    }        
}

export async function HistoricoDeleteConsultas(req, res) {
    try {
        const result = await getHistorico('CONSULTAS', null, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoDeleteConsultas');
    }     
}

export async function HistoricoConsultas(req, res) {
    try {
        const result = await getHistorico('CONSULTAS', req.params.id, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoConsultas');
    }     
}

export async function carregarCadastrosRelacao(req, res) {
    const usuario = req.usuario;

    const idCadastro = parseInt(req.query.idCadastro, 10);
    if (!Number.isInteger(idCadastro) || idCadastro <= 0) {
        return res.status(400).json({ erro: 'ID de cadastro inválido' });
    }

    try {
        const result = await executeQueryEmpresa(
            ' SELECT '+
            '    ID, '+
            '    ID_CADASTRO, '+
            '    ID_ESPECIALIDADE_TERAPEUTA '+
            ' FROM CADASTRO_RELACAO '+
            ' WHERE ID_CADASTRO = ? ',
            [idCadastro],
            usuario
        );

        return res.status(200).json(result);

    } catch(err) {
        return handleError(res, err, 'carregarCadastrosRelacao');
    }           
}

export async function HistoricoCadastrosRelacao(req, res) {
    try {
        const result = await getHistorico('CADASTRO_RELACAO', req.params.id, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoCadastrosRelacao');
    }       
}

export async function adicionarCadastrosRelacao(req, res) {
    const usuario = req.usuario;  
    const { idCadastro, idRelacao } = req.body;

    if (!Number.isInteger(idCadastro) || idCadastro <= 0) {
        return res.status(400).json({ erro: 'ID de cadastro inválido' });
    }    

    if (!Number.isInteger(idRelacao) || idRelacao <= 0) {
        return res.status(400).json({ erro: 'ID de relação inválido' });
    }    

    try {        
        const result = await executeQueryEmpresa(
            'INSERT INTO CADASTRO_RELACAO (ID_CADASTRO, ID_ESPECIALIDADE_TERAPEUTA) '+
            ' VALUES (?, ?) ',
            [idCadastro, idRelacao],
            usuario
        );
        await InserirHistoricoInsert(usuario, 'CADASTRO_RELACAO');
        res.status(201).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'adicionarCadastrosRelacao');
    }        
}

export async function excluirCadastrosRelacao(req, res) {
    const usuario = req.usuario;
    const idRelacao = parseInt(req.params.id, 10);
    if (!Number.isInteger(idRelacao) || idRelacao <= 0) {
        return res.status(400).json({ erro: 'ID de relação inválido' });
    }

    if (!Number.isInteger(idRelacao) || idRelacao <= 0) {
        return res.status(400).json({ erro: 'ID de relação inválido' });
    } 

    try {
        await InserirHistoricoDelete(usuario, 'CADASTRO_RELACAO', idRelacao);
        await executeQueryEmpresa(
            'DELETE FROM CADASTRO_RELACAO WHERE ID = ?',
            [idRelacao],
            usuario        
        );        
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'excluirCadastrosRelacao');
    }    
}

export async function adicionarCadastros(req, res) {
    const usuario = req.usuario;  
    const { nome, telefone, dt_nasc, tipo, cpf } = req.body;

    if (!nome || typeof nome !== 'string' || nome.trim().length === 0 || nome.length > 150) {
        return res.status(400).json({ erro: 'Nome inválido' });
    }
    if (cpf && !/^\d{11}$/.test(cpf.replace(/\D/g, ''))) {
        return res.status(400).json({ erro: 'CPF inválido' });
    }
    if (!['Paciente', 'Terapeuta'].includes(tipo)) { 
        return res.status(400).json({ erro: 'Tipo inválido' });
    }  

    try {        
        const result = await executeQueryEmpresa(
            'INSERT INTO CADASTROS (NOME, TELEFONE, DT_NASC, DT_CADASTRO, REGISTRO_PROFISSIONAL, TIPO, CPF, DIAGNOSTICO, UPDATED_AT) '+
            ' VALUES (?, ?, ?, CURRENT_DATE, ?, ?, ?, ?, 1) ',
            [nome, telefone, dt_nasc, req.body.registro_profissional, tipo, encrypt(cpf ?? ''), encrypt(req.body.diagnostico ?? '')],
            usuario
        );
        await InserirHistoricoInsert(usuario, 'CADASTROS');
        res.status(201).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'adicionarCadastros');
    }  
}

export async function HistoricoDeleteCadastros(req, res) {
    try {
        const result = await getHistorico('CADASTROS', null, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoDeleteCadastros');
    }     
}

export async function HistoricoCadastros(req, res) {
    try {
        const result = await getHistorico('CADASTROS', req.params.id, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoCadastros');
    }     
}

export async function excluirCadastros(req, res) {
    const usuario = req.usuario;

    try {
        await InserirHistoricoDelete(usuario, 'CADASTROS', req.params.id);
        await executeQueryEmpresa(
            'DELETE FROM CADASTROS WHERE ID = ?',
            [req.params.id],
            usuario        
        );        
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'excluirCadastros');
    }
}

export async function alterarCadastros(req, res) {
    const usuario = req.usuario;

    try {
         const { updatedAt, campos } = req.body;

        if (!updatedAt) {
            return res.status(400).json({ erro: 'updatedAt é obrigatório' });
        }

        await InserirHistorico(usuario, 'CADASTROS', req.params.id, campos);
  
        const setClauses = [];
        const valores = [];

        const CAMPOS_PERMITIDOS = new Set([
            'NOME', 'TELEFONE', 'DT_NASC', 'REGISTRO_PROFISSIONAL', 'TIPO', 'CPF', 'DIAGNOSTICO'
        ]);

        for (const [campo, valor] of Object.entries(campos)) {
            if (campo.toUpperCase() === 'UPDATED_AT') {
                continue;
            }            
            if (!CAMPOS_PERMITIDOS.has(campo.toUpperCase())) {
                return res.status(400).json({ erro: `Campo inválido: ${campo}` });
            }
            setClauses.push(`${campo} = ?`);
            valores.push(valor);
        }

        if (setClauses.length === 0) {
            return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
        }

        valores.push(req.params.id);
        valores.push(req.body.updatedAt);

        const result = await executeQueryEmpresa(
            `UPDATE CADASTROS SET UPDATED_AT = UPDATED_AT + 1, ${setClauses.join(', ')} WHERE ID = ? AND UPDATED_AT = ? RETURNING ID `,
            valores,
            usuario
        );
        
        if (result.length === 0) {
            res.status(409).json({ erro: 'Registro desatualizado, tente novamente' });
        }
        else {
            res.status(200).json({ sucesso: true });
        }

    } catch(err) {
        return handleError(res, err, 'alterarCadastros');
    }
}

export async function carregarCadastroPorId(req, res) {
    const usuario = req.usuario;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'ID inválido' });
    try {
        const result = await executeQueryEmpresa(
            'SELECT ID, NOME, TELEFONE, DT_NASC, DT_CADASTRO, REGISTRO_PROFISSIONAL, TIPO, CPF, DIAGNOSTICO, UPDATED_AT ' +
            'FROM CADASTROS WHERE ID = ?',
            [id], usuario
        );
        if (!result.length) return res.status(404).json({ erro: 'Cadastro não encontrado' });

        // em carregarCadastros, dentro do .map():
        const descriptografado = result.map(r => ({
            ...r,
            cpf:         isEncrypted(r.cpf)         ? decrypt(r.cpf)         : r.cpf,
            diagnostico: isEncrypted(r.diagnostico) ? decrypt(r.diagnostico) : r.diagnostico,
            // Normaliza Date para string ISO date apenas
            dt_nasc:     r.dt_nasc instanceof Date  ? r.dt_nasc.toISOString().slice(0, 10) : r.dt_nasc,
            dt_cadastro: r.dt_cadastro instanceof Date ? r.dt_cadastro.toISOString().slice(0, 10) : r.dt_cadastro,
        }));
        return res.status(200).json(descriptografado);
    } catch(err) {
        return handleError(res, err, 'carregarCadastroPorId');
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
            '    CADASTROS.DIAGNOSTICO, '+
            '    CADASTROS.UPDATED_AT '+
            ' FROM CADASTROS '+
            ' ORDER BY CADASTROS.NOME ',
            [por_pagina, offset],
            usuario
        );
       // em carregarCadastros, dentro do .map():
        const descriptografado = result.map(r => ({
            ...r,
            cpf:         isEncrypted(r.cpf)         ? decrypt(r.cpf)         : r.cpf,
            diagnostico: isEncrypted(r.diagnostico) ? decrypt(r.diagnostico) : r.diagnostico,
            // Normaliza Date para string ISO date apenas
            dt_nasc:     r.dt_nasc instanceof Date  ? r.dt_nasc.toISOString().slice(0, 10) : r.dt_nasc,
            dt_cadastro: r.dt_cadastro instanceof Date ? r.dt_cadastro.toISOString().slice(0, 10) : r.dt_cadastro,
        }));
        return res.status(200).json(descriptografado);

    } catch(err) {
        return handleError(res, err, 'carregarCadastros');
    }    
}

export async function carregarEspecialidades(req, res) {
    const usuario = req.usuario;
    
    try {
        const result = await executeQueryEmpresa(
            'SELECT ID, DESCRICAO, INATIVO, ID_COR, UPDATED_AT FROM ESPECIALIDADES ',
            [],
            usuario
        );

        return res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'carregarEspecialidades')
    }
}

export async function adicionarEspecialidades(req, res) {
    const usuario = req.usuario;    

    try {
        const result = await executeQueryEmpresa(
            'INSERT INTO ESPECIALIDADES (DESCRICAO, INATIVO, ID_COR, UPDATED_AT) '+
            ' VALUES (?, ?, ?, 1) ',
            [req.body.descricao, req.body.inativo, req.body.id_cor],
            usuario
        );
        await InserirHistoricoInsert(usuario, 'ESPECIALIDADES');
        res.status(201).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'adicionarEspecialidades');
    }          
}

export async function HistoricoDeleteEspecialidades(req, res) {
    try {
        const result = await getHistorico('ESPECIALIDADES', null, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoDeleteEspecialidades');
    }     
}

export async function HistoricoEspecialidades(req, res) {
    try {
        const result = await getHistorico('ESPECIALIDADES', req.params.id, req.usuario);
        res.status(200).json(result);    
    } catch(err) {
        return handleError(res, err, 'HistoricoEspecialidades');
    }     
}

export async function alterarEspecialidades(req, res) {
    const usuario = req.usuario;

    try {
        const { updatedAt, campos } = req.body;  // ← desestrutura igual ao alterarCadastros

        if (!updatedAt) {
            return res.status(400).json({ erro: 'updatedAt é obrigatório' });
        }

        await InserirHistorico(usuario, 'ESPECIALIDADES', req.params.id, campos);

        const setClauses = [];
        const valores    = [];
        const CAMPOS_PERMITIDOS = new Set(['DESCRICAO', 'INATIVO', 'ID_COR']);

        for (const [campo, valor] of Object.entries(campos)) {
            if (campo.toUpperCase() === 'UPDATED_AT') continue;
            if (!CAMPOS_PERMITIDOS.has(campo.toUpperCase())) {
                return res.status(400).json({ erro: `Campo inválido: ${campo}` });
            }
            setClauses.push(`${campo} = ?`);
            valores.push(valor);
        }

        if (setClauses.length === 0) {
            return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
        }

        valores.push(req.params.id);
        valores.push(updatedAt);

        const result = await executeQueryEmpresa(
            `UPDATE ESPECIALIDADES SET UPDATED_AT = UPDATED_AT + 1, ${setClauses.join(', ')} WHERE ID = ? AND UPDATED_AT = ? RETURNING ID`,
            valores,
            usuario
        );

        if (result.length === 0) {
            res.status(409).json({ erro: 'Registro desatualizado, tente novamente' });
        } else {
            res.status(200).json({ sucesso: true });
        }

    } catch(err) {
        return handleError(res, err, 'alterarEspecialidades');
    }
}

export async function excluirEspecialidades(req, res) {
    const usuario = req.usuario;

    try {
        await InserirHistoricoDelete(usuario, 'ESPECIALIDADES', req.params.id);
        await executeQueryEmpresa(
            'DELETE FROM ESPECIALIDADES WHERE ID = ?',
            [req.params.id],
            usuario        
        );        
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'excluirEspecialidades');
    }    
}

export async function getHistorico(tabela, id_registro, id_usuario) {
    let result;
    if (!id_registro) {
        result = await executeQueryEmpresa(
            "SELECT VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, NOME_USUARIO FROM HISTORICO " +
            "WHERE TABELA = ? AND TIPO = 'DELETE' ORDER BY DTHR DESC",
            [tabela], id_usuario
        );
    } else if (tabela === 'PERMISSOES_USUARIOS' || tabela === 'CADASTRO_RELACAO') {
        result = await executeQueryEmpresa(
            "SELECT VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, NOME_USUARIO, TIPO FROM HISTORICO " +
            "WHERE TABELA = ? AND ID_REGISTRO = ? ORDER BY DTHR DESC",
            [tabela, id_registro], id_usuario
        );
    } else {
        result = await executeQueryEmpresa(
            "SELECT VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, NOME_USUARIO FROM HISTORICO " +
            "WHERE TABELA = ? AND ID_REGISTRO = ? AND TIPO = 'UPDATE' ORDER BY DTHR DESC",
            [tabela, id_registro], id_usuario
        );
    }

    const resolved = await Promise.all(result.map(row => resolverBlobsHistorico(row)));

    const camposCripto = CAMPOS_CRIPTOGRAFADOS[tabela] ?? new Set();
    if (camposCripto.size === 0) return resolved;

    return resolved.map(row => {
        if (!camposCripto.has((row.campo||'').toUpperCase())) return row;
        return {
            ...row,
            valor_novo:   descriptografarSafe(row.valor_novo),
            valor_antigo: descriptografarSafe(row.valor_antigo),
        };
    });
}

// Resolve campos BLOB que o node-firebird retorna como função
async function resolverBlobsHistorico(row) {
    const resolved = { ...row };
    for (const key of ['valor_novo', 'valor_antigo']) {
        if (typeof resolved[key] === 'function') {
            resolved[key] = await new Promise((resolve, reject) => {
                resolved[key]((err, _name, e) => {
                    if (err) { resolve(null); return; }
                    const chunks = [];
                    e.on('data', d => chunks.push(d));
                    e.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
                    e.on('error', () => resolve(null));
                });
            });
        }
    }
    return resolved;
}

function descriptografarSafe(valor) {
    if (!valor) return valor;
    try { return decrypt(valor); } catch { return null; }
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