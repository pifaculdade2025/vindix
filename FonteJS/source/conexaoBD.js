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

async function InserirHistorico(id_usuario, tabela, id_registro, campos_novos, tipo = 'UPDATE') {
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

        const vlAntigoBruto = atual[campoUpper] ?? atual[campo];

        // Descriptografa antigo para comparar em plaintext
        let vlAntigoPlain;
        try {
            vlAntigoPlain = camposCripto.has(campoUpper) && vlAntigoBruto
                ? decrypt(vlAntigoBruto)
                : vlAntigoBruto;
        } catch {
            vlAntigoPlain = vlAntigoBruto;
        }

        // Converte ambos para string para comparar (resolve diferença de tipos)
        const antigoCmp = vlAntigoPlain == null ? '' : String(vlAntigoPlain).trim();
        const novoCmp   = vlNovo        == null ? '' : String(vlNovo).trim();

        if (antigoCmp === novoCmp) continue;

        // Grava: antigo já criptografado (como está no banco), novo criptografa se necessário
        const vlNovoGravar = camposCripto.has(campoUpper) && vlNovo != null
            ? encrypt(String(vlNovo))
            : vlNovo;

        await executeQueryEmpresa(
            'INSERT INTO HISTORICO (TABELA, VALOR_NOVO, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, TIPO, ID_REGISTRO) ' +
            'VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)',
            [tabela, vlNovoGravar, vlAntigoBruto, campoUpper, id_usuario, tipo, id_registro],
            id_usuario
        );
    }
}

async function InserirHistoricoInsert(id_usuario, tabela) {  
    await executeQueryEmpresa(
        `INSERT INTO HISTORICO (TABELA, DTHR, ID_USUARIO, TIPO, ID_REGISTRO) 
        VALUES (?, CURRENT_TIMESTAMP, ?, 'INSERT', (SELECT GEN_ID(GEN_${tabela}_ID, 0) FROM RDB$DATABASE))`,
        [tabela, id_usuario],
        id_usuario
    );
}

async function InserirHistoricoDelete(id_usuario, tabela, id_registro) {
    // Campos principais de cada tabela para exibir no histórico de delete
    const CAMPOS_RESUMO = {
        CADASTROS:           ['NOME', 'TIPO', 'TELEFONE', 'CPF'],
        CONSULTAS:           ['ID_PACIENTE', 'ID_TERAPEUTA', 'ID_ESPECIALIDADE', 'DT_HR_SESSAO'],
        ESPECIALIDADES:      ['DESCRICAO', 'INATIVO'],
        PERMISSOES_USUARIOS: ['ID_USUARIO', 'ID_PERMISSAO'],
        CADASTRO_RELACAO:    ['ID_CADASTRO', 'ID_ESPECIALIDADE_TERAPEUTA'],
    };

    const camposCripto = CAMPOS_CRIPTOGRAFADOS[tabela] ?? new Set();
    const campos = CAMPOS_RESUMO[tabela] ?? [];

    try {
        const [atual] = await executeQueryEmpresa(
            `SELECT * FROM ${tabela} WHERE ID = ?`,
            [id_registro],
            id_usuario
        );

        if (atual && campos.length) {
            for (const campo of campos) {
                const vlBruto = atual[campo.toUpperCase()] ?? atual[campo];
                if (vlBruto == null) continue;

                // Descriptografa para gravar legível no histórico de delete
                let vlLegivel;
                try {
                    vlLegivel = camposCripto.has(campo.toUpperCase()) && vlBruto
                        ? decrypt(vlBruto)
                        : String(vlBruto ?? '');
                } catch {
                    vlLegivel = String(vlBruto ?? '');
                }

                await executeQueryEmpresa(
                    'INSERT INTO HISTORICO (TABELA, VALOR_ANTIGO, DTHR, CAMPO, ID_USUARIO, TIPO, ID_REGISTRO) ' +
                    'VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, \'DELETE\', ?)',
                    [tabela, vlLegivel, campo, id_usuario, id_registro],
                    id_usuario
                );
            }
            return;
        }
    } catch {
        // Se não conseguir ler, grava apenas o evento de delete sem dados
    }

    // Fallback — grava só o evento
    await executeQueryEmpresa(
        `INSERT INTO HISTORICO (TABELA, DTHR, ID_USUARIO, TIPO, ID_REGISTRO) 
         VALUES (?, CURRENT_TIMESTAMP, ?, 'DELETE', ?)`,
        [tabela, id_usuario, id_registro],
        id_usuario
    );
}

export {executeQueryDBPrincipal, executeQueryEmpresa, InserirHistorico, InserirHistoricoInsert, InserirHistoricoDelete}