import {executeQueryDBPrincipal, executeQueryEmpresa, BuscarRegistroAtual, InserirHistorico, InserirHistoricoRegistro, InserirHistoricoInsert, InserirHistoricoDelete} from "./conexaoBD.js";
import { gerarToken, limparCacheUsuario, carregarPermissoes as permissoesDoUsuario, carregarTerapeuta, escopoTerapeuta } from "./auth.js"
import { sincronizarAgendamento, removerEventoAgendamento, googleConectado } from "./agenda.js";
import { metaNoEscopo, esperaNoEscopo, validarAvaliacoes, salvarAvaliacoes, cobrarSessao, metasDaSessao, metasDoPeriodo, exclusivoFinanceiro, conferirSaidaSessao, saldoPaciente } from "./clinica.js";
import {decrypt, encrypt, isEncrypted} from "./cripto.js";
import { validarDados, senhaInvalida, paraId, lerCripto, CAMPOS_CRIPTOGRAFADOS, TABELAS_EXCLUSAO_LOGICA } from "./regras.js";
import bcrypt from "bcrypt";
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const SALT_ROUNDS = 12;
const HASH_FAKE = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), SALT_ROUNDS);

const PERM_TOTAL    = 1;
const PERM_USUARIOS = 2;

// Logo de cada empresa: arquivo indicado em EMPRESAS.CAMINHO_LOGOS (definido pelo programa de empresas)
const EXTENSOES_LOGO = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_SESSOES_RELATORIO = 200;

export function handleError(res, err, context = '') {
    console.error(`[${context}]`, err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
}

// Firebird 5 devolve UPDATE ... RETURNING como array; versões antigas como objeto
export const foiAtualizado = result => Array.isArray(result) ? result.length > 0 : !!result;

// Texto criptografado passa como OCTETS: o parâmetro comum é limitado a 8191 caracteres (UTF8)
export const PARAM_CRIPTO = 'CAST(? AS VARCHAR(32765) CHARACTER SET OCTETS)';

// Colunas, marcadores e parâmetros para gravar; as colunas vêm das regras (nunca do usuário)
function paraGravar(tabela, valores) {
    const cripto = CAMPOS_CRIPTOGRAFADOS[tabela] ?? new Set();
    const colunas = Object.keys(valores);
    const marcadores = colunas.map(c => cripto.has(c) ? PARAM_CRIPTO : '?');
    const params = colunas.map(c => cripto.has(c) && valores[c] != null ? encrypt(String(valores[c])) : valores[c]);
    return { colunas, marcadores, params };
}

export function descriptografarCampos(tabela, row) {
    const resultado = { ...row };
    for (const campo of CAMPOS_CRIPTOGRAFADOS[tabela] ?? []) {
        const chave = campo.toLowerCase();
        if (isEncrypted(resultado[chave])) resultado[chave] = decrypt(resultado[chave]);
    }
    return resultado;
}

/* =================== Escopo do profissional =================== */
// Usuário vinculado a um profissional (sem acesso total) só enxerga o que é dele.
// O vínculo vem do banco a cada requisição (req.terapeuta), nunca do front.

// Paciente do profissional: tem vínculo, agendamento ou sessão com ele
const sqlPacienteDoTerapeuta = a =>
    `(EXISTS (SELECT 1 FROM CADASTRO_RELACAO RE WHERE RE.ID_CADASTRO = ${a}.ID AND RE.ID_ESPECIALIDADE_TERAPEUTA = ?)` +
    ` OR EXISTS (SELECT 1 FROM AGENDAMENTOS AE WHERE AE.ID_PACIENTE = ${a}.ID AND AE.ID_TERAPEUTA = ?)` +
    ` OR EXISTS (SELECT 1 FROM CONSULTAS CE WHERE CE.ID_PACIENTE = ${a}.ID AND CE.ID_TERAPEUTA = ?))`;

// Cadastros visíveis: o próprio profissional e os pacientes dele
function filtroCadastros(alias, t) {
    return { sql: `(${alias}.ID = ? OR (${alias}.TIPO = 'Paciente' AND ${sqlPacienteDoTerapeuta(alias)}))`, params: [t, t, t, t] };
}

export async function cadastroNoEscopo(req, id) {
    if (!req.terapeuta) return true;
    const f = filtroCadastros('C', req.terapeuta);
    const r = await executeQueryEmpresa(`SELECT 1 FROM CADASTROS C WHERE C.ID = ? AND ${f.sql}`, [id, ...f.params], req.usuario);
    return r.length > 0;
}

export async function especialidadeNoEscopo(req, id) {
    if (!req.terapeuta) return true;
    const r = await executeQueryEmpresa(
        'SELECT 1 FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ? AND ID_ESPECIALIDADE_TERAPEUTA = ?',
        [req.terapeuta, id], req.usuario);
    return r.length > 0;
}

// O registro existente pode ser visto ou alterado por este usuário?
async function registroNoEscopo(req, tabela, registro) {
    const t = req.terapeuta;
    if (!t) return true;
    if (tabela === 'CONSULTAS' || tabela === 'AGENDAMENTOS') return registro.id_terapeuta === t;
    if (tabela === 'CADASTROS') return cadastroNoEscopo(req, registro.id);
    if (tabela === 'ESPECIALIDADES') return especialidadeNoEscopo(req, registro.id);
    if (tabela === 'METAS') return metaNoEscopo(req, registro);
    if (tabela === 'LISTA_ESPERA') return esperaNoEscopo(req, registro);
    // PACOTES e PAGAMENTOS: o financeiro dos pacientes não é visível ao profissional vinculado
    return false;
}

// Profissional vinculado não altera nem exclui o que também é de outros profissionais:
// especialidade usada por outro profissional e paciente atendido/vinculado a outro profissional.
// (Ver e editar os dados do paciente continua permitido: o prontuário é compartilhado.)
async function compartilhadoComOutros(req, tabela, registro, operacao) {
    const t = req.terapeuta;
    if (!t) return false;
    if (tabela === 'ESPECIALIDADES') {
        const [r] = await executeQueryEmpresa(
            `SELECT
                (SELECT COUNT(*) FROM CADASTRO_RELACAO R JOIN CADASTROS C ON C.ID = R.ID_CADASTRO
                  WHERE C.TIPO = 'Terapeuta' AND R.ID_ESPECIALIDADE_TERAPEUTA = ? AND R.ID_CADASTRO <> ?) +
                (SELECT COUNT(*) FROM AGENDAMENTOS WHERE ID_ESPECIALIDADE = ? AND ID_TERAPEUTA <> ?) +
                (SELECT COUNT(*) FROM CONSULTAS WHERE ID_ESPECIALIDADE = ? AND ID_TERAPEUTA <> ?) N
             FROM RDB$DATABASE`,
            [registro.id, t, registro.id, t, registro.id, t], req.usuario);
        return r.n > 0;
    }
    if (tabela === 'CADASTROS' && operacao === 'excluir' && registro.id !== t) {
        const [r] = await executeQueryEmpresa(
            `SELECT
                (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ? AND ID_ESPECIALIDADE_TERAPEUTA <> ?) +
                (SELECT COUNT(*) FROM AGENDAMENTOS WHERE ID_PACIENTE = ? AND ID_TERAPEUTA <> ?) +
                (SELECT COUNT(*) FROM CONSULTAS WHERE ID_PACIENTE = ? AND ID_TERAPEUTA <> ?) N
             FROM RDB$DATABASE`,
            [registro.id, t, registro.id, t, registro.id, t], req.usuario);
        return r.n > 0;
    }
    return false;
}
const compartilhado = res => res.status(403).json({
    erro: 'Este registro também é usado por outros profissionais. Peça à administração da clínica para fazer essa mudança.',
});

// Histórico de um registro: mesma regra, buscando o dono pelo ID
async function historicoNoEscopo(req, tabela, id) {
    if (!req.terapeuta) return true;
    if (tabela === 'CADASTROS' || tabela === 'CADASTRO_RELACAO') return cadastroNoEscopo(req, id);
    if (tabela === 'ESPECIALIDADES') return especialidadeNoEscopo(req, id);
    if (tabela === 'METAS' || tabela === 'LISTA_ESPERA') {
        const [r] = await executeQueryEmpresa(`SELECT ID, ID_PACIENTE, ID_ESPECIALIDADE, ID_TERAPEUTA FROM ${tabela} WHERE ID = ?`, [id], req.usuario);
        return !!r && registroNoEscopo(req, tabela, r);
    }
    if (tabela !== 'CONSULTAS' && tabela !== 'AGENDAMENTOS') return false;
    const [r] = await executeQueryEmpresa(`SELECT ID_TERAPEUTA FROM ${tabela} WHERE ID = ?`, [id], req.usuario);
    return r?.id_terapeuta === req.terapeuta;
}

// Os dados enviados respeitam o escopo? Devolve a mensagem de erro ou null
async function dadosNoEscopo(req, tabela, valores, atual) {
    const t = req.terapeuta;
    if (!t) return null;
    if (tabela === 'CONSULTAS' || tabela === 'AGENDAMENTOS') {
        if (Object.hasOwn(valores, 'ID_TERAPEUTA') && valores.ID_TERAPEUTA !== t) return 'Você só pode registrar atendimentos seus';
        if (Object.hasOwn(valores, 'ID_PACIENTE') && valores.ID_PACIENTE !== atual?.id_paciente
            && !await cadastroNoEscopo(req, valores.ID_PACIENTE)) {
            return 'Este paciente não está entre os seus. Peça à recepção para vinculá-lo a você.';
        }
    }
    if (tabela === 'PACOTES' || tabela === 'PAGAMENTOS') return 'O financeiro é restrito à administração da clínica';
    if (tabela === 'METAS' && !atual) {
        if (!await cadastroNoEscopo(req, valores.ID_PACIENTE)) return 'Este paciente não está entre os seus';
        if (!await especialidadeNoEscopo(req, valores.ID_ESPECIALIDADE)) return 'Você só pode criar metas nas especialidades que atende';
    }
    if (tabela === 'LISTA_ESPERA') {
        if (!await cadastroNoEscopo(req, valores.ID_PACIENTE)) return 'Este paciente não está entre os seus';
        if (valores.ID_TERAPEUTA && valores.ID_TERAPEUTA !== t) return 'Você só pode direcionar a espera para você mesmo';
    }
    if (tabela === 'CADASTROS') {
        if (!atual && valores.TIPO !== 'Paciente') return 'Você pode cadastrar apenas pacientes';
        if (atual && Object.hasOwn(valores, 'TIPO') && valores.TIPO !== atual.tipo) return 'Você não pode trocar o tipo deste cadastro';
    }
    return null;
}

// Paciente ou especialidade criados por um profissional já nascem vinculados a ele
async function vincularAoTerapeuta(req, tabela, id) {
    const t = req.terapeuta;
    if (!t || !id) return;
    const par = tabela === 'CADASTROS' ? [id, t] : tabela === 'ESPECIALIDADES' ? [t, id] : null;
    if (!par) return;
    await executeQueryEmpresa('INSERT INTO CADASTRO_RELACAO (ID_CADASTRO, ID_ESPECIALIDADE_TERAPEUTA) VALUES (?, ?)', par, req.usuario);
    await InserirHistoricoRegistro(req.usuario, 'CADASTRO_RELACAO', 'INSERT', par[0], {
        campo: tabela === 'CADASTROS' ? 'ID_TERAPEUTA' : 'ID_ESPECIALIDADE', novo: par[1],
    });
}

export const naoEncontrado = res => res.status(404).json({ erro: 'Registro não encontrado' });

/* =================== Listas: página e busca =================== */
// Toda lista vem em páginas (limite fixo protege o servidor); o total vai no cabeçalho X-Total-Count

export function paginacao(req, { padrao = 50, max = 100 } = {}) {
    const pagina = Math.min(100000, Math.max(1, parseInt(req.query.pagina) || 1));
    const porPagina = Math.min(max, Math.max(1, parseInt(req.query.por_pagina) || padrao));
    return { porPagina, offset: (pagina - 1) * porPagina };
}

// Busca por texto: CONTAINING ignora maiúsculas/minúsculas e não trata % e _ como curingas
export function filtroBusca(termo, colunas) {
    const t = typeof termo === 'string' ? termo.trim().slice(0, 100) : '';
    if (!t) return { sql: '', params: [] };
    return { sql: ` AND (${colunas.map(c => `${c} CONTAINING ?`).join(' OR ')})`, params: colunas.map(() => t) };
}

export function enviarPagina(res, linhas, total) {
    res.set('X-Total-Count', String(total));
    return res.status(200).json(linhas);
}

/* =================== CRUD genérico =================== */

// INSERT com validação, regras de negócio, criptografia e histórico.
// extras: [coluna, expressão SQL fixa] ou [coluna, '?', valor]; aposSalvar devolve dados extras da resposta
// Preço da especialidade e repasse do profissional são dados do financeiro: só quem administra
// o financeiro vê ou altera (nunca o profissional vinculado, nem para si mesmo)
const CAMPOS_FINANCEIROS = { CADASTROS: ['REPASSE_PERCENTUAL'], ESPECIALIDADES: ['VALOR_CENTAVOS'] };
const temAlguma = (req, ...ids) => ids.some(id => (req.permissoes ?? []).includes(id));
export const verFinanceiro = req => !req.terapeuta && temAlguma(req, 1, 60, 61);
const alterarFinanceiro = req => !req.terapeuta && temAlguma(req, 1, 60, 63);

function erroCamposFinanceiros(req, tabela, valores, atual) {
    if (alterarFinanceiro(req)) return null;
    const mudou = c => Object.hasOwn(valores, c) && (atual ? valores[c] !== atual[c.toLowerCase()] : valores[c] != null);
    return (CAMPOS_FINANCEIROS[tabela] ?? []).some(mudou) ? 'Sem permissão para alterar valores do financeiro' : null;
}
// Remove os campos financeiros de registros (ou do histórico) para quem não vê o financeiro
function semCamposFinanceiros(req, tabela, linhas) {
    const campos = CAMPOS_FINANCEIROS[tabela];
    if (!campos || verFinanceiro(req)) return linhas;
    const chaves = campos.map(c => c.toLowerCase());
    return linhas
        .filter(l => !campos.includes(String(l.campo ?? '').toUpperCase()))
        .map(l => { const r = { ...l }; for (const k of chaves) delete r[k]; return r; });
}

export async function inserirRegistro(req, res, tabela, contexto, { regrasNegocio, extras = [], aposSalvar } = {}) {
    const usuario = req.usuario;

    const { valores, erro } = validarDados(tabela, req.body);
    if (erro) return res.status(400).json({ erro });
    const erroFinanceiro = erroCamposFinanceiros(req, tabela, valores, null);
    if (erroFinanceiro) return res.status(403).json({ erro: erroFinanceiro });

    try {
        const erroEscopo = await dadosNoEscopo(req, tabela, valores, null);
        if (erroEscopo) return res.status(403).json({ erro: erroEscopo });

        if (regrasNegocio) {
            const erroRegra = await regrasNegocio(usuario, valores, null);
            if (erroRegra) return res.status(400).json({ erro: erroRegra });
        }

        const { colunas, marcadores, params } = paraGravar(tabela, valores);
        const todas = [...colunas, ...extras.map(([c]) => c)];
        const valoresSql = [...marcadores, ...extras.map(([, sql]) => sql)];
        const todosParams = [...params, ...extras.filter(([, sql]) => sql === '?').map(([, , valor]) => valor)];

        const result = await executeQueryEmpresa(
            `INSERT INTO ${tabela} (${todas.join(', ')}) VALUES (${valoresSql.join(', ')}) RETURNING ID`,
            todosParams,
            usuario
        );
        await InserirHistoricoInsert(usuario, tabela, result?.id);
        await vincularAoTerapeuta(req, tabela, result?.id);
        const extra = aposSalvar ? await aposSalvar(usuario, result?.id) : {};
        res.status(201).json({ sucesso: true, id: result?.id, ...extra });
    } catch(err) {
        return handleError(res, err, contexto);
    }
}

// UPDATE com validação, controle de concorrência (UPDATED_AT) e histórico
export async function atualizarRegistro(req, res, tabela, contexto, regrasNegocio, { aposSalvar } = {}) {
    const usuario = req.usuario;

    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });

    const { updatedAt, campos } = req.body ?? {};
    if (!Number.isInteger(updatedAt)) {
        return res.status(400).json({ erro: 'updatedAt é obrigatório' });
    }

    const { valores, erro } = validarDados(tabela, campos, { parcial: true });
    if (erro) return res.status(400).json({ erro });
    if (Object.keys(valores).length === 0) {
        return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
    }

    try {
        const atual = await BuscarRegistroAtual(usuario, tabela, id);
        if (!atual || !await registroNoEscopo(req, tabela, atual)) return naoEncontrado(res);
        if (await compartilhadoComOutros(req, tabela, atual, 'alterar')) return compartilhado(res);
        const erroFinanceiro = erroCamposFinanceiros(req, tabela, valores, atual);
        if (erroFinanceiro) return res.status(403).json({ erro: erroFinanceiro });

        const erroEscopo = await dadosNoEscopo(req, tabela, valores, atual);
        if (erroEscopo) return res.status(403).json({ erro: erroEscopo });

        if (regrasNegocio) {
            const erroRegra = await regrasNegocio(usuario, valores, atual);
            if (erroRegra) return res.status(400).json({ erro: erroRegra });
        }

        const { colunas, marcadores, params } = paraGravar(tabela, valores);
        const filtroExcluido = TABELAS_EXCLUSAO_LOGICA.has(tabela) ? ' AND EXCLUIDO_EM IS NULL' : '';
        const result = await executeQueryEmpresa(
            `UPDATE ${tabela} SET UPDATED_AT = UPDATED_AT + 1, ${colunas.map((c, i) => `${c} = ${marcadores[i]}`).join(', ')} ` +
            `WHERE ID = ? AND UPDATED_AT = ?${filtroExcluido} RETURNING ID`,
            [...params, id, updatedAt],
            usuario
        );

        if (!foiAtualizado(result)) {
            return res.status(409).json({ erro: 'Registro desatualizado. Tente novamente.' });
        }

        await InserirHistorico(usuario, tabela, id, valores, atual);
        const extra = aposSalvar ? await aposSalvar(usuario, id) : {};
        res.status(200).json({ sucesso: true, ...extra });
    } catch(err) {
        return handleError(res, err, contexto);
    }
}

