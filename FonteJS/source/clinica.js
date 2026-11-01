// Gestão da clínica: financeiro (pacotes, pagamentos e repasses), plano terapêutico (metas) e lista de espera.
// Mesmas regras do resto do sistema: validação em regras.js, escopo do profissional, histórico e
// criptografia dos dados de saúde (descrição e nota das metas).
import { executeQueryDBPrincipal, executeQueryEmpresa, InserirHistoricoRegistro } from './conexaoBD.js';
import { decrypt, encrypt, isEncrypted } from './cripto.js';
import { paraId, lerCripto } from './regras.js';
import {
    handleError, getEmpresa, naoEncontrado, paginacao, filtroBusca, enviarPagina, PARAM_CRIPTO, foiAtualizado,
    inserirRegistro, atualizarRegistro, excluirRegistro, cadastroNoEscopo, especialidadeNoEscopo,
} from './funcoes.js';

const q = (req, sql, params = []) => executeQueryEmpresa(sql, params, req.usuario);
const texto = v => (isEncrypted(v) ? decrypt(v) : v);
const notaValida = n => Number.isInteger(n) && n >= 1 && n <= 5;

// Paciente (e especialidade/profissional, quando informados) existem e estão ativos
async function validarAtendimento(usuario, { paciente, especialidade, terapeuta, especialidadeAtiva = true }) {
    const [r] = await executeQueryEmpresa(
        `SELECT
            (SELECT TIPO FROM CADASTROS WHERE ID = ? AND EXCLUIDO_EM IS NULL) TIPO_PACIENTE,
            (SELECT INATIVO FROM ESPECIALIDADES WHERE ID = ?) ESP_INATIVO,
            (SELECT TIPO FROM CADASTROS WHERE ID = ? AND EXCLUIDO_EM IS NULL) TIPO_TERAPEUTA
         FROM RDB$DATABASE`,
        [paciente ?? 0, especialidade ?? 0, terapeuta ?? 0], usuario);
    if (paciente && r.tipo_paciente !== 'Paciente') return 'Paciente inválido';
    if (especialidade && r.esp_inativo == null) return 'Especialidade inválida';
    if (especialidade && especialidadeAtiva && r.esp_inativo === 'S') return 'Especialidade inativa';
    if (terapeuta && r.tipo_terapeuta !== 'Terapeuta') return 'Profissional inválido';
    return null;
}

/* ============================================================================ Escopo do profissional */

// Meta: paciente dele e (meta criada por ele ou numa especialidade que ele atende)
export async function metaNoEscopo(req, meta) {
    const t = req.terapeuta;
    if (!t) return true;
    if (!await cadastroNoEscopo(req, meta.id_paciente)) return false;
    return meta.id_terapeuta === t || especialidadeNoEscopo(req, meta.id_especialidade);
}

// Lista de espera: direcionada a ele, ou sem profissional numa especialidade que ele atende
export async function esperaNoEscopo(req, item) {
    const t = req.terapeuta;
    if (!t) return true;
    if (item.id_terapeuta) return item.id_terapeuta === t;
    return especialidadeNoEscopo(req, item.id_especialidade);
}

// Filtro SQL equivalente ao esperaNoEscopo (alias da tabela LISTA_ESPERA)
const filtroEspera = (a, t) => ({
    sql: ` AND (${a}.ID_TERAPEUTA = ? OR (${a}.ID_TERAPEUTA IS NULL AND EXISTS (SELECT 1 FROM CADASTRO_RELACAO R
              WHERE R.ID_CADASTRO = ? AND R.ID_ESPECIALIDADE_TERAPEUTA = ${a}.ID_ESPECIALIDADE)))`,
    params: [t, t],
});
// Filtro SQL de metas visíveis para o profissional (alias da tabela METAS)
const filtroMetas = (a, t) => ({
    sql: ` AND (${a}.ID_TERAPEUTA = ? OR EXISTS (SELECT 1 FROM CADASTRO_RELACAO R
              WHERE R.ID_CADASTRO = ? AND R.ID_ESPECIALIDADE_TERAPEUTA = ${a}.ID_ESPECIALIDADE))`,
    params: [t, t],
});

/* ============================================================================ Plano terapêutico (metas) */

