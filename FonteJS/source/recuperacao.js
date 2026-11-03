// Recuperação de senha por e-mail.
// - O código só existe no link do e-mail: o banco guarda o hash, vale 30 minutos e funciona uma vez.
// - O pedido mostra o início do e-mail só de quem tem um cadastrado; o resto recebe sempre a mesma resposta.
// - O usuário master não recupera por e-mail: tem acesso total, e a senha dele é trocada pelo programa de administração.
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { executeQueryDBPrincipal, InserirHistoricoRegistro } from './conexaoBD.js';
import { decrypt } from './cripto.js';
import { handleError, foiAtualizado } from './funcoes.js';
import { limparCacheUsuario } from './auth.js';
import { senhaInvalida } from './regras.js';
import { enviarEmail, emailRecuperacao, emailSenhaAlterada } from './email.js';

const VALIDADE_MIN = 30, INTERVALO_MIN = 2, SALT_ROUNDS = 12;
const ORIGENS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean);
const hashDe = codigo => crypto.createHash('sha256').update(codigo).digest('hex');
const codigoValido = c => typeof c === 'string' && /^[0-9a-f]{64}$/.test(c);

// Endereço do link: só um dos endereços permitidos no .env, nunca o que a requisição disser
// (senão alguém pediria a recuperação de outra pessoa com um link apontando para um site falso)
function enderecoDoSistema(req) {
    const origem = req.get('origin');
    return (ORIGENS.includes(origem) ? origem : ORIGENS[0] ?? '').replace(/\/+$/, '');
}

// "zanela@gmail.com" -> "za***@gmail.com" (como os aplicativos mostram para onde enviaram)
function mascararEmail(email) {
    const [nome, dominio] = email.split('@');
    return `${nome.slice(0, nome.length > 3 ? 2 : 1)}***@${dominio}`;
}

async function processarPedido(login, base) {
    const [u] = await executeQueryDBPrincipal(
        `SELECT U.ID, U.NOME, U.LOGIN, U.EMAIL, E.NOME EMPRESA,
                CASE WHEN U.RECUPERA_EXPIRA > DATEADD(? MINUTE TO LOCALTIMESTAMP) THEN 1 ELSE 0 END ENVIADO_HA_POUCO
         FROM USUARIOS U JOIN EMPRESAS E ON E.ID = U.EMPRESA
         WHERE UPPER(U.LOGIN) = UPPER(?) AND U.MASTER = 0 AND U.INATIVO = 0 AND U.EMAIL IS NOT NULL`,
        [VALIDADE_MIN - INTERVALO_MIN, login]);
    if (!u) return { semEmail: true };

    const email = decrypt(u.email), mascara = mascararEmail(email);
    if (u.enviado_ha_pouco === 1) return { enviado: true, jaEnviado: true, email: mascara };

    const codigo = crypto.randomBytes(32).toString('hex');
    await executeQueryDBPrincipal(
        'UPDATE USUARIOS SET RECUPERA_HASH = ?, RECUPERA_EXPIRA = DATEADD(? MINUTE TO LOCALTIMESTAMP) WHERE ID = ?',
        [hashDe(codigo), VALIDADE_MIN, u.id]);
    try {
        // O código vai depois do # : essa parte do endereço não chega a servidores nem a logs
        const info = await enviarEmail(email, emailRecuperacao({
            nome: u.nome, login: u.login, empresa: u.empresa, link: `${base}/#recuperar=${codigo}`, minutos: VALIDADE_MIN,
        }));
        console.log(`[recuperacao] E-mail aceito pelo servidor de envio (usuário ${u.id})`, info.response ?? '');
    } catch (err) {
        await executeQueryDBPrincipal('UPDATE USUARIOS SET RECUPERA_HASH = NULL, RECUPERA_EXPIRA = NULL WHERE ID = ?', [u.id]);
        throw err;
    }
    return { enviado: true, email: mascara };
}

