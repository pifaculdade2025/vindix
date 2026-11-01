import firebird from "node-firebird";
import { LRUCache } from 'lru-cache';
import * as funcoes from "./funcoes.js";
import 'dotenv/config';
import {decrypt, encrypt} from "./cripto.js";
import { CAMPOS_CRIPTOGRAFADOS, TABELAS_EXCLUSAO_LOGICA, lerCripto } from "./regras.js";

const CAMINHO_BD_PRINC = process.env.CAMINHO_BD_PRINC;
if (!CAMINHO_BD_PRINC) {
    throw new Error("CAMINHO_BD_PRINC não definido");
}
const HOST_BD  = process.env.HOST_BD;
if (!HOST_BD) {
    throw new Error("HOST_BD não definido");
}
const PORT_BD  = process.env.PORT_BD;
if (!PORT_BD) {
    throw new Error("PORT_BD não definido"); 
}
const USER_BD  = process.env.USER_BD;
if (!USER_BD) {
    throw new Error("USER_BD não definido");
}
const SENHA_BD  = process.env.SENHA_BD;
if (!SENHA_BD) {
    throw new Error("SENHA_BD não definido");
}

// Parâmetro string direto em coluna BLOB dessincroniza a conexão no node-firebird
// (o INSERT parece funcionar mas não é gravado); o CAST evita o envio como BLOB
// OCTETS: até 32765 bytes sem conversão de charset (o resumo criptografado chega a 32700)
const SQL_TEXTO_BLOB = 'CAST(? AS VARCHAR(32765) CHARACTER SET OCTETS)';

const poolPrincipal = firebird.pool(5, {   
    host: HOST_BD,
    port: parseInt(PORT_BD, 10),
    database: CAMINHO_BD_PRINC,
    user: USER_BD,
    password: SENHA_BD,
    lowercase_keys: true,
    pageSize: 4096
});

function criarOptions(caminhoBanco) {
  return { 
    host: HOST_BD,
    port: parseInt(PORT_BD, 10),
    database: caminhoBanco, 
    user: USER_BD,
    password: SENHA_BD,
    lowercase_keys: true,
    role: null,
    pageSize: 4096
  }
}

const poolsEmpresa = new LRUCache({
  max: 50,  
  dispose: (pool, key) => {
    pool.destroy(); 
  },
  ttl: 1000 * 60 * 30 
});

function comTimeout(promise, ms = 15000, contexto = '') {
    const timeout = new Promise((_, reject) =>
        setTimeout(
            () => reject(new Error(`Query timeout após ${ms}ms [${contexto}]`)),
            ms
        )
    );
    return Promise.race([promise, timeout]);
}

function getPoolEmpresa(caminhoBD) {
    if (!poolsEmpresa.has(caminhoBD)) {
        const pool = firebird.pool(5, criarOptions(caminhoBD));
        poolsEmpresa.set(caminhoBD, pool);
    }
    return poolsEmpresa.get(caminhoBD);
}

const GDS_LOGIN_FALHOU = 335544472;

// O SRP do node-firebird falha em ~10% dos logins mesmo com a senha correta
// ("Your user name and password are not defined"); basta tentar de novo
function obterConexao(pool, tentativas = 5) {
    return new Promise((resolve, reject) => {
        pool.get((err, db) => {
            if (!err) return resolve(db);
            if (err.gdscode === GDS_LOGIN_FALHOU && tentativas > 1) {
                return obterConexao(pool, tentativas - 1).then(resolve, reject);
            }
            reject(err);
        });
    });
}

const pad2 = n => String(n).padStart(2, '0');

// Tipos SQL do Firebird (bit 1 = nullable)
const FORMATO_POR_TIPO_SQL = { 570: 'data', 560: 'hora', 510: 'datahora' };

// node-firebird devolve DATE/TIME/TIMESTAMP como Date em horário local (TIME vem em 01/01/1970).
// Datas do banco não têm fuso, então viram texto local para não serem convertidas para UTC no JSON.
function formatarDataLocal(d, formato) {
    const data = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const hora = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    if (formato === 'hora') return hora;
    if (formato === 'data') return data;
    return `${data}T${hora}`;
}