// Exclusão lógica (prontuário) ou física, com histórico
export async function excluirRegistro(req, res, tabela, contexto, { podeExcluir, aposExcluir } = {}) {
    const usuario = req.usuario;

    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });

    try {
        const atual = await BuscarRegistroAtual(usuario, tabela, id);
        if (!atual || !await registroNoEscopo(req, tabela, atual)) return naoEncontrado(res);
        if (await compartilhadoComOutros(req, tabela, atual, 'excluir')) return compartilhado(res);
        if (req.terapeuta && tabela === 'CADASTROS' && atual.id === req.terapeuta) {
            return res.status(403).json({ erro: 'Você não pode excluir o seu próprio cadastro' });
        }

        if (podeExcluir) {
            const erroRegra = await podeExcluir(usuario, atual);
            if (erroRegra) return res.status(409).json({ erro: erroRegra });
        }

        if (TABELAS_EXCLUSAO_LOGICA.has(tabela)) {
            await executeQueryEmpresa(
                `UPDATE ${tabela} SET EXCLUIDO_EM = CURRENT_TIMESTAMP, EXCLUIDO_POR = ? WHERE ID = ? AND EXCLUIDO_EM IS NULL`,
                [usuario, id],
                usuario
            );
        } else {
            await executeQueryEmpresa(`DELETE FROM ${tabela} WHERE ID = ?`, [id], usuario);
        }

        if (aposExcluir) await aposExcluir(usuario, atual);
        await InserirHistoricoDelete(usuario, tabela, id, atual);
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, contexto);
    }
}

// Detalhe de um registro com dados sensíveis; a leitura fica registrada (LGPD)
async function lerRegistroSensivel(req, res, tabela, sql, contexto) {
    const usuario = req.usuario;
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });

    try {
        const [registro] = await executeQueryEmpresa(sql, [id], usuario);
        if (!registro || !await registroNoEscopo(req, tabela, registro)) return naoEncontrado(res);

        await InserirHistoricoRegistro(usuario, tabela, 'LEITURA', id);
        const dados = descriptografarCampos(tabela, registro);
        // O profissional vê o próprio repasse
        if (tabela === 'CADASTROS' && registro.id === req.terapeuta) return res.status(200).json(dados);
        return res.status(200).json(semCamposFinanceiros(req, tabela, [dados])[0]);
    } catch(err) {
        return handleError(res, err, contexto);
    }
}

/* =================== Login / sessão =================== */

export async function validarLogin(req, res){
    const { usuario, senha } = req.body ?? {};

    if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario || !senha) {
        return res.status(400).json({ erro: 'Usuário e senha são obrigatórios' });
    }

    if (senha.length > 60) {
        return res.status(400).json({ erro: 'Entrada inválida' });
    }

    if (usuario.length < 3 || usuario.length > 100){
        return res.status(400).json({ erro: 'Usuário inválido' });
    }

    try {
        const result = await executeQueryDBPrincipal('SELECT ID, SENHA, NOME, COALESCE(TOKEN_VERSION, 0) TOKEN_VERSION, TROCAR_SENHA, INATIVO FROM USUARIOS WHERE UPPER(LOGIN) = UPPER(?)', [usuario]);

        const hashReal = result.length > 0 ? result[0].senha : HASH_FAKE;

        const senhaCorreta = await bcrypt.compare(senha, hashReal);

        if (!senhaCorreta || result.length === 0) {
            return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
        }

        // Só depois da senha correta, para não revelar quais logins existem
        if (result[0].inativo === 1) {
            return res.status(403).json({ erro: 'Este usuário está inativo. Fale com o administrador da clínica.' });
        }

        const permissoes = await permissoesDoUsuario(result[0].id);

        if (permissoes.length === 0) {
            return res.status(403).json({ erro: 'Usuário não tem permissões configuradas' });
        }

        const token = gerarToken(result[0].id, result[0].token_version);
        // Profissional vinculado: o front mostra só os atendimentos dele (o back já filtra tudo)
        const terapeuta = await carregarTerapeuta(result[0].id);
        const profissional = escopoTerapeuta(permissoes, terapeuta) ? terapeuta : null;
        // trocarSenha: senha redefinida pelo administrador; o back-end só libera a troca de senha
        return res.json({ token, id: result[0].id, nome: result[0].nome, permissoes, profissional, trocarSenha: result[0].trocar_senha === 1 });

    } catch(err) {
        return handleError(res, err, 'validarLogin');
    }
}

// Encerra todas as sessões do usuário (o token deixa de valer no back-end)
export async function logout(req, res) {
    try {
        await executeQueryDBPrincipal(
            'UPDATE USUARIOS SET TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1 WHERE ID = ?',
            [req.usuario]
        );
        limparCacheUsuario(req.usuario);
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'logout');
    }
}

/* =================== Usuários e permissões =================== */

// Hierarquia: ninguém altera as próprias permissões; só quem tem acesso total
// mexe em administradores e concede/remove as permissões 1 e 2.
// O usuário master da empresa (VINDIX-<EMPRESA>) não existe para o sistema: ninguém o vê nem altera,
// nem ele próprio (a única coisa que ele muda é a própria senha, em "Minha senha")
async function verificarGestaoUsuario(req, alvo, { permissao = null, permitirProprio = false } = {}) {
    const mesmaEmpresa = await executeQueryDBPrincipal(
        'SELECT 1 FROM USUARIOS WHERE ID=? AND MASTER = 0 AND EMPRESA=(SELECT EMPRESA FROM USUARIOS WHERE ID=?)',
        [alvo, req.usuario]
    );
    if (mesmaEmpresa.length === 0) return { status: 404, erro: 'Usuário não encontrado' };

    if (alvo === req.usuario && !permitirProprio) {
        return { status: 403, erro: 'Você não pode alterar as próprias permissões' };
    }

    if (!req.permissoes.includes(PERM_TOTAL)) {
        if (permissao === PERM_TOTAL || permissao === PERM_USUARIOS) {
            return { status: 403, erro: 'Somente administradores podem conceder ou remover esta permissão' };
        }
        const permissoesAlvo = await permissoesDoUsuario(alvo);
        if (permissoesAlvo.includes(PERM_TOTAL)) {
            return { status: 403, erro: 'Somente administradores podem alterar um administrador' };
        }
    }
    return null;
}

export async function carregarUsuarios(req, res) {
    const usuario = req.usuario;

    try {
        const [result, vinculos] = await Promise.all([
            executeQueryDBPrincipal(
                'SELECT ID, LOGIN, NOME, UPDATED_AT, INATIVO, CAST(CASE WHEN FOTO IS NULL THEN 0 ELSE FOTO_VERSAO END AS INTEGER) FOTO_VERSAO FROM USUARIOS WHERE MASTER = 0 AND EMPRESA = (SELECT EMPRESA FROM USUARIOS U WHERE U.ID = ?) ORDER BY NOME',
                [usuario]
            ),
            executeQueryEmpresa(
                'SELECT ID, NOME, ID_USUARIO FROM CADASTROS WHERE ID_USUARIO IS NOT NULL AND EXCLUIDO_EM IS NULL',
                [], usuario
            ),
        ]);
        const porUsuario = new Map(vinculos.map(v => [v.id_usuario, v]));

        return res.status(200).json(result.map(u => ({
            ...u,
            inativo:           u.inativo === 1,
            profissional_id:   porUsuario.get(u.id)?.id ?? null,
            profissional_nome: porUsuario.get(u.id)?.nome ?? null,
        })));

    } catch(err) {
        return handleError(res, err, 'carregarUsuarios');
    }
}

// Lista de permissões enviada pelo front: IDs existentes e sem repetição
async function validarListaPermissoes(lista) {
    if (!Array.isArray(lista) || lista.length > 100) return { erro: 'Lista de permissões inválida' };
    const ids = [...new Set(lista.map(paraId))];
    if (ids.some(id => !id)) return { erro: 'Lista de permissões inválida' };
    if (ids.length) {
        const existentes = await executeQueryDBPrincipal(
            `SELECT ID FROM PERMISSOES WHERE ID IN (${ids.map(() => '?').join(', ')})`, ids);
        if (existentes.length !== ids.length) return { erro: 'Permissão inexistente' };
    }
    return { ids };
}

// Só quem tem acesso total concede ou remove as permissões 1 e 2
const mexeEmPermissaoRestrita = (req, ids) =>
    !req.permissoes.includes(PERM_TOTAL) && ids.some(p => p === PERM_TOTAL || p === PERM_USUARIOS);

// Profissional que pode ser ligado ao usuário (alvo null = usuário novo). Devolve { status, erro } ou null
async function validarProfissionalDoUsuario(req, idCadastro, alvo) {
    const [c] = await executeQueryEmpresa(
        'SELECT TIPO, ID_USUARIO FROM CADASTROS WHERE ID = ? AND EXCLUIDO_EM IS NULL', [idCadastro], req.usuario);
    if (!c || c.tipo !== 'Terapeuta') return { status: 400, erro: 'Selecione um profissional cadastrado' };
    if (c.id_usuario && c.id_usuario !== alvo) {
        return { status: 409, erro: 'Este profissional já está vinculado a outro usuário' };
    }
    return null;
}

// Novo usuário recebe uma senha temporária (mostrada uma única vez) e cria a própria no primeiro acesso.
// Permissões e profissional chegam junto (o front guarda até gravar) e são validados antes de criar.
export async function cadastrarUsuario(req, res) {
    const usuario = req.usuario;
    const { login, nome, permissoes = [], idCadastro: enviado = null } = req.body ?? {};

    if (typeof login !== 'string' || typeof nome !== 'string') {
        return res.status(400).json({ erro: 'Login e nome são obrigatórios' });
    }

    if (nome.trim().length === 0 || nome.length > 100) {
        return res.status(400).json({ erro: 'Informe um nome válido' });
    }

    if (!/^[a-zA-Z0-9._@-]{3,64}$/.test(login)) {
        return res.status(400).json({ erro: 'Login inválido' });
    }

    if (/^vindix/i.test(login)) {
        return res.status(400).json({ erro: 'Logins que começam com "VINDIX" são reservados. Escolha outro.' });
    }

    const idCadastro = enviado === null ? null : paraId(enviado);
    if (enviado !== null && !idCadastro) return res.status(400).json({ erro: 'Profissional inválido' });

    try {
        const lista = await validarListaPermissoes(permissoes);
        if (lista.erro) return res.status(400).json({ erro: lista.erro });
        if (mexeEmPermissaoRestrita(req, lista.ids)) {
            return res.status(403).json({ erro: 'Somente administradores podem conceder esta permissão' });
        }
        if (idCadastro) {
            const erroProf = await validarProfissionalDoUsuario(req, idCadastro, null);
            if (erroProf) return res.status(erroProf.status).json({ erro: erroProf.erro });
        }

        const resultEmpresa = await getEmpresa(usuario);
        const empresa = resultEmpresa[0].empresa;
        const resultLogin = await executeQueryDBPrincipal('SELECT ID FROM USUARIOS WHERE UPPER(LOGIN) = UPPER(?)', [login]);

        if (resultLogin.length > 0) {
            return res.status(409).json({ erro: 'Login indisponível, escolha outro' });
        }

        const temporaria = gerarSenhaTemporaria();
        const hash = await bcrypt.hash(temporaria, SALT_ROUNDS);
        const novo = await executeQueryDBPrincipal(
            'INSERT INTO USUARIOS (LOGIN, SENHA, EMPRESA, NOME, TOKEN_VERSION, UPDATED_AT, TROCAR_SENHA, INATIVO) ' +
            'VALUES (?, ?, ?, ?, 0, 1, 1, 0) RETURNING ID',
            [login, hash, empresa, nome.trim()]
        );

        // Restos de um usuário antigo com o mesmo ID não podem passar para o novo
        await executeQueryEmpresa('DELETE FROM PERMISSOES_USUARIOS WHERE ID_USUARIO = ?', [novo.id], usuario);
        await executeQueryEmpresa('UPDATE CADASTROS SET ID_USUARIO = NULL WHERE ID_USUARIO = ?', [novo.id], usuario);

        for (const permissao of lista.ids) {
            await executeQueryEmpresa(
                'INSERT INTO PERMISSOES_USUARIOS (ID_USUARIO, ID_PERMISSAO) VALUES (?, ?)', [novo.id, permissao], usuario);
            await InserirHistoricoRegistro(usuario, 'PERMISSOES_USUARIOS', 'INSERT', novo.id, { campo: 'ID_PERMISSAO', novo: permissao });
        }
        if (idCadastro) {
            await executeQueryEmpresa('UPDATE CADASTROS SET ID_USUARIO = ? WHERE ID = ?', [novo.id, idCadastro], usuario);
            await InserirHistoricoRegistro(usuario, 'USUARIOS', 'UPDATE', novo.id, { campo: 'ID_CADASTRO', novo: idCadastro });
        }

        res.set('Cache-Control', 'no-store');
        res.status(201).json({ sucesso: true, id: novo?.id, login, senhaTemporaria: temporaria });

    } catch(err) {
        return handleError(res, err, 'cadastrarUsuario');
    }
}

// Grava de uma vez a lista de permissões montada no front (só as diferenças vão para o banco)
export async function definirPermissoes(req, res) {
    const usuarioLogado = req.usuario;
    const alvo = paraId(req.params.id);
    if (!alvo) return res.status(400).json({ erro: 'ID de usuário inválido' });

    try {
        const lista = await validarListaPermissoes(req.body?.ids);
        if (lista.erro) return res.status(400).json({ erro: lista.erro });

        const bloqueio = await verificarGestaoUsuario(req, alvo);
        if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });

        const atuais = await executeQueryEmpresa(
            'SELECT ID, ID_PERMISSAO FROM PERMISSOES_USUARIOS WHERE ID_USUARIO = ?', [alvo], usuarioLogado);
        const atuaisIds = new Set(atuais.map(p => p.id_permissao));
        const adicionar = lista.ids.filter(p => !atuaisIds.has(p));
        const remover = atuais.filter(p => !lista.ids.includes(p.id_permissao));

        if (mexeEmPermissaoRestrita(req, [...adicionar, ...remover.map(p => p.id_permissao)])) {
            return res.status(403).json({ erro: 'Somente administradores podem conceder ou remover esta permissão' });
        }

        for (const permissao of adicionar) {
            await executeQueryEmpresa(
                'INSERT INTO PERMISSOES_USUARIOS (ID_USUARIO, ID_PERMISSAO) VALUES (?, ?)', [alvo, permissao], usuarioLogado);
            await InserirHistoricoRegistro(usuarioLogado, 'PERMISSOES_USUARIOS', 'INSERT', alvo, { campo: 'ID_PERMISSAO', novo: permissao });
        }
        for (const p of remover) {
            await executeQueryEmpresa('DELETE FROM PERMISSOES_USUARIOS WHERE ID = ?', [p.id], usuarioLogado);
            await InserirHistoricoRegistro(usuarioLogado, 'PERMISSOES_USUARIOS', 'DELETE', alvo, { campo: 'ID_PERMISSAO', antigo: p.id_permissao });
        }

        // Perdeu permissão: as sessões abertas dele são encerradas
        if (remover.length) {
            const [{ empresa }] = await getEmpresa(usuarioLogado);
            await executeQueryDBPrincipal(
                'UPDATE USUARIOS SET TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1 WHERE ID = ? AND EMPRESA = ?',
                [alvo, empresa]
            );
        }
        limparCacheUsuario(alvo);
        res.status(200).json({ sucesso: true, adicionadas: adicionar.length, removidas: remover.length });
    } catch(err) {
        return handleError(res, err, 'definirPermissoes');
    }
}

