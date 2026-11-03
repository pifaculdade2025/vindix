// Envio de e-mails do sistema. Padrão: Gmail, com a senha de app em SENHA_EMAIL no .env.
// Para trocar de serviço basta informar EMAIL_HOST, EMAIL_PORTA, EMAIL_USUARIO e SENHA_EMAIL.
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const USUARIO = process.env.EMAIL_USUARIO ?? 'adm.vindix@gmail.com';
const HOST = process.env.EMAIL_HOST ?? 'smtp.gmail.com';
const PORTA = parseInt(process.env.EMAIL_PORTA ?? '465', 10);
// O Google mostra a senha de app com espaços, que não fazem parte dela
const SENHA = (process.env.SENHA_EMAIL ?? '').replace(/\s/g, '');
const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vindix-email.png');

const CORES = { ameixa: '#5b2a86', tinta: '#221a3d', texto: '#575170', suave: '#827c99', linha: '#e4e1ee', fundo: '#f3f3f9' };

let transporte = null;
function obterTransporte() {
    if (!SENHA) throw new Error('SENHA_EMAIL não definida no .env');
    transporte ??= nodemailer.createTransport({
        host: HOST, port: PORTA, secure: PORTA === 465, auth: { user: USUARIO, pass: SENHA },
        connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
    });
    return transporte;
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Moldura dos e-mails (tabelas e estilos na própria tag: é o que os programas de e-mail respeitam)
function moldura(titulo, corpo) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:${CORES.fundo};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${CORES.tinta}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CORES.fundo}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${CORES.linha};border-radius:16px">
    <tr><td style="padding:28px 32px 0">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:10px"><img src="cid:logo-vindix" width="40" height="40" alt="" style="display:block"></td>
        <td style="font-size:22px;font-weight:700;letter-spacing:-.5px;color:${CORES.tinta}">vindix</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:24px 32px 32px">${corpo}</td></tr>
  </table>
  <p style="margin:18px 0 0;max-width:520px;font-size:12px;line-height:1.5;color:${CORES.suave}">Mensagem automática do Vindix, sistema de gestão de clínicas. Não responda a este e-mail.</p>
</td></tr></table></body></html>`;
}

const paragrafo = (t, extra = '') => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${CORES.texto};${extra}">${t}</p>`;

async function enviar({ para, assunto, html, texto }) {
    const info = await obterTransporte().sendMail({
        from: { name: 'Vindix', address: USUARIO }, to: para, subject: assunto, html, text: texto,
        attachments: [{ filename: 'vindix.png', path: LOGO, cid: 'logo-vindix' }],
    });
    if (info.rejected?.length) throw new Error('o servidor de e-mail recusou o destinatário');
    return info;
}

// Monta os e-mails sem enviar (também usado para conferir como ficam)
export function emailRecuperacao({ nome, login, empresa, link, minutos }) {
    const primeiro = String(nome ?? '').trim().split(/\s+/)[0];
    return {
        assunto: 'Recuperação de senha do Vindix',
        html: moldura('Recuperação de senha', `
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:${CORES.tinta}">Vamos criar uma senha nova</h1>
      ${paragrafo(`Olá, ${esc(primeiro)}. Recebemos um pedido para recuperar a senha do seu acesso${empresa ? ` à <strong style="color:${CORES.tinta}">${esc(empresa)}</strong>` : ''}.`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:${CORES.fundo};border-radius:10px"><tr>
        <td style="padding:12px 16px;font-size:14px;color:${CORES.texto}">Seu login: <strong style="color:${CORES.tinta}">${esc(login)}</strong></td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td align="center">
        <a href="${esc(link)}" style="display:inline-block;padding:14px 32px;background:${CORES.ameixa};border-radius:999px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">Criar nova senha</a>
      </td></tr></table>
      ${paragrafo(`O link vale por <strong style="color:${CORES.tinta}">${minutos} minutos</strong> e só funciona uma vez.`)}
      ${paragrafo('Se não foi você que pediu, pode ignorar este e-mail: sua senha continua a mesma.')}
      <hr style="border:0;border-top:1px solid ${CORES.linha};margin:24px 0 16px">
      <p style="margin:0;font-size:12px;line-height:1.5;color:${CORES.suave}">Se o botão não abrir, copie e cole este endereço no navegador:<br><a href="${esc(link)}" style="color:${CORES.ameixa};word-break:break-all">${esc(link)}</a></p>`),
        texto: `Olá, ${primeiro}.\n\nRecebemos um pedido para recuperar a senha do seu acesso${empresa ? ` à ${empresa}` : ''}.\nSeu login: ${login}\n\nPara criar uma senha nova, abra este endereço (vale por ${minutos} minutos e só funciona uma vez):\n${link}\n\nSe não foi você que pediu, ignore este e-mail: sua senha continua a mesma.\n\nVindix`,
    };
}

export function emailSenhaAlterada({ nome, login }) {
    const primeiro = String(nome ?? '').trim().split(/\s+/)[0];
    return {
        assunto: 'Sua senha do Vindix foi alterada',
        html: moldura('Senha alterada', `
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:${CORES.tinta}">Sua senha foi alterada</h1>
      ${paragrafo(`Olá, ${esc(primeiro)}. A senha do login <strong style="color:${CORES.tinta}">${esc(login)}</strong> acabou de ser alterada pelo link de recuperação, e as sessões abertas foram encerradas.`)}
      ${paragrafo('Se foi você, está tudo certo. <strong>Se não foi você, avise o administrador da clínica agora.</strong>', 'margin-bottom:0')}`),
        texto: `Olá, ${primeiro}.\n\nA senha do login ${login} acabou de ser alterada pelo link de recuperação, e as sessões abertas foram encerradas.\n\nSe foi você, está tudo certo. Se não foi você, avise o administrador da clínica agora.\n\nVindix`,
    };
}

export const enviarEmail = (para, conteudo) => enviar({ para, ...conteudo });
