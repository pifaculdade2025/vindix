import crypto from 'crypto';

if (!process.env.TOKEN_ENC_KEY) {
  throw new Error("TOKEN_ENC_KEY não definido");
}
const ENC_KEY = Buffer.from(process.env.TOKEN_ENC_KEY, 'hex'); 

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(stored) {
  const [ivHex, tagHex, encHex] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex,'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex,'hex')) + decipher.final('utf8');
}

export {decrypt, encrypt}