// Usuário inativo não entra mais no sistema; as sessões abertas dele são encerradas na hora
export async function alterarStatusUsuario(req, res) {
    const alvo = paraId(req.params.id);
    const inativo = req.body?.inativo;
    if (!alvo || typeof inativo !== 'boolean') return res.status(400).json({ erro: 'Dados inválidos' });
    if (alvo === req.usuario) return res.status(400).json({ erro: 'Você não pode inativar o próprio usuário' });

    try {
        const bloqueio = await verificarGestaoUsuario(req, alvo);
        if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });

        const result = await executeQueryDBPrincipal(
            'UPDATE USUARIOS SET INATIVO = ?, UPDATED_AT = UPDATED_AT + 1, ' +
            'TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + ? WHERE ID = ? AND INATIVO <> ? RETURNING ID',
            [inativo ? 1 : 0, inativo ? 1 : 0, alvo, inativo ? 1 : 0]
        );
        limparCacheUsuario(alvo);
        if (foiAtualizado(result)) {
            await InserirHistoricoRegistro(req.usuario, 'USUARIOS', 'UPDATE', alvo, {
                campo: 'INATIVO', antigo: inativo ? 'N' : 'S', novo: inativo ? 'S' : 'N',
            });
        }
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'alterarStatusUsuario');
    }
}

// Liga o usuário ao cadastro de um profissional (ou desfaz com idCadastro: null).
// A partir daí ele vê apenas os próprios atendimentos (exceto com acesso total).
export async function vincularProfissional(req, res) {
    const alvo = paraId(req.params.id);
    const enviado = req.body?.idCadastro;
    const idCadastro = enviado === null ? null : paraId(enviado);
    if (!alvo || (enviado !== null && !idCadastro)) return res.status(400).json({ erro: 'Dados inválidos' });

    try {
        const bloqueio = await verificarGestaoUsuario(req, alvo, { permitirProprio: true });
        if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });

        if (idCadastro) {
            const erroProf = await validarProfissionalDoUsuario(req, idCadastro, alvo);
            if (erroProf) return res.status(erroProf.status).json({ erro: erroProf.erro });
        }

        await executeQueryEmpresa('UPDATE CADASTROS SET ID_USUARIO = NULL WHERE ID_USUARIO = ?', [alvo], req.usuario);
        if (idCadastro) {
            await executeQueryEmpresa('UPDATE CADASTROS SET ID_USUARIO = ? WHERE ID = ?', [alvo, idCadastro], req.usuario);
        }
        limparCacheUsuario(alvo);

        await InserirHistoricoRegistro(req.usuario, 'USUARIOS', 'UPDATE', alvo, {
            campo: 'ID_CADASTRO', novo: idCadastro ?? 'nenhum',
        });
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'vincularProfissional');
    }
}

export async function carregarPermissoes(req, res) {
    try {
        const result = await executeQueryDBPrincipal(
            ' SELECT ID, TABELA, TIPO FROM PERMISSOES ',
            []
        );
        res.status(200).json(result);
    } catch(err){
        return handleError(res, err, 'carregarPermissoes');
    }
}

export async function carregarPermissoesUsuario(req, res) {
    const usuarioLogado = req.usuario;
    const usuario = paraId(req.query.usuario);

    if (!usuario) {
        return res.status(400).json({ erro: 'ID de usuário inválido' });
    }

    try {
        const check = await executeQueryDBPrincipal(
            'SELECT 1 FROM USUARIOS WHERE ID=? AND MASTER = 0 AND EMPRESA=(SELECT EMPRESA FROM USUARIOS WHERE ID=?)',
            [usuario, usuarioLogado]
        );
        if (check.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
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
    const usuario   = paraId(req.body?.usuario);
    const permissao = paraId(req.body?.permissao);

    if (!usuario || !permissao) {
        return res.status(400).json({ erro: 'Informe o usuario e a permissão'});
    }

    try {
        const bloqueio = await verificarGestaoUsuario(req, usuario, { permissao });
        if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });

        const perm = await executeQueryDBPrincipal(
            'SELECT ID FROM PERMISSOES WHERE ID=?',
            [permissao]
        );
        if (perm.length===0) {
            return res.status(400).json({erro:'Permissão inexistente'});
        }

        const existente = await executeQueryEmpresa(
            'SELECT 1 FROM PERMISSOES_USUARIOS WHERE ID_USUARIO = ? AND ID_PERMISSAO = ?',
            [usuario, permissao],
            usuarioLogado
        );
        if (existente.length > 0) {
            return res.status(409).json({ erro: 'O usuário já tem esta permissão' });
        }

        await executeQueryEmpresa(
            'INSERT INTO PERMISSOES_USUARIOS (ID_USUARIO, ID_PERMISSAO) VALUES (?, ?)',
            [usuario, permissao],
            usuarioLogado
        );
        limparCacheUsuario(usuario);

        // No histórico de permissões o "registro" é o usuário que recebeu a permissão
        await InserirHistoricoRegistro(usuarioLogado, 'PERMISSOES_USUARIOS', 'INSERT', usuario, {
            campo: 'ID_PERMISSAO', novo: permissao,
        });
        res.status(201).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'adicionarPermissoes');
    }
}

export async function excluirPermissao(req, res) {
    const usuarioLogado = req.usuario;
    const idPermissao = paraId(req.body?.idPermissao);

    if (!idPermissao) {
        return res.status(400).json({ erro: 'Informe qual permissão deseja excluir'});
    }

    try {
        const [registro] = await executeQueryEmpresa(
            'SELECT ID_USUARIO, ID_PERMISSAO FROM PERMISSOES_USUARIOS WHERE ID = ?',
            [idPermissao],
            usuarioLogado
        );

        if (!registro) {
            return res.status(404).json({ erro: 'Permissão não encontrada' });
        }

        const usuario = registro.id_usuario;
        const bloqueio = await verificarGestaoUsuario(req, usuario, { permissao: registro.id_permissao });
        if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });

        await executeQueryEmpresa(
            'DELETE FROM PERMISSOES_USUARIOS WHERE ID = ?',
            [idPermissao],
            usuarioLogado
        );

        // Derruba a sessão do usuário que perdeu a permissão
        const [{ empresa }] = await getEmpresa(usuarioLogado);
        await executeQueryDBPrincipal(
            'UPDATE USUARIOS SET TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1 WHERE ID = ? AND EMPRESA = ?',
            [usuario, empresa]
        );
        limparCacheUsuario(usuario);

        await InserirHistoricoRegistro(usuarioLogado, 'PERMISSOES_USUARIOS', 'DELETE', usuario, {
            campo: 'ID_PERMISSAO', antigo: registro.id_permissao,
        });
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'excluirPermissao');
    }
}

export async function HistoricoPermissoesUsuario(req, res) {
    const usuario = paraId(req.params.id);
    if (!usuario) return res.status(400).json({ erro: 'ID de usuário inválido' });

    try {
        const check = await executeQueryDBPrincipal(
            'SELECT 1 FROM USUARIOS WHERE ID=? AND MASTER = 0 AND EMPRESA=(SELECT EMPRESA FROM USUARIOS WHERE ID=?)',
            [usuario, req.usuario]
        );
        if (check.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado' });

        const result = await getHistorico('PERMISSOES_USUARIOS', usuario, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoPermissoesUsuario');
    }
}

export async function alterarNome(req, res) {
    const usuario = paraId(req.body?.usuario);
    const { novonome, updatedAt } = req.body ?? {};

    if (!usuario) {
        return res.status(400).json({ erro: 'Informe o usuário que deseja alterar '});
    }

    if (typeof novonome !== 'string' || novonome.trim().length === 0 || novonome.length > 100) {
        return res.status(400).json({ erro: 'Informe um nome válido' });
    }

    if (!Number.isInteger(updatedAt)) {
        return res.status(400).json({ erro: 'updatedAt é obrigatório' });
    }

    try {
        const bloqueio = await verificarGestaoUsuario(req, usuario, { permitirProprio: true });
        if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });

        const resultUpdate = await executeQueryDBPrincipal(
            ' UPDATE USUARIOS SET NOME = ?, UPDATED_AT = UPDATED_AT+1 '+
            ' WHERE ID = ? AND UPDATED_AT = ? RETURNING ID ',
            [novonome.trim(), usuario, updatedAt]
        );

        if (!foiAtualizado(resultUpdate)) {
            return res.status(409).json({ erro: 'Registro alterado por outro usuário. Recarregue e tente novamente.'});
        }

        return res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'alterarNome');
    }
}

// Cada usuário troca a própria senha (não exige permissão de administrador)
/* =================== Foto de perfil (só a do próprio usuário) =================== */

// A foto chega reduzida pelo navegador; o servidor confere tamanho e se é mesmo uma imagem
const FOTO_MAX_BYTES = 24000;
function tipoDaImagem(buf) {
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
    if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

export async function minhaFoto(req, res) {
    try {
        const [u] = await executeQueryDBPrincipal(
            'SELECT CAST(FOTO AS VARCHAR(32765) CHARACTER SET OCTETS) FOTO, FOTO_VERSAO FROM USUARIOS WHERE ID = ?', [req.usuario]);
        res.set('Cache-Control', 'private, no-store');
        if (!u?.foto) return res.status(204).end();
        const buf = Buffer.from(String(u.foto), 'base64');
        const tipo = tipoDaImagem(buf);
        if (!tipo) return res.status(204).end();
        return res.status(200).json({ imagem: `data:${tipo};base64,${buf.toString('base64')}`, versao: u.foto_versao });
    } catch (err) {
        return handleError(res, err, 'minhaFoto');
    }
}

// Fotos de vários usuários da mesma empresa de uma vez (tela de usuários); o master nunca aparece
const MAX_FOTOS_POR_VEZ = 50;
export async function fotosUsuarios(req, res) {
    const ids = [...new Set(String(req.query.ids ?? '').split(',').filter(Boolean).map(paraId))];
    if (!ids.length || ids.includes(null) || ids.length > MAX_FOTOS_POR_VEZ) return res.status(400).json({ erro: 'Usuários inválidos' });
    try {
        const linhas = await executeQueryDBPrincipal(
            `SELECT ID, CAST(FOTO AS VARCHAR(32765) CHARACTER SET OCTETS) FOTO FROM USUARIOS
             WHERE ID IN (${ids.map(() => '?').join(', ')}) AND MASTER = 0 AND FOTO IS NOT NULL
               AND EMPRESA = (SELECT EMPRESA FROM USUARIOS U WHERE U.ID = ?)`, [...ids, req.usuario]);
        const fotos = {};
        for (const l of linhas) {
            const buf = Buffer.from(String(l.foto), 'base64'), tipo = tipoDaImagem(buf);
            if (tipo) fotos[l.id] = `data:${tipo};base64,${buf.toString('base64')}`;
        }
        res.set('Cache-Control', 'private, no-store');
        return res.status(200).json(fotos);
    } catch (err) {
        return handleError(res, err, 'fotosUsuarios');
    }
}

export async function alterarMinhaFoto(req, res) {
    const { imagem } = req.body ?? {};
    // Aceita "data:image/...;base64,XXXX" ou só o base64
    const base64 = typeof imagem === 'string' ? imagem.replace(/^data:image\/(png|jpeg|webp);base64,/, '') : '';
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return res.status(400).json({ erro: 'Imagem inválida' });
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > FOTO_MAX_BYTES) return res.status(400).json({ erro: 'A foto é grande demais' });
    if (!tipoDaImagem(buf)) return res.status(400).json({ erro: 'Envie uma imagem JPG, PNG ou WebP' });
    try {
        await executeQueryDBPrincipal(
            `UPDATE USUARIOS SET FOTO = ${PARAM_CRIPTO}, FOTO_VERSAO = FOTO_VERSAO + 1 WHERE ID = ?`,
            [buf.toString('base64'), req.usuario]);
        return res.status(200).json({ ok: true });
    } catch (err) {
        return handleError(res, err, 'alterarMinhaFoto');
    }
}

export async function removerMinhaFoto(req, res) {
    try {
        await executeQueryDBPrincipal('UPDATE USUARIOS SET FOTO = NULL, FOTO_VERSAO = FOTO_VERSAO + 1 WHERE ID = ?', [req.usuario]);
        return res.status(200).json({ ok: true });
    } catch (err) {
        return handleError(res, err, 'removerMinhaFoto');
    }
}

export async function alterarSenha(req, res) {
    const usuario = req.usuario;
    const { senhaAtual, novaSenha } = req.body ?? {};

    if (typeof senhaAtual !== 'string' || typeof novaSenha !== 'string' || !senhaAtual) {
        return res.status(400).json({ erro: 'Senha atual e nova senha são obrigatórias' });
    }

    const erroSenha = senhaInvalida(novaSenha);
    if (erroSenha) {
        return res.status(400).json({ erro: erroSenha });
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
            return res.status(400).json({ erro: 'Senha atual incorreta' });
        }

        if (await bcrypt.compare(novaSenha, result[0].senha)) {
            return res.status(400).json({ erro: 'A nova senha deve ser diferente da atual' });
        }

        const novoHash = await bcrypt.hash(novaSenha, SALT_ROUNDS);
        await executeQueryDBPrincipal(
            'UPDATE USUARIOS SET SENHA = ?, TROCAR_SENHA = 0, TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1 WHERE ID = ?',
            [novoHash, usuario]
        );

        limparCacheUsuario(usuario);
        res.json({ sucesso: true });

    } catch(err) {
        return handleError(res, err, 'alterarSenha');
    }
}

// Senha temporária: 12 caracteres sem os ambíguos (0/O, 1/l/I), com letra e número
function gerarSenhaTemporaria() {
    const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let senha;
    do {
        senha = Array.from({ length: 12 }, () => caracteres[crypto.randomInt(caracteres.length)]).join('');
    } while (senhaInvalida(senha));
    return senha;
}

// Administrador redefine a senha de outro usuário: gera uma senha temporária (mostrada uma única vez),
// encerra as sessões dele e exige a criação de uma senha nova no próximo acesso
export async function redefinirSenha(req, res) {
    const alvo = paraId(req.params.id);
    if (!alvo) return res.status(400).json({ erro: 'ID de usuário inválido' });
    if (alvo === req.usuario) {
        return res.status(400).json({ erro: 'Para trocar a sua própria senha use "Minha senha"' });
    }

    try {
        const bloqueio = await verificarGestaoUsuario(req, alvo);
        if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });

        const temporaria = gerarSenhaTemporaria();
        const hash = await bcrypt.hash(temporaria, SALT_ROUNDS);
        await executeQueryDBPrincipal(
            'UPDATE USUARIOS SET SENHA = ?, TROCAR_SENHA = 1, TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1 WHERE ID = ?',
            [hash, alvo]
        );
        limparCacheUsuario(alvo);

        await InserirHistoricoRegistro(req.usuario, 'USUARIOS', 'UPDATE', alvo, {
            campo: 'SENHA', novo: 'Redefinida pelo administrador',
        });

        res.set('Cache-Control', 'no-store');
        res.status(200).json({ sucesso: true, senhaTemporaria: temporaria });
    } catch(err) {
        return handleError(res, err, 'redefinirSenha');
    }
}

/* =================== Consultas =================== */

