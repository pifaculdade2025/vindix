import fetch from 'node-fetch';
import { executeQueryDBPrincipal, executeQueryEmpresa } from './conexaoBD.js';
import {decrypt, encrypt} from "./cripto.js";
import 'dotenv/config';
import * as funcoes from "./funcoes.js";
import { criarNonce, consumirNonce } from './nonces.js';
import crypto from 'crypto';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
if (!CLIENT_ID) {
    throw new Error("CLIENT_ID não definido");
}
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_SECRET) {
    throw new Error("CLIENT_SECRET não definido");
}
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI;
if (!REDIRECT_URI) {
    throw new Error("REDIRECT_URI não definido");
}

export async function conectarGoogle(req, res) { 
    const usuario = req.usuario; 

    if (!usuario) {
        return res.status(400).json({ erro: 'Usuário não informado' })
    }

    try {
        // Já conectada e funcionando: precisa desconectar antes. Se a conexão gravada não vale
        // mais (ex.: acesso removido na conta Google), ela é descartada e a nova é liberada
        let conectada;
        try { conectada = await verificarConexao(usuario); } catch { conectada = !!await linhaToken(usuario); }
        if (conectada) {
            return res.status(400).json({ erro: 'Google Agenda já configurado para esta empresa' });
        }

        const nonce = criarNonce(usuario);
        const state = encodeURIComponent(encrypt(nonce));

        const url = 'https://accounts.google.com/o/oauth2/v2/auth?' +
                    `client_id=${CLIENT_ID}` +
                    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
                    `&response_type=code` +
                    `&scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar')}` +
                    `&access_type=offline` +
                    // Sempre pede a autorização de novo: só assim o Google entrega uma chave permanente
                    // (refresh token) mesmo para uma conta que já tinha autorizado o Vindix antes
                    `&prompt=consent` +
                    `&include_granted_scopes=true` +
                    `&state=${state}`;      

        // O front abre a URL num popup (um redirect não levaria o token de autenticação)
        res.json({ url });

    } catch(err) {
        return funcoes.handleError(res, err, 'conectarGoogle');
    }
}

export async function callbackGoogle(req, res) {
    const { code, state } = req.query;

    if (!code || !state) {
        return res.status(400).send('Parâmetros inválidos');
    }

    let usuario;
    try {
        const nonce = decrypt(decodeURIComponent(state));
        usuario = consumirNonce(nonce);
        if (!usuario || !Number.isInteger(usuario) || usuario <= 0) throw new Error();
    } catch {
        return res.status(400).send('Autorização inválida ou expirada. Tente conectar de novo.');
    }

    try {
        const resultGoogle = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code:          code,
                client_id:     CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri:  REDIRECT_URI,
                grant_type:    'authorization_code'
            })
        });
        const tokenData = await resultGoogle.json();

        if (tokenData.error) {
            console.error('[callbackGoogle] Erro Google:', tokenData.error_description);
            return res.status(500).send('Erro ao conectar com o Google. Tente novamente.');
            // return res.status(500).send('Erro Google: ' + tokenData.error_description);
        }
        if (!tokenData.refresh_token) {
            return res.status(500).send('O Google não liberou o acesso permanente. Remova o acesso do Vindix na sua conta Google e conecte de novo.');
        }

        const expiraEm = new Date(Date.now() + (tokenData.expires_in - 300) * 1000);

        const resultUsuario = await executeQueryDBPrincipal(
            'SELECT EMPRESA FROM USUARIOS WHERE ID = ?',
            [usuario]
        );

        if (resultUsuario.length === 0) {
            return res.status(404).send('Usuário não encontrado');
        }

        const idEmpresa = resultUsuario[0].empresa;

        // Uma conexão por empresa: a nova substitui qualquer chave antiga que tenha ficado
        await executeQueryDBPrincipal('DELETE FROM GOOGLE_TOKEN WHERE ID_EMPRESA = ?', [idEmpresa]);
        await executeQueryDBPrincipal(
            ' INSERT INTO GOOGLE_TOKEN (ACCESS_TOKEN, REFRESH_TOKEN, EXPIRA_EM, ID_EMPRESA)' +
            ' VALUES (?, ?, ?, ?)',
            [encrypt(tokenData.access_token), encrypt(tokenData.refresh_token), expiraEm, idEmpresa]
        );
        esquecerTokens();

        const nonceScript = crypto.randomBytes(16).toString('base64');
        res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonceScript}'`);
        res.send(`
            <html><body><script nonce="${nonceScript}">
                alert('Google Agenda conectado com sucesso!');
                window.close();
            </script></body></html>
        `);

    } catch (err) {
        return funcoes.handleError(res, err, 'callbackGoogle');
    }
}