async function regrasMeta(usuario, valores, atual) {
    if (atual) {
        const mudou = c => Object.hasOwn(valores, c) && valores[c] !== atual[c.toLowerCase()];
        if (mudou('ID_PACIENTE') || mudou('ID_ESPECIALIDADE')) return 'Paciente e especialidade da meta não podem ser trocados';
        return null;
    }
    return validarAtendimento(usuario, { paciente: valores.ID_PACIENTE, especialidade: valores.ID_ESPECIALIDADE });
}

export function adicionarMeta(req, res) {
    return inserirRegistro(req, res, 'METAS', 'adicionarMeta', {
        regrasNegocio: regrasMeta,
        // Meta criada por um profissional fica em nome dele
        extras: [['ID_TERAPEUTA', '?', req.terapeuta ?? null], ['CRIADO_POR', '?', req.usuario], ['UPDATED_AT', '1']],
    });
}
export function alterarMeta(req, res) {
    return atualizarRegistro(req, res, 'METAS', 'alterarMeta', regrasMeta);
}
export function excluirMeta(req, res) {
    return excluirRegistro(req, res, 'METAS', 'excluirMeta');
}

// Metas ativas de um paciente numa especialidade (para avaliar na sessão). Leitura auditada (dado de saúde)
export async function metasDaSessao(req, idPaciente, idEspecialidade, idConsulta = null) {
    const f = req.terapeuta ? filtroMetas('M', req.terapeuta) : { sql: '', params: [] };
    const linhas = await q(req,
        `SELECT M.ID, ${lerCripto('M.DESCRICAO', 'DESCRICAO')}, M.STATUS,
                (SELECT FIRST 1 ${lerCripto('A.NOTA', 'NOTA')} FROM AVALIACOES_META A WHERE A.ID_META = M.ID AND A.ID_CONSULTA = ?) NOTA
         FROM METAS M
         WHERE M.ID_PACIENTE = ? AND M.ID_ESPECIALIDADE = ? AND M.EXCLUIDO_EM IS NULL
           AND (M.STATUS = 'ATIVA' OR EXISTS (SELECT 1 FROM AVALIACOES_META A2 WHERE A2.ID_META = M.ID AND A2.ID_CONSULTA = ?))${f.sql}
         ORDER BY M.ID`,
        [idConsulta ?? 0, idPaciente, idEspecialidade, idConsulta ?? 0, ...f.params]);
    return linhas.map(m => {
        const nota = parseInt(texto(m.nota), 10);
        return { id: m.id, descricao: texto(m.descricao), status: m.status, nota: notaValida(nota) ? nota : null };
    });
}

export async function listarMetasSessao(req, res) {
    const paciente = paraId(req.query.paciente), especialidade = paraId(req.query.especialidade);
    if (!paciente || !especialidade) return res.status(400).json({ erro: 'Informe paciente e especialidade' });
    try {
        if (!await cadastroNoEscopo(req, paciente)) return naoEncontrado(res);
        const metas = await metasDaSessao(req, paciente, especialidade);
        if (metas.length) await InserirHistoricoRegistro(req.usuario, 'CADASTROS', 'LEITURA', paciente);
        res.status(200).json(metas);
    } catch (err) {
        return handleError(res, err, 'listarMetasSessao');
    }
}

// Metas do paciente com as avaliações no período (gráfico de evolução por meta)
export async function metasDoPeriodo(req, idPaciente, de, ate) {
    const f = req.terapeuta ? filtroMetas('M', req.terapeuta) : { sql: '', params: [] };
    const metas = await q(req,
        `SELECT M.ID, M.ID_ESPECIALIDADE, E.DESCRICAO ESPECIALIDADE, ${lerCripto('M.DESCRICAO', 'DESCRICAO')}, M.STATUS,
                M.DT_INICIO, M.UPDATED_AT
         FROM METAS M JOIN ESPECIALIDADES E ON E.ID = M.ID_ESPECIALIDADE
         WHERE M.ID_PACIENTE = ? AND M.EXCLUIDO_EM IS NULL${f.sql}
         ORDER BY M.STATUS, M.ID`, [idPaciente, ...f.params]);
    if (!metas.length) return [];
    const avaliacoes = await q(req,
        `SELECT A.ID_META, C.DT_HR_SESSAO DATA_HORA, ${lerCripto('A.NOTA', 'NOTA')}
         FROM AVALIACOES_META A JOIN CONSULTAS C ON C.ID = A.ID_CONSULTA
         WHERE A.ID_META IN (${metas.map(() => '?').join(', ')}) AND C.EXCLUIDO_EM IS NULL
           AND C.DT_HR_SESSAO >= ? AND C.DT_HR_SESSAO < DATEADD(1 DAY TO CAST(? AS DATE))
           ${req.terapeuta ? 'AND C.ID_TERAPEUTA = ?' : ''}
         ORDER BY C.DT_HR_SESSAO`,
        [...metas.map(m => m.id), `${de} 00:00:00`, ate, ...(req.terapeuta ? [req.terapeuta] : [])]);
    return metas.map(m => ({
        id: m.id, id_especialidade: m.id_especialidade, especialidade: m.especialidade,
        descricao: texto(m.descricao), status: m.status, dt_inicio: m.dt_inicio, updated_at: m.updated_at,
        avaliacoes: avaliacoes.filter(a => a.id_meta === m.id)
            .map(a => ({ data_hora: a.data_hora, nota: parseInt(texto(a.nota), 10) }))
            .filter(a => notaValida(a.nota)),
    }));
}