// Paciente, terapeuta e especialidade válidos e vinculados (consultas e agendamentos).
// Mesmas regras do front, verificadas de novo aqui
async function validarVinculosAtendimento(usuario, valores, atual) {
    const efetivo = campo => Object.hasOwn(valores, campo) ? valores[campo] : atual?.[campo.toLowerCase()];
    const paciente      = efetivo('ID_PACIENTE');
    const terapeuta     = efetivo('ID_TERAPEUTA');
    const especialidade = efetivo('ID_ESPECIALIDADE');

    // Na alteração, só revalida os vínculos se algum deles mudou
    const mudou = c => Object.hasOwn(valores, c) && valores[c] !== atual?.[c.toLowerCase()];
    if (atual && !['ID_PACIENTE', 'ID_TERAPEUTA', 'ID_ESPECIALIDADE'].some(mudou)) return null;

    const [r] = await executeQueryEmpresa(
        `SELECT
            (SELECT TIPO FROM CADASTROS WHERE ID = ? AND EXCLUIDO_EM IS NULL) TIPO_PACIENTE,
            (SELECT TIPO FROM CADASTROS WHERE ID = ? AND EXCLUIDO_EM IS NULL) TIPO_TERAPEUTA,
            (SELECT INATIVO FROM ESPECIALIDADES WHERE ID = ?) ESP_INATIVO,
            (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ?) ESPS_DO_TERAPEUTA,
            (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ? AND ID_ESPECIALIDADE_TERAPEUTA = ?) TERAPEUTA_ATENDE,
            (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ?) TERAPEUTAS_DO_PACIENTE,
            (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ? AND ID_ESPECIALIDADE_TERAPEUTA = ?) PACIENTE_VINCULADO
         FROM RDB$DATABASE`,
        [paciente, terapeuta, especialidade, terapeuta, terapeuta, especialidade, paciente, paciente, terapeuta],
        usuario
    );

    if (r.tipo_paciente !== 'Paciente') return 'Paciente inválido';
    if (r.tipo_terapeuta !== 'Terapeuta') return 'Profissional inválido';
    if (r.esp_inativo == null) return 'Especialidade inválida';
    if ((!atual || mudou('ID_ESPECIALIDADE')) && r.esp_inativo === 'S') return 'Especialidade inativa';
    if (r.esps_do_terapeuta > 0 && r.terapeuta_atende === 0) return 'O profissional não atende esta especialidade';
    if (r.terapeutas_do_paciente > 0 && r.paciente_vinculado === 0) return 'O paciente não está vinculado a este profissional';
    return null;
}

async function regrasConsulta(usuario, valores, atual) {
    // Consulta gerada de agendamento: paciente, terapeuta e especialidade vêm do agendamento
    if (atual?.id_agendamento) {
        const mudou = c => Object.hasOwn(valores, c) && valores[c] !== atual[c.toLowerCase()];
        if (['ID_PACIENTE', 'ID_TERAPEUTA', 'ID_ESPECIALIDADE'].some(mudou)) {
            return 'Paciente, profissional e especialidade desta sessão vêm do agendamento e não podem ser alterados';
        }
        return null;
    }
    return validarVinculosAtendimento(usuario, valores, atual);
}

// Consulta excluída volta o agendamento para "agendado" (permite gerar outra)
async function reabrirAgendamento(usuario, consulta) {
    if (!consulta.id_agendamento) return;
    const result = await executeQueryEmpresa(
        "UPDATE AGENDAMENTOS SET STATUS = 'AGENDADO', UPDATED_AT = UPDATED_AT + 1 WHERE ID = ? AND STATUS = 'REALIZADO' RETURNING ID",
        [consulta.id_agendamento],
        usuario
    );
    if (foiAtualizado(result)) {
        await InserirHistoricoRegistro(usuario, 'AGENDAMENTOS', 'UPDATE', consulta.id_agendamento, {
            campo: 'STATUS', antigo: 'REALIZADO', novo: 'AGENDADO',
        });
        // O evento do Google volta para o horário agendado
        await sincronizarAgendamento(usuario, consulta.id_agendamento);
    }
}

// Sessão de um agendamento com data ou duração alterada: o evento do Google acompanha
async function sincronizarSessaoGoogle(usuario, idConsulta) {
    const [c] = await executeQueryEmpresa('SELECT ID_AGENDAMENTO FROM CONSULTAS WHERE ID = ?', [idConsulta], usuario);
    return c?.id_agendamento ? { google: await sincronizarAgendamento(usuario, c.id_agendamento) } : {};
}

// Lista sem o resumo da sessão (dado de saúde); o resumo só vem no detalhe
export async function carregarConsultas(req, res){
    const usuario = req.usuario;
    const { porPagina, offset } = paginacao(req);
    const busca = filtroBusca(req.query.busca, ['PACIENTES.NOME', 'TERAPEUTAS.NOME', 'ESPECIALIDADES.DESCRICAO']);
    const escopo = req.terapeuta ? { sql: ' AND CONSULTAS.ID_TERAPEUTA = ?', params: [req.terapeuta] } : { sql: '', params: [] };
    const origem =
        ' FROM CONSULTAS ' +
        '    LEFT JOIN CADASTROS PACIENTES ON PACIENTES.ID = CONSULTAS.ID_PACIENTE ' +
        '    LEFT JOIN CADASTROS TERAPEUTAS ON TERAPEUTAS.ID = CONSULTAS.ID_TERAPEUTA ' +
        '    LEFT JOIN ESPECIALIDADES ON ESPECIALIDADES.ID = CONSULTAS.ID_ESPECIALIDADE ' +
        ` WHERE CONSULTAS.EXCLUIDO_EM IS NULL${escopo.sql}${busca.sql}`;
    const params = [...escopo.params, ...busca.params];

    try {
        const [result, [{ total }]] = await Promise.all([
            executeQueryEmpresa(
                ' SELECT FIRST ? SKIP ? '+
                '    CONSULTAS.ID, '+
                '    PACIENTES.NOME AS PACIENTE, '+
                '    TERAPEUTAS.NOME AS TERAPEUTA, '+
                '    CONSULTAS.DT_HR_SESSAO DATA_HORA, '+
                '    CONSULTAS.ID_AGENDAMENTO, '+
                '    CONSULTAS.UPDATED_AT, '+
                '    CONSULTAS.ID_TERAPEUTA, '+
                '    CONSULTAS.ID_ESPECIALIDADE, '+
                '    CONSULTAS.TEMPO_SESSAO, '+
                '    CONSULTAS.ID_PACIENTE, '+
                '    ESPECIALIDADES.DESCRICAO AS ESPECIALIDADE ' +
                origem +
                ' ORDER BY CONSULTAS.DT_HR_SESSAO DESC, CONSULTAS.ID DESC',
                [porPagina, offset, ...params],
                usuario
            ),
            executeQueryEmpresa(`SELECT COUNT(*) TOTAL${origem}`, params, usuario),
        ]);
        return enviarPagina(res, result, total);

    } catch(err) {
        return handleError(res, err, 'carregarConsultas');
    }
}

// Detalhe da sessão com as metas do paciente naquela especialidade (e a nota dada nesta sessão)
export async function carregarConsultaPorId(req, res) {
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });
    try {
        const [registro] = await executeQueryEmpresa(
            'SELECT ID, ID_PACIENTE, ID_TERAPEUTA, ID_ESPECIALIDADE, DT_HR_SESSAO DATA_HORA, TEMPO_SESSAO, ' +
            `${lerCripto('RESUMO_SESSAO')}, ${lerCripto('EVOLUCAO')}, ID_AGENDAMENTO, UPDATED_AT ` +
            'FROM CONSULTAS WHERE ID = ? AND EXCLUIDO_EM IS NULL', [id], req.usuario);
        if (!registro || !await registroNoEscopo(req, 'CONSULTAS', registro)) return naoEncontrado(res);
        await InserirHistoricoRegistro(req.usuario, 'CONSULTAS', 'LEITURA', id);
        const metas = await metasDaSessao(req, registro.id_paciente, registro.id_especialidade, id);
        return res.status(200).json({ ...descriptografarCampos('CONSULTAS', registro), metas });
    } catch(err) {
        return handleError(res, err, 'carregarConsultaPorId');
    }
}

// "metas" (avaliações das metas na sessão) vai junto, fora dos campos da tabela
function separarMetas(req, chaveCorpo = null) {
    const corpo = chaveCorpo ? req.body?.[chaveCorpo] : req.body;
    if (!corpo || typeof corpo !== 'object' || !Object.hasOwn(corpo, 'metas')) return undefined;
    const { metas, ...resto } = corpo;
    if (chaveCorpo) req.body = { ...req.body, [chaveCorpo]: resto }; else req.body = resto;
    return metas;
}

export function AdicionarConsultas(req, res) {
    const metas = separarMetas(req);
    return inserirRegistro(req, res, 'CONSULTAS', 'AdicionarConsultas', {
        regrasNegocio: async (usuario, valores, atual) =>
            await regrasConsulta(usuario, valores, atual) ?? await validarAvaliacoes(req, valores.ID_PACIENTE, metas),
        extras: [['UPDATED_AT', '1']],
        aposSalvar: async (usuario, id) => {
            await cobrarSessao(usuario, id);
            await salvarAvaliacoes(req, id, metas);
            return {};
        },
    });
}

// Trocar paciente ou especialidade muda quem paga e qual pacote a sessão usa
const mudouCobranca = (valores, atual) =>
    ['ID_PACIENTE', 'ID_ESPECIALIDADE'].some(c => Object.hasOwn(valores, c) && valores[c] !== atual[c.toLowerCase()]);

export function alterarConsultas(req, res) {
    const metas = separarMetas(req, 'campos');
    let recobrar = false;
    return atualizarRegistro(req, res, 'CONSULTAS', 'alterarConsultas',
        async (usuario, valores, atual) => {
            const erro = await regrasConsulta(usuario, valores, atual) ?? await validarAvaliacoes(req, valores.ID_PACIENTE ?? atual.id_paciente, metas);
            if (erro) return erro;
            recobrar = mudouCobranca(valores, atual);
            return recobrar ? conferirSaidaSessao(usuario, atual) : null;
        },
        {
            aposSalvar: async (usuario, id) => {
                if (recobrar) await cobrarSessao(usuario, id);
                await salvarAvaliacoes(req, id, metas);
                return sincronizarSessaoGoogle(usuario, id);
            },
        });
}

export function excluirConsultas(req, res) {
    return exclusivoFinanceiro(req.usuario, () => excluirRegistro(req, res, 'CONSULTAS', 'excluirConsultas', {
        podeExcluir: conferirSaidaSessao, aposExcluir: reabrirAgendamento,
    }));
}

export async function HistoricoDeleteConsultas(req, res) {
    try {
        const result = await getHistorico('CONSULTAS', null, req.usuario);
        res.status(200).json(await excluidosNoEscopo(req, 'CONSULTAS', result));
    } catch(err) {
        return handleError(res, err, 'HistoricoDeleteConsultas');
    }
}

export async function HistoricoConsultas(req, res) {
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });
    try {
        if (!await historicoNoEscopo(req, 'CONSULTAS', id)) return naoEncontrado(res);
        const result = await getHistorico('CONSULTAS', id, req.usuario);
        await auditarLeituraHistorico(req.usuario, 'CONSULTAS', id, result);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoConsultas');
    }
}

/* =================== Agendamentos =================== */
// AGENDADO -> REALIZADO (gerou a consulta) ou CANCELADO. Só os agendamentos vão para o Google Agenda.

const STATUS_AGENDAMENTO = new Set(['AGENDADO', 'REALIZADO', 'CANCELADO', 'FALTOU']);
const MAX_REPETICOES = 52;

// "YYYY-MM-DD HH:MM:SS" + "HH:MM:SS" -> "YYYY-MM-DD HH:MM:SS"
function somarDuracao(inicio, duracao) {
    const [data, hora] = String(inicio).replace('T', ' ').split(' ');
    const [a, m, d] = data.split('-').map(Number);
    const [h, mi, se] = hora.split(':').map(Number);
    const [dh, dm, ds] = String(duracao).split(':').map(Number);
    const fim = new Date(a, m - 1, d, h + dh, mi + dm, (se || 0) + (ds || 0));
    const p = n => String(n).padStart(2, '0');
    return `${fim.getFullYear()}-${p(fim.getMonth() + 1)}-${p(fim.getDate())} ${p(fim.getHours())}:${p(fim.getMinutes())}:${p(fim.getSeconds())}`;
}

async function regrasAgendamento(usuario, valores, atual) {
    if (atual && atual.status !== 'AGENDADO') return 'Só é possível alterar agendamentos com status Agendado';

    const erroVinculo = await validarVinculosAtendimento(usuario, valores, atual);
    if (erroVinculo) return erroVinculo;
    return conflitoAgendamento(usuario, valores, atual);
}

// Terapeuta e paciente não podem ter dois agendamentos no mesmo horário
async function conflitoAgendamento(usuario, valores, atual) {
    const efetivo = campo => Object.hasOwn(valores, campo) ? valores[campo] : atual?.[campo.toLowerCase()];
    const inicio = String(efetivo('DT_HR_AGENDADA')).replace('T', ' ');
    const fim = somarDuracao(inicio, efetivo('TEMPO_PREVISTO'));
    const terapeuta = efetivo('ID_TERAPEUTA'), paciente = efetivo('ID_PACIENTE');

    const [conflito] = await executeQueryEmpresa(
        `SELECT FIRST 1 A.ID_TERAPEUTA FROM AGENDAMENTOS A
         WHERE A.STATUS = 'AGENDADO' AND A.ID <> ? AND (A.ID_TERAPEUTA = ? OR A.ID_PACIENTE = ?)
           AND A.DT_HR_AGENDADA < ?
           AND DATEADD(DATEDIFF(SECOND FROM TIME '00:00:00' TO A.TEMPO_PREVISTO) SECOND TO A.DT_HR_AGENDADA) > ?`,
        [atual?.id ?? 0, terapeuta, paciente, fim, inicio],
        usuario
    );
    if (conflito) {
        return conflito.id_terapeuta === terapeuta
            ? 'O profissional já tem um agendamento neste horário'
            : 'O paciente já tem um agendamento neste horário';
    }
    return null;
}

const sincronizarGoogle = async (usuario, id) => ({ google: await sincronizarAgendamento(usuario, id) });

export async function carregarAgendamentos(req, res) {
    const usuario = req.usuario;
    const { de, ate, status } = req.query;
    // Profissional vinculado vê só a própria agenda, qualquer que seja o filtro pedido
    const terapeuta = req.terapeuta ?? (req.query.terapeuta === undefined ? null : paraId(req.query.terapeuta));
    const dataValida = v => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v);

    if (!dataValida(de) || !dataValida(ate)) return res.status(400).json({ erro: 'Período inválido' });
    if (status !== undefined && !STATUS_AGENDAMENTO.has(status)) return res.status(400).json({ erro: 'Status inválido' });
    if (!req.terapeuta && req.query.terapeuta !== undefined && !terapeuta) return res.status(400).json({ erro: 'Profissional inválido' });

    const { porPagina, offset } = paginacao(req, { padrao: 100, max: 500 });
    const filtros = [], params = [];
    if (de)        { filtros.push('A.DT_HR_AGENDADA >= ?'); params.push(`${de} 00:00:00`); }
    if (ate)       { filtros.push('A.DT_HR_AGENDADA < DATEADD(1 DAY TO CAST(? AS DATE))'); params.push(ate); }
    if (status)    { filtros.push('A.STATUS = ?'); params.push(status); }
    if (terapeuta) { filtros.push('A.ID_TERAPEUTA = ?'); params.push(terapeuta); }
    const busca = filtroBusca(req.query.busca, ['P.NOME', 'T.NOME', 'E.DESCRICAO']);
    const origem = `
             FROM AGENDAMENTOS A
                JOIN CADASTROS P ON P.ID = A.ID_PACIENTE
                JOIN CADASTROS T ON T.ID = A.ID_TERAPEUTA
                JOIN ESPECIALIDADES E ON E.ID = A.ID_ESPECIALIDADE
             WHERE 1 = 1${filtros.map(f => ` AND ${f}`).join('')}${busca.sql}`;
    const todos = [...params, ...busca.params];

    try {
        const [result, [{ total }]] = await Promise.all([executeQueryEmpresa(
            `SELECT FIRST ? SKIP ? A.ID, A.ID_PACIENTE, P.NOME PACIENTE, A.ID_TERAPEUTA, T.NOME TERAPEUTA,
                    A.ID_ESPECIALIDADE, E.DESCRICAO ESPECIALIDADE, A.DT_HR_AGENDADA, A.TEMPO_PREVISTO, A.STATUS,
                    CAST(CASE WHEN A.GOOGLE_EVENT_ID IS NULL THEN 'N' ELSE 'S' END AS VARCHAR(1)) NO_GOOGLE, A.UPDATED_AT,
                    A.ID_SERIE, CAST(A.FALTA_JUSTIFICADA AS VARCHAR(1)) FALTA_JUSTIFICADA,
                    (SELECT FIRST 1 C.ID FROM CONSULTAS C WHERE C.ID_AGENDAMENTO = A.ID AND C.EXCLUIDO_EM IS NULL) ID_CONSULTA
             ${origem}
             ORDER BY A.DT_HR_AGENDADA, A.ID`,
            [porPagina, offset, ...todos],
            usuario
        ), executeQueryEmpresa(`SELECT COUNT(*) TOTAL ${origem}`, todos, usuario)]);
        return enviarPagina(res, result, total);
    } catch(err) {
        return handleError(res, err, 'carregarAgendamentos');
    }
}