// Várias sincronizações seguidas (uma série inteira) usam o mesmo token: a primeira busca
// (e renova, se preciso) e as outras esperam por ela; o resultado vale por pouco tempo
const TOKEN_CACHE_MS = 30 * 1000;
const tokenPorUsuario = new Map();
function getToken(usuario) {
    const guardado = tokenPorUsuario.get(usuario);
    if (guardado && guardado.expira > Date.now()) return guardado.promessa;
    const promessa = buscarToken(usuario);
    if (tokenPorUsuario.size > 5000) tokenPorUsuario.clear();
    tokenPorUsuario.set(usuario, { promessa, expira: Date.now() + TOKEN_CACHE_MS });
    promessa.catch(() => tokenPorUsuario.delete(usuario));
    return promessa;
}
// Ao conectar ou desconectar o Google, ninguém pode continuar com o token antigo
export function esquecerTokens() { tokenPorUsuario.clear(); }
// Empresa com o Google conectado? (na dúvida, responde que sim e a sincronização decide)
export async function googleConectado(usuario) {
    try { return !!await getToken(usuario); } catch { return true; }
}

// Conexão que o Google não aceita mais (acesso removido na conta Google, chave revogada ou perdida):
// sai do banco, para a empresa aparecer como desconectada e poder conectar de novo
async function descartarConexao(idToken, motivo) {
    console.warn(`[Google Agenda] conexão descartada: ${motivo}`);
    await executeQueryDBPrincipal('DELETE FROM GOOGLE_TOKEN WHERE ID = ?', [idToken]);
    esquecerTokens();
}

// Renova a chave de acesso com a chave permanente; null se o Google não reconhece mais a conexão
async function renovarToken(tokenRow) {
    const resultGoogle = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id:     CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: decrypt(tokenRow.refresh_token),
            grant_type:    'refresh_token'
        })
    });
    const tokenData = await resultGoogle.json();

    if (tokenData.error === 'invalid_grant') {
        await descartarConexao(tokenRow.id, tokenData.error_description ?? tokenData.error);
        return null;
    }
    if (tokenData.error) {
        throw new Error('Erro ao renovar token: ' + tokenData.error_description);
    }

    const novaExpiracao = new Date(Date.now() + (tokenData.expires_in - 300) * 1000);
    await executeQueryDBPrincipal(
        'UPDATE GOOGLE_TOKEN SET ACCESS_TOKEN = ?, EXPIRA_EM = ? WHERE ID = ?',
        [encrypt(tokenData.access_token), novaExpiracao, tokenRow.id]
    );
    return tokenData.access_token;
}

async function linhaToken(usuario) {
    const [linha] = await executeQueryDBPrincipal(
        ' SELECT GOOGLE_TOKEN.ID, GOOGLE_TOKEN.REFRESH_TOKEN, GOOGLE_TOKEN.ACCESS_TOKEN, GOOGLE_TOKEN.EXPIRA_EM' +
        ' FROM GOOGLE_TOKEN JOIN USUARIOS ON USUARIOS.EMPRESA = GOOGLE_TOKEN.ID_EMPRESA WHERE USUARIOS.ID = ?',
        [usuario]
    );
    return linha ?? null;
}

// Confere com o Google se a conexão da empresa ainda vale (renovando a chave se preciso).
// Se não valer mais, ela é descartada e a empresa pode conectar de novo
export async function verificarConexao(usuario) {
    const tokenRow = await linhaToken(usuario);
    if (!tokenRow) return false;
    const valido = token => fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token)).then(r => r.ok);
    const atual = new Date() < new Date(tokenRow.expira_em) ? decrypt(tokenRow.access_token) : await renovarToken(tokenRow);
    if (!atual) return false;
    if (await valido(atual)) return true;
    // Chave de acesso recusada: renova uma vez (se a chave permanente também não vale, a conexão é descartada)
    esquecerTokens();
    const nova = await renovarToken(tokenRow);
    return !!nova && await valido(nova);
}