// Avaliações de metas enviadas junto com a sessão: [{ id, nota }] (nota null = sem avaliação)
export async function validarAvaliacoes(req, idPaciente, metas) {
    if (metas === undefined) return null;
    if (!Array.isArray(metas) || metas.length > 50) return 'Avaliações das metas inválidas';
    const ids = metas.map(m => paraId(m?.id));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) return 'Avaliações das metas inválidas';
    if (metas.some(m => m.nota !== null && !notaValida(m.nota))) return 'A avaliação da meta vai de 1 a 5';
    if (!ids.length) return null;
    const linhas = await q(req,
        `SELECT ID, ID_PACIENTE, ID_ESPECIALIDADE, ID_TERAPEUTA, STATUS FROM METAS
         WHERE ID IN (${ids.map(() => '?').join(', ')}) AND EXCLUIDO_EM IS NULL`, ids);
    if (linhas.length !== ids.length || linhas.some(m => m.id_paciente !== idPaciente)) return 'Meta não encontrada para este paciente';
    for (const m of linhas) if (!await metaNoEscopo(req, m)) return 'Meta não encontrada para este paciente';
    return null;
}

export async function salvarAvaliacoes(req, idConsulta, metas) {
    if (!Array.isArray(metas)) return;
    for (const { id, nota } of metas) {
        const idMeta = paraId(id);
        if (nota === null) {
            await q(req, 'DELETE FROM AVALIACOES_META WHERE ID_META = ? AND ID_CONSULTA = ?', [idMeta, idConsulta]);
            continue;
        }
        const r = await q(req, `UPDATE AVALIACOES_META SET NOTA = ${PARAM_CRIPTO} WHERE ID_META = ? AND ID_CONSULTA = ? RETURNING ID`,
            [encrypt(String(nota)), idMeta, idConsulta]);
        if (!foiAtualizado(r)) {
            await q(req, `INSERT INTO AVALIACOES_META (ID_META, ID_CONSULTA, NOTA) VALUES (?, ?, ${PARAM_CRIPTO})`,
                [idMeta, idConsulta, encrypt(String(nota))]);
        }
    }
}

/* ============================================================================ Financeiro */

// Sessão registrada: desconta do pacote mais antigo com saldo (da especialidade ou de qualquer uma);
// sem pacote, fica cobrada pelo valor atual da especialidade (fixado no registro)
// Operações que mexem no saldo de um paciente rodam uma de cada vez (o servidor é um processo só):
// sem isso, duas sessões simultâneas poderiam usar a última vaga do mesmo pacote, ou dois
// pagamentos ao mesmo tempo passariam juntos da conferência do saldo em aberto
// Uma fila por empresa: o lançamento de uma clínica não espera pelo de outra
const filasFinanceiro = new Map();
export async function exclusivoFinanceiro(usuario, fn) {
    const [{ empresa }] = await getEmpresa(usuario);
    const anterior = filasFinanceiro.get(empresa) ?? Promise.resolve();
    const vez = anterior.then(fn, fn);
    const fim = vez.catch(() => {});
    filasFinanceiro.set(empresa, fim);
    fim.then(() => { if (filasFinanceiro.get(empresa) === fim) filasFinanceiro.delete(empresa); });
    return vez;
}

