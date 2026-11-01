import express from "express";
import cors from "cors";
import rateLimit from 'express-rate-limit';
import { autenticarToken, exigirPermissao } from "./auth.js"
import * as funcoes from "./funcoes.js";
import * as clinica from './clinica.js';
import * as agenda from './agenda.js';
import helmet from 'helmet';
import compression from 'compression';
import { tooBusyCheck } from "./too-busy.js";
import slowDown from 'express-slow-down';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.ALLOWED_ORIGINS) {
    throw new Error("ALLOWED_ORIGINS não definido");
}
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');

const loginSlow = slowDown({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  delayAfter: 3,              // começa a atrasar após 3 tentativas
  delayMs: (hits) => (hits - 3) * 500,  // +500ms por tentativa acima de 3
});

// Troca de foto: poucas por vez (cada uma grava até 24 KB no banco)
const fotoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas trocas de foto em pouco tempo. Aguarde alguns minutos.' }
});

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 minutos
  max: 10,                    // máximo 10 tentativas
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em 5 minutos.' }
});

// HTTPS: informe HTTPS_CERT e HTTPS_KEY (caminhos dos arquivos .pem) no .env
const usarHttps = Boolean(process.env.HTTPS_CERT && process.env.HTTPS_KEY);

const app = express();
// Atrás de um proxy reverso (ex.: o que vai fazer o HTTPS), informe TRUST_PROXY no .env (ex.: 1 = um proxy,
// ou o IP dele). Sem isso, todos os acessos parecem vir do proxy e o limite de login bloquearia a clínica inteira
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? parseInt(v, 10) : v);
}
app.use(express.json({ limit: '100kb' }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origem não permitida'));
    }
  },
  credentials: true,
  // Total das listas paginadas
  exposedHeaders: ['X-Total-Count']
}));
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Fontes servidas pelo próprio sistema (nenhuma origem externa)
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", ...allowedOrigins],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(usarHttps ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  // HSTS só faz sentido com HTTPS; em HTTP faria o navegador recusar o acesso
  strictTransportSecurity: usarHttps,
  // O popup do Google Agenda precisa ser aberto pela página
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));
app.use(tooBusyCheck);
const globalLimiter = rateLimit({ windowMs: 60000, max: 300, message: { erro: 'Muitas requisições em pouco tempo. Aguarde um minuto e tente de novo.' } });
app.use(globalLimiter);

const PORTA = parseInt(process.env.PORTA ?? '8080', 10);
const aoIniciar = (err) => {
  if (err) { 
    console.error('Falha ao iniciar servidor', err); 
    process.exit(1); 
  }  
  console.log(`Servidor rodando na porta ${PORTA} (${usarHttps ? 'HTTPS' : 'HTTP'})`);
  if (!usarHttps) {
    console.warn('ATENÇÃO: sem HTTPS, senhas e dados de saúde trafegam sem criptografia na rede. Configure HTTPS_CERT e HTTPS_KEY.');
  }
};

if (usarHttps) {
  https.createServer({
    cert: fs.readFileSync(process.env.HTTPS_CERT),
    key:  fs.readFileSync(process.env.HTTPS_KEY),
  }, app).listen(PORTA, '0.0.0.0', aoIniciar);
} else {
  app.listen(PORTA, '0.0.0.0', aoIniciar);
}

// Compressão só nos arquivos do site (HTML, CSS, JS, SVG). As respostas da API, que levam tokens e
// dados pessoais, seguem sem compressão: assim não há como explorar ataques do tipo BREACH
const arquivoDoSite = req => req.method === 'GET' && (req.path === '/' || /\.(html|css|js|svg)$/.test(req.path));
app.use(compression({ filter: (req, res) => arquivoDoSite(req) && compression.filter(req, res) }));
app.use(express.static(path.join(__dirname, '..', '..', 'front'), {
  setHeaders(res, arquivo) {
    // Fontes nunca mudam (o nome muda junto); o resto revalida pelo ETag, então uma atualização aparece na hora
    res.setHeader('Cache-Control', arquivo.endsWith('.woff2') ? 'public, max-age=31536000, immutable' : 'no-cache');
  },
}));

//ver se o servidor está vivo
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

//login
app.post('/login', loginSlow, loginLimiter, funcoes.validarLogin);
app.post('/logout', autenticarToken, funcoes.logout);