// Quem tem e-mail vê o início dele; login inexistente, inativo, master ou sem e-mail recebem a mesma
// resposta (procurar o administrador), para não indicar qual desses é o caso
export async function solicitarRecuperacao(req, res) {
    const login = req.body?.usuario;
    res.set('Cache-Control', 'no-store');
    if (typeof login !== 'string' || !login.trim() || login.length > 64) return res.status(200).json({ semEmail: true });
    try {
        return res.status(200).json(await processarPedido(login.trim(), enderecoDoSistema(req)));
    } catch (err) {
        console.error('[recuperacao] Não foi possível enviar:', err.message);
        return res.status(503).json({ erro: 'Não foi possível enviar o e-mail agora. Tente de novo em instantes ou fale com o administrador da clínica.' });
    }
}

const SQL_CODIGO_VALIDO = 'RECUPERA_HASH = ? AND RECUPERA_EXPIRA > LOCALTIMESTAMP AND MASTER = 0 AND INATIVO = 0';
const CODIGO_INVALIDO = 'Este link venceu ou já foi usado. Peça a recuperação de novo.';

// Para a tela já avisar se o link não serve mais, antes de a pessoa digitar a senha nova
export async function validarCodigoRecuperacao(req, res) {
    res.set('Cache-Control', 'no-store');
    const { codigo } = req.body ?? {};
    if (!codigoValido(codigo)) return res.status(200).json({ valido: false });
    try {
        const [u] = await executeQueryDBPrincipal(`SELECT ID FROM USUARIOS WHERE ${SQL_CODIGO_VALIDO}`, [hashDe(codigo)]);
        return res.status(200).json({ valido: !!u });
    } catch (err) {
        return handleError(res, err, 'validarCodigoRecuperacao');
    }
}

export async function confirmarRecuperacao(req, res) {
    res.set('Cache-Control', 'no-store');
    const { codigo, novaSenha } = req.body ?? {};
    if (!codigoValido(codigo)) return res.status(400).json({ erro: CODIGO_INVALIDO });
    const erroSenha = senhaInvalida(novaSenha);
    if (erroSenha) return res.status(400).json({ erro: erroSenha });

    const hash = hashDe(codigo);
    try {
        const [u] = await executeQueryDBPrincipal(`SELECT ID, NOME, LOGIN, EMAIL, SENHA FROM USUARIOS WHERE ${SQL_CODIGO_VALIDO}`, [hash]);
        if (!u) return res.status(400).json({ erro: CODIGO_INVALIDO });
        if (await bcrypt.compare(novaSenha, u.senha)) {
            return res.status(400).json({ erro: 'A nova senha deve ser diferente da atual' });
        }
        const novoHash = await bcrypt.hash(novaSenha, SALT_ROUNDS);
        // Um único comando: dois envios ao mesmo tempo não conseguem usar o mesmo link
        const r = await executeQueryDBPrincipal(
            `UPDATE USUARIOS SET SENHA = ?, TROCAR_SENHA = 0, TOKEN_VERSION = COALESCE(TOKEN_VERSION, 0) + 1,
                RECUPERA_HASH = NULL, RECUPERA_EXPIRA = NULL WHERE ID = ? AND ${SQL_CODIGO_VALIDO} RETURNING ID`,
            [novoHash, u.id, hash]);
        if (!foiAtualizado(r)) return res.status(400).json({ erro: CODIGO_INVALIDO });

        limparCacheUsuario(u.id);
        await InserirHistoricoRegistro(u.id, 'USUARIOS', 'UPDATE', u.id, { campo: 'SENHA', novo: 'Redefinida pelo link enviado por e-mail' });
        res.status(200).json({ sucesso: true });
        // Aviso para o dono da conta: se não foi ele, fica sabendo
        enviarEmail(decrypt(u.email), emailSenhaAlterada({ nome: u.nome, login: u.login }))
            .catch(err => console.error('[recuperacao] Aviso de senha alterada não enviado:', err.message));
    } catch (err) {
        return handleError(res, err, 'confirmarRecuperacao');
    }
}