export function cobrarSessao(usuario, idConsulta) {
    return exclusivoFinanceiro(usuario, async () => {
        const [c] = await executeQueryEmpresa('SELECT ID_PACIENTE, ID_ESPECIALIDADE FROM CONSULTAS WHERE ID = ?', [idConsulta], usuario);
        if (!c) return;
        // A sessão sai do pacote atual (se tinha) antes de procurar o pacote com vaga
        await executeQueryEmpresa('UPDATE CONSULTAS SET ID_PACOTE = NULL WHERE ID = ?', [idConsulta], usuario);
        const [pacote] = await executeQueryEmpresa(
            `SELECT FIRST 1 P.ID FROM PACOTES P
             WHERE P.ID_PACIENTE = ? AND P.EXCLUIDO_EM IS NULL AND (P.ID_ESPECIALIDADE IS NULL OR P.ID_ESPECIALIDADE = ?)
               AND P.QTD_SESSOES > (SELECT COUNT(*) FROM CONSULTAS X WHERE X.ID_PACOTE = P.ID AND X.EXCLUIDO_EM IS NULL)
             ORDER BY P.DT_COMPRA, P.ID`, [c.id_paciente, c.id_especialidade], usuario);
        if (pacote) {
            await executeQueryEmpresa('UPDATE CONSULTAS SET ID_PACOTE = ?, VALOR_CENTAVOS = 0 WHERE ID = ?', [pacote.id, idConsulta], usuario);
        } else {
            await executeQueryEmpresa(
                'UPDATE CONSULTAS SET VALOR_CENTAVOS = COALESCE((SELECT VALOR_CENTAVOS FROM ESPECIALIDADES WHERE ID = ?), 0) WHERE ID = ?',
                [c.id_especialidade, idConsulta], usuario);
        }
    });
}

// Saldo de cada paciente: (sessões avulsas + pacotes) - pagamentos. Positivo = paciente deve à clínica
const SQL_SALDOS = `
    SELECT P.ID, P.NOME,
        (SELECT COALESCE(SUM(C.VALOR_CENTAVOS), 0) FROM CONSULTAS C
          WHERE C.ID_PACIENTE = P.ID AND C.EXCLUIDO_EM IS NULL AND C.ID_PACOTE IS NULL) SESSOES,
        (SELECT COALESCE(SUM(K.VALOR_CENTAVOS), 0) FROM PACOTES K WHERE K.ID_PACIENTE = P.ID AND K.EXCLUIDO_EM IS NULL) PACOTES,
        (SELECT COALESCE(SUM(G.VALOR_CENTAVOS), 0) FROM PAGAMENTOS G WHERE G.ID_PACIENTE = P.ID AND G.EXCLUIDO_EM IS NULL) PAGO,
        (SELECT COALESCE(SUM(K.QTD_SESSOES), 0) FROM PACOTES K WHERE K.ID_PACIENTE = P.ID AND K.EXCLUIDO_EM IS NULL) -
        (SELECT COUNT(*) FROM CONSULTAS X JOIN PACOTES K ON K.ID = X.ID_PACOTE
          WHERE K.ID_PACIENTE = P.ID AND K.EXCLUIDO_EM IS NULL AND X.EXCLUIDO_EM IS NULL) SESSOES_PACOTE
    FROM CADASTROS P
    WHERE P.TIPO = 'Paciente' AND P.EXCLUIDO_EM IS NULL`;

// Saldo em aberto do paciente, em centavos (positivo = deve à clínica)
export async function saldoPaciente(usuario, idPaciente) {
    const [r] = await executeQueryEmpresa(
        `SELECT X.SESSOES + X.PACOTES - X.PAGO SALDO FROM (${SQL_SALDOS} AND P.ID = ?) X`, [idPaciente], usuario);
    return Number(r?.saldo ?? 0);
}
const brl = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function financeiroPacientes(req, res) {
    const { porPagina, offset } = paginacao(req);
    const busca = filtroBusca(req.query.busca, ['X.NOME']);
    const soAberto = req.query.situacao === 'aberto';
    // Só quem tem movimento financeiro (sessão cobrada, pacote ou pagamento)
    const origem = ` FROM (${SQL_SALDOS}) X WHERE (X.SESSOES > 0 OR X.PACOTES > 0 OR X.PAGO > 0)` +
        (soAberto ? ' AND X.SESSOES + X.PACOTES - X.PAGO > 0' : '') + busca.sql;
    try {
        const [linhas, [{ total }]] = await Promise.all([
            q(req, `SELECT FIRST ? SKIP ? X.*, X.SESSOES + X.PACOTES - X.PAGO SALDO${origem} ORDER BY X.NOME, X.ID`,
                [porPagina, offset, ...busca.params]),
            q(req, `SELECT COUNT(*) TOTAL${origem}`, busca.params),
        ]);
        return enviarPagina(res, linhas, total);
    } catch (err) {
        return handleError(res, err, 'financeiroPacientes');
    }
}