//usuarios
app.get('/usuarios', autenticarToken, exigirPermissao(1, 2), funcoes.carregarUsuarios);
app.post('/usuarios', autenticarToken, exigirPermissao(1, 2), funcoes.cadastrarUsuario);
  //senha
  app.put('/usuarios/senha', autenticarToken, loginLimiter, funcoes.alterarSenha);
  //foto de perfil (cada um só a própria)
  app.get('/usuarios/me/foto', autenticarToken, funcoes.minhaFoto);
  app.get('/usuarios/fotos', autenticarToken, exigirPermissao(1, 2), funcoes.fotosUsuarios);
  app.put('/usuarios/me/foto', autenticarToken, fotoLimiter, funcoes.alterarMinhaFoto);
  app.delete('/usuarios/me/foto', autenticarToken, fotoLimiter, funcoes.removerMinhaFoto);
  app.post('/usuarios/:id/redefinir-senha', autenticarToken, exigirPermissao(1, 2), funcoes.redefinirSenha);
  // Usuário que é um profissional: passa a ver só os próprios atendimentos
  app.put('/usuarios/:id/profissional', autenticarToken, exigirPermissao(1, 2), funcoes.vincularProfissional);
  app.put('/usuarios/:id/permissoes', autenticarToken, exigirPermissao(1, 2), funcoes.definirPermissoes);
  app.put('/usuarios/:id/status', autenticarToken, exigirPermissao(1, 2), funcoes.alterarStatusUsuario);
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
app.get('/cadastros/pendencias', autenticarToken, exigirPermissao(1, 10, 11), funcoes.pendenciasCadastros);
app.get('/cadastros/:id', autenticarToken, exigirPermissao(1, 10, 11), funcoes.carregarCadastroPorId);
// Evolução do paciente nas sessões (dado das sessões: exige acesso às consultas)
app.get('/cadastros/:id/evolucao', autenticarToken, exigirPermissao(1, 20, 21), funcoes.evolucaoPaciente);
app.get('/cadastros/historico/delete', autenticarToken, exigirPermissao(1, 10, 15), funcoes.HistoricoDeleteCadastros);
app.get('/cadastros/historico/:id', autenticarToken, exigirPermissao(1, 10, 15), funcoes.HistoricoCadastros);
app.post('/cadastros', autenticarToken, exigirPermissao(1, 10, 12), funcoes.adicionarCadastros);
app.put('/cadastros/:id', autenticarToken, exigirPermissao(1, 10, 13), funcoes.alterarCadastros);
// Inclusão (12) também grava os vínculos do cadastro que acabou de criar; o restante é conferido na função
app.put('/cadastros/:id/vinculos', autenticarToken, exigirPermissao(1, 10, 12, 13), funcoes.definirVinculos);
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
app.get('/consultas/:id', autenticarToken, exigirPermissao(1, 20, 21), funcoes.carregarConsultaPorId);
app.post('/consultas', autenticarToken, exigirPermissao(1, 20, 22), funcoes.AdicionarConsultas);
app.put('/consultas/:id', autenticarToken, exigirPermissao(1, 20, 23), funcoes.alterarConsultas);
app.delete('/consultas/:id', autenticarToken, exigirPermissao(1, 20, 24), funcoes.excluirConsultas);

//Agendamentos (só eles vão para o Google Agenda)
app.get('/agendamentos', autenticarToken, exigirPermissao(1, 40, 41), funcoes.carregarAgendamentos);
app.get('/agendamentos/historico/:id', autenticarToken, exigirPermissao(1, 40, 45), funcoes.HistoricoAgendamentos);
app.post('/agendamentos', autenticarToken, exigirPermissao(1, 40, 42), funcoes.adicionarAgendamento);
app.put('/agendamentos/:id', autenticarToken, exigirPermissao(1, 40, 43), funcoes.alterarAgendamento);
app.post('/agendamentos/:id/cancelar', autenticarToken, exigirPermissao(1, 40, 44), funcoes.cancelarAgendamento);
app.post('/agendamentos/:id/google', autenticarToken, exigirPermissao(1, 40, 43), funcoes.sincronizarAgendamentoGoogle);
// Gerar a consulta (sessão realizada) é inclusão de consulta
app.post('/agendamentos/:id/consulta', autenticarToken, exigirPermissao(1, 20, 22), funcoes.gerarConsulta);
// Falta do paciente (registrar ou desfazer)
app.post('/agendamentos/:id/falta', autenticarToken, exigirPermissao(1, 40, 43), funcoes.registrarFalta);

// Plano terapêutico (metas): faz parte do prontuário, usa as permissões das sessões
app.get('/metas', autenticarToken, exigirPermissao(1, 20, 21), clinica.listarMetasSessao);
app.post('/metas', autenticarToken, exigirPermissao(1, 20, 22), clinica.adicionarMeta);
app.put('/metas/:id', autenticarToken, exigirPermissao(1, 20, 23), clinica.alterarMeta);
app.delete('/metas/:id', autenticarToken, exigirPermissao(1, 20, 24), clinica.excluirMeta);

