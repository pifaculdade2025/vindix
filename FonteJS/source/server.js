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
  windowMs: 5 * 60 * 1000,  // 5 minutos
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
const globalLimiter = rateLimit({ windowMs: 60000, max: 60 });
app.use(globalLimiter);

app.listen(8080, (err) => {
  if (err) { 
    console.error('Falha ao iniciar servidor', err); 
    process.exit(1); 
  }
  console.log('Servidor rodando na porta 8080');
});

//ver se o servidor está vivo
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

//login
app.post('/login', loginSlow, loginLimiter, funcoes.validarLogin);

//usuarios
app.get('/usuarios', autenticarToken, exigirPermissao(1, 2), funcoes.carregarUsuarios);
app.post('/usuarios', autenticarToken, exigirPermissao(1, 2), funcoes.cadastrarUsuario);
  //senha
  app.put('/usuarios/senha', autenticarToken, exigirPermissao(1, 2), funcoes.alterarSenha);
  //Nome
  app.put('/usuarios/nome', autenticarToken, exigirPermissao(1, 2), funcoes.alterarNome);
  //permissoes do usuario
  app.get('/usuarios/permissoes', autenticarToken, exigirPermissao(1, 2), funcoes.carregarPermissoesUsuario);
  app.get('/usuarios/permissoes/historico/:id', autenticarToken, exigirPermissao(1, 2), funcoes.HistoricoPermissoesUsuario);
  app.post('/usuarios/permissoes', autenticarToken, exigirPermissao(1, 2), funcoes.adicionarPermissoes);
  app.delete('/usuarios/permissoes', autenticarToken, exigirPermissao(1, 2), funcoes.excluirPermissao);

//permissoes
app.get('/permissoes', autenticarToken, exigirPermissao(1, 2), funcoes.carregarPermissoes);

//cadastros
app.get('/cadastros', autenticarToken, exigirPermissao(1, 10, 11), funcoes.carregarCadastros);
app.get('/cadastros/:id', autenticarToken, exigirPermissao(1, 10, 11), funcoes.carregarCadastroPorId);
app.get('/cadastros/historico/delete', autenticarToken, exigirPermissao(1, 10, 15), funcoes.HistoricoDeleteCadastros);
app.get('/cadastros/historico/:id', autenticarToken, exigirPermissao(1, 10, 15), funcoes.HistoricoCadastros);
app.post('/cadastros', autenticarToken, exigirPermissao(1, 10, 12), funcoes.adicionarCadastros);
app.put('/cadastros/:id', autenticarToken, exigirPermissao(1, 10, 13), funcoes.alterarCadastros);
app.delete('/cadastros/:id', autenticarToken, exigirPermissao(1, 10, 14), funcoes.excluirCadastros);

//cadastros relacao
app.get('/cadastrosRelacao', autenticarToken, exigirPermissao(1, 10, 11), funcoes.carregarCadastrosRelacao);
app.get('/cadastrosRelacao/historico/:idCadastro', autenticarToken, exigirPermissao(1, 10, 15), funcoes.HistoricoCadastrosRelacao);
app.post('/cadastrosRelacao', autenticarToken, exigirPermissao(1, 10, 13), funcoes.adicionarCadastrosRelacao);
app.delete('/cadastrosRelacao/:id', autenticarToken, exigirPermissao(1, 10, 13), funcoes.excluirCadastrosRelacao);

//consultas
app.get('/consultas', autenticarToken, exigirPermissao(1, 20, 21), funcoes.carregarConsultas);
app.get('/consultas/historico/delete', autenticarToken, exigirPermissao(1, 20, 25), funcoes.HistoricoDeleteConsultas);
app.get('/consultas/historico/:id', autenticarToken, exigirPermissao(1, 20, 25), funcoes.HistoricoConsultas);
app.post('/consultas', autenticarToken, exigirPermissao(1, 20, 22), funcoes.AdicionarConsultas);
app.put('/consultas/:id', autenticarToken, exigirPermissao(1, 20, 23), funcoes.alterarConsultas);
app.delete('/consultas/:id', autenticarToken, exigirPermissao(1, 20, 24), funcoes.excluirConsultas);

//Especialidades
app.get('/especialidade', autenticarToken, exigirPermissao(1, 30, 31), funcoes.carregarEspecialidades);
app.get('/especialidade/historico/delete', autenticarToken, exigirPermissao(1, 30, 35), funcoes.HistoricoDeleteEspecialidades);
app.get('/especialidade/historico/:id', autenticarToken, exigirPermissao(1, 30, 35), funcoes.HistoricoEspecialidades);
app.post('/especialidade', autenticarToken, exigirPermissao(1, 30, 32), funcoes.adicionarEspecialidades);
app.put('/especialidade/:id', autenticarToken, exigirPermissao(1, 30, 33), funcoes.alterarEspecialidades);
app.delete('/especialidade/:id', autenticarToken, exigirPermissao(1, 30, 33), funcoes.excluirEspecialidades);

//Google Agenda
app.get('/google/conectar', autenticarToken, exigirPermissao(1), agenda.conectarGoogle);
app.get('/google/status', autenticarToken, exigirPermissao(1), agenda.statusGoogle);
app.get('/google/callback', agenda.callbackGoogle); 
app.post('/google/evento',  autenticarToken, exigirPermissao(1, 26), agenda.criarEventoGoogle);
app.delete('/google/conectar', autenticarToken, exigirPermissao(1), agenda.desconectarGoogle);

/*
Permissões:
ID|TABELA        |TIPO     |
--+--------------+---------+
 1|GERAL         |GERAL    |
 2|USUARIOS      |GERAL    |
10|CADASTRO      |GERAL    |
11|CADASTRO      |ACESSAR  |
12|CADASTRO      |INSERIR  |
13|CADASTRO      |ALTERAR  |
14|CADASTRO      |EXCLUIR  |
15|CADASTRO      |HISTORICO|
20|CONSULTAS     |GERAL    |
21|CONSULTAS     |ACESSAR  |
22|CONSULTAS     |INSERIR  |
23|CONSULTAS     |ALTERAR  |
24|CONSULTAS     |EXCLUIR  |
25|CONSULTAS     |HISTORICO|
26|CONSULTAS     |AGENDA   |
30|ESPECIALIDADES|GERAL    |
31|ESPECIALIDADES|ACESSAR  |
32|ESPECIALIDADES|INSERIR  |
33|ESPECIALIDADES|ALTERAR  |
34|ESPECIALIDADES|EXCLUIR  |
35|ESPECIALIDADES|HISTORICO|
*/