export async function extratoPaciente(req, res) {
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });
    try {
        const [saldo] = await q(req, `SELECT X.*, X.SESSOES + X.PACOTES - X.PAGO SALDO FROM (${SQL_SALDOS} AND P.ID = ?) X`, [id]);
        if (!saldo) return naoEncontrado(res);
        const pacotes = await q(req,
            `SELECT K.ID, K.ID_ESPECIALIDADE, E.DESCRICAO ESPECIALIDADE, K.QTD_SESSOES, K.VALOR_CENTAVOS, K.DT_COMPRA, K.OBS,
                    (SELECT COUNT(*) FROM CONSULTAS X WHERE X.ID_PACOTE = K.ID AND X.EXCLUIDO_EM IS NULL) USADAS
             FROM PACOTES K LEFT JOIN ESPECIALIDADES E ON E.ID = K.ID_ESPECIALIDADE
             WHERE K.ID_PACIENTE = ? AND K.EXCLUIDO_EM IS NULL ORDER BY K.DT_COMPRA DESC, K.ID DESC`, [id]);
        const pagamentos = await q(req,
            `SELECT ID, VALOR_CENTAVOS, DT_PAGAMENTO, FORMA, REFERENTE FROM PAGAMENTOS
             WHERE ID_PACIENTE = ? AND EXCLUIDO_EM IS NULL ORDER BY DT_PAGAMENTO DESC, ID DESC`, [id]);
        const sessoes = await q(req,
            `SELECT FIRST 100 C.ID, C.DT_HR_SESSAO DATA_HORA, E.DESCRICAO ESPECIALIDADE, T.NOME TERAPEUTA, C.VALOR_CENTAVOS, C.ID_PACOTE
             FROM CONSULTAS C JOIN ESPECIALIDADES E ON E.ID = C.ID_ESPECIALIDADE JOIN CADASTROS T ON T.ID = C.ID_TERAPEUTA
             WHERE C.ID_PACIENTE = ? AND C.EXCLUIDO_EM IS NULL AND (C.ID_PACOTE IS NOT NULL OR C.VALOR_CENTAVOS > 0)
             ORDER BY C.DT_HR_SESSAO DESC`, [id]);
        res.status(200).json({ paciente: { id: saldo.id, nome: saldo.nome }, saldo, pacotes, pagamentos, sessoes });
    } catch (err) {
        return handleError(res, err, 'extratoPaciente');
    }
}

async function regrasPacote(usuario, valores) {
    return validarAtendimento(usuario, { paciente: valores.ID_PACIENTE, especialidade: valores.ID_ESPECIALIDADE, especialidadeAtiva: true });
}
export function adicionarPacote(req, res) {
    return inserirRegistro(req, res, 'PACOTES', 'adicionarPacote', {
        regrasNegocio: regrasPacote, extras: [['CRIADO_POR', '?', req.usuario], ['UPDATED_AT', '1']],
    });
}
export function excluirPacote(req, res) {
    return exclusivoFinanceiro(req.usuario, () => excluirRegistro(req, res, 'PACOTES', 'excluirPacote', {
        podeExcluir: async (usuario, atual) => {
            const [r] = await executeQueryEmpresa('SELECT COUNT(*) N FROM CONSULTAS WHERE ID_PACOTE = ? AND EXCLUIDO_EM IS NULL', [atual.id], usuario);
            if (r.n > 0) return 'Este pacote já tem sessões usadas e não pode ser excluído';
            // Sem o pacote, o que já foi pago não pode passar do que o paciente deve
            if (await saldoPaciente(usuario, atual.id_paciente) - atual.valor_centavos < 0) {
                return 'Este pacote já foi pago. Exclua antes o pagamento correspondente';
            }
            return null;
        },
    }));
}