// "2026-11-03 14:00:00" -> texto do mesmo instante deslocado (dias ou milissegundos), no horário local
function deslocarDataHora(dataHora, { dias = 0, ms = 0 } = {}) {
    const [d, h] = String(dataHora).replace('T', ' ').split(' ');
    const [a, m, dia] = d.split('-').map(Number);
    const [hh, mi, ss] = h.split(':').map(Number);
    const x = new Date(a, m - 1, dia + dias, hh, mi, ss || 0);
    x.setTime(x.getTime() + ms);
    const p = n => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
}
const instante = dataHora => new Date(String(dataHora).replace(' ', 'T')).getTime();
const diaMes = dataHora => { const [a, m, d] = String(dataHora).slice(0, 10).split('-'); return `${d}/${m}`; };
const conflitoDeHorario = erro => /já tem um agendamento/.test(erro ?? '');

// Série inteira para o Google: a resposta não espera por ele. O Google aceita poucas alterações
// por segundo, então os envios vão numa fila por usuário, dois de cada vez (com nova tentativa
// quando ele pede para esperar). Enquanto isso, a lista mostra "Pendente" nos que faltam.
const GOOGLE_SIMULTANEOS = 2;
const filasGoogle = new Map();
async function sincronizarVarios(usuario, ids, fn = sincronizarAgendamento) {
    if (!ids.length) return 'sincronizado';
    // Sem o Google conectado não há o que enviar (no cancelamento, os eventos já não existem lá)
    if (!await googleConectado(usuario)) return fn === sincronizarAgendamento ? 'nao_conectado' : 'sincronizado';
    const anterior = filasGoogle.get(usuario) ?? Promise.resolve();
    const vez = anterior.then(async () => {
        let proximo = 0, falhas = 0;
        const trabalhador = async () => {
            while (proximo < ids.length) if (await fn(usuario, ids[proximo++]) === 'falhou') falhas++;
        };
        await Promise.all(Array.from({ length: Math.min(GOOGLE_SIMULTANEOS, ids.length) }, trabalhador));
        if (falhas) console.error(`[sincronizarVarios] ${falhas} de ${ids.length} não foram para o Google`);
    }).catch(err => console.error('[sincronizarVarios]', err));
    filasGoogle.set(usuario, vez);
    vez.then(() => { if (filasGoogle.get(usuario) === vez) filasGoogle.delete(usuario); });
    return 'em_andamento';
}

// Agendar: um só, ou repetido (repetir: { intervalo: 1 = toda semana | 2 = a cada 2 semanas, vezes: 2..52 }).
// Com horário ocupado em alguma data, devolve as datas (409) e só cria as livres se pularConflitos = true
export async function adicionarAgendamento(req, res) {
    const { repetir, pularConflitos, ...dados } = req.body ?? {};
    req.body = dados;
    if (repetir === undefined || repetir === null) {
        return inserirRegistro(req, res, 'AGENDAMENTOS', 'adicionarAgendamento', {
            regrasNegocio: regrasAgendamento,
            extras: [['STATUS', "'AGENDADO'"], ['UPDATED_AT', '1'], ['CRIADO_POR', '?', req.usuario]],
            aposSalvar: sincronizarGoogle,
        });
    }

    const usuario = req.usuario;
    const intervalo = repetir?.intervalo, vezes = repetir?.vezes;
    if (![1, 2].includes(intervalo) || !Number.isInteger(vezes) || vezes < 2 || vezes > MAX_REPETICOES) {
        return res.status(400).json({ erro: `Repetição inválida: toda semana ou a cada 2 semanas, de 2 a ${MAX_REPETICOES} vezes` });
    }
    const { valores, erro } = validarDados('AGENDAMENTOS', req.body);
    if (erro) return res.status(400).json({ erro });

    try {
        const erroEscopo = await dadosNoEscopo(req, 'AGENDAMENTOS', valores, null);
        if (erroEscopo) return res.status(403).json({ erro: erroEscopo });

        // Paciente, profissional e especialidade são os mesmos em todas as datas: confere uma vez só
        const erroVinculo = await validarVinculosAtendimento(usuario, valores, null);
        if (erroVinculo) return res.status(400).json({ erro: erroVinculo });
        const livres = [], conflitos = [];
        for (let i = 0; i < vezes; i++) {
            const data = deslocarDataHora(valores.DT_HR_AGENDADA, { dias: i * 7 * intervalo });
            const erroRegra = await conflitoAgendamento(usuario, { ...valores, DT_HR_AGENDADA: data }, null);
            if (!erroRegra) livres.push(data);
            else if (conflitoDeHorario(erroRegra)) conflitos.push(data);
            else return res.status(400).json({ erro: erroRegra });
        }
        if (!livres.length) return res.status(409).json({ erro: 'Todos os horários da repetição estão ocupados' });
        if (conflitos.length && pularConflitos !== true) {
            return res.status(409).json({
                erro: `Horário ocupado em ${conflitos.map(diaMes).join(', ')}.`,
                conflitos: conflitos.map(diaMes), livres: livres.length,
            });
        }

        // Todos da série recebem o ID do primeiro em ID_SERIE
        const ids = [];
        for (const data of livres) {
            const [{ id }] = await executeQueryEmpresa('SELECT GEN_ID(GEN_AGENDAMENTOS_ID, 1) ID FROM RDB$DATABASE', [], usuario);
            const { colunas, marcadores, params } = paraGravar('AGENDAMENTOS', { ...valores, DT_HR_AGENDADA: data });
            await executeQueryEmpresa(
                `INSERT INTO AGENDAMENTOS (ID, ${colunas.join(', ')}, STATUS, UPDATED_AT, CRIADO_POR, ID_SERIE) ` +
                `VALUES (?, ${marcadores.join(', ')}, 'AGENDADO', 1, ?, ?)`,
                [id, ...params, usuario, ids[0] ?? id], usuario);
            await InserirHistoricoInsert(usuario, 'AGENDAMENTOS', id);
            ids.push(id);
        }
        const google = await sincronizarVarios(usuario, ids);
        res.status(201).json({ sucesso: true, id: ids[0], criados: ids.length, pulados: conflitos.length, google });
    } catch (err) {
        return handleError(res, err, 'adicionarAgendamento');
    }
}

// Remarcar: só este, ou este e os próximos da série (aplicar: 'proximos').
// Nos próximos, a mudança de data/hora é a mesma diferença aplicada a cada um
export async function alterarAgendamento(req, res) {
    const { aplicar, ...corpo } = req.body ?? {};
    req.body = corpo;
    if (aplicar !== 'proximos') {
        return atualizarRegistro(req, res, 'AGENDAMENTOS', 'alterarAgendamento', regrasAgendamento, {
            aposSalvar: sincronizarGoogle,
        });
    }

    const usuario = req.usuario;
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });
    const { updatedAt, campos } = req.body;
    if (!Number.isInteger(updatedAt)) return res.status(400).json({ erro: 'updatedAt é obrigatório' });
    const { valores, erro } = validarDados('AGENDAMENTOS', campos, { parcial: true });
    if (erro) return res.status(400).json({ erro });
    if (!Object.keys(valores).length) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });

    try {
        const atual = await BuscarRegistroAtual(usuario, 'AGENDAMENTOS', id);
        if (!atual || !await registroNoEscopo(req, 'AGENDAMENTOS', atual)) return naoEncontrado(res);
        if (atual.updated_at !== updatedAt) return res.status(409).json({ erro: 'Registro desatualizado, tente novamente' });
        if (!atual.id_serie) return res.status(400).json({ erro: 'Este agendamento não faz parte de uma repetição' });
        const erroEscopo = await dadosNoEscopo(req, 'AGENDAMENTOS', valores, atual);
        if (erroEscopo) return res.status(403).json({ erro: erroEscopo });

        const deslocamento = Object.hasOwn(valores, 'DT_HR_AGENDADA')
            ? instante(valores.DT_HR_AGENDADA) - instante(atual.dt_hr_agendada) : 0;
        const ids = await executeQueryEmpresa(
            "SELECT ID FROM AGENDAMENTOS WHERE ID_SERIE = ? AND STATUS = 'AGENDADO' AND DT_HR_AGENDADA >= ? ORDER BY DT_HR_AGENDADA",
            [atual.id_serie, String(atual.dt_hr_agendada).replace('T', ' ')], usuario);

        // Confere todos antes de gravar qualquer um
        const planos = [], conflitos = [];
        for (const { id: idItem } of ids) {
            const item = idItem === id ? atual : await BuscarRegistroAtual(usuario, 'AGENDAMENTOS', idItem);
            if (!item || !await registroNoEscopo(req, 'AGENDAMENTOS', item)) continue;
            const novos = { ...valores };
            if (Object.hasOwn(valores, 'DT_HR_AGENDADA')) novos.DT_HR_AGENDADA = deslocarDataHora(item.dt_hr_agendada, { ms: deslocamento });
            const erroRegra = await regrasAgendamento(usuario, novos, item);
            if (conflitoDeHorario(erroRegra)) conflitos.push(novos.DT_HR_AGENDADA ?? item.dt_hr_agendada);
            else if (erroRegra) return res.status(400).json({ erro: erroRegra });
            planos.push({ item, novos });
        }
        if (conflitos.length) return res.status(409).json({ erro: `Horário ocupado em ${conflitos.map(diaMes).join(', ')}. Nada foi alterado.` });

        for (const { item, novos } of planos) {
            const { colunas, marcadores, params } = paraGravar('AGENDAMENTOS', novos);
            const r = await executeQueryEmpresa(
                `UPDATE AGENDAMENTOS SET UPDATED_AT = UPDATED_AT + 1, ${colunas.map((c, i) => `${c} = ${marcadores[i]}`).join(', ')} ` +
                `WHERE ID = ? AND STATUS = 'AGENDADO' RETURNING ID`, [...params, item.id], usuario);
            if (foiAtualizado(r)) await InserirHistorico(usuario, 'AGENDAMENTOS', item.id, novos, item);
        }
        const google = await sincronizarVarios(usuario, planos.map(p => p.item.id));
        res.status(200).json({ sucesso: true, alterados: planos.length, google });
    } catch (err) {
        return handleError(res, err, 'alterarAgendamento');
    }
}

// Cancelar: só este, ou este e os próximos da série ({ proximos: true })
export async function cancelarAgendamento(req, res) {
    const usuario = req.usuario;
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });

    try {
        const atual = await BuscarRegistroAtual(usuario, 'AGENDAMENTOS', id);
        if (!atual || !await registroNoEscopo(req, 'AGENDAMENTOS', atual)) return naoEncontrado(res);
        if (atual.status !== 'AGENDADO') return res.status(409).json({ erro: 'Só é possível cancelar agendamentos com status Agendado' });

        const alvos = [id];
        if (req.body?.proximos === true && atual.id_serie) {
            const proximos = await executeQueryEmpresa(
                "SELECT ID, ID_TERAPEUTA FROM AGENDAMENTOS WHERE ID_SERIE = ? AND STATUS = 'AGENDADO' AND DT_HR_AGENDADA > ? AND ID <> ?",
                [atual.id_serie, String(atual.dt_hr_agendada).replace('T', ' '), id], usuario);
            alvos.push(...proximos.filter(p => !req.terapeuta || p.id_terapeuta === req.terapeuta).map(p => p.id));
        }

        const cancelados = [];
        for (const alvo of alvos) {
            const result = await executeQueryEmpresa(
                "UPDATE AGENDAMENTOS SET STATUS = 'CANCELADO', CANCELADO_EM = LOCALTIMESTAMP, CANCELADO_POR = ?, UPDATED_AT = UPDATED_AT + 1 " +
                "WHERE ID = ? AND STATUS = 'AGENDADO' RETURNING ID", [usuario, alvo], usuario);
            if (!foiAtualizado(result)) continue;
            await InserirHistoricoRegistro(usuario, 'AGENDAMENTOS', 'UPDATE', alvo, { campo: 'STATUS', antigo: 'AGENDADO', novo: 'CANCELADO' });
            cancelados.push(alvo);
        }
        if (!cancelados.length) return res.status(409).json({ erro: 'Só é possível cancelar agendamentos com status Agendado' });
        const google = await sincronizarVarios(usuario, cancelados, removerEventoAgendamento);
        res.status(200).json({ sucesso: true, cancelados: cancelados.length, google, id_especialidade: atual.id_especialidade });
    } catch(err) {
        return handleError(res, err, 'cancelarAgendamento');
    }
}

// Falta: o paciente não veio (justificada ou não). Só depois do horário marcado; dá para desfazer
export async function registrarFalta(req, res) {
    const usuario = req.usuario;
    const id = paraId(req.params.id);
    const { justificada, desfazer } = req.body ?? {};
    if (!id || (desfazer !== true && typeof justificada !== 'boolean')) return res.status(400).json({ erro: 'Dados inválidos' });

    try {
        const atual = await BuscarRegistroAtual(usuario, 'AGENDAMENTOS', id);
        if (!atual || !await registroNoEscopo(req, 'AGENDAMENTOS', atual)) return naoEncontrado(res);

        if (desfazer === true) {
            const r = await executeQueryEmpresa(
                "UPDATE AGENDAMENTOS SET STATUS = 'AGENDADO', FALTA_JUSTIFICADA = NULL, UPDATED_AT = UPDATED_AT + 1 WHERE ID = ? AND STATUS = 'FALTOU' RETURNING ID",
                [id], usuario);
            if (!foiAtualizado(r)) return res.status(409).json({ erro: 'Este agendamento não está marcado como falta' });
            await InserirHistoricoRegistro(usuario, 'AGENDAMENTOS', 'UPDATE', id, { campo: 'STATUS', antigo: 'FALTOU', novo: 'AGENDADO' });
            return res.status(200).json({ sucesso: true });
        }

        if (atual.status !== 'AGENDADO') return res.status(409).json({ erro: 'Só é possível registrar falta em agendamentos com status Agendado' });
        if (instante(atual.dt_hr_agendada) > Date.now() + 5 * 60 * 1000) {
            return res.status(400).json({ erro: 'A falta só pode ser registrada depois do horário marcado' });
        }
        const r = await executeQueryEmpresa(
            "UPDATE AGENDAMENTOS SET STATUS = 'FALTOU', FALTA_JUSTIFICADA = ?, UPDATED_AT = UPDATED_AT + 1 WHERE ID = ? AND STATUS = 'AGENDADO' RETURNING ID",
            [justificada ? 'S' : 'N', id], usuario);
        if (!foiAtualizado(r)) return res.status(409).json({ erro: 'Este agendamento foi alterado por outra pessoa' });
        await InserirHistoricoRegistro(usuario, 'AGENDAMENTOS', 'UPDATE', id, { campo: 'STATUS', antigo: 'AGENDADO', novo: 'FALTOU' });
        await InserirHistoricoRegistro(usuario, 'AGENDAMENTOS', 'UPDATE', id, { campo: 'FALTA_JUSTIFICADA', novo: justificada ? 'S' : 'N' });
        res.status(200).json({ sucesso: true, id_especialidade: atual.id_especialidade });
    } catch (err) {
        return handleError(res, err, 'registrarFalta');
    }
}

// Reenvia ao Google Agenda (ex.: Google estava fora do ar ou foi conectado depois)
export async function sincronizarAgendamentoGoogle(req, res) {
    const usuario = req.usuario;
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });

    try {
        const atual = await BuscarRegistroAtual(usuario, 'AGENDAMENTOS', id);
        if (!atual || !await registroNoEscopo(req, 'AGENDAMENTOS', atual)) return res.status(404).json({ erro: 'Agendamento não encontrado' });
        if (atual.status !== 'AGENDADO') {
            return res.status(409).json({ erro: 'Só agendamentos com status Agendado vão para o Google Agenda' });
        }

        const google = await sincronizarAgendamento(usuario, id);
        if (google === 'nao_conectado') return res.status(409).json({ erro: 'Google Agenda não está conectado' });
        if (google === 'falhou') return res.status(502).json({ erro: 'Não foi possível sincronizar com o Google Agenda' });
        res.status(200).json({ sucesso: true, google });
    } catch(err) {
        return handleError(res, err, 'sincronizarAgendamentoGoogle');
    }
}