// Lista de espera: usa as permissões da agenda
app.get('/espera', autenticarToken, exigirPermissao(1, 40, 41), clinica.listarEspera);
app.get('/espera/contagem', autenticarToken, exigirPermissao(1, 40, 41), clinica.contarEspera);
app.post('/espera', autenticarToken, exigirPermissao(1, 40, 42), clinica.adicionarEspera);
app.put('/espera/:id/status', autenticarToken, exigirPermissao(1, 40, 43), clinica.alterarStatusEspera);

// Financeiro dos pacientes: nunca para o profissional vinculado (ele vê só o próprio repasse)
const semProfissional = (req, res, next) => req.terapeuta
  ? res.status(403).json({ erro: 'O financeiro é restrito à administração da clínica' }) : next();
app.get('/financeiro/pacientes', autenticarToken, exigirPermissao(1, 60, 61), semProfissional, clinica.financeiroPacientes);
app.get('/financeiro/pacientes/:id', autenticarToken, exigirPermissao(1, 60, 61), semProfissional, clinica.extratoPaciente);
app.get('/financeiro/repasses', autenticarToken, exigirPermissao(1, 60, 61), clinica.repasses);
app.post('/pacotes', autenticarToken, exigirPermissao(1, 60, 62), semProfissional, clinica.adicionarPacote);
app.delete('/pacotes/:id', autenticarToken, exigirPermissao(1, 60, 64), semProfissional, clinica.excluirPacote);
app.post('/pagamentos', autenticarToken, exigirPermissao(1, 60, 62), semProfissional, clinica.adicionarPagamento);
app.delete('/pagamentos/:id', autenticarToken, exigirPermissao(1, 60, 64), semProfissional, clinica.excluirPagamento);
app.get('/pagamentos/:id/recibo', autenticarToken, exigirPermissao(1, 60, 61), semProfissional, clinica.reciboPagamento);

//Especialidades
app.get('/especialidade', autenticarToken, exigirPermissao(1, 30, 31), funcoes.carregarEspecialidades);
app.get('/especialidade/historico/delete', autenticarToken, exigirPermissao(1, 30, 35), funcoes.HistoricoDeleteEspecialidades);
app.get('/especialidade/historico/:id', autenticarToken, exigirPermissao(1, 30, 35), funcoes.HistoricoEspecialidades);
app.post('/especialidade', autenticarToken, exigirPermissao(1, 30, 32), funcoes.adicionarEspecialidades);
app.put('/especialidade/:id', autenticarToken, exigirPermissao(1, 30, 33), funcoes.alterarEspecialidades);
app.delete('/especialidade/:id', autenticarToken, exigirPermissao(1, 30, 34), funcoes.excluirEspecialidades);

//Relatórios
app.get('/relatorios/evolucao', autenticarToken, exigirPermissao(1, 20, 21), funcoes.relatorioEvolucao);
app.get('/empresa/logo', autenticarToken, funcoes.logoEmpresa);
app.get('/empresa', autenticarToken, funcoes.dadosEmpresa);

//Resumo (indicadores agregados de atendimento)
app.get('/resumo', autenticarToken, exigirPermissao(1, 50), funcoes.carregarResumo);

//Google Agenda
app.get('/google/conectar', autenticarToken, exigirPermissao(1), agenda.conectarGoogle);
app.get('/google/status', autenticarToken, exigirPermissao(1), agenda.statusGoogle);
app.get('/google/callback', agenda.callbackGoogle); 
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
30|ESPECIALIDADES|GERAL    |
31|ESPECIALIDADES|ACESSAR  |
32|ESPECIALIDADES|INSERIR  |
33|ESPECIALIDADES|ALTERAR  |
34|ESPECIALIDADES|EXCLUIR  |
35|ESPECIALIDADES|HISTORICO|
40|AGENDAMENTOS  |GERAL    |
41|AGENDAMENTOS  |ACESSAR  |
42|AGENDAMENTOS  |INSERIR  |
43|AGENDAMENTOS  |ALTERAR  |
44|AGENDAMENTOS  |EXCLUIR  | (cancelar)
45|AGENDAMENTOS  |HISTORICO|
50|RESUMO        |GERAL    | (permissão especial: única do resumo)
60|FINANCEIRO    |GERAL    |
61|FINANCEIRO    |ACESSAR  |
62|FINANCEIRO    |INSERIR  | (pacotes e pagamentos)
63|FINANCEIRO    |ALTERAR  | (preço das especialidades e repasse dos profissionais)
64|FINANCEIRO    |EXCLUIR  |
65|FINANCEIRO    |HISTORICO|
*/