// Pagamento não pode passar do saldo em aberto (o paciente nunca fica com saldo negativo)
export function adicionarPagamento(req, res) {
    return exclusivoFinanceiro(req.usuario, () => inserirRegistro(req, res, 'PAGAMENTOS', 'adicionarPagamento', {
        regrasNegocio: async (usuario, valores) => {
            const erro = await validarAtendimento(usuario, { paciente: valores.ID_PACIENTE });
            if (erro) return erro;
            const aberto = await saldoPaciente(usuario, valores.ID_PACIENTE);
            if (aberto <= 0) return 'Este paciente não tem valores em aberto';
            if (valores.VALOR_CENTAVOS > aberto) return `O valor passa do saldo em aberto (${brl(aberto)})`;
            return null;
        },
        extras: [['CRIADO_POR', '?', req.usuario], ['UPDATED_AT', '1']],
    }));
}
export function excluirPagamento(req, res) {
    return exclusivoFinanceiro(req.usuario, () => excluirRegistro(req, res, 'PAGAMENTOS', 'excluirPagamento'));
}

// Sessão cobrada só sai (excluída, ou trocada de paciente/especialidade) se o saldo do paciente
// continuar sem crédito; senão o pagamento dela precisa ser ajustado antes
export async function conferirSaidaSessao(usuario, consulta) {
    const [c] = await executeQueryEmpresa(
        'SELECT ID_PACIENTE, ID_PACOTE, VALOR_CENTAVOS FROM CONSULTAS WHERE ID = ?', [consulta.id], usuario);
    if (!c || c.id_pacote || !(c.valor_centavos > 0)) return null;
    if (await saldoPaciente(usuario, c.id_paciente) - c.valor_centavos < 0) {
        return 'Esta sessão já foi paga. Peça para o financeiro excluir o pagamento dela antes';
    }
    return null;
}

// Dados do recibo de um pagamento (o front monta o documento para impressão)
export async function reciboPagamento(req, res) {
    const id = paraId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido' });
    try {
        const [p] = await q(req,
            `SELECT G.ID, G.VALOR_CENTAVOS, G.DT_PAGAMENTO, G.FORMA, G.REFERENTE, P.NOME PACIENTE
             FROM PAGAMENTOS G JOIN CADASTROS P ON P.ID = G.ID_PACIENTE WHERE G.ID = ? AND G.EXCLUIDO_EM IS NULL`, [id]);
        if (!p) return naoEncontrado(res);
        const [empresa] = await executeQueryDBPrincipal(
            'SELECT E.NOME FROM EMPRESAS E JOIN USUARIOS U ON U.EMPRESA = E.ID WHERE U.ID = ?', [req.usuario]);
        res.status(200).json({ ...p, empresa: empresa?.nome ?? '' });
    } catch (err) {
        return handleError(res, err, 'reciboPagamento');
    }
}

// Repasse do mês: cada sessão realizada vale o valor cobrado (ou a parte do pacote); o profissional
// recebe o percentual do cadastro dele. Profissional vinculado vê só o próprio repasse.
export async function repasses(req, res) {
    const m = /^(\d{4})-(\d{2})$/.exec(req.query.mes ?? '');
    if (!m || +m[2] < 1 || +m[2] > 12) return res.status(400).json({ erro: 'Mês inválido' });
    try {
        const linhas = await q(req,
            `SELECT T.ID, T.NOME, T.REPASSE_PERCENTUAL, COUNT(C.ID) SESSOES,
                    COALESCE(SUM(CASE WHEN C.ID_PACOTE IS NULL THEN COALESCE(C.VALOR_CENTAVOS, 0)
                                      ELSE K.VALOR_CENTAVOS / K.QTD_SESSOES END), 0) GERADO
             FROM CONSULTAS C
                JOIN CADASTROS T ON T.ID = C.ID_TERAPEUTA
                LEFT JOIN PACOTES K ON K.ID = C.ID_PACOTE
             WHERE C.EXCLUIDO_EM IS NULL AND C.DT_HR_SESSAO >= ? AND C.DT_HR_SESSAO < DATEADD(1 MONTH TO CAST(? AS DATE))
               ${req.terapeuta ? 'AND C.ID_TERAPEUTA = ?' : ''}
             GROUP BY T.ID, T.NOME, T.REPASSE_PERCENTUAL ORDER BY T.NOME`,
            [`${m[1]}-${m[2]}-01 00:00:00`, `${m[1]}-${m[2]}-01`, ...(req.terapeuta ? [req.terapeuta] : [])]);
        res.status(200).json(linhas.map(l => ({
            ...l, repasse: Math.round(Number(l.gerado) * (l.repasse_percentual ?? 0) / 100),
        })));
    } catch (err) {
        return handleError(res, err, 'repasses');
    }
}