async function buscarToken(usuario) {
    const tokenRow = await linhaToken(usuario);
    // Empresa sem Google Agenda conectado
    if (!tokenRow) return null;
    // Ainda válida: usa direto; vencida: renova (null se o Google não aceitar mais a conexão)
    if (new Date() < new Date(tokenRow.expira_em)) return decrypt(tokenRow.access_token);
    return renovarToken(tokenRow);
}

const URL_EVENTOS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// O Google limita quantas alterações seguidas a agenda aceita (403 rateLimitExceeded / 429):
// espera um pouco e tenta de novo, com espera maior a cada tentativa
const ESPERAS_LIMITE_MS = [400, 1000, 2000, 4000];
async function fetchGoogle(url, opcoes) {
    for (let tentativa = 0; ; tentativa++) {
        const resp = await fetch(url, opcoes);
        const limite = resp.status === 429 || (resp.status === 403 && /rate ?limit/i.test(await resp.clone().text()));
        if (!limite || tentativa >= ESPERAS_LIMITE_MS.length) return resp;
        await new Promise(ok => setTimeout(ok, ESPERAS_LIMITE_MS[tentativa] + Math.random() * 300));
    }
}
const FUSO_AGENDA = process.env.FUSO_AGENDA ?? 'America/Sao_Paulo';

// Resultado da sincronização com o Google Agenda: 'sincronizado' | 'nao_conectado' | 'falhou'.
// Nunca lança erro: o agendamento vale mesmo se o Google estiver fora do ar.
export async function sincronizarAgendamento(usuario, idAgendamento) {
    try {
        const token = await getToken(usuario);
        if (!token) return 'nao_conectado';

        // Realizado: o evento passa para o horário real da sessão (data e duração informadas ao registrar)
        const [ag] = await executeQueryEmpresa(
            `SELECT A.ID, A.STATUS, A.GOOGLE_EVENT_ID,
                    COALESCE(C.DT_HR_SESSAO, A.DT_HR_AGENDADA) DT_HR_AGENDADA,
                    DATEADD(DATEDIFF(SECOND FROM TIME '00:00:00' TO COALESCE(C.TEMPO_SESSAO, A.TEMPO_PREVISTO)) SECOND
                            TO COALESCE(C.DT_HR_SESSAO, A.DT_HR_AGENDADA)) DT_HR_FIM,
                    E.ID_COR, T.NOME || ' - ' || E.DESCRICAO TITULO
             FROM AGENDAMENTOS A
                JOIN CADASTROS T ON T.ID = A.ID_TERAPEUTA
                JOIN ESPECIALIDADES E ON E.ID = A.ID_ESPECIALIDADE
                LEFT JOIN CONSULTAS C ON C.ID_AGENDAMENTO = A.ID AND C.EXCLUIDO_EM IS NULL AND A.STATUS = 'REALIZADO'
             WHERE A.ID = ?`,
            [idAgendamento],
            usuario
        );
        if (!ag) return 'falhou';
        if (ag.status === 'CANCELADO') return removerEventoAgendamento(usuario, idAgendamento);
        // Sessão realizada que nunca foi ao Google: não cria evento só para registrar o passado
        if (ag.status === 'REALIZADO' && !ag.google_event_id) return 'sincronizado';

        // Título só com terapeuta e especialidade: o nome do paciente não vai para o Google (LGPD)
        const evento = {
            summary: ag.titulo,
            start: { dateTime: ag.dt_hr_agendada, timeZone: FUSO_AGENDA },
            end:   { dateTime: ag.dt_hr_fim,      timeZone: FUSO_AGENDA },
            ...(ag.id_cor > 0 ? { colorId: String(ag.id_cor) } : {}),
        };
        const opcoes = metodo => ({
            method: metodo,
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(evento),
        });

        let resp = null;
        if (ag.google_event_id) {
            resp = await fetchGoogle(`${URL_EVENTOS}/${encodeURIComponent(ag.google_event_id)}`, opcoes('PATCH'));
            // Evento apagado direto no Google: cria de novo
            if (resp.status === 404 || resp.status === 410) resp = null;
        }
        if (!resp) resp = await fetchGoogle(URL_EVENTOS, opcoes('POST'));

        const dados = await resp.json();
        if (!resp.ok) {
            console.error('[sincronizarAgendamento] Erro Google:', dados.error?.message);
            return 'falhou';
        }

        if (dados.id !== ag.google_event_id) {
            await executeQueryEmpresa(
                'UPDATE AGENDAMENTOS SET GOOGLE_EVENT_ID = ? WHERE ID = ?',
                [dados.id, ag.id],
                usuario
            );
        }
        return 'sincronizado';
    } catch (err) {
        console.error('[sincronizarAgendamento]', err);
        return 'falhou';
    }
}