// Datas viram texto local e colunas OCTETS (Buffer) viram texto UTF8
function normalizarResultado(result, meta) {
    if (!result || !Array.isArray(meta)) return result;

    const colunas = meta
        .map(col => ({ chave: col.alias?.toLowerCase(), formato: FORMATO_POR_TIPO_SQL[col.type & ~1] }))
        .filter(col => col.chave);

    const linhas = Array.isArray(result) ? result : [result];
    for (const linha of linhas) {
        for (const { chave, formato } of colunas) {
            const valor = linha[chave];
            if (valor instanceof Date && formato) linha[chave] = formatarDataLocal(valor, formato);
            else if (Buffer.isBuffer(valor)) linha[chave] = valor.toString('utf8');
        }
    }
    return result;
}

function executarNoPool(pool, sSQL, params) {
    return obterConexao(pool).then(db => new Promise((resolve, reject) => {
        db.query(sSQL, params, (err, result, meta) => {
            db.detach();
            if (err) reject(err);
            else resolve(normalizarResultado(result, meta));
        });
    }));
}

function executeQueryDBPrincipal(sSQL, params) {
    const queryPromise = executarNoPool(poolPrincipal, sSQL, params);
    return comTimeout(queryPromise, 15000, 'DBPrincipal');
}

async function executeQueryEmpresa(sSQL, params, usuario) {
    const result = await funcoes.getEmpresa(usuario);

    if (!result[0].caminho_bd) {
        throw new Error('Caminho do banco não encontrado');
    }

    const caminhoBD = decrypt(result[0].caminho_bd);
    const poolEmpresa = getPoolEmpresa(caminhoBD);

    const queryPromise = executarNoPool(poolEmpresa, sSQL, params);
    return comTimeout(queryPromise, 15000, 'DBEmpresa');
}

// Deixa data/hora num formato único para comparar e gravar no histórico:
// "2026-10-30T14:00" / "2026-10-30 14:00:00" -> "2026-10-30 14:00:00", "01:00" -> "01:00:00"
function normalizarValor(v) {
    if (v == null) return '';
    const s = String(v).trim();
    let m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?(\.\d+)?$/);
    if (m) return `${m[1]} ${m[2]}${m[3] ?? ':00'}`;
    m = s.match(/^(\d{2}:\d{2})(:\d{2})?$/);
    if (m) return `${m[1]}${m[2] ?? ':00'}`;
    return s;
}

// Lê campo BLOB, que o node-firebird retorna como função
function lerBlob(valor) {
    if (typeof valor !== 'function') return Promise.resolve(valor);
    return new Promise(resolve => {
        valor((err, _name, e) => {
            if (err) return resolve(null);
            const chunks = [];
            e.on('data', d => chunks.push(d));
            e.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            e.on('error', () => resolve(null));
        });
    });
}

// Colunas de cada tabela (a estrutura é a mesma em todas as empresas)
const colunasPorTabela = new Map();
async function colunasDaTabela(id_usuario, tabela) {
    if (!colunasPorTabela.has(tabela)) {
        const result = await executeQueryEmpresa(
            'SELECT TRIM(RDB$FIELD_NAME) COLUNA FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = ? ORDER BY RDB$FIELD_POSITION',
            [tabela],
            id_usuario
        );
        colunasPorTabela.set(tabela, result.map(r => r.coluna));
    }
    return colunasPorTabela.get(tabela);
}

// Registro atual (ignora os excluídos logicamente); tabela vem sempre do código, nunca do usuário
async function BuscarRegistroAtual(id_usuario, tabela, id_registro) {
    const cripto = CAMPOS_CRIPTOGRAFADOS[tabela] ?? new Set();
    const colunas = (await colunasDaTabela(id_usuario, tabela)).map(c => cripto.has(c) ? lerCripto(c) : c);
    const filtroExcluido = TABELAS_EXCLUSAO_LOGICA.has(tabela) ? ' AND EXCLUIDO_EM IS NULL' : '';
    const [atual] = await executeQueryEmpresa(
        `SELECT ${colunas.join(', ')} FROM ${tabela} WHERE ID = ?${filtroExcluido}`,
        [id_registro],
        id_usuario
    );
    if (!atual) return null;

    for (const chave of Object.keys(atual)) {
        atual[chave] = await lerBlob(atual[chave]);
    }
    return atual;
}