// Gera a consulta (sessão realizada) a partir do agendamento.
// Paciente, terapeuta e especialidade vêm do agendamento; o usuário informa horário real e resumo.
export async function gerarConsulta(req, res) {
    const usuario = req.usuario;
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });

    try {
        const agendamento = await BuscarRegistroAtual(usuario, 'AGENDAMENTOS', id);
        if (!agendamento || !await registroNoEscopo(req, 'AGENDAMENTOS', agendamento)) {
            return res.status(404).json({ erro: 'Agendamento não encontrado' });
        }
        if (agendamento.status !== 'AGENDADO') {
            return res.status(409).json({ erro: 'Este agendamento já foi realizado ou cancelado' });
        }

        const metas = req.body?.metas;
        const erroMetas = await validarAvaliacoes(req, agendamento.id_paciente, metas);
        if (erroMetas) return res.status(400).json({ erro: erroMetas });

        const { valores, erro } = validarDados('CONSULTAS', {
            dt_hr_sessao:     req.body?.dt_hr_sessao,
            tempo_sessao:     req.body?.tempo_sessao,
            resumo_sessao:    req.body?.resumo_sessao,
            evolucao:         req.body?.evolucao,
            id_paciente:      agendamento.id_paciente,
            id_terapeuta:     agendamento.id_terapeuta,
            id_especialidade: agendamento.id_especialidade,
        });
        if (erro) return res.status(400).json({ erro });

        // Marca como realizado antes de gravar: impede gerar duas consultas do mesmo agendamento
        const reserva = await executeQueryEmpresa(
            "UPDATE AGENDAMENTOS SET STATUS = 'REALIZADO', UPDATED_AT = UPDATED_AT + 1 WHERE ID = ? AND STATUS = 'AGENDADO' RETURNING ID",
            [id],
            usuario
        );
        if (!foiAtualizado(reserva)) {
            return res.status(409).json({ erro: 'Este agendamento já foi realizado ou cancelado' });
        }

        let consulta;
        try {
            const { colunas, marcadores, params } = paraGravar('CONSULTAS', valores);
            consulta = await executeQueryEmpresa(
                `INSERT INTO CONSULTAS (${colunas.join(', ')}, ID_AGENDAMENTO, UPDATED_AT) ` +
                `VALUES (${marcadores.join(', ')}, ?, 1) RETURNING ID`,
                [...params, id],
                usuario
            );
        } catch (err) {
            await executeQueryEmpresa(
                "UPDATE AGENDAMENTOS SET STATUS = 'AGENDADO', UPDATED_AT = UPDATED_AT + 1 WHERE ID = ? AND STATUS = 'REALIZADO'",
                [id],
                usuario
            );
            throw err;
        }

        await InserirHistoricoInsert(usuario, 'CONSULTAS', consulta?.id);
        await InserirHistoricoRegistro(usuario, 'AGENDAMENTOS', 'UPDATE', id, {
            campo: 'STATUS', antigo: 'AGENDADO', novo: 'REALIZADO',
        });
        await cobrarSessao(usuario, consulta.id);
        await salvarAvaliacoes(req, consulta.id, metas);
        // No Google, o evento vai para o horário em que a sessão realmente aconteceu
        const google = agendamento.google_event_id ? await sincronizarAgendamento(usuario, id) : 'nao_enviado';
        res.status(201).json({ sucesso: true, id: consulta?.id, google });
    } catch(err) {
        return handleError(res, err, 'gerarConsulta');
    }
}

export async function HistoricoAgendamentos(req, res) {
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });
    try {
        if (!await historicoNoEscopo(req, 'AGENDAMENTOS', id)) return naoEncontrado(res);
        const result = await getHistorico('AGENDAMENTOS', id, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoAgendamentos');
    }
}

/* =================== Vínculos (CADASTRO_RELACAO) =================== */
// ID_ESPECIALIDADE_TERAPEUTA guarda o terapeuta (quando o cadastro é paciente)
// ou a especialidade (quando o cadastro é terapeuta)

const campoDoVinculo = tipoCadastro => tipoCadastro === 'Paciente' ? 'ID_TERAPEUTA' : 'ID_ESPECIALIDADE';

export async function carregarCadastrosRelacao(req, res) {
    const usuario = req.usuario;

    const idCadastro = paraId(req.query.idCadastro);
    if (!idCadastro) {
        return res.status(400).json({ erro: 'ID de cadastro inválido' });
    }

    try {
        if (!await cadastroNoEscopo(req, idCadastro)) return naoEncontrado(res);
        // Profissional vendo um paciente: só o vínculo do paciente com ele
        const soComigo = req.terapeuta && idCadastro !== req.terapeuta;
        const result = await executeQueryEmpresa(
            ' SELECT '+
            '    ID, '+
            '    ID_CADASTRO, '+
            '    ID_ESPECIALIDADE_TERAPEUTA '+
            ' FROM CADASTRO_RELACAO '+
            ' WHERE ID_CADASTRO = ? ' + (soComigo ? ' AND ID_ESPECIALIDADE_TERAPEUTA = ? ' : ''),
            soComigo ? [idCadastro, req.terapeuta] : [idCadastro],
            usuario
        );

        return res.status(200).json(result);

    } catch(err) {
        return handleError(res, err, 'carregarCadastrosRelacao');
    }
}

export async function HistoricoCadastrosRelacao(req, res) {
    const idCadastro = paraId(req.params.idCadastro);
    if (!idCadastro) return res.status(400).json({ erro: 'ID de cadastro inválido' });

    try {
        if (!await historicoNoEscopo(req, 'CADASTRO_RELACAO', idCadastro)) return naoEncontrado(res);
        const result = await getHistorico('CADASTRO_RELACAO', idCadastro, req.usuario);
        res.status(200).json(result);
    } catch(err) {
        return handleError(res, err, 'HistoricoCadastrosRelacao');
    }
}

export async function adicionarCadastrosRelacao(req, res) {
    const usuario = req.usuario;
    const idCadastro = paraId(req.body?.idCadastro);
    const idRelacao  = paraId(req.body?.idRelacao);

    if (!idCadastro) {
        return res.status(400).json({ erro: 'ID de cadastro inválido' });
    }

    if (!idRelacao) {
        return res.status(400).json({ erro: 'ID de relação inválido' });
    }

    try {
        if (req.terapeuta) {
            if (!await cadastroNoEscopo(req, idCadastro)) return naoEncontrado(res);
            if (idCadastro !== req.terapeuta && idRelacao !== req.terapeuta) {
                return res.status(403).json({ erro: 'Você só pode vincular pacientes a você mesmo' });
            }
        }
        const [r] = await executeQueryEmpresa(
            `SELECT
                (SELECT TIPO FROM CADASTROS WHERE ID = ? AND EXCLUIDO_EM IS NULL) TIPO_CADASTRO,
                (SELECT TIPO FROM CADASTROS WHERE ID = ? AND EXCLUIDO_EM IS NULL) TIPO_ALVO,
                (SELECT INATIVO FROM ESPECIALIDADES WHERE ID = ?) ESP_INATIVO,
                (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ? AND ID_ESPECIALIDADE_TERAPEUTA = ?) EXISTENTE
             FROM RDB$DATABASE`,
            [idCadastro, idRelacao, idRelacao, idCadastro, idRelacao],
            usuario
        );

        if (!r.tipo_cadastro) return res.status(404).json({ erro: 'Cadastro não encontrado' });
        if (r.tipo_cadastro === 'Paciente' && r.tipo_alvo !== 'Terapeuta') {
            return res.status(400).json({ erro: 'Selecione um profissional válido' });
        }
        if (r.tipo_cadastro === 'Terapeuta' && (r.esp_inativo == null || r.esp_inativo === 'S')) {
            return res.status(400).json({ erro: 'Selecione uma especialidade ativa' });
        }
        if (r.existente > 0) return res.status(409).json({ erro: 'Vínculo já existe' });

        await executeQueryEmpresa(
            'INSERT INTO CADASTRO_RELACAO (ID_CADASTRO, ID_ESPECIALIDADE_TERAPEUTA) VALUES (?, ?)',
            [idCadastro, idRelacao],
            usuario
        );

        // No histórico de vínculos o "registro" é o cadastro
        await InserirHistoricoRegistro(usuario, 'CADASTRO_RELACAO', 'INSERT', idCadastro, {
            campo: campoDoVinculo(r.tipo_cadastro), novo: idRelacao,
        });
        res.status(201).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'adicionarCadastrosRelacao');
    }
}

export async function excluirCadastrosRelacao(req, res) {
    const usuario = req.usuario;
    const idRelacao = paraId(req.params.id);
    if (!idRelacao) {
        return res.status(400).json({ erro: 'ID de relação inválido' });
    }

    try {
        const [vinculo] = await executeQueryEmpresa(
            'SELECT R.ID_CADASTRO, R.ID_ESPECIALIDADE_TERAPEUTA, C.TIPO FROM CADASTRO_RELACAO R ' +
            'LEFT JOIN CADASTROS C ON C.ID = R.ID_CADASTRO WHERE R.ID = ?',
            [idRelacao],
            usuario
        );
        if (!vinculo) return res.status(404).json({ erro: 'Vínculo não encontrado' });
        if (req.terapeuta && vinculo.id_cadastro !== req.terapeuta && vinculo.id_especialidade_terapeuta !== req.terapeuta) {
            return res.status(404).json({ erro: 'Vínculo não encontrado' });
        }

        await executeQueryEmpresa(
            'DELETE FROM CADASTRO_RELACAO WHERE ID = ?',
            [idRelacao],
            usuario
        );

        await InserirHistoricoRegistro(usuario, 'CADASTRO_RELACAO', 'DELETE', vinculo.id_cadastro, {
            campo: campoDoVinculo(vinculo.tipo), antigo: vinculo.id_especialidade_terapeuta,
        });
        res.status(200).json({ sucesso: true });
    } catch(err) {
        return handleError(res, err, 'excluirCadastrosRelacao');
    }
}

// Grava de uma vez os vínculos montados no front (terapeutas do paciente ou especialidades do terapeuta).
// Valida tudo antes de gravar; só as diferenças vão para o banco.
export async function definirVinculos(req, res) {
    const usuario = req.usuario;
    const id = paraId(req.params.id);
    const lista = req.body?.ids;
    if (!id || !Array.isArray(lista) || lista.length > 200) return res.status(400).json({ erro: 'Dados inválidos' });
    const ids = [...new Set(lista.map(paraId))];
    if (ids.some(x => !x)) return res.status(400).json({ erro: 'Dados inválidos' });

    try {
        const [cad] = await executeQueryEmpresa(
            'SELECT ID, TIPO FROM CADASTROS WHERE ID = ? AND EXCLUIDO_EM IS NULL', [id], usuario);
        if (!cad || !await cadastroNoEscopo(req, id)) return naoEncontrado(res);

        // Profissional vinculado mexendo num paciente: só o vínculo do paciente com ele
        const soComigo = req.terapeuta && id !== req.terapeuta;
        if (soComigo && ids.some(x => x !== req.terapeuta)) {
            return res.status(403).json({ erro: 'Você só pode vincular pacientes a você mesmo' });
        }

        const atuais = await executeQueryEmpresa(
            'SELECT ID, ID_ESPECIALIDADE_TERAPEUTA ALVO FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ?' +
            (soComigo ? ' AND ID_ESPECIALIDADE_TERAPEUTA = ?' : ''),
            soComigo ? [id, req.terapeuta] : [id], usuario);
        const atuaisIds = new Set(atuais.map(r => r.alvo));
        const adicionar = ids.filter(x => !atuaisIds.has(x));
        const remover = atuais.filter(r => !ids.includes(r.alvo));

        // Quem só pode incluir cadastros completa os vínculos do cadastro que acabou de criar
        if (![PERM_TOTAL, 10, 13].some(p => req.permissoes.includes(p))) {
            const [criou] = await executeQueryEmpresa(
                `SELECT FIRST 1 1 N FROM HISTORICO WHERE TABELA = 'CADASTROS' AND TIPO = 'INSERT' AND ID_REGISTRO = ?
                   AND ID_USUARIO = ? AND DTHR > DATEADD(-1 HOUR TO CURRENT_TIMESTAMP)`, [id, usuario], usuario);
            if (!criou || remover.length || atuais.length) return res.status(403).json({ erro: 'Sem permissão para alterar vínculos' });
        }

        if (adicionar.length) {
            const marcas = adicionar.map(() => '?').join(', ');
            const validos = cad.tipo === 'Paciente'
                ? await executeQueryEmpresa(
                    `SELECT ID FROM CADASTROS WHERE TIPO = 'Terapeuta' AND EXCLUIDO_EM IS NULL AND ID IN (${marcas})`, adicionar, usuario)
                : await executeQueryEmpresa(
                    `SELECT ID FROM ESPECIALIDADES WHERE INATIVO = 'N' AND ID IN (${marcas})`, adicionar, usuario);
            if (validos.length !== adicionar.length) {
                return res.status(400).json({ erro: cad.tipo === 'Paciente' ? 'Selecione profissionais válidos' : 'Selecione especialidades ativas' });
            }
        }

        const campo = campoDoVinculo(cad.tipo);
        for (const r of remover) {
            await executeQueryEmpresa('DELETE FROM CADASTRO_RELACAO WHERE ID = ?', [r.id], usuario);
            await InserirHistoricoRegistro(usuario, 'CADASTRO_RELACAO', 'DELETE', id, { campo, antigo: r.alvo });
        }
        for (const alvo of adicionar) {
            await executeQueryEmpresa(
                'INSERT INTO CADASTRO_RELACAO (ID_CADASTRO, ID_ESPECIALIDADE_TERAPEUTA) VALUES (?, ?)', [id, alvo], usuario);
            await InserirHistoricoRegistro(usuario, 'CADASTRO_RELACAO', 'INSERT', id, { campo, novo: alvo });
        }
        res.status(200).json({ sucesso: true, adicionados: adicionar.length, removidos: remover.length });
    } catch(err) {
        return handleError(res, err, 'definirVinculos');
    }
}

/* =================== Cadastros =================== */

async function regrasCadastro(usuario, valores, atual) {
    const tipo = valores.TIPO ?? atual?.tipo;
    const diagnostico = Object.hasOwn(valores, 'DIAGNOSTICO') ? valores.DIAGNOSTICO : null;
    if (tipo === 'Terapeuta' && diagnostico) return 'Diagnóstico só pode ser informado para pacientes';
    if (tipo === 'Paciente' && valores.REPASSE_PERCENTUAL != null) return 'Repasse só pode ser informado para profissionais';

    // Trocar o tipo quebraria consultas e vínculos já existentes
    if (atual && valores.TIPO && valores.TIPO !== atual.tipo) {
        const [uso] = await executeQueryEmpresa(
            `SELECT
                (SELECT COUNT(*) FROM CONSULTAS WHERE ID_PACIENTE = ? OR ID_TERAPEUTA = ?) +
                (SELECT COUNT(*) FROM AGENDAMENTOS WHERE ID_PACIENTE = ? OR ID_TERAPEUTA = ?) CONSULTAS,
                (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ? OR ID_ESPECIALIDADE_TERAPEUTA = ?) VINCULOS
             FROM RDB$DATABASE`,
            [atual.id, atual.id, atual.id, atual.id, atual.id, atual.id],
            usuario
        );
        if (uso.consultas > 0 || uso.vinculos > 0) {
            return 'Não é possível trocar o tipo de um cadastro que já tem agendamentos, consultas ou vínculos';
        }
    }
    return null;
}

// Cadastro com agendamento em aberto não pode ser excluído
async function cadastroComAgendamento(usuario, atual) {
    const [r] = await executeQueryEmpresa(
        "SELECT COUNT(*) N FROM AGENDAMENTOS WHERE STATUS = 'AGENDADO' AND (ID_PACIENTE = ? OR ID_TERAPEUTA = ?)",
        [atual.id, atual.id],
        usuario
    );
    if (r.n > 0) return 'Este cadastro tem agendamentos em aberto. Cancele-os antes de excluir.';
    // Excluir o paciente faria sumir o que ele deve (ou o que já pagou) do financeiro
    if (atual.tipo === 'Paciente' && await saldoPaciente(usuario, atual.id) !== 0) {
        return 'Este paciente tem valores em aberto no financeiro. Acerte o saldo antes de excluir.';
    }
    return null;
}