/* ============================================================================ Lista de espera */

// Mesmas regras de vínculo do agendamento. Sem profissional escolhido ("qualquer um"), a especialidade
// precisa ser atendida por algum profissional do paciente. Paciente sem vínculos aceita qualquer combinação.
async function vinculosEspera(usuario, { ID_PACIENTE: paciente, ID_ESPECIALIDADE: esp, ID_TERAPEUTA: terapeuta }) {
    const [r] = await executeQueryEmpresa(
        `SELECT
            (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ?) TERAPEUTAS_DO_PACIENTE,
            (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ? AND ID_ESPECIALIDADE_TERAPEUTA = ?) PACIENTE_VINCULADO,
            (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ?) ESPS_DO_TERAPEUTA,
            (SELECT COUNT(*) FROM CADASTRO_RELACAO WHERE ID_CADASTRO = ? AND ID_ESPECIALIDADE_TERAPEUTA = ?) TERAPEUTA_ATENDE,
            (SELECT COUNT(*) FROM CADASTRO_RELACAO P WHERE P.ID_CADASTRO = ?
               AND (NOT EXISTS (SELECT 1 FROM CADASTRO_RELACAO T WHERE T.ID_CADASTRO = P.ID_ESPECIALIDADE_TERAPEUTA)
                    OR EXISTS (SELECT 1 FROM CADASTRO_RELACAO T WHERE T.ID_CADASTRO = P.ID_ESPECIALIDADE_TERAPEUTA AND T.ID_ESPECIALIDADE_TERAPEUTA = ?))) ALGUEM_ATENDE
         FROM RDB$DATABASE`,
        [paciente, paciente, terapeuta ?? 0, terapeuta ?? 0, terapeuta ?? 0, esp, paciente, esp], usuario);
    if (terapeuta) {
        if (r.esps_do_terapeuta > 0 && r.terapeuta_atende === 0) return 'O profissional não atende esta especialidade';
        if (r.terapeutas_do_paciente > 0 && r.paciente_vinculado === 0) return 'O paciente não está vinculado a este profissional';
    } else if (r.terapeutas_do_paciente > 0 && r.alguem_atende === 0) {
        return 'Nenhum profissional do paciente atende esta especialidade';
    }
    return null;
}

async function regrasEspera(usuario, valores) {
    const erro = await validarAtendimento(usuario, { paciente: valores.ID_PACIENTE, especialidade: valores.ID_ESPECIALIDADE, terapeuta: valores.ID_TERAPEUTA })
        ?? await vinculosEspera(usuario, valores);
    if (erro) return erro;
    const [r] = await executeQueryEmpresa(
        "SELECT COUNT(*) N FROM LISTA_ESPERA WHERE ID_PACIENTE = ? AND ID_ESPECIALIDADE = ? AND STATUS = 'AGUARDANDO'",
        [valores.ID_PACIENTE, valores.ID_ESPECIALIDADE], usuario);
    return r.n > 0 ? 'Este paciente já está na lista de espera desta especialidade' : null;
}

export function adicionarEspera(req, res) {
    return inserirRegistro(req, res, 'LISTA_ESPERA', 'adicionarEspera', {
        regrasNegocio: regrasEspera,
        extras: [['STATUS', "'AGUARDANDO'"], ['CRIADO_POR', '?', req.usuario], ['UPDATED_AT', '1']],
    });
}

