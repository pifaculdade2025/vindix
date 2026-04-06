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

const poolPrincipal = firebird.pool(5, {   
    host: HOST_BD,
    port: PORT_BD,
    database: CAMINHO_BD_PRINC,
    user: USER_BD,
    password: SENHA_BD,
    lowercase_keys: true,
    pageSize: 4096
});

function criarOptions(caminhoBanco) {
  return { 
    host: HOST_BD,
    port: PORT_BD,
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

export {executeQueryDBPrincipal, executeQueryEmpresa}