// Regras de validação dos dados de cada tabela. O back-end valida tudo aqui,
// independente do que o front já tenha verificado.

export const CAMPOS_CRIPTOGRAFADOS = {
    CADASTROS: new Set(['CPF', 'DIAGNOSTICO']),
    CONSULTAS: new Set(['RESUMO_SESSAO', 'EVOLUCAO']),
    METAS: new Set(['DESCRICAO']),
    AVALIACOES_META: new Set(['NOTA']),
};

// Leitura de coluna criptografada como OCTETS: lida como UTF8 o limite seria 8191 caracteres
export const lerCripto = (coluna, alias = coluna) => `CAST(${coluna} AS VARCHAR(32765) CHARACTER SET OCTETS) ${alias}`;

// Tabelas com exclusão lógica (prontuário precisa ser mantido)
export const TABELAS_EXCLUSAO_LOGICA = new Set(['CADASTROS', 'CONSULTAS', 'PACOTES', 'PAGAMENTOS', 'METAS']);

// tipo: texto | enum | id | inteiro | data | hora | datahora | cpf
// maxCripto: tamanho da coluna que guarda o valor criptografado
const REGRAS = {
    CADASTROS: {
        NOME:                  { rotulo: 'Nome', tipo: 'texto', obrigatorio: true, max: 100 },
        TIPO:                  { rotulo: 'Tipo', tipo: 'enum', obrigatorio: true, valores: ['Paciente', 'Terapeuta'] },
        TELEFONE:              { rotulo: 'Telefone', tipo: 'texto', max: 20, regex: /^[0-9()+\-\s]+$/ },
        DT_NASC:               { rotulo: 'Nascimento', tipo: 'data', passado: true },
        CPF:                   { rotulo: 'CPF', tipo: 'cpf', maxCripto: 100 },
        REGISTRO_PROFISSIONAL: { rotulo: 'Registro profissional', tipo: 'texto', max: 30 },
        DIAGNOSTICO:           { rotulo: 'Diagnóstico', tipo: 'texto', max: 400, maxCripto: 1000 },
        // Só para profissionais: parte de cada sessão que vai para ele
        REPASSE_PERCENTUAL:    { rotulo: 'Repasse', tipo: 'inteiro', min: 0, max: 100 },
    },
    CONSULTAS: {
        ID_PACIENTE:      { rotulo: 'Paciente', tipo: 'id', obrigatorio: true },
        ID_TERAPEUTA:     { rotulo: 'Profissional', tipo: 'id', obrigatorio: true },
        ID_ESPECIALIDADE: { rotulo: 'Especialidade', tipo: 'id', obrigatorio: true },
        // A sessão já aconteceu: não pode ficar depois de agora (tolerância para relógios fora de hora)
        DT_HR_SESSAO:     { rotulo: 'Data e hora da sessão', tipo: 'datahora', obrigatorio: true, naoFutura: true },
        TEMPO_SESSAO:     { rotulo: 'Duração', tipo: 'hora', obrigatorio: true, naoZero: true },
        RESUMO_SESSAO:    { rotulo: 'Resumo da sessão', tipo: 'texto', max: 8000, maxCripto: 32700 },
        // 1 Regrediu · 2 Sem avanço · 3 Avanço leve · 4 Bom avanço · 5 Avanço expressivo
        EVOLUCAO:         { rotulo: 'Evolução do paciente', tipo: 'inteiro', min: 1, max: 5, maxCripto: 100 },
    },
    AGENDAMENTOS: {
        ID_PACIENTE:      { rotulo: 'Paciente', tipo: 'id', obrigatorio: true },
        ID_TERAPEUTA:     { rotulo: 'Profissional', tipo: 'id', obrigatorio: true },
        ID_ESPECIALIDADE: { rotulo: 'Especialidade', tipo: 'id', obrigatorio: true },
        DT_HR_AGENDADA:   { rotulo: 'Data e hora', tipo: 'datahora', obrigatorio: true },
        TEMPO_PREVISTO:   { rotulo: 'Duração prevista', tipo: 'hora', obrigatorio: true, naoZero: true },
    },
    ESPECIALIDADES: {
        DESCRICAO: { rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, max: 80 },
        INATIVO:   { rotulo: 'Status', tipo: 'enum', obrigatorio: true, valores: ['S', 'N'] },
        ID_COR:    { rotulo: 'Cor', tipo: 'inteiro', min: 0, max: 11 },
        // Valores em centavos (inteiros: sem erro de arredondamento)
        VALOR_CENTAVOS: { rotulo: 'Valor da sessão', tipo: 'inteiro', min: 0, max: 10000000 },
    },
    PACOTES: {
        ID_PACIENTE:      { rotulo: 'Paciente', tipo: 'id', obrigatorio: true },
        ID_ESPECIALIDADE: { rotulo: 'Especialidade', tipo: 'id' },
        QTD_SESSOES:      { rotulo: 'Quantidade de sessões', tipo: 'inteiro', obrigatorio: true, min: 1, max: 200 },
        VALOR_CENTAVOS:   { rotulo: 'Valor do pacote', tipo: 'inteiro', obrigatorio: true, min: 0, max: 100000000 },
        DT_COMPRA:        { rotulo: 'Data', tipo: 'data', obrigatorio: true, passado: true },
        OBS:              { rotulo: 'Observação', tipo: 'texto', max: 200 },
    },
    PAGAMENTOS: {
        ID_PACIENTE:    { rotulo: 'Paciente', tipo: 'id', obrigatorio: true },
        VALOR_CENTAVOS: { rotulo: 'Valor', tipo: 'inteiro', obrigatorio: true, min: 1, max: 100000000 },
        DT_PAGAMENTO:   { rotulo: 'Data do pagamento', tipo: 'data', obrigatorio: true, passado: true },
        FORMA:          { rotulo: 'Forma de pagamento', tipo: 'enum', obrigatorio: true, valores: ['PIX', 'DINHEIRO', 'CARTAO', 'TRANSFERENCIA', 'OUTRO'] },
        REFERENTE:      { rotulo: 'Referente a', tipo: 'texto', max: 200 },
    },
    METAS: {
        ID_PACIENTE:      { rotulo: 'Paciente', tipo: 'id', obrigatorio: true },
        ID_ESPECIALIDADE: { rotulo: 'Especialidade', tipo: 'id', obrigatorio: true },
        DESCRICAO:        { rotulo: 'Meta', tipo: 'texto', obrigatorio: true, max: 300, maxCripto: 1000 },
        STATUS:           { rotulo: 'Situação da meta', tipo: 'enum', valores: ['ATIVA', 'ALCANCADA', 'ENCERRADA'] },
    },
    LISTA_ESPERA: {
        ID_PACIENTE:      { rotulo: 'Paciente', tipo: 'id', obrigatorio: true },
        ID_ESPECIALIDADE: { rotulo: 'Especialidade', tipo: 'id', obrigatorio: true },
        ID_TERAPEUTA:     { rotulo: 'Profissional', tipo: 'id' },
        PREFERENCIA:      { rotulo: 'Preferência de horário', tipo: 'texto', max: 200 },
    },
};

