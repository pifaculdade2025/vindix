import fetch from 'node-fetch';
import { executeQueryDBPrincipal, executeQueryEmpresa } from './conexaoBD.js';
import {decrypt, encrypt} from "./cripto.js";
import 'dotenv/config';
import * as funcoes from "./funcoes.js";
import { criarNonce, consumirNonce } from './nonces.js';

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
        return res.status(400).json({ erro: 'usuario não informado' })
    }

    try {
        const result = await executeQueryDBPrincipal(
            ' SELECT '+
            '    GOOGLE_TOKEN.ID '+
            ' FROM GOOGLE_TOKEN '+
            '    JOIN USUARIOS ON USUARIOS.EMPRESA = GOOGLE_TOKEN.ID_EMPRESA '+
            ' WHERE USUARIOS.ID = ?',
            [usuario]
        );

        if (result.length > 0) {
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
                    `&include_granted_scopes=true` +
                    `&state=${state}`;      

        res.redirect(url);

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
        return res.status(400).send('State inválido ou expirado');
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
            return res.status(500).send('Erro Google: ' + tokenData.error_description);
        }
        if (!tokenData.refresh_token) {
            return res.status(500).send('Refresh token não retornado. Revogue o acesso no Google e tente novamente.');
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

        await executeQueryDBPrincipal(
            ' INSERT INTO GOOGLE_TOKEN (ID, ACCESS_TOKEN, REFRESH_TOKEN, EXPIRA_EM, ID_EMPRESA)' +
            ' VALUES ((SELECT COALESCE(MAX(ID), 0) + 1 FROM GOOGLE_TOKEN), ?, ?, ?, ?)',
            [encrypt(tokenData.access_token), encrypt(tokenData.refresh_token), expiraEm, idEmpresa]
        );

        res.send(`
            <html><body><script>
                alert('Google Calendar conectado com sucesso!');
                window.close();
            </script></body></html>
        `);

    } catch (err) {
        return funcoes.handleError(res, err, 'callbackGoogle');
    }
}

async function getToken(usuario) {
    const result = await executeQueryDBPrincipal(
        ' SELECT ' +
        '    GOOGLE_TOKEN.ID, ' +
        '    GOOGLE_TOKEN.REFRESH_TOKEN, ' +
        '    GOOGLE_TOKEN.ACCESS_TOKEN, ' +
        '    GOOGLE_TOKEN.EXPIRA_EM ' +
        ' FROM GOOGLE_TOKEN ' +
        ' JOIN USUARIOS ON USUARIOS.EMPRESA = GOOGLE_TOKEN.ID_EMPRESA ' +
        ' WHERE USUARIOS.ID = ?',
        [usuario]
    );

    if (result.length === 0) {
        throw new Error('Google Agenda não configurado para este usuário');
    }

    const tokenRow = result[0];
    const agora    = new Date();
    const expiraEm = new Date(tokenRow.expira_em);

    // se ainda não expirou, retorna direto
    if (agora < expiraEm) {
        return decrypt(tokenRow.access_token);
    }

    // expirou — renova usando o refresh_token
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

export async function criarEventoGoogle(req, res) {
    const usuario = req.usuario;
    const idConsulta = parseInt(req.body.consulta, 10);

    if (!Number.isInteger(idConsulta) || idConsulta <= 0) {
        return res.status(400).json({ erro: 'ID de consulta inválido' });
    }

    try {
        const token = await getToken(usuario);

        const result = await executeQueryEmpresa(
            `SELECT 
                CONSULTAS.DT_HR_SESSAO,
                DATEADD(
                    (
                        EXTRACT(hour FROM CONSULTAS.TEMPO_SESSAO) * 3600 + 
                        EXTRACT(minute FROM CONSULTAS.TEMPO_SESSAO) * 60 + 
                        EXTRACT(second FROM CONSULTAS.TEMPO_SESSAO)
                    ) 
                    SECOND TO CONSULTAS.DT_HR_SESSAO
                ) AS DT_HR_FIM,
                CONSULTAS.TEMPO_SESSAO,
                CONSULTAS.ENVIADO_GOOGLE,
                ESPECIALIDADES.ID_COR,
                CADASTROS.NOME || ' - ' || ESPECIALIDADES.DESCRICAO AS TITULO
             FROM CONSULTAS
                JOIN CADASTROS ON CADASTROS.ID = CONSULTAS.ID_TERAPEUTA
                JOIN ESPECIALIDADES ON ESPECIALIDADES.ID = CONSULTAS.ID_ESPECIALIDADE
             WHERE CONSULTAS.ID = ?`,
            [idConsulta], 
            usuario
        );

        if (result.length === 0) {
            return res.status(404).json({ erro: 'Consulta não encontrada' });
        }

        const consulta = result[0];

        if (consulta.enviado_google === 'S') {
            return res.status(400).json({ erro: 'Consulta já enviada ao Google Agenda' });
        }

        const evento = {
            summary: consulta.titulo,
            start:   { dateTime: new Date(consulta.dt_hr_sessao).toISOString() },
            end:     { dateTime: new Date(consulta.dt_hr_fim).toISOString() }
        };

        if (consulta.id_cor > 0) {
            evento.colorId = String(consulta.id_cor);
        }

        const resultGoogle = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type':  'application/json'
            },
            body: JSON.stringify(evento)
        });
        const googleResp = await resultGoogle.json();

        if (googleResp.error) {
            return res.status(500).json({ erro: 'Erro Google: ' + googleResp.error.message });
        }

        await executeQueryEmpresa(
            `UPDATE CONSULTAS SET ENVIADO_GOOGLE = 'S' WHERE ID = ?`,
            [idConsulta], usuario
        );

        res.json({ sucesso: true });

    } catch (err) {
        return funcoes.handleError(res, err, 'criarEventoGoogle');
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
            const token = await getToken(usuario);//decrypt(result[0].access_token);
            await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
                method: 'POST'
            });
        } catch {
            // Log mas não bloqueia — deleta localmente de qualquer jeito
            console.warn('[desconectarGoogle] Falha ao revogar token no Google');
        }

        await executeQueryDBPrincipal(
            'DELETE FROM GOOGLE_TOKEN WHERE ID = ?',
            [result[0].id]
        );

        // Zerar flag nas consultas já enviadas 
        await executeQueryEmpresa(
          "UPDATE CONSULTAS SET ENVIADO_GOOGLE = 'N' WHERE ENVIADO_GOOGLE = 'S'",
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
        const result = await executeQueryDBPrincipal(
            `SELECT GOOGLE_TOKEN.ID FROM GOOGLE_TOKEN
             JOIN USUARIOS ON USUARIOS.EMPRESA = GOOGLE_TOKEN.ID_EMPRESA
             WHERE USUARIOS.ID = ?`,
            [usuario]
        );
        res.json({ conectado: result.length > 0 });
    } catch (err) {
        return funcoes.handleError(res, err, 'statusGoogle');
    }
}