// Remove os vínculos do cadastro excluído (inclusive de pacientes com este terapeuta)
async function removerVinculosCadastro(usuario, atual) {
    await executeQueryEmpresa(
        'DELETE FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ? OR ' +
        "(ID_ESPECIALIDADE_TERAPEUTA = ? AND ID_CADASTRO IN (SELECT ID FROM CADASTROS WHERE TIPO = 'Paciente'))",
        [atual.id, atual.tipo === 'Terapeuta' ? atual.id : -1],
        usuario
    );
}

export function adicionarCadastros(req, res) {
    return inserirRegistro(req, res, 'CADASTROS', 'adicionarCadastros', {
        regrasNegocio: regrasCadastro,
        extras: [['DT_CADASTRO', 'CURRENT_DATE'], ['UPDATED_AT', '1']],
    });
}

export function alterarCadastros(req, res) {
    return atualizarRegistro(req, res, 'CADASTROS', 'alterarCadastros', regrasCadastro);
}

export function excluirCadastros(req, res) {
    return excluirRegistro(req, res, 'CADASTROS', 'excluirCadastros', {
        podeExcluir: cadastroComAgendamento,
        aposExcluir: removerVinculosCadastro,
    });
}

export async function HistoricoDeleteCadastros(req, res) {
    try {
        const result = await getHistorico('CADASTROS', null, req.usuario);
        res.status(200).json(await excluidosNoEscopo(req, 'CADASTROS', result));
    } catch(err) {
        return handleError(res, err, 'HistoricoDeleteCadastros');
    }
}

export async function HistoricoCadastros(req, res) {
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });
    try {
        if (!await historicoNoEscopo(req, 'CADASTROS', id)) return naoEncontrado(res);
        const result = await getHistorico('CADASTROS', id, req.usuario);
        await auditarLeituraHistorico(req.usuario, 'CADASTROS', id, result);
        res.status(200).json(semCamposFinanceiros(req, 'CADASTROS', result));
    } catch(err) {
        return handleError(res, err, 'HistoricoCadastros');
    }
}

export function carregarCadastroPorId(req, res) {
    return lerRegistroSensivel(req, res, 'CADASTROS',
        `SELECT ID, NOME, TELEFONE, DT_NASC, DT_CADASTRO, REGISTRO_PROFISSIONAL, TIPO, REPASSE_PERCENTUAL, ${lerCripto('CPF')}, ` +
        `${lerCripto('DIAGNOSTICO')}, UPDATED_AT FROM CADASTROS WHERE ID = ? AND EXCLUIDO_EM IS NULL`,
        'carregarCadastroPorId');
}

// Lista sem CPF e diagnóstico; esses dados só vêm no detalhe.
// Filtros: busca (nome ou telefone), tipo (Paciente | Terapeuta), sem_vinculo=1
export async function carregarCadastros(req, res) {
    const usuario = req.usuario;
    const { porPagina, offset } = paginacao(req);
    const tipo = req.query.tipo;
    if (tipo !== undefined && tipo !== 'Paciente' && tipo !== 'Terapeuta') return res.status(400).json({ erro: 'Tipo inválido' });

    const filtros = [], params = [];
    if (req.terapeuta) { const f = filtroCadastros('CADASTROS', req.terapeuta); filtros.push(f.sql); params.push(...f.params); }
    if (tipo) { filtros.push('CADASTROS.TIPO = ?'); params.push(tipo); }
    if (req.query.sem_vinculo === '1') filtros.push('NOT EXISTS (SELECT 1 FROM CADASTRO_RELACAO R WHERE R.ID_CADASTRO = CADASTROS.ID)');
    const busca = filtroBusca(req.query.busca, ['CADASTROS.NOME', 'CADASTROS.TELEFONE']);
    const origem = ` FROM CADASTROS WHERE CADASTROS.EXCLUIDO_EM IS NULL${filtros.map(f => ` AND ${f}`).join('')}${busca.sql}`;
    const todos = [...params, ...busca.params];

    try {
        const [result, [{ total }]] = await Promise.all([
            executeQueryEmpresa(
                ' SELECT FIRST ? SKIP ? '+
                '    CADASTROS.ID, '+
                '    CADASTROS.NOME, '+
                '    CADASTROS.TELEFONE, '+
                '    CADASTROS.DT_NASC, '+
                '    CADASTROS.DT_CADASTRO, '+
                '    CADASTROS.REGISTRO_PROFISSIONAL, '+
                '    CADASTROS.TIPO, '+
                '    CADASTROS.UPDATED_AT '+
                origem +
                ' ORDER BY CADASTROS.NOME, CADASTROS.ID ',
                [porPagina, offset, ...todos],
                usuario
            ),
            executeQueryEmpresa(`SELECT COUNT(*) TOTAL${origem}`, todos, usuario),
        ]);

        // Vínculos de todos os cadastros da página numa consulta só (profissional vinculado: só os que envolvem ele)
        const ids = result.map(c => c.id);
        const vinculos = ids.length ? await executeQueryEmpresa(
            `SELECT ID, ID_CADASTRO, ID_ESPECIALIDADE_TERAPEUTA FROM CADASTRO_RELACAO
             WHERE ID_CADASTRO IN (${ids.map(() => '?').join(', ')})` +
            (req.terapeuta ? ' AND (ID_CADASTRO = ? OR ID_ESPECIALIDADE_TERAPEUTA = ?)' : ''),
            [...ids, ...(req.terapeuta ? [req.terapeuta, req.terapeuta] : [])],
            usuario
        ) : [];
        const porCadastro = new Map(ids.map(i => [i, []]));
        for (const v of vinculos) porCadastro.get(v.id_cadastro)?.push(v);

        return enviarPagina(res, result.map(c => ({ ...c, vinculos: porCadastro.get(c.id) })), total);

    } catch(err) {
        return handleError(res, err, 'carregarCadastros');
    }
}

// Quantos pacientes estão sem profissional e quantos profissionais estão sem especialidade
export async function pendenciasCadastros(req, res) {
    if (req.terapeuta) return res.status(200).json({ pacientes: 0, profissionais: 0 });
    try {
        const [r] = await executeQueryEmpresa(
            `SELECT
                SUM(CASE WHEN C.TIPO = 'Paciente' THEN 1 ELSE 0 END) PACIENTES,
                SUM(CASE WHEN C.TIPO = 'Terapeuta' THEN 1 ELSE 0 END) PROFISSIONAIS
             FROM CADASTROS C
             WHERE C.EXCLUIDO_EM IS NULL AND NOT EXISTS (SELECT 1 FROM CADASTRO_RELACAO R WHERE R.ID_CADASTRO = C.ID)`,
            [], req.usuario);
        res.status(200).json({ pacientes: r?.pacientes ?? 0, profissionais: r?.profissionais ?? 0 });
    } catch(err) {
        return handleError(res, err, 'pendenciasCadastros');
    }
}

/* =================== Especialidades =================== */

async function especialidadeEmUso(usuario, atual) {
    const [uso] = await executeQueryEmpresa(
        `SELECT
            (SELECT COUNT(*) FROM CONSULTAS WHERE ID_ESPECIALIDADE = ?) +
            (SELECT COUNT(*) FROM AGENDAMENTOS WHERE ID_ESPECIALIDADE = ?) CONSULTAS,
            (SELECT COUNT(*) FROM CADASTRO_RELACAO R JOIN CADASTROS C ON C.ID = R.ID_CADASTRO
              WHERE C.TIPO = 'Terapeuta' AND R.ID_ESPECIALIDADE_TERAPEUTA = ?) VINCULOS
         FROM RDB$DATABASE`,
        [atual.id, atual.id, atual.id],
        usuario
    );
    if (uso.consultas > 0 || uso.vinculos > 0) {
        return 'Especialidade em uso por agendamentos, sessões ou profissionais. Marque como inativa em vez de excluir.';
    }
    return null;
}

export async function carregarEspecialidades(req, res) {
    const usuario = req.usuario;

    try {
        const result = await executeQueryEmpresa(
            'SELECT ID, DESCRICAO, INATIVO, ID_COR, VALOR_CENTAVOS, UPDATED_AT FROM ESPECIALIDADES ' +
            (req.terapeuta ? 'WHERE ID IN (SELECT ID_ESPECIALIDADE_TERAPEUTA FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ?)' : ''),
            req.terapeuta ? [req.terapeuta] : [],
            usuario
        );

        return res.status(200).json(semCamposFinanceiros(req, 'ESPECIALIDADES', result));
    } catch(err) {
        return handleError(res, err, 'carregarEspecialidades')
    }
}

export function adicionarEspecialidades(req, res) {
    return inserirRegistro(req, res, 'ESPECIALIDADES', 'adicionarEspecialidades', {
        extras: [['UPDATED_AT', '1']],
    });
}

export async function HistoricoDeleteEspecialidades(req, res) {
    try {
        const result = await getHistorico('ESPECIALIDADES', null, req.usuario);
        res.status(200).json(await excluidosNoEscopo(req, 'ESPECIALIDADES', result));
    } catch(err) {
        return handleError(res, err, 'HistoricoDeleteEspecialidades');
    }
}

export async function HistoricoEspecialidades(req, res) {
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });
    try {
        if (!await historicoNoEscopo(req, 'ESPECIALIDADES', id)) return naoEncontrado(res);
        const result = await getHistorico('ESPECIALIDADES', id, req.usuario);
        res.status(200).json(semCamposFinanceiros(req, 'ESPECIALIDADES', result));
    } catch(err) {
        return handleError(res, err, 'HistoricoEspecialidades');
    }
}

export function alterarEspecialidades(req, res) {
    return atualizarRegistro(req, res, 'ESPECIALIDADES', 'alterarEspecialidades');
}

export function excluirEspecialidades(req, res) {
    return excluirRegistro(req, res, 'ESPECIALIDADES', 'excluirEspecialidades', { podeExcluir: especialidadeEmUso });
}

/* =================== Relatórios =================== */

// Registro de evolução: dados das sessões para impressão (cada leitura fica auditada)
export async function relatorioEvolucao(req, res) {
    const usuario = req.usuario;
    const ids = [...new Set(String(req.query.ids ?? '').split(',').filter(Boolean).map(paraId))];

    if (ids.length === 0 || ids.includes(null)) {
        return res.status(400).json({ erro: 'Informe as sessões do relatório' });
    }
    if (ids.length > MAX_SESSOES_RELATORIO) {
        return res.status(400).json({ erro: `Selecione no máximo ${MAX_SESSOES_RELATORIO} sessões por relatório` });
    }

    try {
        const result = await executeQueryEmpresa(
            `SELECT C.ID, C.DT_HR_SESSAO DATA_HORA, C.TEMPO_SESSAO, ${lerCripto('C.RESUMO_SESSAO', 'RESUMO_SESSAO')},
                    ${lerCripto('C.EVOLUCAO', 'EVOLUCAO')},
                    P.ID ID_PACIENTE, P.NOME PACIENTE, P.DT_NASC, ${lerCripto('P.DIAGNOSTICO', 'DIAGNOSTICO')},
                    T.ID ID_TERAPEUTA, T.NOME TERAPEUTA, T.REGISTRO_PROFISSIONAL,
                    E.DESCRICAO ESPECIALIDADE
             FROM CONSULTAS C
                JOIN CADASTROS P ON P.ID = C.ID_PACIENTE
                JOIN CADASTROS T ON T.ID = C.ID_TERAPEUTA
                JOIN ESPECIALIDADES E ON E.ID = C.ID_ESPECIALIDADE
             WHERE C.ID IN (${ids.map(() => '?').join(', ')}) AND C.EXCLUIDO_EM IS NULL
             ${req.terapeuta ? 'AND C.ID_TERAPEUTA = ?' : ''}
             ORDER BY P.NOME, T.NOME, E.DESCRICAO, C.DT_HR_SESSAO`,
            req.terapeuta ? [...ids, req.terapeuta] : ids,
            usuario
        );
        if (result.length === 0) return res.status(404).json({ erro: 'Nenhuma sessão encontrada' });

        const consultas = result.map(r => descriptografarCampos('CADASTROS', descriptografarCampos('CONSULTAS', r)));

        const pacientes = [...new Set(consultas.map(c => c.id_paciente))];
        await Promise.all([
            ...consultas.map(c => InserirHistoricoRegistro(usuario, 'CONSULTAS', 'LEITURA', c.id)),
            ...pacientes.map(id => InserirHistoricoRegistro(usuario, 'CADASTROS', 'LEITURA', id)),
        ]);

        const [empresa] = await executeQueryDBPrincipal(
            'SELECT E.NOME FROM EMPRESAS E JOIN USUARIOS U ON U.EMPRESA = E.ID WHERE U.ID = ?',
            [usuario]
        );
        res.status(200).json({ empresa: empresa?.nome ?? '', consultas });
    } catch(err) {
        return handleError(res, err, 'relatorioEvolucao');
    }
}

// Logo da empresa do usuário logado. O caminho vem do banco (EMPRESAS.CAMINHO_LOGOS), nunca da requisição.
// Ao lado do arquivo podem existir variantes: <nome>.png (fundo transparente), <nome>-icone.png e <nome>-escuro.png
export async function logoEmpresa(req, res) {
    try {
        const [empresa] = await executeQueryDBPrincipal(
            'SELECT E.CAMINHO_LOGOS FROM EMPRESAS E JOIN USUARIOS U ON U.EMPRESA = E.ID WHERE U.ID = ?', [req.usuario]);
        const base = String(empresa?.caminho_logos ?? '').trim();
        const extensao = path.extname(base).toLowerCase();
        if (!base || !path.isAbsolute(base) || !EXTENSOES_LOGO.has(extensao)) {
            return res.status(404).json({ erro: 'Logo da empresa não encontrada' });
        }
        const semExtensao = base.slice(0, -extensao.length);
        const variante = { icone: '-icone', escuro: '-escuro' }[req.query.variante] ?? '';
        const arquivo = [...new Set([`${semExtensao}${variante}.png`, `${semExtensao}.png`, base])]
            .find(f => fs.existsSync(f));
        if (!arquivo) return res.status(404).json({ erro: 'Logo da empresa não encontrada' });
        // O endereço é o mesmo para todas as empresas: o navegador sempre confere com o servidor
        // (sem isso, quem trocasse de login no mesmo navegador veria a logo da outra empresa)
        res.set('Cache-Control', 'private, no-cache');
        res.vary('Authorization');
        res.sendFile(arquivo, { cacheControl: false }, err => {
            if (err && !res.headersSent) res.status(404).json({ erro: 'Logo da empresa não encontrada' });
        });
    } catch(err) {
        return handleError(res, err, 'logoEmpresa');
    }
}

/* =================== Resumo (indicadores de atendimento) =================== */
// Só números agregados: nenhum nome de paciente ou dado de saúde sai daqui

const MAX_DIAS_RESUMO = 366;

const dataTexto = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function lerData(txt) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt ?? '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 ? d : null;
}

// Segunda-feira da semana da data (as séries semanais começam na segunda)
function inicioSemana(d) {
    const s = new Date(d);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return s;
}

