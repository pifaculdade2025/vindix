import express from "express";
import cors from "cors";
import rateLimit from 'express-rate-limit';
import { autenticarToken, exigirPermissao } from "./auth.js"
import * as funcoes from "./funcoes.js";
import * as agenda from './agenda.js';
import helmet from 'helmet';
import { tooBusyCheck } from "./too-busy.js";
import slowDown from 'express-slow-down';

if (!process.env.ALLOWED_ORIGINS) {
    throw new Error("ALLOWED_ORIGINS não definido");
}
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');

const loginSlow = slowDown({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  delayAfter: 3,              // começa a atrasar após 3 tentativas
  delayMs: (hits) => (hits - 3) * 500,  // +500ms por tentativa acima de 3
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 10,                    // máximo 10 tentativas
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em 15 minutos.' }
});

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origem não permitida'));
    }
  },
  credentials: true
}));
app.use(helmet());
app.use(tooBusyCheck);
const globalLimiter = rateLimit({ windowMs: 60000, max: 300 });
app.use(globalLimiter);

app.listen(8080);

//ver se o servidor está vivo
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

//login
app.post('/login', loginSlow, loginLimiter, funcoes.validarLogin);

//usuarios
app.get('/usuarios', autenticarToken, exigirPermissao(1, 2), funcoes.carregarUsuarios);
app.post('/usuarios', autenticarToken, exigirPermissao(1, 2), funcoes.cadastrarUsuario);
app.put('/usuarios/senha', autenticarToken, exigirPermissao(1, 2), funcoes.alterarSenha);

//consultas
app.get('/consultas', autenticarToken, exigirPermissao(1, 20, 21), funcoes.carregarConsultas);

//Google Agenda
app.get('/google/conectar', autenticarToken, exigirPermissao(1), agenda.conectarGoogle);
app.get('/google/status', autenticarToken, exigirPermissao(1), agenda.statusGoogle);
app.get('/google/callback', agenda.callbackGoogle); 
app.post('/google/evento',  autenticarToken, exigirPermissao(1), agenda.criarEventoGoogle);
app.delete('/google/conectar', autenticarToken, exigirPermissao(1), agenda.desconectarGoogle);

/*
Permissões:
ID|TABELA        |TIPO   |
--+--------------+-------+
 1|GERAL         |GERAL  |
 2|USUARIOS      |GERAL  |
10|CADASTRO      |GERAL  |
11|CADASTRO      |ACESSAR|
12|CADASTRO      |INSERIR|
13|CADASTRO      |ALTERAR|
14|CADASTRO      |EXCLUIR|
20|CONSULTAS     |GERAL  |
21|CONSULTAS     |ACESSAR|
22|CONSULTAS     |INSERIR|
23|CONSULTAS     |ALTERAR|
24|CONSULTAS     |EXCLUIR|
30|ESPECIALIDADES|GERAL  |
31|ESPECIALIDADES|ACESSAR|
32|ESPECIALIDADES|INSERIR|
33|ESPECIALIDADES|ALTERAR|
34|ESPECIALIDADES|EXCLUIR|
*/