const pad2 = n => String(n).padStart(2, '0');
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

function dataValida(a, m, d) {
    const dt = new Date(a, m - 1, d);
    return dt.getFullYear() === a && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function cpfValido(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    for (const t of [9, 10]) {
        let soma = 0;
        for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
        if ((soma * 10) % 11 % 10 !== Number(cpf[t])) return false;
    }
    return true;
}

// Retorna { valor } normalizado ou { erro }
function normalizar(regra, bruto) {
    if (bruto == null || (typeof bruto === 'string' && bruto.trim() === '')) return { valor: null };

    switch (regra.tipo) {
        case 'texto': {
            if (typeof bruto !== 'string') return { erro: 'deve ser texto' };
            const v = bruto.trim();
            if (regra.max && v.length > regra.max) return { erro: `máximo de ${regra.max} caracteres` };
            if (regra.regex && !regra.regex.test(v)) return { erro: 'formato inválido' };
            return { valor: v };
        }
        case 'enum':
            if (!regra.valores.includes(bruto)) return { erro: 'valor inválido' };
            return { valor: bruto };
        case 'id':
        case 'inteiro': {
            const n = typeof bruto === 'string' && /^-?\d+$/.test(bruto.trim()) ? Number(bruto) : bruto;
            if (!Number.isInteger(n)) return { erro: 'deve ser um número inteiro' };
            if (regra.tipo === 'id' && n <= 0) return { erro: 'inválido' };
            if (regra.min != null && n < regra.min) return { erro: `mínimo ${regra.min}` };
            if (regra.max != null && n > regra.max) return { erro: `máximo ${regra.max}` };
            return { valor: n };
        }
        case 'data': {
            const m = typeof bruto === 'string' && bruto.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!m || !dataValida(+m[1], +m[2], +m[3])) return { erro: 'data inválida' };
            if (regra.passado) {
                const hoje = new Date();
                const hojeTxt = `${hoje.getFullYear()}-${pad2(hoje.getMonth() + 1)}-${pad2(hoje.getDate())}`;
                if (m[0] > hojeTxt || +m[1] < 1900) return { erro: 'data fora do intervalo permitido' };
            }
            return { valor: m[0] };
        }
        case 'hora': {
            const m = typeof bruto === 'string' && bruto.trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] ?? 0) > 59) return { erro: 'hora inválida' };
            const v = `${m[1]}:${m[2]}:${m[3] ?? '00'}`;
            if (regra.naoZero && v === '00:00:00') return { erro: 'não pode ser zero' };
            return { valor: v };
        }
        case 'datahora': {
            const m = typeof bruto === 'string' && bruto.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (!m || !dataValida(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +(m[6] ?? 0) > 59) {
                return { erro: 'data/hora inválida' };
            }
            if (regra.naoFutura && new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) > new Date(Date.now() + TOLERANCIA_FUTURO_MS)) {
                return { erro: 'não pode ser depois de agora' };
            }
            return { valor: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}` };
        }
        case 'cpf': {
            if (typeof bruto !== 'string') return { erro: 'deve ser texto' };
            const v = bruto.replace(/\D/g, '');
            if (!cpfValido(v)) return { erro: 'inválido' };
            return { valor: v };
        }
        default:
            return { erro: 'tipo de campo desconhecido' };
    }
}

// Tamanho do valor depois de criptografado (iv:tag:dados em hex)
const tamanhoCriptografado = v => 24 + 1 + 32 + 1 + Buffer.byteLength(String(v), 'utf8') * 2;

/**
 * Valida e normaliza os dados recebidos para a tabela.
 * Retorna { valores } com as chaves em maiúsculas (nomes de coluna confiáveis) ou { erro }.
 * parcial: true no UPDATE (só os campos enviados são validados).
 */
export function validarDados(tabela, dados, { parcial = false } = {}) {
    const regras = REGRAS[tabela];
    if (!regras) throw new Error(`Sem regras para a tabela ${tabela}`);
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return { erro: 'Dados inválidos' };

    const valores = {};
    for (const [chave, bruto] of Object.entries(dados)) {
        const campo = chave.toUpperCase();
        if (campo === 'UPDATED_AT') continue;
        if (!Object.hasOwn(regras, campo)) return { erro: `Campo inválido: ${chave}` };

        const regra = regras[campo];
        const { valor, erro } = normalizar(regra, bruto);
        if (erro) return { erro: `${regra.rotulo}: ${erro}` };
        if (regra.maxCripto && valor != null && tamanhoCriptografado(valor) > regra.maxCripto) {
            return { erro: `${regra.rotulo}: texto muito longo` };
        }
        valores[campo] = valor;
    }

    for (const [campo, regra] of Object.entries(regras)) {
        if (!regra.obrigatorio) continue;
        const enviado = Object.hasOwn(valores, campo);
        if ((enviado && valores[campo] == null) || (!enviado && !parcial)) {
            return { erro: `${regra.rotulo} é obrigatório` };
        }
    }

    return { valores };
}

// Senha: 8 a 60 caracteres, com pelo menos uma letra e um número
export function senhaInvalida(senha) {
    if (typeof senha !== 'string' || senha.length < 8 || senha.length > 60) {
        return 'A senha deve ter entre 8 e 60 caracteres';
    }
    if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
        return 'A senha deve ter pelo menos uma letra e um número';
    }
    return null;
}

// ID positivo vindo de rota/query/body
export function paraId(valor) {
    const n = typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : valor;
    return Number.isInteger(n) && n > 0 ? n : null;
}