export async function carregarResumo(req, res) {
    const usuario = req.usuario;
    const inicio = lerData(req.query.de), fim = lerData(req.query.ate);
    const terapeutaPedido = req.query.terapeuta === undefined ? null : paraId(req.query.terapeuta);
    // Profissional vinculado vê só os próprios números
    const terapeuta = req.terapeuta ?? terapeutaPedido;

    if (!inicio || !fim || fim < inicio) return res.status(400).json({ erro: 'Período inválido' });
    const dias = Math.round((fim - inicio) / 86400000) + 1;
    if (dias > MAX_DIAS_RESUMO) return res.status(400).json({ erro: `O período pode ter no máximo ${MAX_DIAS_RESUMO} dias` });
    if (!req.terapeuta && req.query.terapeuta !== undefined && !terapeutaPedido) return res.status(400).json({ erro: 'Profissional inválido' });

    // Período anterior de mesmo tamanho, para comparação
    const fimAnterior = new Date(inicio); fimAnterior.setDate(fimAnterior.getDate() - 1);
    const inicioAnterior = new Date(fimAnterior); inicioAnterior.setDate(inicioAnterior.getDate() - dias + 1);

    // Filtros de período/profissional para CONSULTAS (C) e AGENDAMENTOS (A)
    const filtroC = (de, ate) => ({
        sql: 'C.EXCLUIDO_EM IS NULL AND C.DT_HR_SESSAO >= ? AND C.DT_HR_SESSAO < DATEADD(1 DAY TO CAST(? AS DATE))' +
             (terapeuta ? ' AND C.ID_TERAPEUTA = ?' : ''),
        params: [`${dataTexto(de)} 00:00:00`, dataTexto(ate), ...(terapeuta ? [terapeuta] : [])],
    });
    const filtroA = (de, ate) => ({
        sql: 'A.DT_HR_AGENDADA >= ? AND A.DT_HR_AGENDADA < DATEADD(1 DAY TO CAST(? AS DATE))' +
             (terapeuta ? ' AND A.ID_TERAPEUTA = ?' : ''),
        params: [`${dataTexto(de)} 00:00:00`, dataTexto(ate), ...(terapeuta ? [terapeuta] : [])],
    });
    const fc = filtroC(inicio, fim), fa = filtroA(inicio, fim);
    const fcAnt = filtroC(inicioAnterior, fimAnterior), faAnt = filtroA(inicioAnterior, fimAnterior);
    const q = (sql, params) => executeQueryEmpresa(sql, params, usuario);
    const minutos = "COALESCE(SUM(DATEDIFF(MINUTE FROM TIME '00:00:00' TO C.TEMPO_SESSAO)), 0)";

    try {
        const [
            [sessoes], status, [remarcadas], porDiaRealizadas, porDiaCanceladas,
            especialidades, profissionais, ocupacao, [sessoesAnt], [canceladasAnt],
        ] = await Promise.all([
            q(`SELECT COUNT(*) N, ${minutos} MINUTOS,
                      SUM(CASE WHEN C.ID_AGENDAMENTO IS NULL THEN 1 ELSE 0 END) AVULSAS
               FROM CONSULTAS C WHERE ${fc.sql}`, fc.params),
            q(`SELECT A.STATUS, COUNT(*) N, SUM(CASE WHEN A.DT_HR_AGENDADA < LOCALTIMESTAMP THEN 1 ELSE 0 END) PASSADOS,
                      SUM(CASE WHEN A.FALTA_JUSTIFICADA = 'S' THEN 1 ELSE 0 END) JUSTIFICADAS
               FROM AGENDAMENTOS A WHERE ${fa.sql} GROUP BY A.STATUS`, fa.params),
            q(`SELECT COUNT(DISTINCT H.ID_REGISTRO) N FROM HISTORICO H
               JOIN AGENDAMENTOS A ON A.ID = H.ID_REGISTRO
               WHERE H.TABELA = 'AGENDAMENTOS' AND H.TIPO = 'UPDATE' AND H.CAMPO = 'DT_HR_AGENDADA' AND ${fa.sql}`, fa.params),
            q(`SELECT CAST(C.DT_HR_SESSAO AS DATE) DIA, COUNT(*) N FROM CONSULTAS C WHERE ${fc.sql} GROUP BY 1`, fc.params),
            q(`SELECT CAST(A.DT_HR_AGENDADA AS DATE) DIA, COUNT(*) N FROM AGENDAMENTOS A
               WHERE A.STATUS = 'CANCELADO' AND ${fa.sql} GROUP BY 1`, fa.params),
            q(`SELECT E.ID, E.DESCRICAO, E.ID_COR,
                      (SELECT COUNT(*) FROM AGENDAMENTOS A WHERE A.ID_ESPECIALIDADE = E.ID AND ${fa.sql}) AGENDAMENTOS,
                      (SELECT COUNT(*) FROM CONSULTAS C WHERE C.ID_ESPECIALIDADE = E.ID AND ${fc.sql}) REALIZADAS
               FROM ESPECIALIDADES E`, [...fa.params, ...fc.params]),
            q(`SELECT T.ID, T.NOME,
                      (SELECT COUNT(*) FROM CONSULTAS C WHERE C.ID_TERAPEUTA = T.ID AND ${fc.sql}) REALIZADAS,
                      (SELECT ${minutos} FROM CONSULTAS C WHERE C.ID_TERAPEUTA = T.ID AND ${fc.sql}) MINUTOS,
                      (SELECT COUNT(*) FROM AGENDAMENTOS A WHERE A.ID_TERAPEUTA = T.ID AND A.STATUS = 'CANCELADO' AND ${fa.sql}) CANCELADAS,
                      (SELECT COUNT(*) FROM AGENDAMENTOS A WHERE A.ID_TERAPEUTA = T.ID AND A.STATUS = 'FALTOU' AND ${fa.sql}) FALTAS
               FROM CADASTROS T WHERE T.TIPO = 'Terapeuta'`, [...fc.params, ...fc.params, ...fa.params, ...fa.params]),
            q(`SELECT EXTRACT(WEEKDAY FROM C.DT_HR_SESSAO) DIA, EXTRACT(HOUR FROM C.DT_HR_SESSAO) HORA, COUNT(*) N
               FROM CONSULTAS C WHERE ${fc.sql} GROUP BY 1, 2`, fc.params),
            q(`SELECT COUNT(*) N FROM CONSULTAS C WHERE ${fcAnt.sql}`, fcAnt.params),
            q(`SELECT COUNT(*) N FROM AGENDAMENTOS A WHERE A.STATUS = 'CANCELADO' AND ${faAnt.sql}`, faAnt.params),
        ]);

        const porStatus = Object.fromEntries(status.map(s => [s.status, s]));
        const canceladas = porStatus.CANCELADO?.n ?? 0;
        const faltas = porStatus.FALTOU?.n ?? 0;

        // Pacientes cujas 3 últimas sessões marcadas (já passadas, não canceladas) foram faltas
        const recentes = await q(
            `SELECT A.ID_PACIENTE, P.NOME, A.STATUS FROM AGENDAMENTOS A JOIN CADASTROS P ON P.ID = A.ID_PACIENTE
             WHERE A.STATUS IN ('REALIZADO', 'FALTOU') AND A.DT_HR_AGENDADA >= DATEADD(-180 DAY TO CURRENT_DATE)
               AND P.EXCLUIDO_EM IS NULL ${terapeuta ? 'AND A.ID_TERAPEUTA = ?' : ''}
             ORDER BY A.ID_PACIENTE, A.DT_HR_AGENDADA DESC`, terapeuta ? [terapeuta] : []);
        const porPaciente = new Map();
        for (const r of recentes) {
            if (!porPaciente.has(r.id_paciente)) porPaciente.set(r.id_paciente, { id: r.id_paciente, nome: r.nome, seguidas: 0, parou: false });
            const p = porPaciente.get(r.id_paciente);
            if (p.parou) continue;
            if (r.status === 'FALTOU') p.seguidas++; else p.parou = true;
        }
        const faltasSeguidas = [...porPaciente.values()].filter(p => p.seguidas >= 3)
            .sort((a, b) => b.seguidas - a.seguidas).map(({ id, nome, seguidas }) => ({ id, nome, seguidas }));
        const agendados = porStatus.AGENDADO ?? { n: 0, passados: 0 };

        // Séries semanais (segunda a domingo), incluindo semanas sem movimento
        const semanas = new Map();
        for (let s = inicioSemana(inicio); s <= fim; s.setDate(s.getDate() + 7)) {
            semanas.set(dataTexto(s), { inicio: dataTexto(s), realizadas: 0, canceladas: 0 });
        }
        const somar = (linhas, campo) => {
            for (const l of linhas) {
                const chave = dataTexto(inicioSemana(lerData(l.dia)));
                if (semanas.has(chave)) semanas.get(chave)[campo] += l.n;
            }
        };
        somar(porDiaRealizadas, 'realizadas');
        somar(porDiaCanceladas, 'canceladas');

        res.status(200).json({
            periodo: { de: dataTexto(inicio), ate: dataTexto(fim), dias },
            totais: {
                realizadas: sessoes.n,
                minutos: sessoes.minutos,
                avulsas: sessoes.avulsas ?? 0,
                canceladas,
                faltas,
                faltasJustificadas: porStatus.FALTOU?.justificadas ?? 0,
                remarcadas: remarcadas.n,
                agendadasFuturas: agendados.n - agendados.passados,
                pendentesRegistro: agendados.passados,
            },
            anterior: { de: dataTexto(inicioAnterior), ate: dataTexto(fimAnterior), realizadas: sessoesAnt.n, canceladas: canceladasAnt.n },
            semanas: [...semanas.values()],
            especialidades: especialidades
                .filter(e => e.agendamentos > 0 || e.realizadas > 0)
                .sort((a, b) => b.agendamentos - a.agendamentos || b.realizadas - a.realizadas),
            faltasSeguidas,
            profissionais: profissionais
                .filter(p => p.realizadas > 0 || p.canceladas > 0 || p.faltas > 0)
                .sort((a, b) => b.realizadas - a.realizadas || b.minutos - a.minutos),
            ocupacao,
        });
    } catch(err) {
        return handleError(res, err, 'carregarResumo');
    }
}

// Evolução do paciente ao longo das sessões (avaliação de 1 a 5 dada pelo profissional).
// Dado de saúde: leitura auditada; profissional vinculado vê só as sessões dele.
export async function evolucaoPaciente(req, res) {
    const id = paraId(req.params.id);
    const inicio = lerData(req.query.de), fim = lerData(req.query.ate);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });
    if (!inicio || !fim || fim < inicio) return res.status(400).json({ erro: 'Período inválido' });

    try {
        const [paciente] = await executeQueryEmpresa(
            "SELECT ID, NOME FROM CADASTROS WHERE ID = ? AND TIPO = 'Paciente' AND EXCLUIDO_EM IS NULL", [id], req.usuario);
        if (!paciente || !await cadastroNoEscopo(req, id)) return res.status(404).json({ erro: 'Paciente não encontrado' });

        const linhas = await executeQueryEmpresa(
            `SELECT C.ID, C.DT_HR_SESSAO DATA_HORA, C.ID_ESPECIALIDADE, E.DESCRICAO ESPECIALIDADE, T.NOME TERAPEUTA,
                    ${lerCripto('C.EVOLUCAO', 'EVOLUCAO')}
             FROM CONSULTAS C
                JOIN ESPECIALIDADES E ON E.ID = C.ID_ESPECIALIDADE
                JOIN CADASTROS T ON T.ID = C.ID_TERAPEUTA
             WHERE C.ID_PACIENTE = ? AND C.EXCLUIDO_EM IS NULL
               AND C.DT_HR_SESSAO >= ? AND C.DT_HR_SESSAO < DATEADD(1 DAY TO CAST(? AS DATE))
               ${req.terapeuta ? 'AND C.ID_TERAPEUTA = ?' : ''}
             ORDER BY C.DT_HR_SESSAO`,
            [id, `${dataTexto(inicio)} 00:00:00`, dataTexto(fim), ...(req.terapeuta ? [req.terapeuta] : [])],
            req.usuario
        );

        const sessoes = linhas.map(l => {
            const r = descriptografarCampos('CONSULTAS', l);
            const nota = parseInt(r.evolucao, 10);
            return {
                id: r.id, data_hora: r.data_hora, id_especialidade: r.id_especialidade,
                especialidade: r.especialidade, terapeuta: r.terapeuta,
                evolucao: nota >= 1 && nota <= 5 ? nota : null,
            };
        });

        const metas = await metasDoPeriodo(req, id, dataTexto(inicio), dataTexto(fim));
        await InserirHistoricoRegistro(req.usuario, 'CADASTROS', 'LEITURA', id);
        res.status(200).json({ paciente: { id: paciente.id, nome: paciente.nome }, sessoes, metas });
    } catch(err) {
        return handleError(res, err, 'evolucaoPaciente');
    }
}

// Nome da empresa do usuário logado (identidade visual do cliente)
export async function dadosEmpresa(req, res) {
    try {
        const [empresa] = await executeQueryDBPrincipal(
            'SELECT E.ID, E.NOME FROM EMPRESAS E JOIN USUARIOS U ON U.EMPRESA = E.ID WHERE U.ID = ?',
            [req.usuario]
        );
        if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada' });
        res.status(200).json({ id: empresa.id, nome: empresa.nome });
    } catch(err) {
        return handleError(res, err, 'dadosEmpresa');
    }
}

/* =================== Histórico =================== */

async function excluidosNoEscopo(req, tabela, linhas) {
    const t = req.terapeuta;
    if (!t) return linhas;
    let ids = [];
    if (tabela === 'CONSULTAS') {
        ids = await executeQueryEmpresa('SELECT ID FROM CONSULTAS WHERE ID_TERAPEUTA = ?', [t], req.usuario);
    } else if (tabela === 'CADASTROS') {
        const f = filtroCadastros('C', t);
        ids = await executeQueryEmpresa(`SELECT C.ID FROM CADASTROS C WHERE ${f.sql}`, f.params, req.usuario);
    }
    const permitidos = new Set(ids.map(r => r.id));
    return linhas.filter(l => permitidos.has(l.id_registro));
}

// Histórico que mostra dado sensível (CPF, diagnóstico, resumo, evolução) conta como leitura (LGPD)
async function auditarLeituraHistorico(usuario, tabela, id, linhas) {
    const cripto = CAMPOS_CRIPTOGRAFADOS[tabela];
    if (cripto && linhas.some(l => cripto.has(String(l.campo || '').toUpperCase()))) {
        await InserirHistoricoRegistro(usuario, tabela, 'LEITURA', id);
    }
}

export async function getHistorico(tabela, id_registro, id_usuario) {
    let result;
    if (!id_registro) {
        result = await executeQueryEmpresa(
            "SELECT VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, NOME_USUARIO, TIPO, ID_REGISTRO FROM HISTORICO " +
            "WHERE TABELA = ? AND TIPO = 'DELETE' ORDER BY DTHR DESC",
            [tabela], id_usuario
        );
    } else if (tabela === 'PERMISSOES_USUARIOS' || tabela === 'CADASTRO_RELACAO') {
        result = await executeQueryEmpresa(
            "SELECT VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, NOME_USUARIO, TIPO, ID_REGISTRO FROM HISTORICO " +
            "WHERE TABELA = ? AND ID_REGISTRO = ? ORDER BY DTHR DESC",
            [tabela, id_registro], id_usuario
        );
    } else {
        result = await executeQueryEmpresa(
            "SELECT VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, NOME_USUARIO, TIPO, ID_REGISTRO FROM HISTORICO " +
            "WHERE TABELA = ? AND ID_REGISTRO = ? AND TIPO IN ('UPDATE', 'INSERT') ORDER BY DTHR DESC",
            [tabela, id_registro], id_usuario
        );
    }

    const resolved = await Promise.all(result.map(row => resolverBlobsHistorico(row)));

    // Usuários ficam no banco principal; busca os nomes dos usuários da mesma empresa
    const usuarios = await executeQueryDBPrincipal(
        'SELECT ID, NOME, MASTER FROM USUARIOS WHERE EMPRESA = (SELECT EMPRESA FROM USUARIOS U WHERE U.ID = ?)',
        [id_usuario]
    );
    const nomes = new Map(usuarios.map(u => [u.id, u.nome]));
    const masters = new Set(usuarios.filter(u => u.master === 1).map(u => u.id));

    const camposCripto = CAMPOS_CRIPTOGRAFADOS[tabela] ?? new Set();

    return resolved.map(row => {
        // Ações do master aparecem sem identificá-lo; e o master nunca aparece como alvo de um registro
        const linha = masters.has(row.id_usuario)
            ? { ...row, id_usuario: null, nome_usuario: 'Administração Vindix' }
            : { ...row, nome_usuario: nomes.get(row.id_usuario) ?? row.nome_usuario };
        if (!camposCripto.has((row.campo||'').toUpperCase())) return linha;
        return {
            ...linha,
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
    // Registros antigos gravaram VALOR_ANTIGO em texto puro
    if (!isEncrypted(valor)) return valor;
    try { return decrypt(valor); } catch { return null; }
}

// Banco da empresa de cada usuário: toda consulta ao banco da empresa precisa dele, então fica
// guardado por pouco tempo (sem isso, cada consulta fazia outra no banco principal antes)
const EMPRESA_CACHE_MS = 60 * 1000;
const empresaPorUsuario = new Map();
export async function getEmpresa(codUsuario) {
    if (!codUsuario) {
        throw new Error('Usuário não informado');
    }
    const guardado = empresaPorUsuario.get(codUsuario);
    if (guardado && guardado.expira > Date.now()) return guardado.result;

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
        throw new Error('Nenhuma empresa encontrada para este usuário');
    }

    if (empresaPorUsuario.size > 5000) empresaPorUsuario.clear();
    empresaPorUsuario.set(codUsuario, { result, expira: Date.now() + EMPRESA_CACHE_MS });
    return result;
}