// Deve ser chamada DEPOIS do UPDATE ter dado certo, com o registro lido ANTES do UPDATE
async function InserirHistorico(id_usuario, tabela, id_registro, campos_novos, atual) {
    if (!atual) return;

    const camposCripto = CAMPOS_CRIPTOGRAFADOS[tabela] ?? new Set();

    try {
        for (const [campo, vlNovo] of Object.entries(campos_novos)) {
            const campoUpper = campo.toUpperCase();
            if (campoUpper === 'UPDATED_AT') continue;

            const vlAntigoBruto = atual[campo.toLowerCase()] ?? atual[campoUpper] ?? atual[campo];
            const cripto = camposCripto.has(campoUpper);

            // Descriptografa antigo para comparar
            let vlAntigoPlain = vlAntigoBruto;
            if (cripto && vlAntigoBruto) {
                try { vlAntigoPlain = decrypt(String(vlAntigoBruto)); } catch { /* valor legado sem criptografia */ }
            }

            const antigo = normalizarValor(vlAntigoPlain);
            const novo   = normalizarValor(vlNovo);
            if (antigo === novo) continue;

            // Campos sensíveis são gravados criptografados nos dois lados
            const vlNovoGravar   = cripto && novo   ? encrypt(novo)   : novo;
            const vlAntigoGravar = cripto && antigo ? encrypt(antigo) : antigo;

            await executeQueryEmpresa(
                `INSERT INTO HISTORICO (TABELA, VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, TIPO, ID_REGISTRO) 
                 VALUES (?, ${SQL_TEXTO_BLOB}, ${SQL_TEXTO_BLOB}, CURRENT_TIMESTAMP, ?, ?, 'UPDATE', ?)`,
                [tabela, vlNovoGravar, vlAntigoGravar, campoUpper, id_usuario, parseInt(id_registro, 10)],
                id_usuario
            );
        }
    } catch (err) {
        // O UPDATE já foi feito; não devolve erro ao usuário por falha no histórico
        console.error(`[InserirHistorico] ${tabela} #${id_registro}:`, err);
    }
}

// Grava uma linha de histórico; tipo: INSERT, UPDATE, DELETE ou LEITURA
async function InserirHistoricoRegistro(id_usuario, tabela, tipo, id_registro, { campo = null, antigo = null, novo = null } = {}) {
    try {
        await executeQueryEmpresa(
            `INSERT INTO HISTORICO (TABELA, VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, TIPO, ID_REGISTRO) 
             VALUES (?, ${SQL_TEXTO_BLOB}, ${SQL_TEXTO_BLOB}, CURRENT_TIMESTAMP, ?, ?, ?, ?)`,
            [tabela, novo == null ? null : String(novo), antigo == null ? null : String(antigo),
             campo, id_usuario, tipo, id_registro ?? null],
            id_usuario
        );
    } catch (err) {
        // A ação principal já foi feita; não devolve erro ao usuário por falha no histórico
        console.error(`[InserirHistoricoRegistro] ${tipo} ${tabela} #${id_registro}:`, err);
    }
}

function InserirHistoricoInsert(id_usuario, tabela, id_registro) {
    return InserirHistoricoRegistro(id_usuario, tabela, 'INSERT', id_registro);
}

// Deve ser chamada DEPOIS da exclusão, com o registro lido ANTES dela
async function InserirHistoricoDelete(id_usuario, tabela, id_registro, atual) {
    // Só o necessário para identificar o registro (sem telefone, CPF ou dados de saúde)
    const CAMPOS_RESUMO = {
        CADASTROS:      ['NOME', 'TIPO'],
        CONSULTAS:      ['ID_PACIENTE', 'ID_TERAPEUTA', 'DT_HR_SESSAO', 'ID_ESPECIALIDADE'],
        ESPECIALIDADES: ['DESCRICAO', 'INATIVO'],
    };

    const partes = [];
    for (const campo of CAMPOS_RESUMO[tabela] ?? []) {
        // node-firebird retorna lowercase
        const valor = atual?.[campo.toLowerCase()];
        if (valor != null) partes.push(`${campo}: ${normalizarValor(valor)}`);
    }

    await InserirHistoricoRegistro(id_usuario, tabela, 'DELETE', id_registro, {
        antigo: partes.length ? partes.join('\n') : null,
    });
}

export {executeQueryDBPrincipal, executeQueryEmpresa, BuscarRegistroAtual, InserirHistorico, InserirHistoricoRegistro, InserirHistoricoInsert, InserirHistoricoDelete}