// Remove do Google Agenda o evento de um agendamento cancelado
export async function removerEventoAgendamento(usuario, idAgendamento) {
    try {
        const [ag] = await executeQueryEmpresa(
            'SELECT GOOGLE_EVENT_ID FROM AGENDAMENTOS WHERE ID = ?',
            [idAgendamento],
            usuario
        );
        if (!ag?.google_event_id) return 'sincronizado';

        const token = await getToken(usuario);
        if (!token) return 'nao_conectado';

        const resp = await fetchGoogle(`${URL_EVENTOS}/${encodeURIComponent(ag.google_event_id)}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token },
        });
        // 404/410: o evento já não existia no Google
        if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
            console.error('[removerEventoAgendamento] Erro Google:', resp.status);
            return 'falhou';
        }

        await executeQueryEmpresa(
            'UPDATE AGENDAMENTOS SET GOOGLE_EVENT_ID = NULL WHERE ID = ?',
            [idAgendamento],
            usuario
        );
        return 'sincronizado';
    } catch (err) {
        console.error('[removerEventoAgendamento]', err);
        return 'falhou';
    }
}

export async function desconectarGoogle(req, res) {
    const usuario = req.usuario;
    try {
        const result = await executeQueryDBPrincipal(
            `SELECT GOOGLE_TOKEN.ID, GOOGLE_TOKEN.ACCESS_TOKEN
             FROM GOOGLE_TOKEN
             JOIN USUARIOS ON USUARIOS.EMPRESA = GOOGLE_TOKEN.ID_EMPRESA
             WHERE USUARIOS.ID = ?`,
            [usuario]
        );

        if (result.length === 0) {
            return res.status(404).json({ erro: 'Google Agenda não conectado' });
        }

        // Tentar revogar no Google (não crítico se falhar)
        try {
            const token = await getToken(usuario);
            if (token) {
                await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
                    method: 'POST'
                });
            }
        } catch {
            // Log mas não bloqueia — deleta localmente de qualquer jeito
            console.warn('[desconectarGoogle] Falha ao revogar token no Google');
        }

        await executeQueryDBPrincipal(
            'DELETE FROM GOOGLE_TOKEN WHERE ID = ?',
            [result[0].id]
        );
        esquecerTokens();

        // Os eventos deixam de estar ligados a uma conta conectada
        await executeQueryEmpresa(
          'UPDATE AGENDAMENTOS SET GOOGLE_EVENT_ID = NULL WHERE GOOGLE_EVENT_ID IS NOT NULL',
          [], usuario
        );

        res.json({ sucesso: true });
    } catch (err) {
        return funcoes.handleError(res, err, 'desconectarGoogle');
    }
}

export async function statusGoogle(req, res) {
    const usuario = req.usuario;
    try {
        let conectado;
        // Testa com o Google; se ele estiver fora do ar, vale o que está gravado
        try { conectado = await verificarConexao(usuario); }
        catch (err) { console.warn('[statusGoogle] Google indisponível:', err.message); conectado = !!await linhaToken(usuario); }
        res.json({ conectado });
    } catch (err) {
        return funcoes.handleError(res, err, 'statusGoogle');
    }
}