export async function listarEspera(req, res) {
    const { porPagina, offset } = paginacao(req);
    const especialidade = req.query.especialidade === undefined ? null : paraId(req.query.especialidade);
    if (req.query.especialidade !== undefined && !especialidade) return res.status(400).json({ erro: 'Especialidade inválida' });
    const filtros = [" AND L.STATUS = 'AGUARDANDO'"], params = [];
    if (especialidade) { filtros.push(' AND L.ID_ESPECIALIDADE = ?'); params.push(especialidade); }
    if (req.terapeuta) { const f = filtroEspera('L', req.terapeuta); filtros.push(f.sql); params.push(...f.params); }
    const busca = filtroBusca(req.query.busca, ['P.NOME']);
    const origem = ` FROM LISTA_ESPERA L
        JOIN CADASTROS P ON P.ID = L.ID_PACIENTE
        JOIN ESPECIALIDADES E ON E.ID = L.ID_ESPECIALIDADE
        LEFT JOIN CADASTROS T ON T.ID = L.ID_TERAPEUTA
        WHERE P.EXCLUIDO_EM IS NULL${filtros.join('')}${busca.sql}`;
    const todos = [...params, ...busca.params];
    try {
        const [linhas, [{ total }]] = await Promise.all([
            q(req, `SELECT FIRST ? SKIP ? L.ID, L.ID_PACIENTE, P.NOME PACIENTE, L.ID_ESPECIALIDADE, E.DESCRICAO ESPECIALIDADE,
                           L.ID_TERAPEUTA, T.NOME TERAPEUTA, L.PREFERENCIA, L.DT_ENTRADA, L.UPDATED_AT,
                           DATEDIFF(DAY FROM L.DT_ENTRADA TO LOCALTIMESTAMP) DIAS
                    ${origem} ORDER BY L.DT_ENTRADA, L.ID`, [porPagina, offset, ...todos]),
            q(req, `SELECT COUNT(*) TOTAL${origem}`, todos),
        ]);
        return enviarPagina(res, linhas, total);
    } catch (err) {
        return handleError(res, err, 'listarEspera');
    }
}

// Quantos aguardam numa especialidade (sugestão ao liberar um horário)
export async function contarEspera(req, res) {
    const especialidade = paraId(req.query.especialidade);
    if (!especialidade) return res.status(400).json({ erro: 'Especialidade inválida' });
    const f = req.terapeuta ? filtroEspera('L', req.terapeuta) : { sql: '', params: [] };
    try {
        const [r] = await q(req,
            `SELECT COUNT(*) N FROM LISTA_ESPERA L JOIN CADASTROS P ON P.ID = L.ID_PACIENTE
             WHERE L.STATUS = 'AGUARDANDO' AND P.EXCLUIDO_EM IS NULL AND L.ID_ESPECIALIDADE = ?${f.sql}`,
            [especialidade, ...f.params]);
        res.status(200).json({ aguardando: r.n });
    } catch (err) {
        return handleError(res, err, 'contarEspera');
    }
}

// Sai da lista: agendado (com o agendamento criado para ele) ou desistiu
export async function alterarStatusEspera(req, res) {
    const id = paraId(req.params.id);
    const { status } = req.body ?? {};
    const idAgendamento = req.body?.idAgendamento === undefined ? null : paraId(req.body.idAgendamento);
    if (!id || !['AGENDADO', 'DESISTIU'].includes(status)) return res.status(400).json({ erro: 'Dados inválidos' });
    if (status === 'AGENDADO' && !idAgendamento) return res.status(400).json({ erro: 'Informe o agendamento' });
    try {
        const [item] = await q(req, 'SELECT ID, ID_PACIENTE, ID_ESPECIALIDADE, ID_TERAPEUTA, STATUS FROM LISTA_ESPERA WHERE ID = ?', [id]);
        if (!item || !await esperaNoEscopo(req, item)) return naoEncontrado(res);
        if (item.status !== 'AGUARDANDO') return res.status(409).json({ erro: 'Este paciente já saiu da lista de espera' });
        if (idAgendamento) {
            const [ag] = await q(req, 'SELECT ID_PACIENTE, ID_TERAPEUTA FROM AGENDAMENTOS WHERE ID = ?', [idAgendamento]);
            if (!ag || ag.id_paciente !== item.id_paciente || (req.terapeuta && ag.id_terapeuta !== req.terapeuta)) {
                return res.status(400).json({ erro: 'Agendamento inválido para este paciente' });
            }
        }
        await q(req, "UPDATE LISTA_ESPERA SET STATUS = ?, ID_AGENDAMENTO = ?, UPDATED_AT = UPDATED_AT + 1 WHERE ID = ? AND STATUS = 'AGUARDANDO'",
            [status, idAgendamento, id]);
        await InserirHistoricoRegistro(req.usuario, 'LISTA_ESPERA', 'UPDATE', id, { campo: 'STATUS', antigo: 'AGUARDANDO', novo: status });
        res.status(200).json({ sucesso: true });
    } catch (err) {
        return handleError(res, err, 'alterarStatusEspera');
    }
}
