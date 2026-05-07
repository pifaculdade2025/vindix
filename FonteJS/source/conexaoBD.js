import firebird from "node-firebird";
import { LRUCache } from 'lru-cache';
import * as funcoes from "./funcoes.js";
import 'dotenv/config';
import {decrypt, encrypt} from "./cripto.js";

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

const CAMPOS_CRIPTOGRAFADOS = {
    CADASTROS: new Set(['CPF', 'DIAGNOSTICO']),
    CONSULTAS:  new Set(['RESUMO_SESSAO']),
};

const poolPrincipal = firebird.pool(5, {   
    host: HOST_BD,
    port: parseInt(PORT_BD, 10),
    database: CAMINHO_BD_PRINC,
    user: USER_BD,
    password: SENHA_BD,
    lowercase_keys: true,
    pageSize: 4096,
    WireCrypt: 'Disabled'
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
    pageSize: 4096,
    WireCrypt: 'Disabled'
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

function executeQueryDBPrincipal(sSQL, params) {
    const queryPromise = new Promise((resolve, reject) => {
        poolPrincipal.get((err, db) => {
            if (err) return reject(err);

            db.query(sSQL, params, (err, result) => {
                db.detach();
                if (err) reject(err);
                else resolve(result);
            });
        });
    });
    return comTimeout(queryPromise, 15000, 'DBPrincipal');
}

async function executeQueryEmpresa(sSQL, params, usuario) {
    const result = await funcoes.getEmpresa(usuario);

    if (!result[0].caminho_bd) {
        throw new Error('Caminho do banco não encontrado');
    }

    const caminhoBD = decrypt(result[0].caminho_bd);
    const poolEmpresa = getPoolEmpresa(caminhoBD);

    const queryPromise = new Promise((resolve, reject) => {
        poolEmpresa.get((err, db) => {
            if (err) return reject(err);

            db.query(sSQL, params, (err, queryResult) => {
                db.detach();
                if (err) reject(err);
                else resolve(queryResult);
            });
        });
    });
    return comTimeout(queryPromise, 15000, 'DBEmpresa');
}

async function InserirHistorico(id_usuario, tabela, id_registro, campos_novos) {
    const [atual] = await executeQueryEmpresa(
        `SELECT * FROM ${tabela} WHERE ID = ?`,
        [id_registro],
        id_usuario
    );

    if (!atual) return;

    const camposCripto = CAMPOS_CRIPTOGRAFADOS[tabela] ?? new Set();
    

    for (const [campo, vlNovo] of Object.entries(campos_novos)) {
        const campoUpper = campo.toUpperCase();
        if (campoUpper === 'UPDATED_AT') continue;

        const vlAntigoBruto = atual[campo.toLowerCase()] ?? atual[campoUpper] ?? atual[campo];

        // Normaliza valor para comparação — trata Date, number e string uniformemente
        function normalizar(v) {
            if (v == null) return '';
            if (v instanceof Date) return v.toISOString().slice(0, 10); // só a data
            return String(v).trim();
        }

        // Descriptografa antigo para comparar
        let vlAntigoPlain;
        try {
            vlAntigoPlain = camposCripto.has(campoUpper) && vlAntigoBruto
                ? decrypt(vlAntigoBruto)
                : vlAntigoBruto;
        } catch {
            vlAntigoPlain = vlAntigoBruto;
        }

        const antigoCmp = normalizar(vlAntigoPlain);
        const novoCmp   = normalizar(vlNovo);

        if (antigoCmp === novoCmp) continue;

        // Grava antigo: já criptografado vem do banco, novo: criptografa se necessário
        const vlNovoGravar = camposCripto.has(campoUpper) && vlNovo != null
            ? encrypt(String(vlNovo))
            : (vlNovo instanceof Date ? vlNovo.toISOString().slice(0,10) : vlNovo);

        // Valor antigo para gravar: descriptografado em plaintext, normalizado
        const vlAntigoGravar = vlAntigoPlain instanceof Date
            ? vlAntigoPlain.toISOString().slice(0,10)
            : vlAntigoPlain;
            
        await executeQueryEmpresa(
            `INSERT INTO HISTORICO (TABELA, VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, TIPO, ID_REGISTRO) 
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'UPDATE', ?)`,
            [tabela, String(vlNovoGravar ?? ''), String(vlAntigoGravar ?? ''), campoUpper, id_usuario, parseInt(id_registro, 10)],
            id_usuario
        );
    }
}

async function InserirHistoricoInsert(id_usuario, tabela) {  
    await executeInsertHistorico(
        `INSERT INTO HISTORICO (TABELA, DTHR, ID_USUARIO, TIPO, ID_REGISTRO) 
        VALUES (?, CURRENT_TIMESTAMP, ?, 'INSERT', (SELECT GEN_ID(GEN_${tabela}_ID, 0) FROM RDB$DATABASE))`,
        [tabela, id_usuario],
        id_usuario
    );
}

async function InserirHistoricoDelete(id_usuario, tabela, id_registro) {
    const CAMPOS_RESUMO = {
        CADASTROS:           ['NOME', 'TIPO', 'TELEFONE'],
        CONSULTAS:           ['ID_PACIENTE', 'ID_TERAPEUTA', 'DT_HR_SESSAO', 'ID_ESPECIALIDADE'],
        ESPECIALIDADES:      ['DESCRICAO', 'INATIVO'],
        PERMISSOES_USUARIOS: ['ID_USUARIO', 'ID_PERMISSAO'],
        CADASTRO_RELACAO:    ['ID_CADASTRO', 'ID_ESPECIALIDADE_TERAPEUTA'],
    };

    const camposCripto = CAMPOS_CRIPTOGRAFADOS[tabela] ?? new Set();
    const campos = CAMPOS_RESUMO[tabela] ?? [];
    let valorAntigo = null;

    try {
        const [atual] = await executeQueryEmpresa(
            `SELECT * FROM ${tabela} WHERE ID = ?`,
            [id_registro],
            id_usuario
        );

        if (atual && campos.length) {
            const partes = [];
            for (const campo of campos) {
                // node-firebird retorna lowercase
                let valor = atual[campo.toLowerCase()] ?? atual[campo];
                if (valor == null) continue;
                if (valor instanceof Date) valor = valor.toISOString().slice(0, 10);
                try {
                    if (camposCripto.has(campo) && valor) valor = decrypt(String(valor));
                } catch { valor = ''; }
                partes.push(`${campo}: ${valor}`);
            }
            if (partes.length) valorAntigo = partes.join('\n');
        }
    } catch { /* grava sem dados se falhar */ }

    await executeInsertHistorico(
        "INSERT INTO HISTORICO (TABELA, VALOR_ANTIGO, DTHR, ID_USUARIO, TIPO, ID_REGISTRO) " +
        "VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'DELETE', ?)",
        [tabela, valorAntigo, id_usuario, id_registro],
        id_usuario
    );
}

export {executeQueryDBPrincipal, executeQueryEmpresa, InserirHistorico, InserirHistoricoInsert, InserirHistoricoDelete}