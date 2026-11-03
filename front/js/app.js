/* ===============================================================
   VINDIX — Front-end v2.2
   =============================================================== */
(() => {
  'use strict';

  const CONFIG = {
    // Mesmo endereço da página quando o back-end serve o front; no Live Server aponta para a porta 8080
    API_BASE:      ['5500','5501'].includes(window.location.port)
                     ? `${window.location.protocol}//${window.location.hostname}:8080`
                     : window.location.origin,
    TOKEN_KEY:     'vindix:token',
    USER_KEY:      'vindix:user',
    PERMS_KEY:     'vindix:perms',
    USER_ID_KEY:   'vindix:uid',
    TOAST_TIMEOUT: 4000,
    MAX_TOASTS:    3,
  };

  const EP = {
    login:'/login', usuarios:'/usuarios', usrNome:'/usuarios/nome',
    usrSenha:'/usuarios/senha', usrPerms:'/usuarios/permissoes',
    perms:'/permissoes', cadastros:'/cadastros', relacao:'/cadastrosRelacao',
    consultas:'/consultas', esp:'/especialidade',
    gStatus:'/google/status', gConectar:'/google/conectar', logout:'/logout', agenda:'/agendamentos',
  };

  const PERMS_MAP = {
    1:{label:'Acesso total'}, 2:{label:'Usuários — Geral'},
    10:{label:'Cadastro — Geral'}, 11:{label:'Cadastro — Acessar'},
    12:{label:'Cadastro — Inserir'}, 13:{label:'Cadastro — Alterar'},
    14:{label:'Cadastro — Excluir'}, 15:{label:'Cadastro — Histórico'},
    20:{label:'Consultas — Geral'}, 21:{label:'Consultas — Acessar'},
    22:{label:'Consultas — Inserir'}, 23:{label:'Consultas — Alterar'},
    24:{label:'Consultas — Excluir'}, 25:{label:'Consultas — Histórico'},
    30:{label:'Especialidades — Geral'}, 31:{label:'Especialidades — Acessar'},
    32:{label:'Especialidades — Inserir'}, 33:{label:'Especialidades — Alterar'},
    34:{label:'Especialidades — Excluir'}, 35:{label:'Especialidades — Histórico'},
    40:{label:'Agenda — Geral'}, 41:{label:'Agenda — Acessar'},
    42:{label:'Agenda — Agendar'}, 43:{label:'Agenda — Reagendar'},
    44:{label:'Agenda — Cancelar'}, 45:{label:'Agenda — Histórico'},
    50:{label:'Resumo'},
    60:{label:'Financeiro — Geral'}, 61:{label:'Financeiro — Acessar'},
    62:{label:'Financeiro — Inserir'}, 63:{label:'Financeiro — Alterar'},
    64:{label:'Financeiro — Excluir'}, 65:{label:'Financeiro — Histórico'},
  };

  // Avaliação da evolução do paciente em cada sessão (1 a 5)
  const EVOLUCAO = {1:'Regrediu',2:'Sem avanço',3:'Avanço leve',4:'Bom avanço',5:'Avanço expressivo'};

  const STATUS_AGENDAMENTO = {
    AGENDADO:  {label:'Agendado',  badge:'badge--info'},
    REALIZADO: {label:'Realizado', badge:'badge--success'},
    FALTOU:    {label:'Faltou',    badge:'badge--warning'},
    CANCELADO: {label:'Cancelado', badge:'badge--danger'},
  };

  const COR_GOOGLE = {
    0:null, 1:'#7986cb', 2:'#33b679', 3:'#8e24aa', 4:'#e67c73',
    5:'#f6c026', 6:'#f5511d', 7:'#039be5', 8:'#616161',
    9:'#3f51b5', 10:'#0b8043', 11:'#d60000',
  };
  const NOME_COR = {
    0:'Sem cor',1:'Lavanda',2:'Sálvia',3:'Uva',4:'Flamingo',
    5:'Banana',6:'Tangerina',7:'Pavão',8:'Grafite',
    9:'Mirtilo',10:'Basílio',11:'Tomate',
  };

  // Sessão guardada por aba: cada aba pode ter um usuário logado diferente.
  // Acessos protegidos com try/catch (navegação privada ou armazenamento bloqueado)
  const sessao = {
    get(k){try{return sessionStorage.getItem(k);}catch{return null;}},
    set(k,v){try{sessionStorage.setItem(k,v);}catch{}},
    del(k){try{sessionStorage.removeItem(k);}catch{}},
  };

  /* STATE */
  const S = {
    token:null, userName:'', userId:null, permissoes:[],
    currentPage:null, empresa:null,
    cadastros:[], consultas:[], especialidades:[], usuarios:[], todasPerms:[], agendamentos:[],
    // Listas paginadas: total no servidor; profissionais completos; nomes e cadastros já vistos (por ID)
    totais:{cadastros:0,consultas:0,agendamentos:0}, terapeutas:[], nomes:new Map(), cad:new Map(),
    cadastrosFilter:'all',
    sidebarCollapsed:false,
    ed:{ pessoaId:null, pessoaUA:null, consultaId:null, consultaUA:null, consultaAgendamento:null,
         agendaId:null, agendaUA:null,
         espId:null, espUA:null, usuarioId:null, usuarioUA:null },
  };

  // Cada página de lista traz no máximo 100 registros (o resto vem em "Carregar mais")
  const POR_PAGINA = 100;

  // Guarda os nomes (e os cadastros) que já passaram pela tela, para mostrar nomes no lugar de IDs
  function lembrarCadastros(lista){
    for(const c of lista){S.nomes.set(c.id,c.nome);c._relacoes=Array.isArray(c.vinculos)?c.vinculos:(c._relacoes||[]);S.cad.set(c.id,c);}
  }
  function lembrarNomes(lista,pares){
    for(const x of lista)for(const [id,nome] of pares)if(x[id]&&x[nome])S.nomes.set(x[id],x[nome]);
  }
  // Rodapé das listas: quantos estão na tela e o botão para trazer a próxima página
  function rodapeLista(qtd,total,id){
    if(total<=qtd)return total>POR_PAGINA?`<div class="lista-mais"><span>Todos os ${total} registros na tela</span></div>`:'';
    return `<div class="lista-mais"><span>Mostrando ${qtd} de ${total}</span>
      <button class="btn btn--secondary" type="button" id="${id}">Carregar mais ${Math.min(POR_PAGINA,total-qtd)}</button></div>`;
  }
  async function carregarMais(btn,fn){
    btn.setAttribute('aria-busy','true');btn.disabled=true;
    try{await fn();}catch(err){ui.error('Erro',err.message);btn.disabled=false;btn.removeAttribute('aria-busy');}
  }
  // Profissionais são poucos: a lista vem completa (página a página) e alimenta os campos de seleção
  async function carregarTerapeutas(){
    if(!temPerm(1,10,11))return;
    const todos=[];
    for(let pagina=1;pagina<=50;pagina++){
      const {itens,total}=await api.cadastros({tipo:'Terapeuta',pagina});
      todos.push(...itens);
      if(!itens.length||todos.length>=total)break;
    }
    lembrarCadastros(todos);S.terapeutas=todos;
  }

  /* API */
  const api = {
    async req(method, path, body=null, {comTotal=false}={}) {
      const h = {'Content-Type':'application/json'};
      if (S.token) h['Authorization'] = `Bearer ${S.token}`;
      const opts = {method, headers:h};
      if (body !== null) opts.body = JSON.stringify(body);
      let r;
      try { r = await fetch(CONFIG.API_BASE + path, opts); }
      catch { throw new Error('Sem conexão com o servidor.'); }
      if (r.status === 401) {
        auth.logout({silent:true});
        throw new Error('Sessão expirada.');
      }
      if (!r.ok) {
        const d=await r.json().catch(()=>({}));
        if (d.trocarSenha) { auth.logout({silent:true}); throw new Error('Entre com a senha temporária para criar uma nova senha.'); }
        const erro=new Error(d.erro||`HTTP ${r.status}`);erro.status=r.status;erro.dados=d;throw erro;
      }
      if (r.status === 204) return null;
      if (comTotal) { const itens = await r.json(); return { itens: Array.isArray(itens) ? itens : [], total: Number(r.headers.get('X-Total-Count')) || 0 }; }
      return r.json();
    },
    // Lista paginada: { itens, total }
    lista: (p, params) => api.req('GET', `${p}?${new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&v!==''))}`, null, {comTotal:true}),
    async login(u, s) {
      let r;
      try { r = await fetch(CONFIG.API_BASE+EP.login,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); }
      catch { throw new Error('Sem conexão com o servidor.'); }
      if (r.status===429) throw new Error('Muitas tentativas. Aguarde 5 minutos.');
      const d = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(d.erro||`HTTP ${r.status}`);
      return d;
    },
    get:  p     => api.req('GET', p),
    post: (p,b) => api.req('POST', p, b),
    put:  (p,b) => api.req('PUT', p, b),
    del:  (p,b) => api.req('DELETE', p, b||null),

    cadastros:       params => api.lista(EP.cadastros, {por_pagina:POR_PAGINA, ...params}),
    cadastroById:    id  => api.get(`${EP.cadastros}/${id}`),
    cadastroPost:    b   => api.post(EP.cadastros, b),
    cadastroPut:     (id,b) => api.put(`${EP.cadastros}/${id}`, b),
    cadastroDel:     id  => api.del(`${EP.cadastros}/${id}`),
    cadastroHist:    id  => api.get(`${EP.cadastros}/historico/${id}`),
    cadastroHistDel: ()  => api.get(`${EP.cadastros}/historico/delete`),
    relacaoGet:      id  => api.get(`${EP.relacao}?idCadastro=${id}`),
    relacaoPost:     b   => api.post(EP.relacao, b),
    relacaoDel:      id  => api.del(`${EP.relacao}/${id}`),
    consultas:       params => api.lista(EP.consultas, {por_pagina:POR_PAGINA, ...params}),
    consultaById:    id  => api.get(`${EP.consultas}/${id}`),
    consultaPost:    b   => api.post(EP.consultas, b),
    consultaPut:     (id,b) => api.put(`${EP.consultas}/${id}`, b),
    consultaDel:     id  => api.del(`${EP.consultas}/${id}`),
    consultaHist:    id  => api.get(`${EP.consultas}/historico/${id}`),
    consultaHistDel: ()  => api.get(`${EP.consultas}/historico/delete`),
    agendaGet:       params => api.lista(EP.agenda, {por_pagina:POR_PAGINA, ...params}),
    agendaPost:      b   => api.post(EP.agenda, b),
    agendaPut:       (id,b) => api.put(`${EP.agenda}/${id}`, b),
    agendaCancelar:  id  => api.post(`${EP.agenda}/${id}/cancelar`, {}),
    agendaGoogle:    id  => api.post(`${EP.agenda}/${id}/google`, {}),
    agendaConsulta:  (id,b) => api.post(`${EP.agenda}/${id}/consulta`, b),
    agendaHist:      id  => api.get(`${EP.agenda}/historico/${id}`),
    espGet:          ()  => api.get(EP.esp),
    espPost:         b   => api.post(EP.esp, b),
    espPut:          (id,b) => api.put(`${EP.esp}/${id}`, b),
    espDel:          id  => api.del(`${EP.esp}/${id}`),
    espHist:         id  => api.get(`${EP.esp}/historico/${id}`),
    espHistDel:      ()  => api.get(`${EP.esp}/historico/delete`),
    usuariosGet:     ()  => api.get(EP.usuarios),
    usuarioPost:     b   => api.post(EP.usuarios, b),
    usuarioNome:     b   => api.put(EP.usrNome, b),
    usuarioSenha:    b   => api.put(EP.usrSenha, b),
    usuarioRedefinir: id => api.post(`${EP.usuarios}/${id}/redefinir-senha`, {}),
    permsGet:        ()  => api.get(EP.perms),
    permsUser:       id  => api.get(`${EP.usrPerms}?usuario=${id}`),
    permAdd:         b   => api.post(EP.usrPerms, b),
    permDel:         b   => api.del(EP.usrPerms, b),
    permHist:        id  => api.get(`${EP.usrPerms}/historico/${id}`),
    gStatus:         ()  => api.get(EP.gStatus),
    gDesconectar:    ()  => api.del(EP.gConectar),
    // Abre a janela já no clique (evita bloqueio de popup) e depois busca a URL com o token
    async gConectar() {
      const p=window.open('','google-oauth','width=520,height=680');
      if(!p){ui.warning('Janela bloqueada','Permita janelas pop-up neste site e tente novamente.');return false;}
      try{ const {url}=await api.get(EP.gConectar); p.opener=null; p.location.href=url; return true; }
      catch(err){ p.close(); throw err; }
    },
  };

  /* UTILS */
  const $  = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => Array.from(r.querySelectorAll(s));
  const esc = s => s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const icon = (id,sz=16) => `<svg class="icon" aria-hidden="true" style="width:${sz}px;height:${sz}px"><use href="#i-${id}"></use></svg>`;
  // Ações da linha: as principais ficam à vista; o resto vai para o menu "⋯" (mesmos botões, com o título como texto)
  const acoesLinha = (principais,outras=[]) => {
    const extra=outras.filter(Boolean);
    return principais.filter(Boolean).join('')+(extra.length?`<div class="mais-acoes"><button class="icon-btn" type="button" data-mais aria-haspopup="menu" aria-expanded="false" title="Mais ações">${icon('more')}</button><div class="mais-acoes__menu" role="menu" hidden>${extra.join('')}</div></div>`:'');
  };
  const initials = n => n?n.trim().split(/\s+/).slice(0,2).map(s=>s[0].toUpperCase()).join(''):'?';
  const debounce = (fn,w=200) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),w); }; };
  const temPerm = (...ids) => ids.some(id=>S.permissoes.includes(id));
  // Preço e repasse são do financeiro (o back só manda/aceita para quem tem a permissão)
  const finVer = () => !S.profissional&&temPerm(1,60,61);
  const finAlterar = () => !S.profissional&&temPerm(1,60,63);
  const fieldErr = (el,show) => el?.closest('.field')?.classList.toggle('has-error',show);
  // Mesma política do back-end: 8 a 60 caracteres, com letra e número
  const senhaFraca = s => s.length<8||s.length>60||!/[A-Za-z]/.test(s)||!/\d/.test(s);

  function formatDateBR(s) {
    if (!s) return '—';
    // Backend devolve datas como texto local ("YYYY-MM-DD" / "YYYY-MM-DDTHH:MM:SS")
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [d,t]=s.split(/[T\s]/), [Y,M,D]=d.split('-');
      return `${D}/${M}/${Y}${t&&t!=='00:00:00'&&!t.startsWith('00:00')?' '+t.slice(0,5):''}`;
    }
    return s;
  }
  // Rótulo dos campos do banco no histórico (mesmos textos dos formulários)
  const CAPTIONS_CAMPOS = {
    // Cadastros
    NOME: 'Nome completo', TIPO: 'Tipo', DT_NASC: 'Nascimento', TELEFONE: 'Telefone',
    CPF: 'CPF', REGISTRO_PROFISSIONAL: 'Registro profissional', DIAGNOSTICO: 'Diagnóstico',
    // Consultas
    DT_HR_SESSAO: 'Data e hora da sessão', TEMPO_SESSAO: 'Duração', ID_TERAPEUTA: 'Profissional',
    // Agendamentos
    DT_HR_AGENDADA: 'Data e hora agendadas', TEMPO_PREVISTO: 'Duração prevista', STATUS: 'Status',
    ID_ESPECIALIDADE: 'Especialidade', ID_PACIENTE: 'Paciente', RESUMO_SESSAO: 'Resumo da sessão',
    // Especialidades
    DESCRICAO: 'Descrição', ID_COR: 'Cor no Google Agenda', INATIVO: 'Status', EVOLUCAO: 'Evolução do paciente',
    // Permissões / relações
    ID_USUARIO: 'Usuário', ID_PERMISSAO: 'Permissão',
    ID_CADASTRO: 'Cadastro', ID_ESPECIALIDADE_TERAPEUTA: 'Especialidade do profissional',
    // Faltas, financeiro, metas e lista de espera
    FALTA_JUSTIFICADA: 'Falta justificada', VALOR_CENTAVOS: 'Valor', REPASSE_PERCENTUAL: 'Repasse (%)',
    QTD_SESSOES: 'Quantidade de sessões', DT_COMPRA: 'Data da compra', DT_PAGAMENTO: 'Data do pagamento',
    FORMA: 'Forma de pagamento', REFERENTE: 'Referente a', OBS: 'Observação', PREFERENCIA: 'Preferência de horário',
  };
  // Campo sem caption cadastrado: "ALGUM_CAMPO" -> "Algum campo"
  function captionCampo(campo) {
    if (!campo) return '';
    const c = String(campo).toUpperCase();
    if (CAPTIONS_CAMPOS[c]) return CAPTIONS_CAMPOS[c];
    const t = c.toLowerCase().replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  // Valores do histórico: datas/horas em qualquer parte do texto viram formato BR
  function formatValorHist(v) {
    if (v == null || v === '') return '—';
    return String(v)
      .replace(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?/g,
               (_,Y,M,D,h) => `${D}/${M}/${Y}${h?' '+h:''}`)
      .replace(/^(\d{2}:\d{2}):\d{2}$/, '$1');
  }
  // Valor de um campo no histórico: IDs viram nomes quando o registro está carregado
  function valorCampoHist(campo, valor) {
    if (valor == null || valor === '') return '—';
    const c = String(campo || '').toUpperCase(), id = Number(valor);
    const nomeCadastro = () => S.nomes.get(id);
    const resolvedores = {
      ID_PACIENTE: nomeCadastro, ID_TERAPEUTA: nomeCadastro, ID_CADASTRO: nomeCadastro,
      ID_ESPECIALIDADE: () => S.especialidades.find(e => e.id === id)?.descricao,
      ID_USUARIO:       () => S.usuarios.find(u => u.id === id)?.nome,
      ID_PERMISSAO:     () => PERMS_MAP[id]?.label,
      INATIVO:          () => ({ S: 'Inativo', N: 'Ativo' })[valor],
      FALTA_JUSTIFICADA:() => ({ S: 'Sim', N: 'Não' })[valor],
      VALOR_CENTAVOS:   () => Number.isFinite(id) ? reais(id) : null,
      EVOLUCAO:         () => EVOLUCAO[valor] ? `${valor}, ${EVOLUCAO[valor]}` : null,
      STATUS:           () => STATUS_AGENDAMENTO[valor]?.label,
    };
    const nome = resolvedores[c]?.();
    if (nome) return c.startsWith('ID_') ? `${nome} (#${valor})` : nome;
    return formatValorHist(valor);
  }
  // Resumo de exclusão ("CAMPO: valor" por linha) com rótulos e valores legíveis
  function resumoHist(texto) {
    if (!texto) return '—';
    return String(texto).split('\n').map(linha => {
      const m = linha.match(/^([A-Z_]+): (.*)$/);
      return m ? `${captionCampo(m[1])}: ${valorCampoHist(m[1], m[2])}` : formatValorHist(linha);
    }).join('\n');
  }
  function validarCPF(cpf) {
    const n=(cpf||'').replace(/\D/g,'');
    if(n.length!==11||/^(\d)\1{10}$/.test(n))return false;
    let s=0;for(let i=0;i<9;i++)s+=+n[i]*(10-i);
    let r=11-s%11;if(r>=10)r=0;if(r!==+n[9])return false;
    s=0;for(let i=0;i<10;i++)s+=+n[i]*(11-i);
    r=11-s%11;if(r>=10)r=0;return r===+n[10];
  }
  function maskCPF(v){
    return v.replace(/\D/g,'').slice(0,11)
      .replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');
  }
  function maskTel(v){
    const d=v.replace(/\D/g,'').slice(0,11);
    if(d.length<=10)
      return d.replace(/(\d{2})(\d)/,'($1) $2').replace(/(\d{4})(\d)/,'$1-$2');
    return d.replace(/(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2');
  }
  const nomeCad = id => S.nomes.get(+id) ?? `#${id}`;
  const nomeEsp = id => { const e=S.especialidades.find(x=>x.id===+id); return e?e.descricao:`#${id}`; };
  function corDot(idCor, size=12) {
    const cor=COR_GOOGLE[idCor||0];
    return cor
      ? `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${cor};border:1.5px solid rgba(0,0,0,.15);vertical-align:middle;flex-shrink:0"></span>`
      : `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:var(--line);border:1.5px solid var(--line-strong);vertical-align:middle;flex-shrink:0"></span>`;
  }

  /* UI */
  const ui = {
    toast(type,title,msg) {
      const box=$('#toasts'); if(!box)return;
      // No máximo MAX_TOASTS na tela: o novo entra e os mais antigos saem na hora (mesmo os que já estavam fechando)
      const toasts=[...$$('.toast',box)];
      toasts.slice(0,Math.max(0,toasts.length-CONFIG.MAX_TOASTS+1)).forEach(x=>x.remove());
      const ico=({success:'check',error:'alert',warning:'alert',info:'info'})[type]||'info';
      const t=document.createElement('div');
      t.className=`toast toast--${type}`;t.setAttribute('role','status');
      t.innerHTML=`<div class="toast__icon">${icon(ico,15)}</div>
        <div class="toast__body"><div class="toast__title">${esc(title)}</div>${msg?`<div class="toast__msg">${esc(msg)}</div>`:''}</div>
        <button class="toast__close" aria-label="Fechar">${icon('close',13)}</button>`;
      box.appendChild(t);
      const close=()=>{t.classList.add('toast--closing');setTimeout(()=>t.remove(),200);};
      t.querySelector('.toast__close').addEventListener('click',close);
      setTimeout(close,CONFIG.TOAST_TIMEOUT);
    },
    success(t,m){this.toast('success',t,m);},
    error(t,m){this.toast('error',t,m);},
    warning(t,m){this.toast('warning',t,m);},
    info(t,m){this.toast('info',t,m);},

    openModal(id) {
      const m=document.getElementById(id); if(!m)return;
      // O último modal aberto fica por cima (ex.: novo pacote aberto de dentro do extrato)
      const abertos=[...$$('.modal.is-open')].filter(x=>x!==m);
      m.style.zIndex=abertos.length?Math.max(...abertos.map(x=>+x.style.zIndex||60))+1:'';
      m.classList.add('is-open');
      const f=m.querySelector('input:not([disabled]),select,textarea');
      if(f) setTimeout(()=>f.focus(),80);
    },
    closeModal(id){document.getElementById(id)?.classList.remove('is-open');},
    closeAllModals(){$$('.modal.is-open').forEach(m=>{delete m.dataset.bloqueado;m.classList.remove('is-open');});},

    // Pergunta com várias respostas; resolve com o valor escolhido (null = voltou)
    escolher(titulo,msg,opcoes,{voltar='Voltar'}={}){
      return new Promise(resolve=>{
        $('#escolha-title').textContent=titulo;$('#escolha-msg').textContent=msg;
        const box=$('#escolha-opcoes'),m=$('#modal-escolha');box.replaceChildren();
        let feito=false;
        const fim=v=>{if(feito)return;feito=true;obs.disconnect();this.closeModal('modal-escolha');resolve(v);};
        for(const o of [...opcoes,{valor:null,rotulo:voltar,estilo:'ghost'}]){
          const b=document.createElement('button');b.type='button';b.className=`btn btn--${o.estilo||'secondary'}`;b.textContent=o.rotulo;
          b.addEventListener('click',()=>fim(o.valor));box.appendChild(b);
        }
        // Fechar pelo fundo ou Esc conta como "voltar"
        const obs=new MutationObserver(()=>{if(!m.classList.contains('is-open'))fim(null);});
        this.openModal('modal-escolha');
        obs.observe(m,{attributes:true,attributeFilter:['class']});
        box.querySelector('.btn')?.focus();
      });
    },
    confirm(title,msg,onOk) {
      $('#confirm-title').textContent=title;
      $('#confirm-msg').textContent=msg;
      const btn=$('#confirm-ok');
      const fr=btn.cloneNode(true);
      btn.parentNode.replaceChild(fr,btn);
      fr.addEventListener('click',()=>{this.closeModal('modal-confirm');onOk&&onOk();});
      this.openModal('modal-confirm');
    },

    skeleton(rows=5){
      let h='<div class="skeleton-rows">';
      for(let i=0;i<rows;i++){const w=30+Math.random()*60;h+=`<div class="sk-row"><div class="sk-bar" style="width:${w}%"></div><div class="sk-bar" style="width:80px"></div></div>`;}
      return h+'</div>';
    },
    emptyState(ico,title,msg,compact=false){
      return `<div class="state state--empty${compact?' state--compact':''}"><div class="state__icon">${icon(ico,24)}</div><h4>${esc(title)}</h4>${msg?`<p>${esc(msg)}</p>`:''}</div>`;
    },
    errorState(title,msg){
      return `<div class="state state--error"><div class="state__icon">${icon('alert',24)}</div><h4>${esc(title)}</h4>${msg?`<p>${esc(msg)}</p>`:''}</div>`;
    },
    renderHistorico(container, rows) {
      if (!rows || !rows.length) {
        container.innerHTML = this.emptyState('history', 'Sem alterações', 'Nenhuma modificação registrada.', true);
        return;
      }

      const html = rows.map(r => {
        const data   = esc(formatDateBR(r.dthr));
        const campo  = r.campo || null;
        const antigo = r.valor_antigo ?? null;
        const novo   = r.valor_novo   ?? null;
        const tipo   = r.tipo || 'UPDATE';
        const usr    = r.nome_usuario && r.id_usuario != null
                         ? `${r.nome_usuario} - ${r.id_usuario}`
                         : (r.nome_usuario || r.id_usuario || '—');

        // DELETE — campo removido (permissão/vínculo) ou resumo do registro excluído
        if (tipo === 'DELETE' || (!campo && antigo)) {
          const detalhe = campo ? `${captionCampo(campo)}: ${valorCampoHist(campo, antigo)}` : resumoHist(antigo);
          return `
          <div class="hist-card hist-card--delete">
            <div class="hist-card__header">
              <span class="badge badge--danger">${campo ? 'REMOÇÃO' : 'EXCLUSÃO'}</span>
              <span class="hist-card__date">${data}</span>
              <span class="hist-card__usr">por ${esc(usr)}</span>
            </div>
            <pre class="hist-card__blob">${esc(detalhe)}</pre>
          </div>`;
        }

        // INSERT — quem incluiu e quando (e o que foi concedido/vinculado, se houver)
        if (tipo === 'INSERT') {
          return `
          <div class="hist-card hist-card--insert">
            <div class="hist-card__header">
              <span class="badge badge--success">INCLUSÃO</span>
              <span class="hist-card__date">${data}</span>
              <span class="hist-card__usr">por ${esc(usr)}</span>
            </div>
            ${campo ? `<pre class="hist-card__blob">${esc(`${captionCampo(campo)}: ${valorCampoHist(campo, novo)}`)}</pre>` : ''}
          </div>`;
        }

        // UPDATE — exibe campo, antes e depois em linha
        return `
        <div class="hist-card hist-card--update">
          <div class="hist-card__header">
            <span class="hist-card__campo">${esc(captionCampo(campo))}</span>
            <span class="hist-card__date">${data}</span>
            <span class="hist-card__usr">por ${esc(usr)}</span>
          </div>
          <div class="hist-card__valores">
            <div class="hist-card__valor hist-card__valor--ant">
              <span class="hist-card__label">Antes</span>
              <span class="hist-valor-ant">${esc(valorCampoHist(campo, antigo))}</span>
            </div>
            <svg class="icon" style="width:14px;height:14px;color:var(--ink-3);flex-shrink:0;margin-top:18px" aria-hidden="true"><use href="#i-arrow-right"></use></svg>
            <div class="hist-card__valor hist-card__valor--nov">
              <span class="hist-card__label">Depois</span>
              <span class="hist-valor-nov">${esc(valorCampoHist(campo, novo))}</span>
            </div>
          </div>
        </div>`;
      }).join('');

      container.innerHTML = `<div class="hist-list">${html}</div>`;
    },
  };

  /* MODAL TABS */
  function initModalTabs(modalId){
    const m=document.getElementById(modalId); if(!m)return;
    m.querySelectorAll('.modal-tab').forEach(tab=>{
      tab.addEventListener('click',()=>{
        m.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('modal-tab--active'));
        m.querySelectorAll('.modal-tab-panel').forEach(p=>p.classList.remove('modal-tab-panel--active'));
        tab.classList.add('modal-tab--active');
        m.querySelector(`#tab-${tab.dataset.tab}`)?.classList.add('modal-tab-panel--active');
      });
    });
  }
  // novo: inclusão (a aba de histórico não tem o que mostrar)
  function resetModalTabs(modalId,{novo=false}={}){
    const m=document.getElementById(modalId); if(!m)return;
    m.querySelectorAll('.modal-tab').forEach((t,i)=>{
      t.classList.toggle('modal-tab--active',i===0);
      t.hidden=novo&&t.dataset.tab.includes('historico');
    });
    m.querySelectorAll('.modal-tab-panel').forEach((p,i)=>p.classList.toggle('modal-tab-panel--active',i===0));
    // Uma aba só (ex.: inclusão sem histórico): a barra de abas não precisa aparecer
    const barra=m.querySelector('.modal-tabs');
    if(barra)barra.hidden=m.querySelectorAll('.modal-tab:not([hidden])').length<2;
    const rodape=m.querySelector('.modal__foot--fixo');if(rodape)rodape.hidden=false;
  }
  // Só o histórico (botão de histórico da lista): as abas de edição ficam escondidas
  function modoHistorico(modalId,tabName){
    const m=document.getElementById(modalId); if(!m)return;
    m.querySelectorAll('.modal-tab').forEach(t=>{t.hidden=t.dataset.tab!==tabName;});
    const barra=m.querySelector('.modal-tabs');if(barra)barra.hidden=true;
    const rodape=m.querySelector('.modal__foot--fixo');if(rodape)rodape.hidden=true;
    gotoModalTab(modalId,tabName);
  }
  function gotoModalTab(modalId,tabName){
    const m=document.getElementById(modalId); if(!m)return;
    m.querySelectorAll('.modal-tab').forEach(t=>t.classList.toggle('modal-tab--active',t.dataset.tab===tabName));
    m.querySelectorAll('.modal-tab-panel').forEach(p=>p.classList.toggle('modal-tab-panel--active',p.id===`tab-${tabName}`));
  }

  // Copia o texto de um campo. A API moderna (navigator.clipboard) só existe em HTTPS ou localhost:
  // acessando pelo IP da rede o celular não tem, então usa a cópia clássica, que funciona sem HTTPS.
  // Precisa rodar dentro do toque/clique (sem await antes), senão o navegador bloqueia.
  async function copiarCampo(campo){
    if(window.isSecureContext&&navigator.clipboard){
      try{await navigator.clipboard.writeText(campo.value);return true;}catch{}
    }
    const {readOnly,inputMode}=campo;
    campo.readOnly=false;campo.inputMode='none';      // iPhone só copia de campo editável; sem abrir teclado
    campo.focus({preventScroll:true});
    campo.setSelectionRange(0,campo.value.length);
    let copiou=false;
    try{copiou=document.execCommand('copy');}catch{}
    campo.readOnly=readOnly;campo.inputMode=inputMode;
    campo.blur();window.getSelection()?.removeAllRanges();
    return copiou;
  }

  /* AUTH */
  const auth = {
    init(){
      // Remove a sessão antiga que ficava no localStorage (compartilhada entre abas)
      try{[CONFIG.TOKEN_KEY,CONFIG.USER_KEY,CONFIG.PERMS_KEY,CONFIG.USER_ID_KEY].forEach(k=>localStorage.removeItem(k));}catch{}
      const token=sessao.get(CONFIG.TOKEN_KEY);
      const user=sessao.get(CONFIG.USER_KEY);
      const perms=sessao.get(CONFIG.PERMS_KEY);
      const uid=sessao.get(CONFIG.USER_ID_KEY);
      if(token&&user){
        S.token=token; S.userName=user;
        S.userId=uid?parseInt(uid,10):null;
        S.permissoes=perms?JSON.parse(perms):[];
        try{
          const pr=JSON.parse(sessao.get('vindix:prof')||'null');
          S.profissional=pr&&Number.isInteger(pr.id)?{id:pr.id,nome:String(pr.nome||'')}:null;
        }catch{S.profissional=null;}
        this.enterApp();
      } else this.showLogin();

      $('#form-login').addEventListener('submit',async e=>{e.preventDefault();await this.handleLogin();});
      $('#btn-toggle-pass').addEventListener('click',()=>{
        const i=$('#input-pass'),hide=i.type==='password';
        i.type=hide?'text':'password';
        $('#btn-toggle-pass svg use').setAttribute('href',hide?'#i-eye-off':'#i-eye');
      });
      $('#btn-logout').addEventListener('click',()=>ui.confirm('Sair do sistema?','Você precisará fazer login novamente.',()=>this.logout()));
      $('#st-copiar').addEventListener('click',async()=>{
        const campo=$('#st-senha');
        if(await copiarCampo(campo)){ui.success('Senha copiada');return;}
        campo.select();
        ui.info('Senha selecionada',matchMedia('(pointer: coarse)').matches?'Toque e segure no campo para copiar.':'Use Ctrl+C para copiar.');
      });
      // A senha temporária não fica na tela depois de fechar; usuário novo segue para as permissões
      $('#modal-senha-temporaria').addEventListener('click',e=>{
        if(!e.target.closest('[data-modal-close]'))return;
        $('#st-senha').value='';
        const novo=S.ed.permissoesAposSenha;S.ed.permissoesAposSenha=null;
        if(novo)pages.usuarios.openEdit(novo).then(()=>gotoModalTab('modal-usuario','usr-permissoes'));
      });
      $('#btn-minha-senha').addEventListener('click',()=>{
        this.liberarModalSenha();
        ['u-senha-atual','u-nova-senha','u-nova-senha2'].forEach(id=>{$('#'+id).value='';fieldErr($('#'+id),false);});
        ui.openModal('modal-minha-senha');
      });
      $('#form-alterar-senha').addEventListener('submit',e=>pages.usuarios.alterarSenha(e));
    },

    async handleLogin(){
      const btn=$('#btn-login');
      const usuario=$('#input-user').value.trim();
      const senha=$('#input-pass').value;
      if(!usuario||!senha){ui.error('Campos obrigatórios','Preencha usuário e senha.');return;}
      if(senha.length>60){ui.error('Senha inválida','Máximo 60 caracteres.');return;}
      btn.setAttribute('aria-busy','true');
      btn.querySelector('.btn__label').textContent='Entrando…';
      try {
        const data=await api.login(usuario,senha);
        if(data.trocarSenha){this.exigirTrocaSenha(data,usuario,senha);return;}
        this.concluirLogin(data,usuario);
      } catch(err){
        $('#login-error-msg').textContent=err.message;
        $('#login-error').hidden=false;
      } finally{
        btn.removeAttribute('aria-busy');
        btn.querySelector('.btn__label').textContent='Entrar';
      }
    },

    concluirLogin(data,usuario){
      S.token=data.token; S.userName=data.nome||usuario; S.userId=data.id;
      S.permissoes=Array.isArray(data.permissoes)?data.permissoes:[];
      S.profissional=data.profissional&&Number.isInteger(data.profissional.id)?{id:data.profissional.id,nome:String(data.profissional.nome||'')}:null;
      sessao.set('vindix:prof',JSON.stringify(S.profissional));
      sessao.set(CONFIG.TOKEN_KEY,S.token);
      sessao.set(CONFIG.USER_ID_KEY,String(S.userId));
      sessao.set(CONFIG.USER_KEY,S.userName);
      sessao.set(CONFIG.PERMS_KEY,JSON.stringify(S.permissoes));
      ui.success('Bem-vindo!',`Olá, ${S.userName}.`);
      this.enterApp();
    },

    // Senha redefinida pelo administrador: cria a senha nova antes de entrar
    // (o token não é guardado e o back-end só aceita a troca de senha)
    exigirTrocaSenha(data,usuario,senhaTemporaria){
      S.token=data.token;
      S.trocaObrigatoria={usuario};
      ['u-senha-atual','u-nova-senha','u-nova-senha2'].forEach(id=>{$('#'+id).value='';fieldErr($('#'+id),false);});
      $('#u-senha-atual').value=senhaTemporaria;
      $('#u-senha-atual').closest('.field').hidden=true;
      $('#modal-minha-senha-title').textContent='Crie uma nova senha';
      $('#minha-senha-aviso').hidden=false;
      $('#modal-minha-senha').dataset.bloqueado='true';
      ui.openModal('modal-minha-senha');
    },
    // Volta o modal "Minha senha" ao normal
    liberarModalSenha(){
      S.trocaObrigatoria=null;
      $('#u-senha-atual').closest('.field').hidden=false;
      $('#modal-minha-senha-title').textContent='Alterar minha senha';
      $('#minha-senha-aviso').hidden=true;
      delete $('#modal-minha-senha').dataset.bloqueado;
    },

    enterApp(){
      $('#screen-login').classList.remove('screen--active');
      $('#screen-app').classList.add('screen--active');
      $('#user-name').textContent=S.userName;
      // Visão do profissional: o back já filtra tudo; aqui só some o que não faz sentido (ex.: filtro por profissional)
      if(S.profissional)document.body.dataset.escopo='profissional';else delete document.body.dataset.escopo;
      fotoPerfil.mostrar(null);fotoPerfil.carregar();
      this.applyNavPerms();
      marca.aplicarCorSalva();
      const pedida=location.hash.slice(1);
      nav.goto(paginaPermitida(pedida)?pedida:nav.inicial());
      marca.carregar();
      this.carregarDados();
      google.verificarStatus();
    },

    async carregarDados(){
      await Promise.allSettled([
        temPerm(1,10,11)?pages.pessoas.load({silent:true}):Promise.resolve(),
        carregarTerapeutas().catch(()=>{}),
        temPerm(1,20,21)?pages.consultas.load({silent:true}):Promise.resolve(),
        temPerm(1,40,41)?pages.agenda.load({silent:true}):Promise.resolve(),
        temPerm(1,30,31)?pages.especialidades.load({silent:true}):Promise.resolve(),
        temPerm(1,2)?pages.usuarios.load({silent:true}):Promise.resolve(),
        temPerm(1,2)?pages.usuarios.loadPerms({silent:true}):Promise.resolve(),
        pages.espera.atualizarBadge(),
      ]);
      const rl=$('#user-role-label');
      if(rl)rl.textContent=temPerm(1)?'Administrador':S.profissional?'Profissional':temPerm(2)?'Gestão de usuários':'Equipe';
      // Semana e Resumo dependem de cadastros e especialidades carregados
      if(['semana','resumo'].includes(S.currentPage))pages[S.currentPage].render();
    },

    applyNavPerms(){
      const show=(id,cond)=>{const el=document.getElementById(id);if(el)el.style.display=cond?'':'none';};
      show('nav-consultas',     temPerm(1,20,21));
      show('nav-agenda',        temPerm(1,40,41));
      show('nav-semana',        temPerm(1,40,41));
      show('nav-resumo',        temPerm(1,50));
      show('nav-group-atendimento',temPerm(1,20,21,40,41));
      show('nav-espera',        temPerm(1,40,41));
      show('nav-financeiro',    temPerm(1,60,61));
      show('nav-group-gestao',  temPerm(1,50,60,61));
      show('btn-new-espera',    temPerm(1,40,42));
      show('btn-semana-agendar',temPerm(1,40,42));
      show('nav-pessoas',       temPerm(1,10,11));
      show('nav-especialidades',temPerm(1,30,31));
      show('nav-usuarios',      temPerm(1,2));
      const gAdm=$('#nav-group-admin');if(gAdm)gAdm.style.display=temPerm(1,2)?'':'none';
      const gCad=$('#nav-group-cadastros');if(gCad)gCad.style.display=temPerm(1,10,11,30,31)?'':'none';
      const gBtn=$('#btn-connect-google');if(gBtn)gBtn.style.display=temPerm(1)?'':'none';
      const nc=$('#btn-new-consulta');if(nc)nc.style.display=temPerm(1,20,22)?'':'none';
      const na=$('#btn-new-agendamento');if(na)na.style.display=temPerm(1,40,42)?'':'none';
      const ne=$('#btn-new-esp');if(ne)ne.style.display=temPerm(1,30,32)?'':'none';
      nav.montarBarraInferior();
      const np=$('#btn-new-pessoa');if(np)np.style.display=temPerm(1,10,12)?'':'none';
      const fe=$('#form-nova-esp');if(fe)fe.style.display=temPerm(1,30,32)?'':'none';
    },

    showLogin(){
      ui.closeAllModals();
      $('#screen-login').classList.add('screen--active');
      $('#screen-app').classList.remove('screen--active');
      document.body.style.overflow='';
      $('#input-user').value='';$('#input-pass').value='';
    },

    logout({silent=false}={}){
      // Saída pelo botão: invalida o token no back-end (fetch direto para não repetir o fluxo de 401)
      if(!silent&&S.token){
        fetch(CONFIG.API_BASE+EP.logout,{method:'POST',headers:{'Authorization':`Bearer ${S.token}`}}).catch(()=>{});
      }
      marca.limpar();
      Object.values(S.logos||{}).forEach(u=>{if(u)URL.revokeObjectURL(u);});
      S.logos={};S.profissional=null;sessao.del('vindix:prof');delete document.body.dataset.escopo;
      fotoPerfil.foto=null;
      S.token=null;S.userName='';S.permissoes=[];S.userId=null;
      S.cadastros=[];S.consultas=[];S.especialidades=[];S.usuarios=[];S.agendamentos=[];
      S.terapeutas=[];S.nomes=new Map();S.cad=new Map();
      [CONFIG.TOKEN_KEY,CONFIG.USER_KEY,CONFIG.PERMS_KEY,CONFIG.USER_ID_KEY].forEach(k=>sessao.del(k));
      if(!silent)ui.info('Sessão encerrada','Até logo!');
      this.showLogin();
    },
  };

  /* GOOGLE */
  const google = {
    async verificarStatus(){
      if(!temPerm(1))return;
      try{const d=await api.gStatus();this.atualizarBotao(d.conectado);}catch{}
    },
    atualizarBotao(conectado){
      const btn=$('#btn-connect-google');if(!btn)return;
      const lbl=btn.querySelector('.only-desktop');
      btn.dataset.gc=conectado?'true':'false';
      btn.title=conectado?'Desconectar Google Agenda':'Conectar ao Google Agenda';
      if(lbl)lbl.textContent=conectado?'Google conectado':'Conectar Google';
      btn.classList.toggle('btn--google-on',conectado);
      if(S.currentPage==='agenda')pages.agenda.renderTable();
    },
    // O retorno do Google acontece no popup: consulta o status até conectar (no máximo 3 minutos)
    aguardarConexao(){
      clearInterval(this._espera);
      const limite=Date.now()+3*60*1000;
      this._espera=setInterval(async()=>{
        if(Date.now()>limite){clearInterval(this._espera);return;}
        try{
          const d=await api.gStatus();
          if(d.conectado){clearInterval(this._espera);this.atualizarBotao(true);ui.success('Google Agenda conectado');}
        }catch{clearInterval(this._espera);}
      },2000);
    },
    async handleBotao(){
      const btn=$('#btn-connect-google');if(!btn)return;
      if(btn.dataset.gc==='true'){
        ui.confirm('Desconectar Google Agenda?','Os eventos já enviados não serão removidos.',async()=>{
          try{await api.gDesconectar();this.atualizarBotao(false);ui.success('Google desconectado');}
          catch(err){ui.error('Erro',err.message);}
        });
      }else{
        try{
          if(!await api.gConectar())return;
          ui.info('Conectando…','Conclua a autenticação na janela do Google.');
          this.aguardarConexao();
        }catch(err){ui.error('Erro',err.message);}
      }
    },
  };

  /* NAV */
  // Ordem das páginas (a primeira permitida é a inicial) e permissões de cada uma
  const PAGINAS = {
    semana:         {titulo:'Calendário',                perms:[1,40,41], curto:'Calendário'},
    agenda:         {titulo:'Agendamentos',              perms:[1,40,41], curto:'Agenda'},
    consultas:      {titulo:'Sessões realizadas',        perms:[1,20,21], curto:'Sessões'},
    resumo:         {titulo:'Resumo',                    perms:[1,50], curto:'Resumo'},
    espera:         {titulo:'Lista de espera',           perms:[1,40,41], curto:'Espera'},
    financeiro:     {titulo:'Financeiro',                perms:[1,60,61], curto:'Financeiro'},
    pessoas:        {titulo:'Pacientes e profissionais', perms:[1,10,11], curto:'Cadastros'},
    especialidades: {titulo:'Especialidades',            perms:[1,30,31], curto:'Especial.'},
    usuarios:       {titulo:'Usuários',                  perms:[1,2],     curto:'Usuários'},
  };
  const paginaPermitida = p => PAGINAS[p] && temPerm(...PAGINAS[p].perms);

  const nav = {
    init(){
      $$('.nav__item').forEach(b=>b.addEventListener('click',()=>this.goto(b.dataset.page)));
      $('#btn-open-sidebar').addEventListener('click',()=>this.toggleSidebar());
      $('#btn-close-sidebar').addEventListener('click',()=>this.closeSidebarMobile());
      $('#btn-retrair-menu').addEventListener('click',()=>this.retrairMenu(document.documentElement.dataset.menu!=='retraido'));
      this.mostrarMenuRetraido();
      $('#backdrop-sidebar').addEventListener('click',()=>this.closeSidebarMobile());
      $('#tabbar').addEventListener('click',e=>{
        const b=e.target.closest('[data-page],[data-menu]');if(!b)return;
        if(b.dataset.menu)this.toggleSidebar();else this.goto(b.dataset.page);
      });
    },
    inicial(){return Object.keys(PAGINAS).find(paginaPermitida)||null;},
    goto(page){
      if(!paginaPermitida(page)){
        const alt=this.inicial();
        if(page&&PAGINAS[page])ui.warning('Sem acesso','Você não tem permissão para esta seção.');
        if(!alt||alt===page)return;
        page=alt;
      }
      S.currentPage=page;
      $$('.page').forEach(p=>p.classList.toggle('page--active',p.dataset.page===page));
      $$('.nav__item').forEach(n=>{
        const ativo=n.dataset.page===page;
        n.classList.toggle('nav__item--active',ativo);
        if(ativo)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');
      });
      $$('.tabbar__item').forEach(n=>n.classList.toggle('tabbar__item--active',n.dataset.page===page));
      this.atualizarTitulo();
      // O endereço guarda a página (recarregar mantém o lugar; dá para criar atalhos)
      history.replaceState(null,'',`#${page}`);
      const r=pages[page]?.render;if(typeof r==='function')r.call(pages[page]);
      this.closeSidebarMobile();
      window.scrollTo({top:0,behavior:'smooth'});
    },
    atualizarTitulo(){
      const t=PAGINAS[S.currentPage]?.titulo||'';
      $('#page-title').textContent=t;
      document.title=[t,S.empresa?.nome,'Vindix'].filter(Boolean).join(' | ');
    },
    // Celular: até 4 atalhos permitidos + "Menu" (abre a gaveta com tudo)
    montarBarraInferior(){
      const permitidas=Object.keys(PAGINAS).filter(paginaPermitida);
      const atalhos=permitidas.slice(0,permitidas.length>5?4:5);
      const item=(p)=>{
        const icone=$(`.nav__item[data-page="${p}"] .nav__icone`)?.innerHTML||'';
        return `<button type="button" class="tabbar__item" data-page="${p}"><span class="nav__icone">${icone}</span>${esc(PAGINAS[p].curto)}</button>`;
      };
      $('#tabbar').innerHTML=atalhos.map(item).join('')+(permitidas.length>atalhos.length
        ?`<button type="button" class="tabbar__item" data-menu="1"><span class="nav__icone">${icon('menu')}</span>Menu</button>`:'');
    },
    // Desktop: menu só com os ícones; a escolha fica guardada neste navegador
    retrairMenu(retrair){
      if(retrair)document.documentElement.dataset.menu='retraido';else delete document.documentElement.dataset.menu;
      try{if(retrair)localStorage.setItem('vindix:menu','retraido');else localStorage.removeItem('vindix:menu');}catch{}
      this.mostrarMenuRetraido();
    },
    mostrarMenuRetraido(){
      const retraido=document.documentElement.dataset.menu==='retraido',btn=$('#btn-retrair-menu'),texto=retraido?'Expandir menu':'Retrair menu';
      btn.title=texto;btn.setAttribute('aria-label',texto);btn.setAttribute('aria-expanded',String(!retraido));
    },
    toggleSidebar(){
      const aberto=!$('#sidebar').classList.contains('is-open');
      $('#sidebar').classList.toggle('is-open',aberto);
      $('#backdrop-sidebar').classList.toggle('is-open',aberto);
    },
    closeSidebarMobile(){
      $('#sidebar').classList.remove('is-open');
      $('#backdrop-sidebar').classList.remove('is-open');
    },
  };

  /* PAGES */
  const pages = {};

  function updateNavBadges(){
    const b=$('#nav-badge-agenda');
    // Com o filtro em "Agendados", o total vem do servidor (a tela pode ter só a primeira página)
    if(b)b.textContent=$('#agenda-status').value==='AGENDADO'&&!$('#search-agenda').value.trim()?S.totais.agendamentos:S.agendamentos.filter(a=>a.status==='AGENDADO').length;
  }

  // "YYYY-MM-DDTHH:MM" no horário local (para inputs datetime-local)
  function dataHoraLocal(d){
    const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Selects de terapeuta/especialidade/paciente (prefixo "c" = consulta, "a" = agendamento)
  async function popularSelectsAtendimento(pre,c){
    const selT=$(`#${pre}-terapeuta`);
    if(!S.terapeutas.length)await carregarTerapeutas().catch(()=>{});
    selT.innerHTML='<option value="">— selecione —</option>'+
      S.terapeutas
        .map(t=>`<option value="${t.id}" ${c&&c.id_terapeuta===t.id?'selected':''}>${esc(t.nome)}</option>`).join('');
    selT.onchange=()=>filtrarEspAtendimento(pre,null);
    const profissionais=selT.querySelectorAll('option[value]:not([value=""])');
    if(!c&&profissionais.length===1)selT.value=profissionais[0].value;
    const busca=$(`#${pre}-paciente-busca`);busca.value='';
    busca.oninput=debounce(()=>buscarPacientes(pre,busca.value,parseInt($(`#${pre}-paciente`).value,10)||null),300);
    await Promise.all([buscarPacientes(pre,'',c?.id_paciente??null),filtrarEspAtendimento(pre,c)]);
  }
  // Pacientes vêm do servidor conforme a busca (no máximo 30 por vez); o escolhido continua na lista
  async function buscarPacientes(pre,termo,selecionado){
    const sel=$(`#${pre}-paciente`);
    let r={itens:[],total:0};
    try{r=await api.cadastros({tipo:'Paciente',busca:termo.trim(),por_pagina:30});}
    catch(err){ui.error('Erro ao buscar pacientes',err.message);}
    lembrarCadastros(r.itens);
    const itens=[...r.itens];
    if(selecionado&&!itens.some(p=>p.id===selecionado))itens.unshift({id:selecionado,nome:nomeCad(selecionado)});
    sel.innerHTML=`<option value="">${termo.trim()&&!r.itens.length?'Nenhum paciente encontrado':'— selecione —'}</option>`+
      itens.map(p=>`<option value="${p.id}" ${p.id===selecionado?'selected':''}>${esc(p.nome)}</option>`).join('')+
      (r.total>r.itens.length?`<option value="" disabled>… mais ${r.total-r.itens.length}: digite para filtrar</option>`:'');
    if(termo.trim()&&r.itens.length===1&&!selecionado)sel.value=String(r.itens[0].id);
  }
  async function filtrarEspAtendimento(pre,c){
    const tid=parseInt($(`#${pre}-terapeuta`).value,10)||null;
    const selE=$(`#${pre}-especialidade`);
    if(!tid){selE.innerHTML='<option value="">— selecione o profissional primeiro —</option>';return;}
    const ter=S.terapeutas.find(x=>x.id===tid);
    if(ter&&!ter._relacoes){
      try{const r=await api.relacaoGet(tid);ter._relacoes=Array.isArray(r)?r:[];}
      catch{ter._relacoes=[];}
    }
    const rels=ter?._relacoes||[];
    // Especialidades vinculadas ao terapeuta (ou todas as ativas se não houver vínculo);
    // a especialidade atual aparece mesmo se tiver sido inativada depois
    const esps=S.especialidades.filter(e=>(c&&c.id_especialidade===e.id)||
      (e.inativo!=='S'&&(!rels.length||rels.some(r=>r.id_especialidade_terapeuta===e.id))));
    selE.innerHTML='<option value="">— selecione —</option>'+
      esps.map(e=>`<option value="${e.id}" ${c&&c.id_especialidade===e.id?'selected':''}>${esc(e.descricao)}</option>`).join('');
  }

  /* Agenda (agendamentos) */
  pages.agenda = {
    render(){this.renderTable();},
    periodo(){
      return {de:$('#agenda-de').value||undefined, ate:$('#agenda-ate').value||undefined, status:$('#agenda-status').value||undefined};
    },
    async load({silent=false,mais=false}={}){
      if(!S.token||!temPerm(1,40,41))return;
      const body=$('#agenda-body'),cnt=$('#count-agenda');
      if(!silent&&!mais){body.innerHTML=ui.skeleton(5);cnt.textContent='—';}
      try{
        const pagina=mais?Math.floor(S.agendamentos.length/POR_PAGINA)+1:1;
        const {itens,total}=await api.agendaGet({...this.periodo(),busca:$('#search-agenda').value.trim(),pagina});
        lembrarNomes(itens,[['id_paciente','paciente'],['id_terapeuta','terapeuta']]);
        S.agendamentos=mais?[...S.agendamentos,...itens]:itens;S.totais.agendamentos=total;
        this.renderTable();updateNavBadges();
        if(S.currentPage==='semana')pages.semana.load();
        if(!silent)ui.success('Agenda atualizada',`${S.agendamentos.length} agendamento(s).`);
      }catch(err){
        if(!silent){body.innerHTML=ui.errorState('Falha',err.message);cnt.textContent='—';ui.error('Erro',err.message);}
      }
    },
    renderTable(){
      const body=$('#agenda-body'),cnt=$('#count-agenda');
      const list=S.agendamentos,total=S.totais.agendamentos,buscando=!!$('#search-agenda').value.trim();
      cnt.textContent=`${total} agendamento${total===1?'':'s'}`;
      if(!list.length){body.innerHTML=buscando?ui.emptyState('search','Nada encontrado','Ajuste a busca.'):ui.emptyState('calendar','Nenhum agendamento','Ajuste o período ou clique em "Agendar".');return;}
      const pE=temPerm(1,40,43),pX=temPerm(1,40,44),pH=temPerm(1,40,45),pC=temPerm(1,20,22);
      const googleOn=$('#btn-connect-google')?.dataset.gc==='true';
      const rows=list.map(a=>{
        const st=STATUS_AGENDAMENTO[a.status]||{label:a.status,badge:''};
        const aberto=a.status==='AGENDADO';
        const google=aberto?(a.no_google==='S'
          ?`<span class="badge badge--success" title="Sincronizado com o Google Agenda">${icon('check',11)} Google</span>`
          :`<span class="badge badge--warning" title="Ainda não está no Google Agenda">Pendente</span>`):'—';
        return `<tr>
          <td class="td-date">${esc(formatDateBR(a.dt_hr_agendada))}${a.id_serie?`<span class="serie-icone" title="Horário que se repete">${icon('repeat',13)}</span>`:''}</td>
          <td><div style="font-weight:500">${esc(a.paciente||'—')}</div></td>
          <td>${esc(a.terapeuta||'—')}</td>
          <td>${badgeEsp(a.id_especialidade,a.especialidade)}</td>
          <td><span class="badge ${st.badge}">${esc(st.label)}${a.status==='FALTOU'&&a.falta_justificada==='S'?' (justificada)':''}</span></td>
          <td>${google}</td>
          <td class="td-actions">${acoesLinha([
            aberto&&pC&&`<button class="icon-btn" data-act="realizar" data-id="${a.id}" title="Registrar sessão realizada">${icon('check')}</button>`,
            aberto&&pE&&`<button class="icon-btn" data-act="edit" data-id="${a.id}" title="Reagendar">${icon('edit')}</button>`,
          ],[
            aberto&&pE&&this.passou(a)&&`<button class="icon-btn" data-act="falta" data-id="${a.id}" title="Registrar falta">${icon('user-off')}</button>`,
            a.status==='FALTOU'&&pE&&`<button class="icon-btn" data-act="desfazer-falta" data-id="${a.id}" title="Desfazer falta">${icon('refresh')}</button>`,
            aberto&&pE&&googleOn&&a.no_google!=='S'&&`<button class="icon-btn" data-act="google" data-id="${a.id}" title="Enviar ao Google Agenda">${icon('google')}</button>`,
            a.id_consulta&&`<button class="icon-btn" data-act="evol" data-id="${a.id_consulta}" title="Registro de evolução">${icon('printer')}</button>`,
            pH&&`<button class="icon-btn" data-act="hist" data-id="${a.id}" title="Histórico">${icon('history')}</button>`,
            aberto&&pX&&`<button class="icon-btn icon-btn--danger" data-act="cancelar" data-id="${a.id}" title="Cancelar agendamento">${icon('close')}</button>`,
          ])}</td></tr>`;
      }).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Data/Hora</th><th>Paciente</th><th>Profissional</th><th>Especialidade</th><th>Status</th><th>Google</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${rows}</tbody></table></div>${rodapeLista(list.length,total,'mais-agenda')}`;
      $('#mais-agenda')?.addEventListener('click',e=>carregarMais(e.currentTarget,()=>this.load({silent:true,mais:true})));
      body.querySelectorAll('[data-act]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const id=parseInt(btn.dataset.id,10),ag=S.agendamentos.find(x=>x.id===id);
          const act=btn.dataset.act;
          if(act==='realizar')pages.consultas.openFromAgendamento(ag);
          else if(act==='edit')this.openEdit(id);
          else if(act==='google')this.enviarGoogle(btn,id);
          else if(act==='evol')evolucao.gerar([id],btn);
          else if(act==='hist')this.openHistorico(id);
          else if(act==='cancelar')this.cancelar(id);
          else if(act==='falta')this.falta(ag);
          else if(act==='desfazer-falta')this.desfazerFalta(ag);
        });
      });
    },
    // Mostra o resultado da sincronização com o Google devolvido pelo back-end
    // Série inteira: o Google é atualizado em segundo plano; a lista é recarregada quando ele deve ter terminado
    avisoGoogle(google,quantos=1){
      if(google==='falhou')ui.warning('Google Agenda','Não foi possível sincronizar agora. Use o botão do Google para tentar de novo.');
      if(google==='em_andamento'){
        clearTimeout(this._recarregarGoogle);
        this._recarregarGoogle=setTimeout(()=>{
          if(S.currentPage==='agenda')this.load({silent:true});
          if(S.currentPage==='semana')pages.semana.load();
        },Math.min(20000,1500+quantos*500));
      }
    },
    // espera: paciente da lista de espera (já vem escolhido; ao salvar, sai da lista)
    async openNew({espera=null}={}){
      resetModalTabs('modal-agendamento',{novo:true});
      S.ed.agendaId=null;S.ed.agendaUA=null;S.ed.agendaSerie=null;S.ed.agendaEspera=espera?.id??null;
      $('#modal-agendamento-title').textContent=espera?`Agendar ${espera.paciente}`:'Novo agendamento';
      $$('#form-agendamento .field').forEach(f=>f.classList.remove('has-error'));
      const d=new Date();d.setMinutes(0,0,0);d.setHours(d.getHours()+1);
      $('#a-data').value=dataHoraLocal(d);$('#a-tempo').value='01:00';
      $('#a-repetir-wrap').hidden=false;$('#a-repetir').checked=false;$('#a-repetir-opcoes').hidden=true;$('#a-vezes').value=12;
      $('#a-serie-wrap').hidden=true;
      if(espera)S.nomes.set(espera.id_paciente,espera.paciente);
      await popularSelectsAtendimento('a',espera?{id_paciente:espera.id_paciente,id_terapeuta:espera.id_terapeuta,id_especialidade:espera.id_especialidade}:null);
      this.fimRepeticao();
      ui.openModal('modal-agendamento');
    },
    // "Última em 23/01/2027" (ajuda a conferir a repetição antes de salvar)
    fimRepeticao(){
      const ini=lerDataHora($('#a-data').value),vezes=parseInt($('#a-vezes').value,10),intervalo=parseInt($('#a-intervalo').value,10);
      const el=$('#a-repetir-fim');
      if(!ini||!(vezes>=2&&vezes<=52)){el.textContent=vezes>52?'No máximo 52 vezes.':'';return;}
      const fim=new Date(ini);fim.setDate(fim.getDate()+(vezes-1)*7*intervalo);
      el.textContent=`Última em ${formatDateBR(dataISO(fim))}.`;
    },
    async openEdit(id){
      await this.load({silent:true});
      const ag=S.agendamentos.find(x=>x.id===id);
      if(!ag||ag.status!=='AGENDADO'){ui.warning('Agendamento indisponível','Ele foi alterado por outra pessoa. A lista foi atualizada.');return;}
      return this.abrirEdicao(ag);
    },
    async abrirEdicao(ag){
      resetModalTabs('modal-agendamento');
      S.ed.agendaId=ag.id;S.ed.agendaUA=ag.updated_at;
      $('#modal-agendamento-title').textContent='Remarcar';
      $$('#form-agendamento .field').forEach(f=>f.classList.remove('has-error'));
      $('#a-data').value=(ag.dt_hr_agendada||'').slice(0,16);
      $('#a-tempo').value=(ag.tempo_previsto||'01:00:00').slice(0,5);
      S.ed.agendaEspera=null;S.ed.agendaSerie=ag.id_serie||null;
      $('#a-repetir-wrap').hidden=true;
      $('#a-serie-wrap').hidden=!ag.id_serie;
      $$('input[name="a-aplicar"]').forEach(r=>{r.checked=r.value==='este';});
      await popularSelectsAtendimento('a',ag);
      ui.openModal('modal-agendamento');
    },
    async save(e){
      e.preventDefault();
      const data=$('#a-data').value,tempo=$('#a-tempo').value;
      const terapeuta=parseInt($('#a-terapeuta').value,10)||null;
      const especialidade=parseInt($('#a-especialidade').value,10)||null;
      const paciente=parseInt($('#a-paciente').value,10)||null;
      let ok=true;
      for(const [sel,inv] of [['#a-data',!data],['#a-tempo',!tempo||tempo==='00:00'],['#a-terapeuta',!terapeuta],['#a-especialidade',!especialidade],['#a-paciente',!paciente]]){
        fieldErr($(sel),inv);if(inv)ok=false;
      }
      if(!ok)return;
      const novo=!S.ed.agendaId,repetir=novo&&$('#a-repetir').checked;
      const vezes=parseInt($('#a-vezes').value,10);
      if(repetir&&!(vezes>=2&&vezes<=52)){fieldErr($('#a-vezes'),true);return;}
      const campos={id_paciente:paciente,id_terapeuta:terapeuta,id_especialidade:especialidade,
        dt_hr_agendada:data.replace('T',' '),tempo_previsto:tempo+':00'};
      const corpo=novo?{...campos}:{updatedAt:S.ed.agendaUA,campos};
      if(repetir)corpo.repetir={intervalo:parseInt($('#a-intervalo').value,10),vezes};
      if(!novo&&S.ed.agendaSerie&&$('input[name="a-aplicar"]:checked')?.value==='proximos')corpo.aplicar='proximos';
      const btn=$('#btn-salvar-agendamento');btn.setAttribute('aria-busy','true');
      try{
        let r;
        try{r=novo?await api.agendaPost(corpo):await api.agendaPut(S.ed.agendaId,corpo);}
        catch(err){
          // Repetição com horários ocupados: oferece criar só os livres
          if(!(repetir&&err.status===409&&err.dados?.conflitos))throw err;
          const livres=Number(err.dados.livres)||0;
          const v=await ui.escolher('Alguns horários estão ocupados',`${err.message} Os outros ${livres} estão livres.`,
            [{valor:'pular',rotulo:`Agendar os ${livres} livres`,estilo:'primary'}]);
          if(v!=='pular')return;
          r=await api.agendaPost({...corpo,pularConflitos:true});
        }
        if(novo&&S.ed.agendaEspera){
          await api.put(`/espera/${S.ed.agendaEspera}/status`,{status:'AGENDADO',idAgendamento:r.id}).catch(()=>{});
          pages.espera.load();
        }
        ui.closeModal('modal-agendamento');
        await this.load({silent:true});
        if(S.currentPage==='semana')pages.semana.load();
        const titulo=r?.criados>1?`${r.criados} agendamentos criados`:r?.alterados>1?`${r.alterados} agendamentos alterados`:novo?'Agendado':'Agendamento alterado';
        ui.success(titulo,r?.pulados?`${r.pulados} ${r.pulados>1?'datas ocupadas ficaram':'data ocupada ficou'} de fora.`:r?.google==='sincronizado'?'Google Agenda atualizado.':r?.google==='em_andamento'?'O Google Agenda é atualizado em instantes.':'');
        this.avisoGoogle(r?.google,r?.criados||r?.alterados);
      }catch(err){
        if(err.message.toLowerCase().includes('desatualizado')){
          ui.warning('Registro desatualizado','Recarregando…');
          if(S.ed.agendaId)await this.openEdit(S.ed.agendaId);else await this.load({silent:true});
        }else ui.error('Erro ao salvar',err.message);
      }finally{btn.removeAttribute('aria-busy');}
    },
    // Horário repetido: pergunta se cancela só este ou também os próximos
    async cancelar(id){
      const ag=S.agendamentos.find(x=>x.id===id)||pages.semana.dados?.find(x=>x.id===id);
      if(!ag?.id_serie){
        ui.confirm('Cancelar agendamento?','O evento também será removido do Google Agenda.',()=>this._cancelar(id,false));
        return;
      }
      const v=await ui.escolher('Cancelar agendamento','Este horário se repete. O evento também sai do Google Agenda.',
        [{valor:'este',rotulo:'Cancelar só este'},{valor:'proximos',rotulo:'Cancelar este e os próximos'}]);
      if(v)this._cancelar(id,v==='proximos');
    },
    async _cancelar(id,proximos){
      try{
        const r=await api.post(`${EP.agenda}/${id}/cancelar`,{proximos});
        await this.load({silent:true});if(S.currentPage==='semana')pages.semana.load();
        ui.success(r.cancelados>1?`${r.cancelados} agendamentos cancelados`:'Agendamento cancelado',r?.google==='em_andamento'?'Os eventos saem do Google Agenda em instantes.':'');
        this.avisoGoogle(r?.google,r.cancelados);
        sugerirEspera(r.id_especialidade);
      }catch(err){ui.error('Erro',err.message);}
    },
    // Falta: só depois do horário marcado
    passou(ag){return lerDataHora(ag.dt_hr_agendada)<=new Date(Date.now()+5*60000);},
    async falta(ag){
      const v=await ui.escolher(`Falta de ${ag.paciente}`,`${formatDateBR(ag.dt_hr_agendada)} com ${ag.terapeuta}.`,
        [{valor:'N',rotulo:'Faltou sem avisar'},{valor:'S',rotulo:'Falta justificada'}]);
      if(!v)return;
      try{
        await api.post(`${EP.agenda}/${ag.id}/falta`,{justificada:v==='S'});
        await this.load({silent:true});if(S.currentPage==='semana')pages.semana.load();
        ui.success('Falta registrada');
      }catch(err){ui.error('Erro',err.message);}
    },
    desfazerFalta(ag){
      ui.confirm('Desfazer a falta?','O agendamento volta para "Agendado".',async()=>{
        try{
          await api.post(`${EP.agenda}/${ag.id}/falta`,{desfazer:true});
          await this.load({silent:true});if(S.currentPage==='semana')pages.semana.load();
          ui.success('Falta desfeita');
        }catch(err){ui.error('Erro',err.message);}
      });
    },
    async enviarGoogle(btn,id){
      btn.setAttribute('aria-busy','true');btn.disabled=true;
      try{await api.agendaGoogle(id);await this.load({silent:true});ui.success('Enviado ao Google Agenda');}
      catch(err){btn.disabled=false;ui.error('Erro',err.message);}
      finally{btn.removeAttribute('aria-busy');}
    },
    async openHistorico(id){
      const c=$('#historico-agendamento-body');c.innerHTML=ui.skeleton(4);
      modoHistorico('modal-agendamento','agendamento-historico');
      $('#modal-agendamento-title').textContent='Histórico do agendamento';
      ui.openModal('modal-agendamento');
      try{ui.renderHistorico(c,await api.agendaHist(id));}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    init(){
      // Período padrão: de hoje a 30 dias, só os agendados
      const hoje=new Date(),fim=new Date();fim.setDate(fim.getDate()+30);
      $('#agenda-de').value=dataHoraLocal(hoje).slice(0,10);
      $('#agenda-ate').value=dataHoraLocal(fim).slice(0,10);
      ['#agenda-de','#agenda-ate','#agenda-status'].forEach(sel=>$(sel).addEventListener('change',()=>this.load({silent:true})));
      $('#btn-reload-agenda').addEventListener('click',()=>this.load());
      $('#btn-new-agendamento').addEventListener('click',()=>this.openNew());
      $('#search-agenda').addEventListener('input',debounce(()=>this.load({silent:true}),300));
      $('#form-agendamento').addEventListener('submit',e=>this.save(e));
      $('#a-repetir').addEventListener('change',e=>{$('#a-repetir-opcoes').hidden=!e.target.checked;this.fimRepeticao();});
      ['#a-data','#a-vezes','#a-intervalo'].forEach(sel=>$(sel).addEventListener('input',()=>this.fimRepeticao()));
    },
  };

  // A sessão já aconteceu: o campo não aceita data/hora depois de agora
  function limitarDataSessao(){$('#c-data').max=dataHoraLocal(new Date());}
  function sessaoNoFuturo(valor){return !!valor&&lerDataHora(valor)>new Date(Date.now()+5*60000);}

  // Metas do paciente na especialidade da sessão (avaliação de 1 a 5, opcional)
  async function carregarMetasSessao(metas=null){
    const wrap=$('#c-metas-wrap');
    if(!metas){
      const pac=parseInt($('#c-paciente').value,10),esp=parseInt($('#c-especialidade').value,10);
      if(!pac||!esp||!temPerm(1,20,21)){wrap.hidden=true;$('#c-metas').replaceChildren();return;}
      try{metas=await api.get(`/metas?paciente=${pac}&especialidade=${esp}`);}catch{metas=[];}
    }
    wrap.hidden=!metas.length;
    $('#c-metas').innerHTML=metas.map(m=>`<div class="meta-linha" data-meta="${Number(m.id)}">
      <span class="meta-linha__texto">${esc(m.descricao)}</span>
      <div class="nota-meta" role="radiogroup" aria-label="${esc(m.descricao)}">${[1,2,3,4,5].map(n=>
        `<label title="${esc(EVOLUCAO[n])}"><input type="radio" name="meta-${Number(m.id)}" value="${n}" ${m.nota===n?'checked data-marcado="1"':''} /><span>${n}</span></label>`).join('')}</div>
    </div>`).join('');
    // Tocar de novo na nota marcada desmarca (meta não avaliada nesta sessão)
    $('#c-metas').querySelectorAll('input').forEach(r=>r.addEventListener('click',()=>{
      if(r.dataset.marcado){r.checked=false;delete r.dataset.marcado;return;}
      $$(`input[name="${r.name}"]`).forEach(x=>delete x.dataset.marcado);r.dataset.marcado='1';
    }));
  }
  function lerMetasSessao(){
    if($('#c-metas-wrap').hidden)return undefined;
    return $$('#c-metas .meta-linha').map(l=>{
      const r=l.querySelector('input:checked');
      return {id:Number(l.dataset.meta),nota:r?Number(r.value):null};
    });
  }

  function lerEvolucao(){const r=$('input[name="c-evolucao"]:checked');return r?parseInt(r.value,10):null;}
  function definirEvolucao(v){$$('input[name="c-evolucao"]').forEach(r=>{r.checked=String(v)===r.value;});}

  /* Consultas */
  pages.consultas = {
    render(){this.renderTable();},
    async load({silent=false,mais=false}={}){
      if(!S.token||!temPerm(1,20,21))return;
      const body=$('#consultas-body'),cnt=$('#count-consultas');
      if(!silent&&!mais){body.innerHTML=ui.skeleton(5);cnt.textContent='—';}
      try{
        const pagina=mais?Math.floor(S.consultas.length/POR_PAGINA)+1:1;
        const {itens,total}=await api.consultas({busca:$('#search-consultas').value.trim(),pagina});
        lembrarNomes(itens,[['id_paciente','paciente'],['id_terapeuta','terapeuta']]);
        S.consultas=mais?[...S.consultas,...itens]:itens;S.totais.consultas=total;
        this.renderTable();updateNavBadges();
        if(!silent)ui.success('Sessões atualizadas',`${S.consultas.length} registro(s).`);
      }catch(err){
        if(!silent){body.innerHTML=ui.errorState('Falha',err.message);cnt.textContent='—';ui.error('Erro',err.message);}
      }
    },
    // A busca já é feita no servidor: a lista na tela é o resultado
    filtradas(){return S.consultas;},
    renderTable(){
      const body=$('#consultas-body'),cnt=$('#count-consultas');
      const list=S.consultas,total=S.totais.consultas,buscando=!!$('#search-consultas').value.trim();
      cnt.textContent=`${total} ${total===1?'sessão':'sessões'}`;
      if(!list.length){body.innerHTML=buscando?ui.emptyState('search','Nada encontrado','Ajuste a busca.'):ui.emptyState('calendar','Nenhuma sessão registrada','Clique em "Atualizar" ou registre uma sessão.');return;}
      const pE=temPerm(1,20,23),pX=temPerm(1,20,24),pH=temPerm(1,20,25);
      const rows=list.map(c=>{
        return `<tr>
          <td><div style="font-weight:500">${esc(c.paciente||'—')}</div></td>
          <td>${esc(c.terapeuta||'—')}</td>
          <td class="td-date">${esc(formatDateBR(c.data_hora))}</td>
          <td>${badgeEsp(c.id_especialidade,c.especialidade)}</td>
          <td>${c.id_agendamento?`<span class="badge badge--info">${icon('calendar',11)} Agendada</span>`:'<span class="badge">Avulsa</span>'}</td>
          <td class="td-actions">${acoesLinha([
            pE&&`<button class="icon-btn" data-act="edit" data-id="${c.id}" title="Editar">${icon('edit')}</button>`,
          ],[
            `<button class="icon-btn" data-act="evol" data-id="${c.id}" title="Registro de evolução">${icon('printer')}</button>`,
            pH&&`<button class="icon-btn" data-act="hist" data-id="${c.id}" title="Histórico">${icon('history')}</button>`,
            pX&&`<button class="icon-btn icon-btn--danger" data-act="del" data-id="${c.id}" title="Excluir">${icon('trash')}</button>`,
          ])}</td></tr>`;
      }).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Paciente</th><th>Profissional</th><th>Data/Hora</th><th>Especialidade</th><th>Origem</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${rows}</tbody></table></div>${rodapeLista(list.length,total,'mais-consultas')}`;
      $('#mais-consultas')?.addEventListener('click',e=>carregarMais(e.currentTarget,()=>this.load({silent:true,mais:true})));
      body.querySelectorAll('[data-act]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const id=parseInt(btn.dataset.id,10);
          if(btn.dataset.act==='edit')this.openEdit(id);
          else if(btn.dataset.act==='hist')this.openHistorico(id);
          else if(btn.dataset.act==='evol')evolucao.gerar([id],btn);
          else if(btn.dataset.act==='del')this.excluir(id);
        });
      });
    },
    // Paciente, terapeuta e especialidade travados quando a consulta vem de um agendamento
    _travarVinculos(travar){
      ['#c-terapeuta','#c-especialidade','#c-paciente','#c-paciente-busca'].forEach(sel=>{$(sel).disabled=travar;});
      $('#c-origem').hidden=!travar;
    },
    async openNew(){
      resetModalTabs('modal-consulta',{novo:true});
      S.ed.consultaId=null;S.ed.consultaUA=null;S.ed.consultaAgendamento=null;
      $('#modal-consulta-title').textContent='Sessão avulsa';
      $$('#form-consulta .field').forEach(f=>f.classList.remove('has-error'));
      limitarDataSessao();
      $('#c-data').value=dataHoraLocal(new Date());
      $('#c-tempo').value='01:00';$('#c-resumo').value='';definirEvolucao(null);
      this._travarVinculos(false);
      $('#c-metas-wrap').hidden=true;
      await this._popularSelects(null);
      ui.openModal('modal-consulta');
    },
    // Gera a consulta (sessão realizada) a partir de um agendamento
    async openFromAgendamento(ag){
      resetModalTabs('modal-consulta',{novo:true});
      S.ed.consultaId=null;S.ed.consultaUA=null;S.ed.consultaAgendamento=ag.id;
      $('#modal-consulta-title').textContent='Registrar sessão realizada';
      $$('#form-consulta .field').forEach(f=>f.classList.remove('has-error'));
      limitarDataSessao();
      $('#c-data').value=(ag.dt_hr_agendada||'').slice(0,16);
      $('#c-tempo').value=(ag.tempo_previsto||'01:00:00').slice(0,5);
      $('#c-resumo').value='';definirEvolucao(null);
      // Agendamento ainda por vir: só registra informando quando a sessão realmente aconteceu
      $('#c-origem').textContent=sessaoNoFuturo(ag.dt_hr_agendada)
        ?`Agendado para ${formatDateBR(ag.dt_hr_agendada)}, que ainda não chegou. Para registrar agora, informe a data e a hora em que a sessão aconteceu. O Google Agenda acompanha a nova data.`
        :`Agendamento de ${formatDateBR(ag.dt_hr_agendada)}. Informe o horário real e o resumo da sessão.`;
      await this._popularSelects(ag);
      this._travarVinculos(true);
      await carregarMetasSessao();
      ui.openModal('modal-consulta');
    },
    async openEdit(id){
      let c;
      try{ [c]=await Promise.all([api.consultaById(id),this.load({silent:true})]); }catch(err){ ui.error('Erro',err.message); return; }
      resetModalTabs('modal-consulta');
      S.ed.consultaId=id;S.ed.consultaUA=c.updated_at;S.ed.consultaAgendamento=null;
      $('#modal-consulta-title').textContent='Editar sessão';
      $('#c-origem').textContent='Sessão gerada de um agendamento: paciente, profissional e especialidade não podem ser alterados.';
      limitarDataSessao();
      $('#c-data').value=(c.data_hora||'').replace(' ','T').slice(0,16);
      $('#c-tempo').value=(c.tempo_sessao||'01:00:00').slice(0,5);
      $('#c-resumo').value=c.resumo_sessao||'';definirEvolucao(c.evolucao);
      $$('#form-consulta .field').forEach(f=>f.classList.remove('has-error'));
      // id_terapeuta, id_paciente, id_especialidade vêm do backend agora
      await this._popularSelects(c);
      this._travarVinculos(!!c.id_agendamento);
      await carregarMetasSessao(Array.isArray(c.metas)?c.metas:[]);
      ui.openModal('modal-consulta');
    },
    _popularSelects(c){return popularSelectsAtendimento('c',c);},
    _filtrarEsp(c){return filtrarEspAtendimento('c',c);},
    async saveConsulta(e){
      e.preventDefault();
      const dataVal=$('#c-data').value,tempo=$('#c-tempo').value;
      const terapeuta=parseInt($('#c-terapeuta').value,10)||null;
      const especialidade=parseInt($('#c-especialidade').value,10)||null;
      const paciente=parseInt($('#c-paciente').value,10)||null;
      const resumo=$('#c-resumo').value.trim();
      let ok=true;
      const futura=sessaoNoFuturo(dataVal);
      fieldErr($('#c-data'),!dataVal||futura);if(!dataVal||futura)ok=false;
      if(futura)ui.warning('Data no futuro','A sessão só pode ser registrada depois de acontecer. Informe a data e a hora reais.');
      fieldErr($('#c-terapeuta'),!terapeuta);if(!terapeuta)ok=false;
      fieldErr($('#c-especialidade'),!especialidade);if(!especialidade)ok=false;
      fieldErr($('#c-paciente'),!paciente);if(!paciente)ok=false;
      if(!ok)return;
      // Validar vínculo paciente-terapeuta via relacoes
      const pac=S.cad.get(paciente);
      if(!S.ed.consultaAgendamento&&pac?._relacoes?.length){
        const vinculado=pac._relacoes.some(r=>r.id_especialidade_terapeuta===terapeuta);
        if(!vinculado){
          ui.error('Vínculo inválido','Este paciente não está vinculado a este profissional. Confira o cadastro.');
          return;
        }
      }
      const btn=$('#btn-salvar-consulta');btn.setAttribute('aria-busy','true');
      try{
        const body={
          id_terapeuta:terapeuta,id_especialidade:especialidade,id_paciente:paciente,
          dt_hr_sessao:dataVal.replace('T',' '),tempo_sessao:tempo+':00',resumo_sessao:resumo,evolucao:lerEvolucao(),
        };
        const metas=lerMetasSessao();
        if(metas)body.metas=metas;
        if(S.ed.consultaAgendamento){
          const r=await api.agendaConsulta(S.ed.consultaAgendamento, {
            dt_hr_sessao: body.dt_hr_sessao, tempo_sessao: body.tempo_sessao, resumo_sessao: resumo, evolucao: body.evolucao,
            ...(metas?{metas}:{}),
          });
          await Promise.all([pages.consultas.load({silent:true}), pages.agenda.load({silent:true})]);
          ui.success('Sessão registrada',r?.google==='sincronizado'?'O Google Agenda ficou com o horário real da sessão.':'O agendamento foi marcado como realizado.');
          pages.agenda.avisoGoogle(r?.google);
        }else if(S.ed.consultaId){
          await api.consultaPut(S.ed.consultaId, {
            updatedAt: S.ed.consultaUA,
            campos: { id_terapeuta: terapeuta, id_especialidade: especialidade,
                      id_paciente: paciente, dt_hr_sessao: dataVal.replace('T',' '),
                      tempo_sessao: tempo+':00', resumo_sessao: resumo, evolucao: body.evolucao, ...(metas?{metas}:{}) },
          });
          // Recarrega para pegar novo updated_at
          await pages.consultas.load({silent:true});
          ui.success('Sessão atualizada');
        }else{
          await api.consultaPost(body);
          await pages.consultas.load({silent:true});
          ui.success('Sessão registrada');
        }
        ui.closeModal('modal-consulta');this.renderTable();
      }catch(err){
        if(err.message.includes('409')||err.message.toLowerCase().includes('desatualizado')){
          ui.warning('Registro desatualizado','Recarregando…');
          await pages.consultas.load({silent:true});
          if(S.ed.consultaId)await this.openEdit(S.ed.consultaId);
          ui.info('Dados atualizados','Confira e salve novamente.');
        }else ui.error('Erro ao salvar',err.message);
      }
      finally{btn.removeAttribute('aria-busy');}
    },
    async openHistorico(id){
      const c=$('#historico-consulta-body');c.innerHTML=ui.skeleton(4);
      $('#modal-consulta-title').textContent='Histórico da sessão';
      modoHistorico('modal-consulta','consulta-historico');
      ui.openModal('modal-consulta');
      try{ui.renderHistorico(c,await api.consultaHist(id));}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    async openHistoricoDeletes(){
      const c=$('#historico-consulta-body');c.innerHTML=ui.skeleton(4);
      modoHistorico('modal-consulta','consulta-historico');
      $('#modal-consulta-title').textContent='Sessões excluídas';
      ui.openModal('modal-consulta');
      try{ui.renderHistorico(c,await api.consultaHistDel());}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    excluir(id){
      ui.confirm('Excluir esta sessão?','Esta ação não pode ser desfeita.',async()=>{
        try{
          await api.consultaDel(id);await this.load({silent:true});updateNavBadges();
          // Se veio de um agendamento, ele volta para "Agendado"
          pages.agenda.load({silent:true});
          ui.success('Excluída');
        }
        catch(err){ui.error('Erro',err.message);}
      });
    },
    init(){
      $('#btn-reload-consultas').addEventListener('click',()=>this.load());
      $('#btn-new-consulta').addEventListener('click',()=>this.openNew());
      $('#btn-hist-del-consultas').addEventListener('click',()=>this.openHistoricoDeletes());
      $('#search-consultas').addEventListener('input',debounce(()=>this.load({silent:true}),300));
      $('#form-consulta').addEventListener('submit',e=>this.saveConsulta(e));
      $('#c-evolucao-limpar').addEventListener('click',()=>definirEvolucao(null));
      // Sessão avulsa: as metas mudam conforme o paciente e a especialidade escolhidos
      ['#c-paciente','#c-especialidade'].forEach(sel=>$(sel).addEventListener('change',()=>carregarMetasSessao()));
      // Busque o paciente para gerar o registro de evolução de todas as sessões dele
      $('#btn-evolucao').addEventListener('click',e=>evolucao.gerar(this.filtradas().map(c=>c.id),e.currentTarget));
    },
  };

  /* Pessoas */
  pages.pessoas = {
    render(){this.renderTable();},
    async load({silent=false,mais=false}={}){
      if(!S.token||!temPerm(1,10,11))return;
      const body=$('#pessoas-body'),cnt=$('#count-pessoas');
      if(!silent&&!mais){body.innerHTML=ui.skeleton(5);cnt.textContent='—';}
      try{
        const f=S.cadastrosFilter;
        const pagina=mais?Math.floor(S.cadastros.length/POR_PAGINA)+1:1;
        const [{itens,total},pend]=await Promise.all([
          api.cadastros({busca:$('#search-pessoas').value.trim(),pagina,
            tipo:['Paciente','Terapeuta'].includes(f)?f:undefined,sem_vinculo:f==='sem-vinculo'?'1':undefined}),
          mais||S.profissional?null:api.get(`${EP.cadastros}/pendencias`).catch(()=>null),
        ]);
        // Os vínculos já vêm com a lista (sem uma requisição por cadastro)
        lembrarCadastros(itens);
        S.cadastros=mais?[...S.cadastros,...itens]:itens;S.totais.cadastros=total;
        if(pend)S.pendencias={pacientes:Number(pend.pacientes)||0,profissionais:Number(pend.profissionais)||0};
        this.renderTable();
        if(!silent)ui.success('Cadastros atualizados',`${total} registro(s).`);
      }catch(err){
        if(!silent){body.innerHTML=ui.errorState('Falha',err.message);cnt.textContent='—';ui.error('Erro',err.message);}
      }
    },
    semVinculo(p){return !(p._relacoes||[]).length;},
    // Pacientes sem profissional e profissionais sem especialidade
    renderPendencias(){
      const alvo=$('#pessoas-pendencias');
      const pac=S.pendencias?.pacientes||0,ter=S.pendencias?.profissionais||0;
      $('#count-sem-vinculo').textContent=pac+ter||'';
      if(S.profissional||S.cadastrosFilter==='sem-vinculo'||!(pac+ter)){alvo.innerHTML='';return;}
      const partes=[];
      if(pac)partes.push(`<strong>${pac} paciente${pac>1?'s':''}</strong> sem profissional vinculado`);
      if(ter)partes.push(`<strong>${ter} profissiona${ter>1?'is':'l'}</strong> sem especialidade`);
      alvo.innerHTML=`<div class="pendencia" role="status">
        <svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>
        <p>${partes.join(' e ')}. Sem vínculo, a agenda aceita qualquer combinação para ${pac+ter>1?'eles':'ele'}.</p>
        <button class="btn btn--secondary" type="button" id="btn-ver-sem-vinculo">Ver quais</button>
      </div>`;
      $('#btn-ver-sem-vinculo').addEventListener('click',()=>this.filtrar('sem-vinculo'));
    },
    filtrar(filtro){
      $$('[data-page="pessoas"] .tabs .tab').forEach(t=>t.classList.toggle('tab--active',t.dataset.filter===filtro));
      S.cadastrosFilter=filtro;this.load({silent:true});
    },
    renderTable(){
      const body=$('#pessoas-body'),cnt=$('#count-pessoas');
      const q=$('#search-pessoas').value.trim();
      const tipo=S.cadastrosFilter;
      this.renderPendencias();
      const list=S.cadastros,total=S.totais.cadastros;
      cnt.textContent=`${total} registro${total===1?'':'s'}`;
      if(!list.length){
        body.innerHTML=tipo==='all'&&!q?ui.emptyState('users','Nenhuma pessoa','Clique em "Cadastrar".')
          :tipo==='sem-vinculo'&&!q?ui.emptyState('check','Tudo vinculado','Todos os pacientes têm profissional e todos os profissionais têm especialidade.')
          :ui.emptyState('search','Nada encontrado','Ajuste a busca.');
        return;
      }
      const pE=temPerm(1,10,13),pX=temPerm(1,10,14),pH=temPerm(1,10,15);
      const aviso=p=>tipo==='sem-vinculo'?`<div class="field__hint">${p.tipo==='Paciente'?'Sem profissional vinculado':'Sem especialidade'}</div>`:'';
      const rows=list.map(p=>`<tr>
        <td><div style="font-weight:500">${esc(p.nome)}</div>${aviso(p)}</td>
        <td><span class="badge badge--${p.tipo==='Paciente'?'info':'accent'}">${esc(p.tipo==='Terapeuta'?'Profissional':(p.tipo||'—'))}</span></td>
        <td style="color:var(--ink-2)">${esc(p.telefone||'—')}</td>
        <td class="td-date">${esc(formatDateBR(p.dt_nasc))}</td>
        <td class="td-actions">${acoesLinha([
          pE&&`<button class="icon-btn" data-act="edit" data-id="${p.id}" title="Editar">${icon('edit')}</button>`,
        ],[
          pH&&`<button class="icon-btn" data-act="hist" data-id="${p.id}" title="Histórico">${icon('history')}</button>`,
          pX&&`<button class="icon-btn icon-btn--danger" data-act="del" data-id="${p.id}" title="Excluir">${icon('trash')}</button>`,
        ])}</td></tr>`).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nome</th><th>Tipo</th><th>Telefone</th><th>Nascimento</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${rows}</tbody></table></div>${rodapeLista(list.length,total,'mais-pessoas')}`;
      $('#mais-pessoas')?.addEventListener('click',e=>carregarMais(e.currentTarget,()=>this.load({silent:true,mais:true})));
      body.querySelectorAll('[data-act]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const id=parseInt(btn.dataset.id,10);
          if(btn.dataset.act==='edit')this.openEdit(id);
          else if(btn.dataset.act==='hist')this.openHistorico(id);
          else if(btn.dataset.act==='del')this.excluir(id);
        });
      });
    },
    // Vínculos ficam só na tela (IDs) até o cadastro ser salvo
    _iniciarVinculos(tipo,ids){
      S.ed.vinc={tipo,original:new Set(ids),atual:[...ids]};
    },
    _vinculosAlterados(){
      const v=S.ed.vinc;if(!v)return null;
      const mudou=v.atual.length!==v.original.size||v.atual.some(id=>!v.original.has(id));
      return mudou?[...v.atual]:null;
    },
    _abrirModal(titulo,p,vinculosPendentes){
      resetModalTabs('modal-pessoa',{novo:!p});
      $('#modal-pessoa-title').textContent=titulo;
      $('#p-nasc').max=dataISO(new Date());
      $$('#modal-pessoa .field').forEach(f=>f.classList.remove('has-error'));
      this._syncCampos();
      const tipo=$('#p-tipo').value;
      this._iniciarVinculos(tipo,(p?._relacoes||[]).map(r=>r.id_especialidade_terapeuta));
      if(vinculosPendentes)S.ed.vinc.atual=[...vinculosPendentes];
      $('#tab-btn-evolucao').style.display=p&&p.tipo==='Paciente'&&temPerm(1,20,21)?'':'none';
      $('#evo-corpo').replaceChildren();S.ed.evo=null;
      this._renderVinculos();
      ui.openModal('modal-pessoa');
    },
    openNew(){
      S.ed.pessoaId=null;S.ed.pessoaUA=null;
      ['p-nome','p-tel','p-cpf','p-reg','p-diag','p-repasse'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      // Na aba Pacientes ou Profissionais, o tipo já vem escolhido
      $('#p-tipo').value=S.cadastrosFilter==='Terapeuta'?'Terapeuta':'Paciente';$('#p-nasc').value='';
      this._abrirModal('Novo cadastro',null);
    },
    async openEdit(id,{vinculos=null}={}){
      let p;
      try{ [p]=await Promise.all([api.cadastroById(id),this.load({silent:true}),carregarTerapeutas()]); }
      catch(err){ ui.error('Erro',err.message); return; }
      if(!p)return;
      S.ed.pessoaId=id;S.ed.pessoaUA=p.updated_at;
      $('#p-nome').value=p.nome||'';$('#p-tipo').value=p.tipo||'Paciente';
      $('#p-nasc').value=(p.dt_nasc||'').slice(0,10);
      $('#p-tel').value=p.telefone||'';$('#p-cpf').value=p.cpf||'';
      $('#p-reg').value=p.registro_profissional||'';$('#p-diag').value=p.diagnostico||'';
      $('#p-repasse').value=p.repasse_percentual??'';
      // Vínculos: os da lista (se o cadastro estiver nela) ou buscados agora
      let rels=S.cad.get(id)?._relacoes;
      if(!rels){try{rels=await api.relacaoGet(id);}catch{rels=[];}}
      S.nomes.set(id,p.nome);
      this._abrirModal('Editar — '+p.nome,{...p,_relacoes:rels},vinculos);
    },
    _syncCampos(){
      const tipo=$('#p-tipo').value;
      const wd=$('#p-diag-wrap');if(wd)wd.style.display=tipo==='Paciente'?'':'none';
      const wr=$('#p-reg-wrap');if(wr)wr.style.display=tipo==='Terapeuta'?'':'none';
      // Repasse: visível para o financeiro e para o próprio profissional; só o financeiro altera
      const proprio=!!S.profissional&&S.ed.pessoaId===S.profissional.id;
      $('#p-repasse-wrap').hidden=!(finVer()||proprio);$('#p-repasse').disabled=!finAlterar();
    },
    async openHistorico(id){
      const c=$('#historico-pessoa-body');c.innerHTML=ui.skeleton(4);
      const p=S.cadastros.find(x=>x.id===id);
      $('#modal-pessoa-title').textContent=p?.nome||'Histórico';
      modoHistorico('modal-pessoa','historico-pessoa');
      ui.openModal('modal-pessoa');
      try{ui.renderHistorico(c,await api.cadastroHist(id));}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    async openHistoricoDeletes(){
      const c=$('#historico-pessoa-body');c.innerHTML=ui.skeleton(4);
      $('#modal-pessoa-title').textContent='Cadastros excluídos';
      modoHistorico('modal-pessoa','historico-pessoa');
      ui.openModal('modal-pessoa');
      try{ui.renderHistorico(c,await api.cadastroHistDel());}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    _renderVinculos(){
      const v=S.ed.vinc,paciente=$('#p-tipo').value==='Paciente';
      const container=$('#relacao-list');
      $('#relacao-title').textContent=paciente?'Profissionais que atendem este paciente':'Especialidades que este profissional atende';
      $('#relacao-desc').textContent=paciente
        ?'Na agenda, o paciente só pode ser marcado com os profissionais abaixo.'
        :'Na agenda, o profissional só pode ser marcado nas especialidades abaixo.';
      const pode=S.ed.pessoaId?temPerm(1,10,13):temPerm(1,10,12,13);
      const rotulo=id=>paciente?`${icon('users',14)} ${esc(nomeCad(id))}`
        :`${corDot((S.especialidades.find(e=>e.id===id)?.id_cor)||0)} ${esc(nomeEsp(id))}`;
      container.innerHTML=v.atual.length?v.atual.map(id=>{
        const novo=!v.original.has(id);
        return `<div class="relacao-item${novo?' relacao-item--novo':''}">
          <span class="relacao-item__label">${rotulo(id)}${novo?'<span class="relacao-item__tag">a gravar</span>':''}</span>
          ${pode?`<button class="icon-btn icon-btn--danger" type="button" data-vid="${id}" title="Remover">${icon('trash',14)}</button>`:''}</div>`;
      }).join(''):`<p style="color:var(--ink-3);font-size:13px;padding:8px 0">${paciente?'Nenhum profissional vinculado.':'Nenhuma especialidade vinculada.'}</p>`;
      container.querySelectorAll('[data-vid]').forEach(btn=>btn.addEventListener('click',()=>{
        v.atual=v.atual.filter(x=>x!==+btn.dataset.vid);this._renderVinculos();
      }));
      $('#relacao-add-wrap').style.display=pode?'':'none';
      this._popularSelectRelacao(paciente);
      const alterados=this._vinculosAlterados();
      const nota=$('#pessoa-pendente');nota.hidden=!alterados;
      nota.textContent=alterados?'Vínculos alterados. Salve para gravar.':'';
      const removidos=[...v.original].filter(id=>!v.atual.includes(id)).length;
      if(alterados&&removidos)nota.textContent=`Vínculos alterados (${removidos} removido${removidos>1?'s':''}). Salve para gravar.`;
    },
    _popularSelectRelacao(paciente){
      const selR=$('#relacao-select'),busca=$('#relacao-busca');
      const ja=new Set(S.ed.vinc.atual);
      const lista=paciente
        ?S.terapeutas.filter(c=>!ja.has(c.id)&&c.id!==S.ed.pessoaId)
        :S.especialidades.filter(e=>e.inativo!=='S'&&!ja.has(e.id));
      busca.placeholder=paciente?'Buscar profissional…':'Buscar especialidade…';
      const render=arr=>{
        selR.innerHTML='<option value="">— selecione —</option>'+
          arr.map(x=>`<option value="${x.id}">${esc(x.nome||x.descricao)}</option>`).join('');
      };
      render(lista);
      busca.value='';
      busca.oninput=()=>{
        const q=busca.value.toLowerCase();
        render(lista.filter(x=>(x.nome||x.descricao||'').toLowerCase().includes(q)));
      };
    },
    async savePessoa(e){
      e.preventDefault();
      const nome=$('#p-nome').value.trim(),tipo=$('#p-tipo').value;
      const nasc=$('#p-nasc').value;
      const tel=$('#p-tel').value.trim();
      const cpfRaw=$('#p-cpf').value.replace(/\D/g,'');
      const reg=$('#p-reg').value.trim(),diag=$('#p-diag').value.trim();
      let ok=true;
      fieldErr($('#p-nome'),!nome||nome.length>150);if(!nome||nome.length>150)ok=false;
      if(cpfRaw&&!validarCPF(cpfRaw)){fieldErr($('#p-cpf'),true);ok=false;}
      else fieldErr($('#p-cpf'),false);
      const comRepasse=finAlterar(),repasseTxt=$('#p-repasse').value.trim(),repasse=repasseTxt===''?null:Number(repasseTxt);
      const repasseInv=comRepasse&&tipo==='Terapeuta'&&repasse!==null&&!(Number.isInteger(repasse)&&repasse>=0&&repasse<=100);
      fieldErr($('#p-repasse'),repasseInv);if(repasseInv)ok=false;
      const nascInv=!!nasc&&(!/^\d{4}-\d{2}-\d{2}$/.test(nasc)||nasc<'1900-01-01'||nasc>dataISO(new Date()));
      fieldErr($('#p-nasc'),nascInv);if(nascInv)ok=false;
      if(!['Paciente','Terapeuta'].includes(tipo))ok=false;
      if(!ok){gotoModalTab('modal-pessoa','dados');return;}
      const btn=$('#btn-salvar-pessoa');btn.setAttribute('aria-busy','true');
      const campos={nome,tipo,telefone:tel||null,dt_nasc:nasc||null,
        registro_profissional:tipo==='Terapeuta'?(reg||null):null,
        cpf:cpfRaw||null,diagnostico:tipo==='Paciente'?(diag||null):null,
        ...(comRepasse?{repasse_percentual:tipo==='Terapeuta'?repasse:null}:{})};
      const vinculos=this._vinculosAlterados();
      let id=S.ed.pessoaId;
      try{
        if(id)await api.cadastroPut(id,{updatedAt:S.ed.pessoaUA,campos});
        else{const r=await api.cadastroPost(campos);id=r.id;}
      }catch(err){
        btn.removeAttribute('aria-busy');
        if(err.message.includes('409')||err.message.toLowerCase().includes('desatualizado')){
          ui.warning('Registro desatualizado','Recarregando…');
          await this.openEdit(S.ed.pessoaId,{vinculos:vinculos||null});
          ui.info('Dados atualizados','Confira e salve novamente.');
        }else ui.error('Erro ao salvar',err.message);
        return;
      }
      // Cadastro gravado: agora os vínculos guardados na tela
      if(vinculos){
        try{await api.put(`${EP.cadastros}/${id}/vinculos`,{ids:vinculos});}
        catch(err){
          btn.removeAttribute('aria-busy');
          await this.openEdit(id,{vinculos});
          gotoModalTab('modal-pessoa','relacao');
          ui.error('Cadastro salvo, vínculos não',`${err.message}. Confira os vínculos e salve de novo.`);
          return;
        }
      }
      btn.removeAttribute('aria-busy');
      S.ed.vinc=null;
      ui.closeModal('modal-pessoa');
      await Promise.all([this.load({silent:true}),carregarTerapeutas().catch(()=>{})]);
      ui.success(S.ed.pessoaId?'Cadastro atualizado':'Cadastro criado');
    },
    excluir(id){
      const p=S.cadastros.find(x=>x.id===id);
      ui.confirm(`Excluir "${p?.nome||id}"?`,'Esta ação não pode ser desfeita.',async()=>{
        try{await api.cadastroDel(id);await Promise.all([this.load({silent:true}),carregarTerapeutas().catch(()=>{})]);ui.success('Excluído');}
        catch(err){ui.error('Erro',err.message);}
      });
    },
    init(){
      $('#btn-reload-pessoas').addEventListener('click',()=>this.load());
      $('#btn-new-pessoa').addEventListener('click',()=>this.openNew());
      $('#btn-hist-del-pessoas').addEventListener('click',()=>this.openHistoricoDeletes());
      $('#search-pessoas').addEventListener('input',debounce(()=>this.load({silent:true}),300));
      $('#p-tipo').addEventListener('change',()=>{
        this._syncCampos();
        // Trocar o tipo muda o significado dos vínculos (profissionais x especialidades)
        const v=S.ed.vinc;
        if(v)v.atual=$('#p-tipo').value===v.tipo?[...v.original]:[];
        this._renderVinculos();
      });
      $('#p-cpf').addEventListener('input',e=>{e.target.value=maskCPF(e.target.value);});
      $('#p-tel').addEventListener('input',e=>{e.target.value=maskTel(e.target.value);});
      $('#form-pessoa').addEventListener('submit',e=>this.savePessoa(e));
      $('#btn-add-relacao').addEventListener('click',()=>{
        const id=parseInt($('#relacao-select').value,10)||null;
        if(!id){ui.warning('Selecione','Escolha um item antes de vincular.');return;}
        if(!S.ed.vinc.atual.includes(id))S.ed.vinc.atual.push(id);
        this._renderVinculos();
      });
      $$('[data-page="pessoas"] .tabs .tab').forEach(tab=>{
        tab.addEventListener('click',()=>this.filtrar(tab.dataset.filter));
      });
    },
  };

  /* EVOLUÇÃO DO PACIENTE (gráfico na ficha do paciente) */
  const evolucaoPaciente = {
    async carregar(){
      const id=S.ed.pessoaId;if(!id)return;
      const corpo=$('#evo-corpo');corpo.innerHTML=ui.skeleton(3);
      const dias=parseInt($('#evo-periodo').value,10)||180;
      const ate=new Date(),de=new Date();de.setDate(de.getDate()-dias+1);
      try{
        const d=await api.get(`/cadastros/${id}/evolucao?de=${dataISO(de)}&ate=${dataISO(ate)}`);
        S.ed.evo=(d.sessoes||[]).map(x=>({...x,id_especialidade:Number(x.id_especialidade),evolucao:x.evolucao===null?null:Number(x.evolucao)}));
        S.ed.evoMetas=(d.metas||[]).map(m=>({...m,id:Number(m.id),id_especialidade:Number(m.id_especialidade),updated_at:Number(m.updated_at),
          avaliacoes:(m.avaliacoes||[]).map(a=>({data_hora:a.data_hora,nota:Number(a.nota)}))}));
      }catch(err){corpo.innerHTML=ui.errorState('Não foi possível carregar a evolução',err.message);return;}
      const serie=$('#evo-serie'),serieAtual=serie.value;
      serie.innerHTML='<option value="">Evolução geral</option>'+S.ed.evoMetas.filter(m=>m.avaliacoes.length)
        .map(m=>`<option value="${m.id}" ${String(m.id)===serieAtual?'selected':''}>Meta: ${esc(m.descricao.length>48?m.descricao.slice(0,46)+'…':m.descricao)}</option>`).join('');
      this.renderMetas();
      const sel=$('#evo-esp'),atual=sel.value;
      const esps=[...new Map(S.ed.evo.map(x=>[x.id_especialidade,x.especialidade])).entries()];
      sel.innerHTML='<option value="">Todas</option>'+esps.map(([i,n])=>`<option value="${i}" ${String(i)===atual?'selected':''}>${esc(n)}</option>`).join('');
      this.desenhar();
    },
    desenhar(){
      const corpo=$('#evo-corpo'),esp=$('#evo-esp').value;
      // Gráfico de uma meta: as notas da meta no lugar da evolução geral
      const meta=(S.ed.evoMetas||[]).find(m=>String(m.id)===$('#evo-serie').value);
      const fonte=meta?meta.avaliacoes.map(a=>({data_hora:a.data_hora,evolucao:a.nota,especialidade:meta.especialidade,terapeuta:'nota da meta',id_especialidade:meta.id_especialidade}))
        :(S.ed.evo||[]);
      const sessoes=fonte.filter(x=>!esp||String(x.id_especialidade)===esp);
      const avaliadas=sessoes.filter(x=>x.evolucao);
      if(!sessoes.length){corpo.innerHTML=ui.emptyState('chart','Nenhuma sessão no período','Escolha um período maior ou registre uma sessão.',true);return;}
      if(!avaliadas.length){corpo.innerHTML=ui.emptyState('chart','Sessões ainda sem avaliação',`${sessoes.length} ${sessoes.length>1?'sessões':'sessão'} no período, nenhuma com a evolução marcada. Avalie ao registrar a sessão.`,true);return;}

      // Resumo: média recente e tendência (primeira metade x segunda metade das avaliações)
      const media=l=>l.reduce((a,x)=>a+x.evolucao,0)/l.length;
      const recentes=avaliadas.slice(-5);
      let tendencia='estável';
      if(avaliadas.length>=4){
        const meio=Math.floor(avaliadas.length/2);
        const dif=media(avaliadas.slice(meio))-media(avaliadas.slice(0,meio));
        tendencia=dif>=.4?'em alta':dif<=-.4?'em queda':'estável';
      }
      const ultima=avaliadas[avaliadas.length-1];
      const fmt=n=>n.toFixed(1).replace('.',',');

      // Gráfico: linha única (um tom) com pontos; eixo Y com os 5 níveis
      const largura=Math.max(320,corpo.clientWidth||600),altura=240;
      const esq=Math.min(130,largura*.3),dir=16,topo=12,base=28;
      // Um ponto por dia: sessões do mesmo dia (especialidades diferentes) viram a média delas
      const dias=[];
      for(const x of avaliadas){
        const dia=String(x.data_hora).slice(0,10),u=dias[dias.length-1];
        if(u&&u.dia===dia)u.sessoes.push(x);else dias.push({dia,sessoes:[x]});
      }
      dias.forEach(d=>{d.t=lerDataHora(d.dia+'T12:00:00').getTime();d.v=media(d.sessoes);});
      const t0=dias[0].t,t1=dias[dias.length-1].t;
      const xDe=t=>t1===t0?esq+(largura-esq-dir)/2:esq+(t-t0)/(t1-t0)*(largura-esq-dir);
      const yDe=v=>topo+(5-v)/4*(altura-topo-base);
      const grade=[1,2,3,4,5].map(v=>`<line class="linha-grade" x1="${esq}" x2="${largura-dir}" y1="${yDe(v)}" y2="${yDe(v)}"/>
        <text x="${esq-10}" y="${yDe(v)+4}" text-anchor="end">${esc(EVOLUCAO[v])}</text>`).join('');
      const pts=dias.map(d=>({x:xDe(d.t),y:yDe(d.v),d}));
      const linha=pts.length>1?`<polyline class="serie" points="${pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>`:'';
      const pontos=pts.map(p=>{
        const tip=`${formatDateBR(p.d.dia)}: `+p.d.sessoes.map(x=>`${x.especialidade} (${x.terapeuta}), ${EVOLUCAO[x.evolucao]}`).join('; ');
        return `<circle class="alvo" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="12" tabindex="0" data-tip="${esc(tip)}"><title>${esc(tip)}</title></circle><circle class="ponto" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5"/>`;
      }).join('');
      const ancora=d=>d===dias[0]?'start':d===dias[dias.length-1]?'end':'middle';
      const rotulosX=(dias.length>1?[dias[0],dias[Math.floor(dias.length/2)],dias[dias.length-1]]:[dias[0]])
        .filter((d,i,a)=>a.indexOf(d)===i)
        .map(d=>`<text x="${xDe(d.t)}" y="${altura-6}" text-anchor="${dias.length>1?ancora(d):'middle'}">${esc(formatDateBR(d.dia))}</text>`).join('');

      corpo.innerHTML=`
        <div class="evo-resumo">
          <span><strong>${fmt(media(recentes))}</strong> média das últimas ${recentes.length} avaliações</span>
          <span><strong>${tendencia}</strong> no período</span>
          <span><strong>${esc(EVOLUCAO[ultima.evolucao])}</strong> na última sessão avaliada</span>
        </div>
        <div class="evo-grafico" role="img" aria-label="${esc(`Evolução em ${avaliadas.length} sessões avaliadas, tendência ${tendencia}`)}">
          <svg viewBox="0 0 ${largura} ${altura}" width="${largura}" height="${altura}">
            ${grade}<line class="linha-base" x1="${esq}" x2="${largura-dir}" y1="${altura-base}" y2="${altura-base}"/>
            ${linha}${pontos}${rotulosX}
          </svg>
        </div>
        ${sessoes.length>avaliadas.length?`<p class="field__hint">${sessoes.length-avaliadas.length} ${sessoes.length-avaliadas.length>1?'sessões':'sessão'} do período sem avaliação não aparece${sessoes.length-avaliadas.length>1?'m':''} no gráfico.</p>`:''}
        <details class="viz-tabela"><summary>Ver em tabela</summary>
          <table class="tbl"><thead><tr><th>Data</th><th>Especialidade</th><th>Profissional</th><th>Evolução</th></tr></thead>
          <tbody>${sessoes.map(x=>`<tr><td>${esc(formatDateBR(x.data_hora))}</td><td>${esc(x.especialidade)}</td><td>${esc(x.terapeuta)}</td><td>${x.evolucao?esc(EVOLUCAO[x.evolucao]):'—'}</td></tr>`).join('')}</tbody></table>
        </details>`;
    },
    // Plano terapêutico: metas do paciente (criar, marcar como alcançada, encerrar, reativar)
    renderMetas(){
      const alvo=$('#evo-metas'),metas=S.ed.evoMetas||[];
      const pI=temPerm(1,20,22),pA=temPerm(1,20,23),pX=temPerm(1,20,24);
      const SIT={ATIVA:'Em andamento',ALCANCADA:'Alcançada',ENCERRADA:'Encerrada'};
      const esps=S.especialidades.filter(e=>e.inativo!=='S');
      alvo.innerHTML=`
        <div class="evo-metas__head"><p class="modal-section__title" style="margin:0">${icon('target',15)} Metas do plano terapêutico</p></div>
        ${metas.length?metas.map(m=>`<div class="meta-item${m.status!=='ATIVA'?' meta-item--fechada':''}">
          <div class="meta-item__texto"><span>${esc(m.descricao)}</span>
            <small>${esc(m.especialidade)} · ${esc(SIT[m.status]||m.status)}${m.avaliacoes.length?` · ${m.avaliacoes.length} ${m.avaliacoes.length>1?'avaliações':'avaliação'} no período`:''}</small></div>
          ${pA&&m.status==='ATIVA'?`<button class="icon-btn" data-meta-status="ALCANCADA" data-id="${m.id}" title="Marcar como alcançada">${icon('check')}</button>
            <button class="icon-btn" data-meta-status="ENCERRADA" data-id="${m.id}" title="Encerrar">${icon('close')}</button>`:''}
          ${pA&&m.status!=='ATIVA'?`<button class="icon-btn" data-meta-status="ATIVA" data-id="${m.id}" title="Reativar">${icon('refresh')}</button>`:''}
          ${pX?`<button class="icon-btn icon-btn--danger" data-meta-del="${m.id}" title="Excluir">${icon('trash')}</button>`:''}
        </div>`).join(''):'<p style="color:var(--ink-3);font-size:13.5px">Nenhuma meta. As metas aparecem para avaliação ao registrar cada sessão.</p>'}
        ${pI&&esps.length?`<div class="meta-nova">
          <div class="field"><label class="field__label" for="meta-esp">Especialidade</label>
            <select class="select" id="meta-esp">${esps.map(e=>`<option value="${e.id}">${esc(e.descricao)}</option>`).join('')}</select></div>
          <div class="field"><label class="field__label" for="meta-desc">Nova meta</label>
            <input class="input" id="meta-desc" type="text" maxlength="300" placeholder="Ex.: formar frases de 3 palavras" autocomplete="off" /></div>
          <button class="btn btn--secondary" type="button" id="meta-add">${icon('plus')}<span>Adicionar</span></button>
        </div>`:''}`;
      alvo.querySelectorAll('[data-meta-status]').forEach(b=>b.addEventListener('click',()=>this.mudarMeta(+b.dataset.id,b.dataset.metaStatus)));
      alvo.querySelectorAll('[data-meta-del]').forEach(b=>b.addEventListener('click',()=>{
        ui.confirm('Excluir esta meta?','As avaliações já feitas deixam de aparecer no gráfico.',async()=>{
          try{await api.del(`/metas/${b.dataset.metaDel}`);await this.carregar();ui.success('Meta excluída');}
          catch(err){ui.error('Erro',err.message);}
        });
      }));
      $('#meta-add')?.addEventListener('click',()=>this.novaMeta());
      $('#meta-desc')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.novaMeta();}});
    },
    async novaMeta(){
      const desc=$('#meta-desc').value.trim(),esp=parseInt($('#meta-esp').value,10);
      fieldErr($('#meta-desc'),!desc);if(!desc||!esp)return;
      const btn=$('#meta-add');btn.setAttribute('aria-busy','true');
      try{await api.post('/metas',{id_paciente:S.ed.pessoaId,id_especialidade:esp,descricao:desc});await this.carregar();ui.success('Meta adicionada');}
      catch(err){ui.error('Erro',err.message);btn.removeAttribute('aria-busy');}
    },
    async mudarMeta(id,status){
      const m=(S.ed.evoMetas||[]).find(x=>x.id===id);if(!m)return;
      try{await api.put(`/metas/${id}`,{updatedAt:m.updated_at,campos:{status}});await this.carregar();
        ui.success({ALCANCADA:'Meta alcançada',ENCERRADA:'Meta encerrada',ATIVA:'Meta reativada'}[status]);}
      catch(err){ui.error('Erro',err.message);}
    },
    init(){
      $('#evo-serie').addEventListener('change',()=>this.desenhar());
      $('#tab-btn-evolucao').addEventListener('click',()=>{if(!S.ed.evo)this.carregar();});
      $('#evo-periodo').addEventListener('change',()=>this.carregar());
      $('#evo-esp').addEventListener('change',()=>this.desenhar());
    },
  };

  /* ===================================================================
     DINHEIRO E DOCUMENTOS (recibo, repasse)
     =================================================================== */
  // O banco guarda centavos (inteiros); na tela, "R$ 1.234,56"
  const FMT_REAIS=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  const reais=c=>FMT_REAIS.format((Number(c)||0)/100);
  // "150" | "150,00" | "1.500,50" | "R$ 1.500,50" -> centavos; vazio -> undefined; inválido -> null
  function lerReais(txt){
    let t=String(txt??'').replace(/[R$\s]/g,'');
    if(!t)return undefined;
    if(/,\d{1,2}$/.test(t))t=t.replace(/\./g,'').replace(',','.');
    else if(/^\d{1,3}(\.\d{3})+$/.test(t))t=t.replace(/\./g,'');
    if(!/^\d+(\.\d{1,2})?$/.test(t))return null;
    return Math.round(parseFloat(t)*100);
  }
  // Ao sair do campo, mostra no formato de moeda
  function campoReais(el){el.addEventListener('blur',()=>{const c=lerReais(el.value);if(Number.isInteger(c))el.value=reais(c);});}

  // Valor por extenso (recibo): 25050 -> "duzentos e cinquenta reais e cinquenta centavos"
  function porExtenso(centavos){
    const U=['','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
    const D=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
    const C=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
    const ate999=n=>{
      if(n===100)return 'cem';
      const c=Math.floor(n/100),r=n%100,partes=[];
      if(c)partes.push(C[c]);
      if(r<20){if(r)partes.push(U[r]);}
      else{partes.push(D[Math.floor(r/10)]+(r%10?` e ${U[r%10]}`:''));}
      return partes.join(' e ');
    };
    const inteiro=n=>{
      if(!n)return 'zero';
      const milhoes=Math.floor(n/1e6),mil=Math.floor(n%1e6/1000),resto=n%1000,partes=[];
      if(milhoes)partes.push(milhoes===1?'um milhão':`${ate999(milhoes)} milhões`);
      if(mil)partes.push(mil===1?'mil':`${ate999(mil)} mil`);
      if(resto)partes.push(ate999(resto));
      return partes.join(resto&&resto<100||resto%100===0&&resto?' e ':' ');
    };
    const r=Math.floor(centavos/100),c=centavos%100;
    // Milhão redondo pede "de": um milhão de reais
    const tReais=r?`${inteiro(r)} ${r>=1e6&&r%1e6===0?'de ':''}${r===1?'real':'reais'}`:'';
    const tCent=c?`${inteiro(c)} ${c===1?'centavo':'centavos'}`:'';
    return [tReais,tCent].filter(Boolean).join(' e ')||'zero real';
  }

  // Imprime um documento por um iframe oculto (mesmo jeito do registro de evolução)
  async function imprimirDocumento(html){
    const frame=document.createElement('iframe');
    frame.setAttribute('aria-hidden','true');
    frame.style.cssText='position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    frame.srcdoc=html;
    document.body.appendChild(frame);
    await new Promise(r=>frame.addEventListener('load',r,{once:true}));
    await Promise.all([...frame.contentDocument.images].map(img=>img.decode().catch(()=>{})));
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(()=>frame.remove(),60000);
  }
  const CSS_DOC=`@page{size:A4;margin:16mm} *{box-sizing:border-box} body{margin:0;font:10.5pt/1.5 Arial,Helvetica,sans-serif;color:#1d2433}
    .cab{display:flex;align-items:center;gap:16px;padding-bottom:10px;border-bottom:2px solid #1a4f8b;margin-bottom:18px}
    .cab img{height:56px;width:auto;object-fit:contain} .cab h1{margin:0;font-size:17pt;color:#1a4f8b} .cab .sub{font-size:9pt;color:#5b6575}
    .num{margin-left:auto;text-align:right;font-size:9pt;color:#5b6575} .num strong{display:block;font-size:13pt;color:#1d2433}
    table{width:100%;border-collapse:collapse} th,td{padding:7px 8px;border-bottom:1px solid #d6dbe4;text-align:left} th{font-size:8.5pt;text-transform:uppercase;letter-spacing:.06em;color:#5b6575}
    td.n,th.n{text-align:right;font-variant-numeric:tabular-nums} tfoot td{font-weight:700;border-top:2px solid #1d2433;border-bottom:0}
    .assinatura{margin-top:70px;display:flex;flex-direction:column;align-items:center;font-size:9.5pt} .assinatura i{width:280px;border-top:1px solid #1d2433;margin-bottom:6px}`;
  const FORMAS={PIX:'Pix',DINHEIRO:'dinheiro',CARTAO:'cartão',TRANSFERENCIA:'transferência',OUTRO:'outra forma'};
  const dataExtensa=iso=>{const [a,m,d]=String(iso).slice(0,10).split('-').map(Number);
    return `${d} de ${['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][m-1]} de ${a}`;};

  async function imprimirRecibo(idPagamento){
    try{
      const p=await api.get(`/pagamentos/${idPagamento}/recibo`);
      const logo=await evolucao.logo()||MARCA_VINDIX;
      const valor=Number(p.valor_centavos)||0;
      await imprimirDocumento(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo</title><style>${CSS_DOC}
        .valor{font-family:Arial;font-size:22pt;font-weight:700;margin:6px 0 18px} p{margin:0 0 12px;font-size:11.5pt;line-height:1.7}</style></head><body>
        <div class="cab"><img src="${logo}" alt=""><div><h1>Recibo</h1><div class="sub">${esc(nomeExibicao(p.empresa))}</div></div>
          <div class="num">Recibo nº<strong>${Number(p.id)}</strong></div></div>
        <div class="valor">${esc(reais(valor))}</div>
        <p>Recebemos de <strong>${esc(p.paciente)}</strong> a importância de <strong>${esc(reais(valor))}</strong> (${esc(porExtenso(valor))}),
          ${p.referente?`referente a ${esc(p.referente)}`:'referente a atendimentos realizados'}, paga em ${esc(FORMAS[p.forma]||'outra forma')}.</p>
        <p>${esc(dataExtensa(p.dt_pagamento))}.</p>
        <div class="assinatura"><i></i>${esc(nomeExibicao(p.empresa))}</div>
      </body></html>`);
    }catch(err){ui.error('Não foi possível gerar o recibo',err.message);}
  }

  // Sugere a lista de espera quando um horário fica livre
  async function sugerirEspera(idEspecialidade){
    if(!idEspecialidade||!temPerm(1,40,41))return;
    try{
      const {aguardando}=await api.get(`/espera/contagem?especialidade=${Number(idEspecialidade)}`);
      if(!aguardando)return;
      const v=await ui.escolher('Horário livre',
        `${aguardando} ${aguardando>1?'pacientes aguardam':'paciente aguarda'} vaga em ${nomeEsp(idEspecialidade)} na lista de espera.`,
        [{valor:'ver',rotulo:'Ver a lista de espera',estilo:'primary'}],{voltar:'Agora não'});
      if(v==='ver'){pages.espera.filtro=String(idEspecialidade);nav.goto('espera');}
    }catch{}
  }

  /* ===================================================================
     LISTA DE ESPERA
     =================================================================== */
  pages.espera = {
    itens:[], total:0, filtro:'',
    render(){this.popularEspecialidades();this.load();},
    popularEspecialidades(){
      const sel=$('#espera-esp'),atual=this.filtro||sel.value;
      sel.innerHTML='<option value="">Todas</option>'+S.especialidades.filter(e=>e.inativo!=='S')
        .map(e=>`<option value="${e.id}" ${String(e.id)===atual?'selected':''}>${esc(e.descricao)}</option>`).join('');
      this.filtro='';
    },
    async load({mais=false}={}){
      if(!S.token||!temPerm(1,40,41))return;
      const body=$('#espera-body');
      if(!mais)body.innerHTML=ui.skeleton(4);
      try{
        const pagina=mais?Math.floor(this.itens.length/POR_PAGINA)+1:1;
        const {itens,total}=await api.lista('/espera',{especialidade:$('#espera-esp').value,busca:$('#search-espera').value.trim(),pagina,por_pagina:POR_PAGINA});
        lembrarNomes(itens,[['id_paciente','paciente']]);
        this.itens=mais?[...this.itens,...itens]:itens;this.total=total;
        this.renderTable();
      }catch(err){body.innerHTML=ui.errorState('Não foi possível carregar a lista de espera',err.message);}
      this.atualizarBadge();
    },
    async atualizarBadge(){
      if(!temPerm(1,40,41))return;
      try{
        const {total}=await api.lista('/espera',{por_pagina:1});
        const b=$('#nav-badge-espera');b.textContent=total;b.hidden=!total;
      }catch{}
    },
    renderTable(){
      const body=$('#espera-body'),list=this.itens,total=this.total;
      $('#count-espera').textContent=`${total} ${total===1?'paciente':'pacientes'}`;
      if(!list.length){body.innerHTML=ui.emptyState('hourglass','Ninguém aguardando','Quando um paciente precisar de vaga, clique em "Adicionar à lista".');return;}
      const pA=temPerm(1,40,42),pS=temPerm(1,40,43);
      const rows=list.map(w=>`<tr>
        <td><div style="font-weight:500">${esc(w.paciente)}</div></td>
        <td>${badgeEsp(w.id_especialidade,w.especialidade)}</td>
        <td>${w.terapeuta?esc(w.terapeuta):'<span style="color:var(--ink-3)">Qualquer um</span>'}</td>
        <td style="color:var(--ink-2)">${esc(w.preferencia||'—')}</td>
        <td class="td-date">${Number(w.dias)===0?'Hoje':`${Number(w.dias)} ${Number(w.dias)===1?'dia':'dias'}`}</td>
        <td class="td-actions">
          ${pA?`<button class="icon-btn" data-act="agendar" data-id="${w.id}" title="Agendar">${icon('calendar')}</button>`:''}
          ${pS?`<button class="icon-btn icon-btn--danger" data-act="sair" data-id="${w.id}" title="Tirar da lista">${icon('close')}</button>`:''}
        </td></tr>`).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Paciente</th><th>Especialidade</th><th>Profissional</th><th>Preferência</th><th>Na lista há</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${rows}</tbody></table></div>${rodapeLista(list.length,total,'mais-espera')}`;
      $('#mais-espera')?.addEventListener('click',e=>carregarMais(e.currentTarget,()=>this.load({mais:true})));
      body.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>{
        const w=this.itens.find(x=>x.id===+b.dataset.id);if(!w)return;
        if(b.dataset.act==='agendar')pages.agenda.openNew({espera:w});
        else this.sair(w);
      }));
    },
    sair(w){
      ui.confirm(`Tirar ${w.paciente} da lista de espera?`,'Use quando o paciente desistir ou não precisar mais da vaga.',async()=>{
        try{await api.put(`/espera/${w.id}/status`,{status:'DESISTIU'});await this.load();ui.success('Paciente saiu da lista');}
        catch(err){ui.error('Erro',err.message);}
      });
    },
    async openNew(){
      $('#form-espera').reset();
      $$('#form-espera .field').forEach(f=>f.classList.remove('has-error'));
      if(!S.terapeutas.length)await carregarTerapeutas().catch(()=>{});
      const busca=$('#w-paciente-busca');busca.value='';
      busca.oninput=debounce(async()=>{await buscarPacientes('w',busca.value,parseInt($('#w-paciente').value,10)||null);this._opcoesPaciente();},300);
      $('#w-paciente').onchange=()=>this._opcoesPaciente();
      $('#w-terapeuta').onchange=()=>this._especialidades();
      await buscarPacientes('w','',null);
      await this._opcoesPaciente();
      ui.openModal('modal-espera');
    },
    // Vínculos do cadastro: profissionais do paciente e, deles, as especialidades (como no agendamento).
    // Paciente sem vínculos aceita qualquer profissional e especialidade.
    async _relacoes(cad){
      if(!cad)return [];
      if(!cad._relacoes){try{const r=await api.relacaoGet(cad.id);cad._relacoes=Array.isArray(r)?r:[];}catch{cad._relacoes=[];}}
      return cad._relacoes;
    },
    async _opcoesPaciente(){
      const pid=parseInt($('#w-paciente').value,10)||null,selT=$('#w-terapeuta'),selE=$('#w-especialidade');
      if(!pid){
        selT.innerHTML='<option value="">— selecione o paciente primeiro —</option>';selT.disabled=true;
        selE.innerHTML='<option value="">— selecione o paciente primeiro —</option>';selE.disabled=true;
        return;
      }
      const relPac=await this._relacoes({id:pid,_relacoes:this._cacheRel?.get(pid)});
      (this._cacheRel??=new Map()).set(pid,relPac);
      if(parseInt($('#w-paciente').value,10)!==pid)return;
      const ids=new Set(relPac.map(r=>r.id_especialidade_terapeuta));
      this._profissionais=ids.size?S.terapeutas.filter(t=>ids.has(t.id)):S.terapeutas;
      const atual=selT.value;
      selT.innerHTML='<option value="">Qualquer profissional</option>'+this._profissionais
        .map(t=>`<option value="${t.id}" ${String(t.id)===atual?'selected':''}>${esc(t.nome)}</option>`).join('');
      selT.disabled=false;
      await this._especialidades();
    },
    async _especialidades(){
      const selE=$('#w-especialidade'),tid=parseInt($('#w-terapeuta').value,10)||null,atual=selE.value||$('#espera-esp').value;
      // Profissional escolhido: as dele; "qualquer um": as de todos os profissionais do paciente
      const fontes=tid?S.terapeutas.filter(t=>t.id===tid):this._profissionais||[];
      let permitidas=null; // null = todas
      if(fontes.length&&fontes!==S.terapeutas){
        const listas=await Promise.all(fontes.map(t=>this._relacoes(t)));
        // Profissional sem especialidades vinculadas atende qualquer uma
        if(!listas.some(l=>!l.length))permitidas=new Set(listas.flat().map(r=>r.id_especialidade_terapeuta));
      }
      const esps=S.especialidades.filter(e=>e.inativo!=='S'&&(!permitidas||permitidas.has(e.id)));
      selE.innerHTML=`<option value="">${esps.length?'Selecione':'Nenhuma especialidade para este paciente'}</option>`+
        esps.map(e=>`<option value="${e.id}" ${String(e.id)===atual?'selected':''}>${esc(e.descricao)}</option>`).join('');
      selE.disabled=!esps.length;
    },
    async save(e){
      e.preventDefault();
      const paciente=parseInt($('#w-paciente').value,10)||null,esp=parseInt($('#w-especialidade').value,10)||null;
      fieldErr($('#w-paciente'),!paciente);fieldErr($('#w-especialidade'),!esp);
      if(!paciente||!esp)return;
      const btn=$('#btn-salvar-espera');btn.setAttribute('aria-busy','true');
      try{
        await api.post('/espera',{id_paciente:paciente,id_especialidade:esp,
          id_terapeuta:parseInt($('#w-terapeuta').value,10)||null,preferencia:$('#w-preferencia').value.trim()||null});
        ui.closeModal('modal-espera');await this.load();ui.success('Paciente adicionado à lista de espera');
      }catch(err){ui.error('Erro',err.message);}
      finally{btn.removeAttribute('aria-busy');}
    },
    init(){
      $('#btn-reload-espera').addEventListener('click',()=>this.load());
      $('#btn-new-espera').addEventListener('click',()=>this.openNew());
      $('#espera-esp').addEventListener('change',()=>this.load());
      $('#search-espera').addEventListener('input',debounce(()=>this.load(),300));
      $('#form-espera').addEventListener('submit',e=>this.save(e));
    },
  };

  /* ===================================================================
     FINANCEIRO
     =================================================================== */
  pages.financeiro = {
    aba:'pacientes', itens:[], total:0, extrato:null,
    render(){
      // Profissional vinculado: só o próprio repasse
      if(S.profissional)this.aba='repasses';
      $('#fin-abas').hidden=!!S.profissional;
      this.mostrarAba(this.aba);
    },
    mostrarAba(aba){
      this.aba=aba;
      $$('#fin-abas .tab').forEach(t=>t.classList.toggle('tab--active',t.dataset.fin===aba));
      $('#fin-pacientes').hidden=aba!=='pacientes';$('#fin-repasses').hidden=aba!=='repasses';
      const lanca=aba==='pacientes'&&!S.profissional&&temPerm(1,60,62);
      $('#btn-new-pagamento').style.display=lanca?'':'none';$('#btn-new-pacote').style.display=lanca?'':'none';
      if(aba==='pacientes')this.load();else this.loadRepasses();
    },
    async load({mais=false}={}){
      if(!S.token||!temPerm(1,60,61)||S.profissional)return;
      const body=$('#fin-body');
      if(!mais)body.innerHTML=ui.skeleton(4);
      try{
        const pagina=mais?Math.floor(this.itens.length/POR_PAGINA)+1:1;
        const {itens,total}=await api.lista('/financeiro/pacientes',{situacao:$('#fin-situacao').value,busca:$('#search-fin').value.trim(),pagina,por_pagina:POR_PAGINA});
        this.itens=mais?[...this.itens,...itens]:itens;this.total=total;
        this.renderTable();
      }catch(err){body.innerHTML=ui.errorState('Não foi possível carregar o financeiro',err.message);}
    },
    saldoHtml(c){
      c=Number(c)||0;
      return c>0?`<span class="valor-aberto">${esc(reais(c))}</span>`:c<0?`<span class="valor-credito">${esc(reais(-c))} de crédito</span>`:'<span style="color:var(--ink-3)">Em dia</span>';
    },
    renderTable(){
      const body=$('#fin-body'),list=this.itens,total=this.total;
      $('#count-fin').textContent=`${total} ${total===1?'paciente':'pacientes'}`;
      if(!list.length){
        body.innerHTML=$('#fin-situacao').value==='aberto'&&!$('#search-fin').value.trim()
          ?ui.emptyState('check','Nada em aberto','Todos os pacientes estão com os pagamentos em dia.')
          :ui.emptyState('search','Nada encontrado','Ajuste a busca ou o filtro.');
        return;
      }
      const rows=list.map(p=>`<tr>
        <td><div style="font-weight:500">${esc(p.nome)}</div></td>
        <td class="num">${esc(reais(Number(p.sessoes)+Number(p.pacotes)))}</td>
        <td class="num">${esc(reais(p.pago))}</td>
        <td class="num">${Number(p.sessoes_pacote)>0?`${Number(p.sessoes_pacote)} ${Number(p.sessoes_pacote)===1?'sessão':'sessões'}`:'—'}</td>
        <td class="num">${this.saldoHtml(p.saldo)}</td>
        <td class="td-actions"><button class="btn btn--secondary" data-id="${p.id}" type="button" style="min-height:34px;padding:4px 14px">Ver extrato</button></td></tr>`).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Paciente</th><th class="num">Cobrado</th><th class="num">Pago</th><th class="num">Pacote restante</th><th class="num">Situação</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${rows}</tbody></table></div>${rodapeLista(list.length,total,'mais-fin')}`;
      $('#mais-fin')?.addEventListener('click',e=>carregarMais(e.currentTarget,()=>this.load({mais:true})));
      body.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>this.abrirExtrato(+b.dataset.id)));
    },
    async abrirExtrato(id){
      const corpo=$('#extrato-corpo');corpo.innerHTML=ui.skeleton(4);$('#extrato-resumo').innerHTML='';$('#extrato-acoes').innerHTML='';
      ui.openModal('modal-extrato');
      try{this.extrato=await api.get(`/financeiro/pacientes/${id}`);}
      catch(err){corpo.innerHTML=ui.errorState('Não foi possível carregar o extrato',err.message);return;}
      this.desenharExtrato();
    },
    desenharExtrato(){
      const d=this.extrato,s=d.saldo,pac={id:d.paciente.id,nome:d.paciente.nome};
      $('#modal-extrato-title').textContent=d.paciente.nome;
      const restante=Number(s.sessoes_pacote)||0;
      $('#extrato-resumo').innerHTML=`
        <div class="fin-resumo__item"><span>${Number(s.saldo)<0?'Crédito':'Em aberto'}</span><strong class="${Number(s.saldo)>0?'valor-aberto':''}">${esc(reais(Math.abs(Number(s.saldo))))}</strong></div>
        <div class="fin-resumo__item"><span>Total pago</span><strong>${esc(reais(s.pago))}</strong></div>
        <div class="fin-resumo__item"><span>Sessões de pacote restantes</span><strong>${restante}</strong></div>`;
      $('#extrato-acoes').innerHTML=temPerm(1,60,62)?`
        ${Number(s.saldo)>0?`<button class="btn btn--primary" type="button" id="ext-pagar">${icon('plus')}<span>Registrar pagamento</span></button>`:''}
        <button class="btn btn--secondary" type="button" id="ext-pacote">${icon('plus')}<span>Novo pacote</span></button>`:'';
      $('#ext-pagar')?.addEventListener('click',()=>this.openPagamento(pac));
      $('#ext-pacote')?.addEventListener('click',()=>this.openPacote(pac));
      const pX=temPerm(1,60,64);
      const tabela=(cab,linhas,vazio)=>linhas.length
        ?`<div class="table-scroll"><table class="tbl"><thead><tr>${cab}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>`
        :`<p style="color:var(--ink-3);font-size:13.5px">${vazio}</p>`;
      $('#extrato-corpo').innerHTML=`
        <section class="fin-secao"><h3>Pagamentos</h3>${tabela('<th>Data</th><th>Forma</th><th>Referente a</th><th class="num">Valor</th><th style="text-align:right">Ações</th>',
          d.pagamentos.map(g=>`<tr><td class="td-date">${esc(formatDateBR(g.dt_pagamento))}</td><td>${esc(FORMAS[g.forma]||g.forma)}</td>
            <td style="color:var(--ink-2)">${esc(g.referente||'—')}</td><td class="num">${esc(reais(g.valor_centavos))}</td>
            <td class="td-actions"><button class="icon-btn" data-recibo="${g.id}" title="Imprimir recibo">${icon('printer')}</button>
              ${pX?`<button class="icon-btn icon-btn--danger" data-del-pag="${g.id}" title="Excluir pagamento">${icon('trash')}</button>`:''}</td></tr>`),
          'Nenhum pagamento registrado.')}</section>
        <section class="fin-secao"><h3>Pacotes</h3>${tabela('<th>Data</th><th>Especialidade</th><th class="num">Sessões</th><th class="num">Valor</th><th style="text-align:right">Ações</th>',
          d.pacotes.map(k=>`<tr><td class="td-date">${esc(formatDateBR(k.dt_compra))}</td><td>${k.especialidade?esc(k.especialidade):'Qualquer'}${k.obs?`<div class="field__hint">${esc(k.obs)}</div>`:''}</td>
            <td class="num">${Number(k.usadas)} de ${Number(k.qtd_sessoes)} usadas</td><td class="num">${esc(reais(k.valor_centavos))}</td>
            <td class="td-actions">${pX&&!Number(k.usadas)?`<button class="icon-btn icon-btn--danger" data-del-pac="${k.id}" title="Excluir pacote">${icon('trash')}</button>`:''}</td></tr>`),
          'Nenhum pacote.')}</section>
        <section class="fin-secao"><h3>Sessões cobradas</h3>${tabela('<th>Data</th><th>Especialidade</th><th>Profissional</th><th class="num">Valor</th>',
          d.sessoes.map(c=>`<tr><td class="td-date">${esc(formatDateBR(c.data_hora))}</td><td>${esc(c.especialidade)}</td><td>${esc(c.terapeuta)}</td>
            <td class="num">${c.id_pacote?'<span style="color:var(--ink-3)">Do pacote</span>':esc(reais(c.valor_centavos))}</td></tr>`),
          'Nenhuma sessão cobrada. O valor da sessão é definido em Especialidades.')}</section>`;
      const corpo=$('#extrato-corpo');
      corpo.querySelectorAll('[data-recibo]').forEach(b=>b.addEventListener('click',()=>imprimirRecibo(+b.dataset.recibo)));
      corpo.querySelectorAll('[data-del-pag]').forEach(b=>b.addEventListener('click',()=>this.excluir('pagamentos',+b.dataset.delPag,'Excluir este pagamento?')));
      corpo.querySelectorAll('[data-del-pac]').forEach(b=>b.addEventListener('click',()=>this.excluir('pacotes',+b.dataset.delPac,'Excluir este pacote?')));
    },
    excluir(tipo,id,titulo){
      ui.confirm(titulo,'Ele deixa de contar no saldo do paciente. A exclusão fica registrada no histórico.',async()=>{
        try{await api.del(`/${tipo}/${id}`);await this.atualizarDepois();ui.success('Excluído');}
        catch(err){ui.error('Erro',err.message);}
      });
    },
    async atualizarDepois(){
      if(this.extrato&&$('#modal-extrato').classList.contains('is-open'))await this.abrirExtrato(this.extrato.paciente.id);
      if(S.currentPage==='financeiro'&&this.aba==='pacientes')this.load();
    },
    // Paciente fixo (vindo do extrato) ou escolhido na busca
    async prepararPaciente(pre,paciente){
      $(`#${pre}-paciente-wrap`).hidden=!!paciente;
      const fixo=$(`#${pre}-paciente-fixo`);fixo.hidden=!paciente;fixo.textContent=paciente?.nome||'';
      S.ed[`${pre}Paciente`]=paciente?.id??null;
      if(!paciente){
        const busca=$(`#${pre}-paciente-busca`);busca.value='';
        busca.oninput=debounce(()=>buscarPacientes(pre,busca.value,parseInt($(`#${pre}-paciente`).value,10)||null),300);
        await buscarPacientes(pre,'',null);
      }
    },
    pacienteEscolhido(pre){return S.ed[`${pre}Paciente`]??(parseInt($(`#${pre}-paciente`).value,10)||null);},
    async openPagamento(paciente=null){
      $('#form-pagamento').reset();$$('#form-pagamento .field').forEach(f=>f.classList.remove('has-error'));
      $('#g-data').value=dataISO(new Date());$('#g-data').max=dataISO(new Date());
      this.aberto=null;this._mostrarAberto();
      await this.prepararPaciente('g',paciente);
      $('#g-paciente').onchange=()=>this._carregarAberto(this.pacienteEscolhido('g'));
      ui.openModal('modal-pagamento');
      if(paciente)this._carregarAberto(paciente.id);
    },
    // Saldo em aberto do paciente: limita e já preenche o valor do pagamento
    async _carregarAberto(id){
      this.aberto=null;this._mostrarAberto();if(!id)return;
      try{
        const r=await api.get(`/financeiro/pacientes/${id}`);
        if(this.pacienteEscolhido('g')!==id)return;
        this.aberto=Math.max(0,Number(r.saldo?.saldo)||0);this._mostrarAberto();
        if(this.aberto>0&&!$('#g-valor').value)$('#g-valor').value=reais(this.aberto);
      }catch{}
    },
    _mostrarAberto(){
      const dica=$('#g-aberto'),btn=$('#btn-salvar-pagamento');
      dica.hidden=this.aberto==null;
      dica.textContent=this.aberto>0?`Em aberto: ${reais(this.aberto)}`:'Nada em aberto para este paciente.';
      dica.classList.toggle('field__hint--alerta',this.aberto===0);
      btn.disabled=this.aberto===0;
    },
    async savePagamento(e){
      e.preventDefault();
      const paciente=this.pacienteEscolhido('g'),valor=lerReais($('#g-valor').value),data=$('#g-data').value;
      const acima=this.aberto!=null&&Number.isInteger(valor)&&valor>this.aberto;
      $('#g-valor').closest('.field').querySelector('.field__error').textContent=acima?`O valor passa do que está em aberto (${reais(this.aberto)}).`:'Informe um valor maior que zero.';
      const erros=[['#g-paciente',!paciente],['#g-valor',!Number.isInteger(valor)||valor<=0||acima],['#g-data',!data||data>dataISO(new Date())]];
      erros.forEach(([s,inv])=>fieldErr($(s),inv));if(erros.some(([,inv])=>inv))return;
      const btn=$('#btn-salvar-pagamento');btn.setAttribute('aria-busy','true');
      try{
        const r=await api.post('/pagamentos',{id_paciente:paciente,valor_centavos:valor,dt_pagamento:data,forma:$('#g-forma').value,referente:$('#g-referente').value.trim()||null});
        ui.closeModal('modal-pagamento');await this.atualizarDepois();
        const v=await ui.escolher('Pagamento registrado',`${reais(valor)} lançados.`,[{valor:'recibo',rotulo:'Imprimir recibo',estilo:'primary'}],{voltar:'Agora não'});
        if(v==='recibo')imprimirRecibo(r.id);
      }catch(err){ui.error('Erro',err.message);}
      finally{btn.removeAttribute('aria-busy');}
    },
    async openPacote(paciente=null){
      $('#form-pacote').reset();$$('#form-pacote .field').forEach(f=>f.classList.remove('has-error'));
      $('#k-data').value=dataISO(new Date());$('#k-data').max=dataISO(new Date());$('#k-por-sessao').textContent='';
      $('#k-especialidade').innerHTML='<option value="">Qualquer especialidade</option>'+S.especialidades.filter(e=>e.inativo!=='S')
        .map(e=>`<option value="${e.id}">${esc(e.descricao)}</option>`).join('');
      await this.prepararPaciente('k',paciente);
      ui.openModal('modal-pacote');
    },
    porSessao(){
      const qtd=parseInt($('#k-qtd').value,10),valor=lerReais($('#k-valor').value);
      $('#k-por-sessao').textContent=qtd>0&&Number.isInteger(valor)?`${reais(Math.round(valor/qtd))} por sessão`:'';
    },
    async savePacote(e){
      e.preventDefault();
      const paciente=this.pacienteEscolhido('k'),qtd=parseInt($('#k-qtd').value,10),valor=lerReais($('#k-valor').value),data=$('#k-data').value;
      const erros=[['#k-paciente',!paciente],['#k-qtd',!(qtd>=1&&qtd<=200)],['#k-valor',!Number.isInteger(valor)],['#k-data',!data||data>dataISO(new Date())]];
      erros.forEach(([s,inv])=>fieldErr($(s),inv));if(erros.some(([,inv])=>inv))return;
      const btn=$('#btn-salvar-pacote');btn.setAttribute('aria-busy','true');
      try{
        await api.post('/pacotes',{id_paciente:paciente,id_especialidade:parseInt($('#k-especialidade').value,10)||null,
          qtd_sessoes:qtd,valor_centavos:valor,dt_compra:data,obs:$('#k-obs').value.trim()||null});
        ui.closeModal('modal-pacote');await this.atualizarDepois();ui.success('Pacote criado','As próximas sessões serão descontadas dele.');
      }catch(err){ui.error('Erro',err.message);}
      finally{btn.removeAttribute('aria-busy');}
    },
    async loadRepasses(){
      const body=$('#repasse-body');body.innerHTML=ui.skeleton(3);
      if(!$('#fin-mes').value)$('#fin-mes').value=dataISO(new Date()).slice(0,7);
      try{this.repasses=await api.get(`/financeiro/repasses?mes=${$('#fin-mes').value}`);}
      catch(err){body.innerHTML=ui.errorState('Não foi possível calcular os repasses',err.message);return;}
      const l=this.repasses.map(r=>({...r,sessoes:Number(r.sessoes),gerado:Number(r.gerado),repasse:Number(r.repasse),pct:r.repasse_percentual==null?null:Number(r.repasse_percentual)}));
      this.repasses=l;
      if(!l.length){body.innerHTML=ui.emptyState('wallet','Nenhuma sessão no mês','Os repasses aparecem conforme as sessões são registradas.',true);return;}
      const soma=k=>l.reduce((a,x)=>a+x[k],0);
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Profissional</th><th class="num">Sessões</th><th class="num">Valor das sessões</th><th class="num">Repasse</th><th class="num">A repassar</th></tr></thead>
        <tbody>${l.map(r=>`<tr><td><div style="font-weight:600">${esc(r.nome)}</div></td><td class="num">${r.sessoes}</td><td class="num">${esc(reais(r.gerado))}</td>
          <td class="num">${r.pct==null?'<span style="color:var(--ink-3)" title="Defina no cadastro do profissional">Não definido</span>':`${r.pct}%`}</td>
          <td class="num"><strong>${esc(reais(r.repasse))}</strong></td></tr>`).join('')}</tbody>
        ${l.length>1?`<tfoot><tr><td>Total</td><td class="num">${soma('sessoes')}</td><td class="num">${esc(reais(soma('gerado')))}</td><td></td><td class="num">${esc(reais(soma('repasse')))}</td></tr></tfoot>`:''}
        </table></div>`;
    },
    async imprimirRepasses(){
      if(!this.repasses?.length){ui.warning('Nada para imprimir','Não há sessões no mês escolhido.');return;}
      const logo=await evolucao.logo()||MARCA_VINDIX;
      const [a,m]=$('#fin-mes').value.split('-');
      const mes=`${['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][+m-1]} de ${a}`;
      const soma=k=>this.repasses.reduce((s,x)=>s+x[k],0);
      await imprimirDocumento(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Repasses</title><style>${CSS_DOC}</style></head><body>
        <div class="cab"><img src="${logo}" alt=""><div><h1>Repasse aos profissionais</h1><div class="sub">${esc(S.empresa?.nome||'')}</div></div>
          <div class="num">Referência<strong>${esc(mes)}</strong></div></div>
        <table><thead><tr><th>Profissional</th><th class="n">Sessões</th><th class="n">Valor das sessões</th><th class="n">Repasse</th><th class="n">A repassar</th></tr></thead>
        <tbody>${this.repasses.map(r=>`<tr><td>${esc(r.nome)}</td><td class="n">${r.sessoes}</td><td class="n">${esc(reais(r.gerado))}</td><td class="n">${r.pct==null?'—':r.pct+'%'}</td><td class="n">${esc(reais(r.repasse))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="n">${soma('sessoes')}</td><td class="n">${esc(reais(soma('gerado')))}</td><td></td><td class="n">${esc(reais(soma('repasse')))}</td></tr></tfoot></table>
      </body></html>`);
    },
    init(){
      $$('#fin-abas .tab').forEach(t=>t.addEventListener('click',()=>this.mostrarAba(t.dataset.fin)));
      $('#btn-reload-fin').addEventListener('click',()=>this.mostrarAba(this.aba));
      $('#fin-situacao').addEventListener('change',()=>this.load());
      $('#search-fin').addEventListener('input',debounce(()=>this.load(),300));
      $('#fin-mes').addEventListener('change',()=>this.loadRepasses());
      $('#btn-imprimir-repasse').addEventListener('click',()=>this.imprimirRepasses());
      $('#btn-new-pagamento').addEventListener('click',()=>this.openPagamento());
      $('#btn-new-pacote').addEventListener('click',()=>this.openPacote());
      $('#form-pagamento').addEventListener('submit',e=>this.savePagamento(e));
      $('#form-pacote').addEventListener('submit',e=>this.savePacote(e));
      ['#k-qtd','#k-valor'].forEach(s=>$(s).addEventListener('input',()=>this.porSessao()));
      ['#g-valor','#k-valor','#esp-valor'].forEach(s=>campoReais($(s)));
    },
  };

  /* Especialidades */
  pages.especialidades = {
    render(){this.renderTable();},
    async load({silent=false}={}){
      if(!S.token||!temPerm(1,30,31))return;
      try{
        const data=await api.espGet();
        S.especialidades=Array.isArray(data)?data:[];
        if(S.currentPage==='especialidades')this.renderTable();
        
        if(!silent&&S.especialidades.length){}
      }catch(err){if(!silent)ui.error('Erro ao carregar especialidades',err.message);}
    },
    renderTable(){
      const body=$('#esp-body'),cnt=$('#count-esp');
      if(!body)return;
      const q=($('#search-esp')?.value||'').toLowerCase();
      const list=S.especialidades.filter(e=>!q||(e.descricao||'').toLowerCase().includes(q));
      if(cnt)cnt.textContent=`${list.length} registro${list.length===1?'':'s'}`;
      if(!list.length){
        body.innerHTML=!S.especialidades.length
          ?ui.emptyState('heart-pulse','Nenhuma especialidade','Clique em "Nova especialidade".')
          :ui.emptyState('search','Nada encontrado','Ajuste a busca.');
        return;
      }
      const pE=temPerm(1,30,33),pX=temPerm(1,30,34),pH=temPerm(1,30,35),fin=finVer();
      const rows=list.map(e=>{
        const cor=COR_GOOGLE[e.id_cor||0];
        return `<tr>
          <td><div style="font-weight:500">${esc(e.descricao)}</div></td>
          <td><span style="display:inline-flex;align-items:center;gap:8px">${corDot(e.id_cor||0)} <span style="font-size:12px;color:var(--ink-3)">${esc(NOME_COR[e.id_cor||0])}</span></span></td>
          ${fin?`<td class="num">${e.valor_centavos!=null?esc(reais(e.valor_centavos)):'<span style="color:var(--ink-3)">—</span>'}</td>`:''}
          <td><span class="badge badge--${e.inativo==='S'?'warning':'success'}">${e.inativo==='S'?'Inativo':'Ativo'}</span></td>
          <td class="td-actions">${acoesLinha([
            pE&&`<button class="icon-btn" data-act="edit" data-id="${e.id}" title="Editar">${icon('edit')}</button>`,
          ],[
            pH&&`<button class="icon-btn" data-act="hist" data-id="${e.id}" title="Histórico">${icon('history')}</button>`,
            pX&&`<button class="icon-btn icon-btn--danger" data-act="del" data-id="${e.id}" title="Excluir">${icon('trash')}</button>`,
          ])}</td></tr>`;
      }).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Descrição</th><th>Cor Google Agenda</th>${finVer()?'<th class="num">Valor da sessão</th>':''}<th>Status</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
      body.querySelectorAll('[data-act]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const id=parseInt(btn.dataset.id,10);
          if(btn.dataset.act==='edit')this.openEdit(id);
          else if(btn.dataset.act==='hist')this.openHistorico(id);
          else if(btn.dataset.act==='del')this.excluir(id);
        });
      });
    },
    openNew(){
      resetModalTabs('modal-especialidade',{novo:true});
      S.ed.espId=null;S.ed.espUA=null;
      $('#modal-esp-title').textContent='Nova especialidade';
      $('#esp-descricao').value='';$('#esp-cor').value=0;$('#esp-inativo').value='N';$('#esp-valor').value='';
      this._campoValor();
      $$('#form-especialidade .field').forEach(f=>f.classList.remove('has-error'));
      // Esconde aba histórico ao inserir
      const tabH=$('#modal-especialidade .modal-tab[data-tab="esp-historico"]');
      if(tabH)tabH.style.display='none';
      ui.openModal('modal-especialidade');
    },
    async openEdit(id){
      await this.load({silent:true});
      const e=S.especialidades.find(x=>x.id===id);if(!e){ui.warning('Especialidade não encontrada','A lista foi atualizada.');return;}
      resetModalTabs('modal-especialidade');
      S.ed.espId=id;S.ed.espUA=e.updated_at;
      $('#modal-esp-title').textContent='Editar — '+e.descricao;
      $('#esp-descricao').value=e.descricao||'';
      $('#esp-cor').value=e.id_cor||0;$('#esp-inativo').value=e.inativo||'N';
      $('#esp-valor').value=e.valor_centavos!=null?reais(e.valor_centavos):'';
      this._campoValor();
      $$('#form-especialidade .field').forEach(f=>f.classList.remove('has-error'));
      const tabH=$('#modal-especialidade .modal-tab[data-tab="esp-historico"]');
      if(tabH)tabH.style.display='';
      ui.openModal('modal-especialidade');
      this._loadHistorico(id);
    },
    openHistorico(id){
      // Abre o modal de edição direto na aba de histórico
      const e=S.especialidades.find(x=>x.id===id);if(!e)return;
      S.ed.espId=id;S.ed.espUA=e.updated_at;
      $('#modal-esp-title').textContent='Histórico — '+e.descricao;
      $('#esp-descricao').value=e.descricao||'';
      $('#esp-cor').value=e.id_cor||0;$('#esp-inativo').value=e.inativo||'N';
      const tabH=$('#modal-especialidade .modal-tab[data-tab="esp-historico"]');
      if(tabH)tabH.style.display='';
      modoHistorico('modal-especialidade','esp-historico');
      ui.openModal('modal-especialidade');
      this._loadHistorico(id);
    },
    async _loadHistorico(id){
      const c=$('#historico-esp-body');c.innerHTML=ui.skeleton(3);
      try{ui.renderHistorico(c,await api.espHist(id));}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    async openHistoricoDeletes(){
      const c=$('#historico-esp-body');c.innerHTML=ui.skeleton(3);
      $('#modal-esp-title').textContent='Especialidades excluídas';
      const tabH=$('#modal-especialidade .modal-tab[data-tab="esp-historico"]');
      if(tabH)tabH.style.display='';
      modoHistorico('modal-especialidade','esp-historico');
      ui.openModal('modal-especialidade');
      try{ui.renderHistorico(c,await api.espHistDel());}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    _campoValor(){
      $('#esp-valor-wrap').hidden=!finVer();$('#esp-valor').disabled=!finAlterar();
    },
    async saveEsp(e){
      e.preventDefault();
      const desc=$('#esp-descricao').value.trim();
      fieldErr($('#esp-descricao'),!desc);if(!desc)return;
      const id_cor=parseInt($('#esp-cor').value,10)||0;
      const inativo=S.ed.espId?($('#esp-inativo').value):'N';
      // O preço só vai junto para quem pode alterá-lo
      const comValor=finAlterar(),valor=comValor?lerReais($('#esp-valor').value):undefined;
      fieldErr($('#esp-valor'),valor===null);if(valor===null)return;
      const valores=comValor?{valor_centavos:valor===undefined?null:valor}:{};
      const btn=$('#form-especialidade .btn--primary');btn.setAttribute('aria-busy','true');
      try{
        if(S.ed.espId){
          await api.espPut(S.ed.espId,{campos:{descricao:desc,inativo,id_cor,...valores},updatedAt:S.ed.espUA});
          // Recarrega para pegar o novo updated_at — necessário para próximas edições e histórico
          await this.load({silent:true});
          ui.success('Atualizada');
        }else{
          await api.espPost({descricao:desc,inativo:'N',id_cor,...valores});
          await this.load({silent:true});
          ui.success('Especialidade criada');
        }
        ui.closeModal('modal-especialidade');this.renderTable();
      }catch(err){
        if(err.message.includes('409')||err.message.toLowerCase().includes('desatualizado')){
          ui.warning('Registro desatualizado','Recarregando…');
          await this.openEdit(S.ed.espId);ui.info('Dados atualizados','Confira e salve novamente.');
        }else ui.error('Erro',err.message);
      }
      finally{btn.removeAttribute('aria-busy');}
    },
    excluir(id){
      const e=S.especialidades.find(x=>x.id===id);
      ui.confirm(`Remover "${e?.descricao||id}"?`,'Esta ação não pode ser desfeita.',async()=>{
        try{await api.espDel(id);S.especialidades=S.especialidades.filter(x=>x.id!==id);this.renderTable();ui.success('Removida');}
        catch(err){ui.error('Erro',err.message);}
      });
    },
    init(){
      $('#btn-new-esp')?.addEventListener('click',()=>this.openNew());
      $('#btn-hist-del-esp')?.addEventListener('click',()=>this.openHistoricoDeletes());
      $('#form-especialidade').addEventListener('submit',e=>this.saveEsp(e));
      $('#search-esp')?.addEventListener('input',debounce(()=>this.renderTable(),180));
    },
  };

  /* Usuários */
  // Áreas das permissões, na ordem em que estão gravadas (tabela PERMISSOES)
  const AREAS_PERMISSAO = {
    GERAL:'Acesso total', USUARIOS:'Gerenciar usuários', CADASTRO:'Pacientes e profissionais', CONSULTAS:'Sessões realizadas',
    ESPECIALIDADES:'Especialidades', AGENDAMENTOS:'Agendamentos', RESUMO:'Ver o resumo', FINANCEIRO:'Financeiro',
  };

  pages.usuarios = {
    render(){this.renderTable();},
    async load({silent=false}={}){
      if(!S.token||!temPerm(1,2))return;
      try{const data=await api.usuariosGet();S.usuarios=Array.isArray(data)?data:[];if(S.currentPage==='usuarios')this.renderTable();this.carregarFotos();}
      catch(err){if(!silent)ui.error('Erro',err.message);}
    },
    async loadPerms({silent=false}={}){
      if(!temPerm(1,2))return;
      try{const data=await api.permsGet();S.todasPerms=(Array.isArray(data)?data:[]).sort((a,b)=>a.id-b.id);}
      catch(err){if(!silent)ui.error('Erro',err.message);}
    },
    renderTable(){
      const body=$('#usuarios-body'),cnt=$('#count-usuarios');
      const q=($('#search-usuarios').value||'').toLowerCase();
      // Ativos primeiro; inativos no fim da lista
      const list=S.usuarios.filter(u=>!q||[u.nome,u.login].some(v=>(v||'').toLowerCase().includes(q)))
        .sort((a,b)=>(a.inativo?1:0)-(b.inativo?1:0));
      if(cnt)cnt.textContent=`${list.length} registro${list.length===1?'':'s'}`;
      if(!list.length){body.innerHTML=ui.emptyState('users','Nenhum usuário','Adicione o primeiro.');return;}
      const rows=list.map(u=>{
        const proprio=u.id===S.userId;
        return `<tr${u.inativo?' class="linha-inativa"':''}>
        <td><div class="usuario-linha">${this.avatar(u)}<span style="font-weight:500">${esc(u.nome)}</span></div></td>
        <td class="mono" style="color:var(--ink-2)">${esc(u.login||'—')}</td>
        <td>${u.profissional_nome?`<span class="badge badge--accent">${esc(u.profissional_nome)}</span>`:'<span style="color:var(--ink-3)">Equipe</span>'}</td>
        <td>${u.inativo?'<span class="badge badge--danger">Inativo</span>':'<span class="badge badge--success">Ativo</span>'}</td>
        <td class="td-actions">${acoesLinha([
          `<button class="icon-btn" data-act="edit" data-id="${u.id}" title="Editar">${icon('edit')}</button>`,
          `<button class="icon-btn" data-act="perm" data-id="${u.id}" title="Permissões">${icon('shield')}</button>`,
        ],[
          `<button class="icon-btn" data-act="dup" data-id="${u.id}" title="Duplicar (mesmas permissões)">${icon('copy')}</button>`,
          !proprio&&!u.inativo&&`<button class="icon-btn" data-act="reset" data-id="${u.id}" title="Redefinir senha">${icon('key')}</button>`,
          !proprio&&`<button class="icon-btn${u.inativo?'':' icon-btn--danger'}" data-act="status" data-id="${u.id}" title="${u.inativo?'Reativar':'Inativar'}">${icon(u.inativo?'user-plus':'user-off')}</button>`,
        ])}</td></tr>`;}).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nome</th><th>Login</th><th>Profissional</th><th>Situação</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
      body.querySelectorAll('[data-act]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const id=parseInt(btn.dataset.id,10),ac=btn.dataset.act;
          if(ac==='edit')this.openEdit(id);
          else if(ac==='perm')this.openEdit(id).then(()=>gotoModalTab('modal-usuario','usr-permissoes'));
          else if(ac==='dup')this.duplicar(id);
          else if(ac==='reset')this.redefinirSenha(id);
          else if(ac==='status')this.alternarStatus(id);
        });
      });
    },
    // Fotos: guardadas por usuário e versão; só busca as que mudaram (até 50 por pedido)
    fotos:new Map(),
    avatar(u){
      const f=u.foto_versao&&this.fotos.get(u.id)?.versao===u.foto_versao?this.fotos.get(u.id).imagem:null;
      return `<span class="avatar avatar--p${f?' avatar--foto':''}" data-foto-usr="${u.id}" aria-hidden="true">${f?`<img src="${f}" alt="">`:esc(initials(u.nome))}</span>`;
    },
    async carregarFotos(){
      const faltam=S.usuarios.filter(u=>u.foto_versao&&this.fotos.get(u.id)?.versao!==u.foto_versao);
      for(let i=0;i<faltam.length;i+=50){
        const lote=faltam.slice(i,i+50);
        let fotos;
        try{fotos=await api.get(`/usuarios/fotos?ids=${lote.map(u=>u.id).join(',')}`);}catch{return;}
        for(const u of lote){
          const img=fotos?.[u.id];
          // Só data URI de imagem (o back já conferiu o conteúdo)
          if(typeof img==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(img))this.fotos.set(u.id,{versao:u.foto_versao,imagem:img});
        }
      }
      if(faltam.length&&S.currentPage==='usuarios')this.renderTable();
      if(S.ed.usuarioId)this._avatarModal(S.usuarios.find(x=>x.id===S.ed.usuarioId));
    },
    _avatarModal(u){
      const el=$('#u-avatar');el.hidden=!u;if(!u)return;
      el.outerHTML=this.avatar(u).replace('class="avatar avatar--p','id="u-avatar" class="avatar avatar--p');
    },
    _abrirModal(titulo,u){
      resetModalTabs('modal-usuario',{novo:!u});
      this._avatarModal(u);
      $('#modal-usuario-title').textContent=titulo;
      $('#u-login-wrap').style.display=u?'none':'';$('#u-senha-wrap').style.display=u?'none':'';
      $$('#tab-usr-dados .field').forEach(f=>f.classList.remove('has-error'));
      this._popularProfissionais(u);
      this._renderPerms();
      ui.openModal('modal-usuario');
    },
    async openNew({base=null,permissoes=[]}={}){
      if(!S.todasPerms.length)await this.loadPerms({silent:true});
      S.ed.usuarioId=null;S.ed.usuarioUA=null;
      $('#u-nome').value='';$('#u-login').value='';$('#u-email').value='';
      // Permissões ficam só na tela até o usuário ser criado
      S.ed.perms={original:new Set(),atual:new Set(permissoes),travado:false};
      this._abrirModal(base?`Duplicar — ${base.nome}`:'Novo usuário',null);
    },
    async duplicar(id){
      const u=S.usuarios.find(x=>x.id===id);if(!u)return;
      let ids;
      try{ids=(await api.permsUser(id)).map(p=>p.id_permissao);}
      catch(err){ui.error('Erro',err.message);return;}
      // Quem não tem acesso total não concede as permissões 1 e 2
      const restritas=temPerm(1)?[]:ids.filter(p=>p===1||p===2);
      await this.openNew({base:u,permissoes:ids.filter(p=>!restritas.includes(p))});
      if(restritas.length)ui.warning('Algumas permissões não foram copiadas','Só administradores concedem acesso total ou gestão de usuários.');
      $('#u-nome').focus();
    },
    async openEdit(id){
      await Promise.all([this.load({silent:true}),S.todasPerms.length?null:this.loadPerms({silent:true})]);
      const u=S.usuarios.find(x=>x.id===id);if(!u){ui.warning('Usuário não encontrado','A lista foi atualizada.');return;}
      S.ed.usuarioId=id;S.ed.usuarioUA=u.updated_at;
      $('#u-nome').value=u.nome||'';$('#u-email').value=u.email||'';
      S.ed.usuarioEmail=u.email||'';
      S.ed.perms={original:new Set(),atual:new Set(),travado:true,carregando:true};
      this._abrirModal('Editar — '+u.nome,u);
      this._loadHistPerms(id);
      try{
        const ids=(await api.permsUser(id)).map(p=>p.id_permissao);
        if(S.ed.usuarioId!==id)return;
        const travado=id===S.userId||(!temPerm(1)&&ids.includes(1));
        S.ed.perms={original:new Set(ids),atual:new Set(ids),travado};
      }catch(err){$('#usr-perms-grupos').innerHTML=ui.errorState('Erro',err.message);return;}
      this._renderPerms();
    },
    // Profissionais livres (sem usuário) + o já vinculado a este usuário
    _popularProfissionais(u){
      const ocupados=new Set(S.usuarios.filter(x=>x.profissional_id&&x.id!==u?.id).map(x=>x.profissional_id));
      const lista=S.terapeutas.filter(c=>!ocupados.has(c.id));
      if(u?.profissional_id&&!lista.some(c=>c.id===u.profissional_id))lista.push({id:u.profissional_id,nome:u.profissional_nome});
      $('#u-profissional').innerHTML='<option value="">Não, acessa como equipe</option>'+
        lista.map(c=>`<option value="${c.id}" ${u?.profissional_id===c.id?'selected':''}>${esc(c.nome)}</option>`).join('');
      $('#u-prof-wrap').hidden=!lista.length;
      S.ed.usuarioProf=u?.profissional_id??null;
    },
    _profissionalEscolhido(){return parseInt($('#u-profissional').value,10)||null;},
    async _salvarProfissional(usuarioId){
      const escolhido=this._profissionalEscolhido();
      if(escolhido===S.ed.usuarioProf)return;
      await api.put(`${EP.usuarios}/${usuarioId}/profissional`,{idCadastro:escolhido});
    },
    _permsAlteradas(){
      const p=S.ed.perms;if(!p||p.travado)return null;
      const mudou=p.atual.size!==p.original.size||[...p.atual].some(id=>!p.original.has(id));
      return mudou?[...p.atual].sort((a,b)=>a-b):null;
    },
    // Permissões agrupadas por área; "Geral" (e o acesso total) já incluem as demais da área
    _renderPerms(){
      const alvo=$('#usr-perms-grupos'),p=S.ed.perms;
      if(p.carregando){alvo.innerHTML=ui.skeleton(4);return;}
      const aviso=$('#usr-perms-aviso');
      aviso.textContent=S.ed.usuarioId===S.userId?'Você não pode alterar as próprias permissões.'
        :p.travado?'Só administradores alteram as permissões de um administrador.'
        :'Marque o que esta pessoa pode fazer. Nada é gravado até você salvar.';
      const grupos=new Map();
      for(const perm of S.todasPerms){
        if(!grupos.has(perm.tabela))grupos.set(perm.tabela,[]);
        grupos.get(perm.tabela).push(perm);
      }
      const total=p.atual.has(1);
      const rotulo=perm=>(PERMS_MAP[perm.id]?.label||perm.tipo).split('— ').pop();
      const caixa=(perm,implicita,texto)=>{
        const restrita=!temPerm(1)&&(perm.id===1||perm.id===2);
        const marcada=p.atual.has(perm.id)||implicita;
        const bloqueada=p.travado||restrita||implicita;
        return `<label class="check"><input type="checkbox" data-perm="${perm.id}" ${marcada?'checked':''} ${bloqueada?'disabled':''}/><span>${esc(texto)}</span></label>`;
      };
      // Permissões especiais (uma caixa só, sem área): ficam no topo, cada uma com o que libera
      const ESPECIAIS={GERAL:'Pode tudo no sistema',USUARIOS:'Cria usuários e define permissões',RESUMO:'Vê os números e indicadores da clínica'};
      const especiais=Object.keys(ESPECIAIS).filter(t=>grupos.has(t)).map(t=>{
        const perm=grupos.get(t)[0];grupos.delete(t);
        return `<div class="perm-especial${t==='GERAL'?' perm-especial--total':''}">${caixa(perm,t!=='GERAL'&&total,AREAS_PERMISSAO[t]||t)}
          <span class="perm-especial__desc">${esc(ESPECIAIS[t])}</span></div>`;
      }).join('');
      alvo.innerHTML=(especiais?`<div class="perm-grupo perm-grupo--especiais"><div class="perm-grupo__titulo"><span>Permissões especiais</span></div>${especiais}</div>`:'')+
      [...grupos.entries()].map(([tabela,lista])=>{
        const area=AREAS_PERMISSAO[tabela]||tabela;
        const geral=lista.find(x=>x.tipo==='GERAL');
        const outras=lista.filter(x=>x!==geral);
        const geralMarcada=geral&&p.atual.has(geral.id);
        if(!outras.length){
          return `<div class="perm-grupo"><div class="perm-grupo__titulo"><span>${esc(area)}</span>
            ${caixa(geral||lista[0],total,'Liberado')}</div></div>`;
        }
        return `<div class="perm-grupo"><div class="perm-grupo__titulo"><span>${esc(area)}</span>
            ${geral?caixa(geral,total,'Tudo nesta área'):''}</div>
          <div class="perm-grupo__itens">${outras.map(x=>caixa(x,total||geralMarcada,rotulo(x))).join('')}</div></div>`;
      }).join('');
      alvo.querySelectorAll('[data-perm]').forEach(cb=>cb.addEventListener('change',()=>{
        const id=+cb.dataset.perm;
        if(cb.checked)p.atual.add(id);else p.atual.delete(id);
        this._renderPerms();
      }));
      const nota=$('#usuario-pendente'),alteradas=this._permsAlteradas();
      nota.hidden=!alteradas;nota.textContent=alteradas?'Permissões alteradas. Salve para gravar.':'';
    },
    async _loadHistPerms(userId){
      const c=$('#historico-usr-body');c.innerHTML=ui.skeleton(3);
      try{ui.renderHistorico(c,await api.permHist(userId));}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    async saveUsuario(e){
      e.preventDefault();
      const nome=$('#u-nome').value.trim();
      const nomeInvalido=!nome||nome.length>100;
      fieldErr($('#u-nome'),nomeInvalido);if(nomeInvalido){gotoModalTab('modal-usuario','usr-dados');return;}
      const email=$('#u-email').value.trim().toLowerCase();
      const emailInvalido=!!email&&!/^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email);
      fieldErr($('#u-email'),emailInvalido);if(emailInvalido){gotoModalTab('modal-usuario','usr-dados');return;}
      const btn=$('#btn-salvar-usuario');
      if(!S.ed.usuarioId){
        const login=$('#u-login').value.trim();
        const loginInv=!/^[a-zA-Z0-9._@\-]{3,64}$/.test(login);
        fieldErr($('#u-login'),loginInv);if(loginInv){gotoModalTab('modal-usuario','usr-dados');return;}
        const permissoes=[...S.ed.perms.atual].sort((a,b)=>a-b);
        if(!permissoes.length){
          ui.warning('Sem permissões','Marque ao menos uma permissão: sem nenhuma a pessoa não consegue entrar.');
          gotoModalTab('modal-usuario','usr-permissoes');return;
        }
        btn.setAttribute('aria-busy','true');
        try{
          // Tudo vai junto: o back valida login, permissões e profissional antes de criar
          const r=await api.usuarioPost({login,nome,email,permissoes,idCadastro:this._profissionalEscolhido()});
          S.ed.perms=null;
          ui.closeModal('modal-usuario');
          await this.load({silent:true});
          ui.success('Usuário criado');
          this.mostrarSenhaTemporaria(nome,r.login,r.senhaTemporaria);
        }
        catch(err){ui.error('Erro',err.message);}
        finally{btn.removeAttribute('aria-busy');}
        return;
      }
      btn.setAttribute('aria-busy','true');
      try{
        await api.usuarioNome({usuario:S.ed.usuarioId,novonome:nome,updatedAt:S.ed.usuarioUA});
        if(email!==S.ed.usuarioEmail)await api.put(`${EP.usuarios}/${S.ed.usuarioId}/email`,{email});
        await this._salvarProfissional(S.ed.usuarioId);
        const perms=this._permsAlteradas();
        if(perms)await api.put(`${EP.usuarios}/${S.ed.usuarioId}/permissoes`,{ids:perms});
        S.ed.perms=null;
        ui.closeModal('modal-usuario');
        await this.load({silent:true});
        ui.success('Usuário atualizado',perms?'As sessões abertas dessa pessoa foram atualizadas.':'');
      }catch(err){
        if(err.message.toLowerCase().includes('alterado por outro')){
          ui.warning('Registro desatualizado','Recarregando…');await this.openEdit(S.ed.usuarioId);
        }else ui.error('Erro',err.message);
      }
      finally{btn.removeAttribute('aria-busy');}
    },
    alternarStatus(id){
      const u=S.usuarios.find(x=>x.id===id);if(!u)return;
      const inativar=!u.inativo;
      ui.confirm(inativar?`Inativar ${u.nome}?`:`Reativar ${u.nome}?`,
        inativar?'A pessoa não conseguirá mais entrar no sistema e as sessões abertas dela serão encerradas agora. O histórico continua guardado.'
                :'A pessoa volta a entrar com o login e a senha atuais.',
        async()=>{
          try{
            await api.put(`${EP.usuarios}/${id}/status`,{inativo:inativar});
            await this.load({silent:true});
            ui.success(inativar?'Usuário inativado':'Usuário reativado');
          }catch(err){ui.error('Erro',err.message);}
        });
    },
    // Senha temporária (cadastro ou redefinição)
    mostrarSenhaTemporaria(nome,login,senha){
      S.ed.permissoesAposSenha=null;
      $('#modal-st-title').textContent='Senha temporária';
      $('#st-nome').textContent=nome;
      $('#st-login').textContent=login||'';
      $('#st-senha').value=senha;
      $('#st-proximo').hidden=true;
      ui.openModal('modal-senha-temporaria');
    },
    redefinirSenha(id){
      const u=S.usuarios.find(x=>x.id===id);if(!u)return;
      ui.confirm(`Redefinir a senha de ${u.nome}?`,
        'Será gerada uma senha temporária. As sessões abertas dessa pessoa serão encerradas e ela precisará criar uma nova senha no próximo acesso.',
        async()=>{
          try{
            const r=await api.usuarioRedefinir(id);
            this.load({silent:true});
            this.mostrarSenhaTemporaria(u.nome,u.login,r.senhaTemporaria);
          }catch(err){ui.error('Erro',err.message);}
        });
    },
    async alterarSenha(e){
      e.preventDefault();
      const senhaAtual=$('#u-senha-atual').value;
      const novaSenha=$('#u-nova-senha').value,novaSenha2=$('#u-nova-senha2').value;
      let ok=true;
      fieldErr($('#u-senha-atual'),!senhaAtual);if(!senhaAtual)ok=false;
      const s1inv=senhaFraca(novaSenha);
      fieldErr($('#u-nova-senha'),s1inv);if(s1inv)ok=false;
      const s2inv=novaSenha!==novaSenha2;
      fieldErr($('#u-nova-senha2'),s2inv);if(s2inv)ok=false;
      if(!ok)return;
      const btn=$('#form-alterar-senha .btn--primary');btn.setAttribute('aria-busy','true');
      try{
        await api.usuarioSenha({senhaAtual,novaSenha});
        const troca=S.trocaObrigatoria;
        auth.liberarModalSenha();
        ui.closeModal('modal-minha-senha');
        if(troca){
          const data=await api.login(troca.usuario,novaSenha);
          auth.concluirLogin(data,troca.usuario);
          return;
        }
        ui.success('Senha alterada','Faça login novamente.');
        auth.logout({silent:true});auth.showLogin();
      }catch(err){ui.error('Erro',err.message);}
      finally{btn.removeAttribute('aria-busy');}
    },
    init(){
      $('#btn-reload-usuarios').addEventListener('click',()=>this.load());
      $('#btn-new-usuario').addEventListener('click',()=>this.openNew());
      $('#search-usuarios').addEventListener('input',debounce(()=>this.renderTable(),180));
      $('#form-usuario').addEventListener('submit',e=>this.saveUsuario(e));
    },
  };

  /* REGISTRO DE EVOLUÇÃO (impressão) */
  const evolucao = {
    // Logo da empresa do usuário (buscada uma vez por sessão)
    // Logo da clínica: '' completa (impresso), 'icone' (menu), 'escuro' (tema escuro)
    async logo(variante=''){
      S.logos=S.logos||{};
      if(S.logos[variante]!==undefined)return S.logos[variante];
      try{
        const p=new URLSearchParams({empresa:S.empresa?.id??''});if(variante)p.set('variante',variante);
        const r=await fetch(`${CONFIG.API_BASE}/empresa/logo?${p}`,{headers:{'Authorization':`Bearer ${S.token}`},cache:'no-cache'});
        S.logos[variante]=r.ok?URL.createObjectURL(await r.blob()):null;
      }catch{S.logos[variante]=null;}
      return S.logos[variante];
    },
    idade(nasc,ref){
      if(!nasc)return '—';
      const [a,m,d]=nasc.slice(0,10).split('-').map(Number),[ra,rm,rd]=ref.slice(0,10).split('-').map(Number);
      return String(ra-a-((rm<m||(rm===m&&rd<d))?1:0));
    },
    duracao(t){
      if(!t)return '';
      const [h,m]=t.split(':').map(Number);
      return h?`${h}h${String(m).padStart(2,'0')}`:`${m} min`;
    },
    // Uma página por paciente + profissional + especialidade, sessões em ordem de data
    agrupar(consultas){
      const grupos=new Map();
      for(const c of consultas){
        const k=`${c.id_paciente}|${c.id_terapeuta}|${c.especialidade}`;
        if(!grupos.has(k))grupos.set(k,[]);
        grupos.get(k).push(c);
      }
      return [...grupos.values()];
    },
    documento(sessoes,logo,empresa){
      const p=sessoes[0],ultima=sessoes[sessoes.length-1];
      const anos=[...new Set(sessoes.map(s=>s.data_hora.slice(0,4)))];
      const ano=anos.length>1?`${anos[0]}–${anos[anos.length-1]}`:anos[0];
      const linhas=sessoes.map(s=>{
        const [data,hora]=formatDateBR(s.data_hora).split(' ');
        const dur=this.duracao(s.tempo_sessao);
        return `<section class="sessao">
          <div class="sessao__data"><span>Sessão de ${esc(data)}${hora?` às ${esc(hora)}`:''}</span><span>${EVOLUCAO[s.evolucao]?`Evolução: ${esc(EVOLUCAO[s.evolucao])}`:''}${EVOLUCAO[s.evolucao]&&dur?'&nbsp;&nbsp;&nbsp;':''}${dur?`Duração: ${esc(dur)}`:''}</span></div>
          <p class="sessao__texto">${s.resumo_sessao?esc(s.resumo_sessao):'<em>Sem registro de resumo.</em>'}</p>
        </section>`;
      }).join('');
      const registro=p.registro_profissional?` · ${esc(p.registro_profissional)}`:'';
      return `<article class="doc">
        <header class="cab">
          ${logo?`<img src="${logo}" alt="">`:''}
          <div><h1>Registro de evolução</h1>${empresa?`<div class="sub">${esc(empresa)}</div>`:''}</div>
          <div class="ano"><span>Ano</span><strong>${esc(ano)}</strong></div>
        </header>
        <div class="dados">
          <div class="dado"><label>Nome do paciente</label><span>${esc(p.paciente)}</span></div>
          <div class="dado"><label>Idade</label><span>${esc(this.idade(p.dt_nasc,ultima.data_hora))}</span></div>
          <div class="dado"><label>Profissional</label><span>${esc(p.terapeuta)}</span></div>
          <div class="dado"><label>Especialidade</label><span>${esc(p.especialidade)}</span></div>
          <div class="dado dado--full"><label>Diagnóstico</label><span>${esc(p.diagnostico||'—')}</span></div>
        </div>
        <h2>Resumo ${sessoes.length>1?`das sessões (${sessoes.length})`:'da sessão'}</h2>
        <div class="linhas">${linhas}</div>
        <footer class="assinatura">
          <div class="assinatura__local">Local e data: ____________________________________</div>
          <div class="assinatura__bloco">
            <div class="assinatura__linha"></div>
            <strong>${esc(p.terapeuta)}</strong>
            <span>${esc(p.especialidade)}${registro}</span>
            <span class="assinatura__rotulo">Assinatura e carimbo do profissional</span>
          </div>
        </footer>
      </article>`;
    },
    html(consultas,logo,empresa=''){
      const docs=this.agrupar(consultas).map(g=>this.documento(g,logo,empresa)).join('');
      return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Registro de evolução</title><style>
        @page{size:A4;margin:14mm 14mm 16mm;@bottom-right{content:"Página " counter(page) " de " counter(pages);font:8pt Arial,sans-serif;color:#7a8291}}
        *{box-sizing:border-box}
        body{margin:0;font:10.5pt/1.4 Arial,Helvetica,sans-serif;color:#1d2433;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .doc{break-after:page}.doc:last-child{break-after:auto}
        .cab{display:flex;align-items:center;gap:16px;padding-bottom:10px;border-bottom:2px solid #1a4f8b}
        .cab img{height:64px;width:auto;object-fit:contain}
        .cab h1{margin:0;font-size:17pt;color:#1a4f8b}
        .cab .sub{font-size:9pt;color:#5b6575}
        .ano{margin-left:auto;text-align:right}
        .ano span{display:block;font-size:7.5pt;text-transform:uppercase;letter-spacing:.08em;color:#5b6575}
        .ano strong{font-size:13pt}
        .dados{display:grid;grid-template-columns:3fr 1fr;gap:8px 18px;margin:14px 0 16px;padding:10px 12px;border:1px solid #d6dbe4;border-radius:6px;background:#f6f8fb}
        .dado label{display:block;font-size:7.5pt;text-transform:uppercase;letter-spacing:.08em;color:#5b6575}
        .dado span{font-weight:600}
        .dado--full{grid-column:1/-1}
        h2{margin:0 0 6px;font-size:9pt;text-transform:uppercase;letter-spacing:.08em;color:#5b6575}
        .linhas{border-top:1px solid #b9c2cf}
        .sessao+.sessao{margin-top:12px;border-top:1px solid #b9c2cf}
        .sessao__data{display:flex;justify-content:space-between;padding:0 6px;line-height:24px;font-size:9pt;font-weight:700;color:#1a4f8b;background:#eef2f8;border-bottom:1px solid #b9c2cf;break-after:avoid}
        .sessao__texto{margin:0;padding:0 6px;line-height:24px;white-space:pre-wrap;overflow-wrap:anywhere;
          -webkit-box-decoration-break:clone;box-decoration-break:clone;
          background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 23px,#d3d9e2 23px,#d3d9e2 24px)}
        .sessao__texto em{color:#7a8291}
        .assinatura{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:48px;break-inside:avoid}
        .assinatura__local{font-size:9pt;color:#5b6575}
        .assinatura__bloco{display:flex;flex-direction:column;align-items:center;min-width:260px;text-align:center;font-size:9.5pt}
        .assinatura__linha{width:100%;border-top:1px solid #1d2433;margin-bottom:6px}
        .assinatura__rotulo{margin-top:2px;font-size:7.5pt;text-transform:uppercase;letter-spacing:.08em;color:#5b6575}
      </style></head><body>${docs}</body></html>`;
    },
    // Imprime por um iframe oculto (não é bloqueado como popup)
    async imprimir(consultas,empresa){
      const logo=await this.logo()||MARCA_VINDIX;
      const frame=document.createElement('iframe');
      frame.setAttribute('aria-hidden','true');
      frame.style.cssText='position:fixed;width:0;height:0;border:0;right:0;bottom:0';
      frame.srcdoc=this.html(consultas,logo,empresa);
      document.body.appendChild(frame);
      await new Promise(r=>frame.addEventListener('load',r,{once:true}));
      await Promise.all([...frame.contentDocument.images].map(img=>img.decode().catch(()=>{})));
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(()=>frame.remove(),60000);
    },
    async gerar(ids,btn){
      if(!ids.length){ui.warning('Nenhuma sessão','Não há sessões para o registro de evolução.');return;}
      if(ids.length>200){ui.warning('Muitas sessões','Filtre para no máximo 200 sessões.');return;}
      btn?.setAttribute('aria-busy','true');
      try{
        const d=await api.get(`/relatorios/evolucao?ids=${ids.join(',')}`);
        await this.imprimir(d.consultas,d.empresa);
      }catch(err){ui.error('Erro ao gerar relatório',err.message);}
      finally{btn?.removeAttribute('aria-busy');}
    },
  };

  /* ===================================================================
     MARCA DA CLÍNICA: nome, logo e cor de ação extraída da logo
     =================================================================== */
  // Nomes gravados em maiúsculas ("HUMANIZARE") viram "Humanizare"
  function nomeExibicao(nome){
    const n=String(nome||'').trim();
    return n&&n===n.toUpperCase()?n.toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase()):n;
  }
  function rgbParaHsl(r,g,b){
    r/=255;g/=255;b/=255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;
    if(max===min)return [0,0,l];
    const d=max-min,s=l>.5?d/(2-max-min):d/(max+min);
    let h=max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4;
    return [h*60,s,l];
  }
  const MARCA_VINDIX="data:image/svg+xml,"+encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'>"+
    "<path d='M9.5 10 31 40' stroke='#10a37f' stroke-width='9' stroke-linecap='round'/>"+
    "<path d='M38.5 10 17 40' stroke='#2f7de1' stroke-width='9' stroke-linecap='round'/>"+
    "<path d='M29.5 30.4 24 38.1 18.5 30.4 24 22.7Z' fill='#5b2a86'/>"+
    "<circle cx='24' cy='9.5' r='5.2' fill='#f2634a'/></svg>");

  const marca = {
    async carregar(){
      try{
        const e=await api.get('/empresa');
        S.empresa={id:e.id,nome:nomeExibicao(e.nome)};
        $('#cliente-nome').textContent=S.empresa.nome;
        $('#cliente-inicial').textContent=(S.empresa.nome||'?').charAt(0).toUpperCase();
        nav.atualizarTitulo();
      }catch{}
      const url=await evolucao.logo('icone');
      if(!url){this.semLogo();return;}
      for(const alvo of [$('#cliente-logo'),$('#topbar-cliente')]){
        const img=document.createElement('img');
        img.src=url;img.alt=alvo.id==='cliente-logo'?`Logo de ${S.empresa?.nome||'clínica'}`:'';
        alvo.replaceChildren(img);
      }
      this.aplicarCor(url);
    },
    // Clínica sem logo: marca do Vindix no lugar e as cores padrão do Vindix
    semLogo(){
      for(const alvo of [$('#cliente-logo'),$('#topbar-cliente')]){
        const img=document.createElement('img');
        img.src=MARCA_VINDIX;img.alt=alvo.id==='cliente-logo'?'Vindix':'';
        alvo.replaceChildren(img);
      }
      const raiz=document.documentElement.style;
      raiz.removeProperty('--brand-claro');raiz.removeProperty('--brand-escuro');
      sessao.del('vindix:cor');
    },
    // Cor predominante (saturada) da logo vira a cor de ação do sistema
    aplicarCor(url){
      const img=new Image();
      img.onload=()=>{
        try{
          const c=document.createElement('canvas');c.width=c.height=48;
          const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,48,48);
          const px=ctx.getImageData(0,0,48,48).data,baldes=new Map();
          for(let i=0;i<px.length;i+=4){
            if(px[i+3]<200)continue;
            const [h,s,l]=rgbParaHsl(px[i],px[i+1],px[i+2]);
            if(s<.35||l<.2||l>.8)continue;
            const k=Math.round(h/20)%18,b=baldes.get(k)||{n:0,h:0,s:0};
            b.n+=s;b.h+=h*s;b.s+=s*s;baldes.set(k,b);
          }
          const melhor=[...baldes.values()].sort((a,b)=>b.n-a.n)[0];
          if(!melhor||melhor.n<20)return;
          const h=Math.round(melhor.h/melhor.n),s=Math.round(Math.min(.82,Math.max(.45,melhor.s/melhor.n))*100);
          const cor={claro:`hsl(${h} ${s}% 40%)`,escuro:`hsl(${h} ${s}% 72%)`};
          sessao.set('vindix:cor',JSON.stringify(cor));
          this.definirCor(cor);
        }catch{}
      };
      img.src=url;
    },
    definirCor(cor){
      const raiz=document.documentElement.style;
      raiz.setProperty('--brand-claro',cor.claro);
      raiz.setProperty('--brand-escuro',cor.escuro);
    },
    // Cor já calculada nesta sessão: aplica antes de desenhar a tela (sem trocar de cor depois)
    aplicarCorSalva(){
      try{
        const cor=JSON.parse(sessao.get('vindix:cor')||'null');
        if(cor&&/^hsl\(\d+ \d+% \d+%\)$/.test(cor.claro)&&/^hsl\(\d+ \d+% \d+%\)$/.test(cor.escuro))this.definirCor(cor);
      }catch{}
    },
    limpar(){
      const raiz=document.documentElement.style;
      raiz.removeProperty('--brand-claro');raiz.removeProperty('--brand-escuro');
      sessao.del('vindix:cor');
      S.empresa=null;
      $('#cliente-nome').textContent='Sua clínica';
      $('#cliente-logo').replaceChildren(Object.assign(document.createElement('span'),{className:'cliente__inicial',id:'cliente-inicial'}));
      // Topo volta para a marca do Vindix (nunca fica vazio)
      $('#topbar-cliente').innerHTML='<svg viewBox="0 0 48 48"><use href="#vx-marca"/></svg>';
      document.title='Vindix';
    },
  };

  /* ===================================================================
     UTILITÁRIOS DE DATA E COR DE ESPECIALIDADE
     =================================================================== */
  const DIAS_CURTOS=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const DIAS_LONGOS=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const MESES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  // Especialidade sem cor do Google ganha uma cor fixa pelo id (sempre a mesma)
  const PALETA_ESP=['#2f7de1','#10a37f','#f2634a','#7a3fbf','#e8a10f','#d6458b','#0e9aa7','#5d6b86'];
  function corEspecialidade(idEsp){
    const e=S.especialidades.find(x=>x.id===idEsp);
    return COR_GOOGLE[e?.id_cor||0]||PALETA_ESP[(idEsp||0)%PALETA_ESP.length];
  }
  function badgeEsp(idEsp,nome){
    return `<span class="badge badge--esp" style="--esp:${corEspecialidade(idEsp)}">${esc(nome||'—')}</span>`;
  }
  const dataISO=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  // "YYYY-MM-DDTHH:MM:SS" -> Date local
  function lerDataHora(s){
    const m=/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s||'');
    return m?new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0)):null;
  }
  const minutosDe=t=>{const [h,m]=String(t||'0:0').split(':').map(Number);return (h||0)*60+(m||0);};
  const hhmm=min=>`${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;
  function duracaoTexto(min){
    const h=Math.floor(min/60),m=min%60;
    return h?`${h}h${m?String(m).padStart(2,'0'):''}`:`${m} min`;
  }

  /* ===================================================================
     DICAS DOS GRÁFICOS (tooltip único; texto sempre via textContent)
     =================================================================== */
  const dica = {
    init(){
      const tip=$('#viz-tip');
      const mostrar=(el,x,y)=>{
        tip.textContent=el.dataset.tip;tip.hidden=false;
        const r=tip.getBoundingClientRect();
        tip.style.left=`${Math.min(window.innerWidth-r.width-8,Math.max(8,x+14))}px`;
        tip.style.top=`${Math.max(8,y-r.height-12)}px`;
      };
      document.addEventListener('pointermove',e=>{
        const el=e.target.closest?.('[data-tip]');
        if(el)mostrar(el,e.clientX,e.clientY);else tip.hidden=true;
      });
      document.addEventListener('focusin',e=>{
        const el=e.target.closest?.('[data-tip]');
        if(!el){tip.hidden=true;return;}
        const r=el.getBoundingClientRect();mostrar(el,r.left+r.width/2,r.top);
      });
      document.addEventListener('scroll',()=>{tip.hidden=true;},true);
    },
  };

  /* ===================================================================
     SEMANA: agenda de cada profissional, de segunda a domingo
     =================================================================== */
  const MESES_LONGOS=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const HORA_PX=60; // altura de uma hora na grade (precisa bater com --hora-h)
  const MAX_POR_DIA_MES=3; // no modo mês, atendimentos à vista por dia (o resto vira "+N")

  // Calendário: dia, semana ou mês (no celular, a lista do dia escolhido)
  pages.semana = {
    modo:'semana', ref:null, dados:[], diaAtivo:null,
    segunda(d){const s=new Date(d.getFullYear(),d.getMonth(),d.getDate());s.setDate(s.getDate()-((s.getDay()+6)%7));return s;},
    somaDias(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;},
    render(){
      if(!this.ref){
        const hoje=new Date();this.ref=new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate());
        try{const m=localStorage.getItem('vindix:cal-modo');if(['dia','semana','mes'].includes(m))this.modo=m;}catch{}
        const r=document.querySelector(`input[name="cal-modo"][value="${this.modo}"]`);if(r)r.checked=true;
      }
      this.popularProfissionais();
      this.load();
    },
    popularProfissionais(){
      const sel=$('#semana-terapeuta'),atual=sel.value;
      sel.innerHTML='<option value="">Todos os profissionais</option>'+
        S.terapeutas
          .map(t=>`<option value="${t.id}" ${String(t.id)===atual?'selected':''}>${esc(t.nome)}</option>`).join('');
    },
    // Primeiro e último dia mostrados (o mês vai de segunda a domingo, semanas inteiras)
    intervalo(){
      const r=this.ref;
      if(this.modo==='dia')return [r,r];
      if(this.modo==='semana'){const i=this.segunda(r);return [i,this.somaDias(i,6)];}
      const ini=this.segunda(new Date(r.getFullYear(),r.getMonth(),1));
      return [ini,this.somaDias(this.segunda(new Date(r.getFullYear(),r.getMonth()+1,0)),6)];
    },
    rotuloPeriodo(){
      const r=this.ref;
      if(this.modo==='dia')return `${DIAS_CURTOS[r.getDay()]}, ${r.getDate()} de ${MESES[r.getMonth()]}`;
      if(this.modo==='mes')return `${MESES_LONGOS[r.getMonth()][0].toUpperCase()}${MESES_LONGOS[r.getMonth()].slice(1)} ${r.getFullYear()}`;
      const [ini,fim]=this.intervalo();
      return ini.getMonth()===fim.getMonth()
        ?`${ini.getDate()} a ${fim.getDate()} de ${MESES[fim.getMonth()]}`
        :`${ini.getDate()} ${MESES[ini.getMonth()]} a ${fim.getDate()} ${MESES[fim.getMonth()]}`;
    },
    async load(){
      if(!S.token||!temPerm(1,40,41))return;
      const [ini,fim]=this.intervalo();
      $('#semana-periodo').textContent=this.rotuloPeriodo();
      const params={de:dataISO(ini),ate:dataISO(fim),por_pagina:500,terapeuta:$('#semana-terapeuta').value||undefined};
      const pedido=this.pedido=Symbol();
      try{
        // O mês pode passar de uma página: busca até completar
        const todos=[];
        for(let pagina=1;pagina<=20;pagina++){
          const {itens,total}=await api.lista(EP.agenda,{...params,pagina});
          todos.push(...itens);
          if(!itens.length||todos.length>=total)break;
        }
        if(pedido!==this.pedido)return;
        this.dados=todos.map(a=>{
          const i=lerDataHora(a.dt_hr_agendada);
          return {...a,_ini:i,_iso:dataISO(i),_minIni:i.getHours()*60+i.getMinutes(),_dur:Math.max(15,minutosDe(a.tempo_previsto))};
        });
      }catch(err){
        $('#semana-grade').innerHTML=ui.errorState('Não foi possível carregar o calendário',err.message);return;
      }
      this.desenhar();
    },
    visiveis(){const canc=$('#semana-canceladas').checked;return this.dados.filter(a=>canc||a.status!=='CANCELADO');},
    // Agendamentos sobrepostos dividem a largura da coluna
    distribuir(itens){
      itens.sort((a,b)=>a._minIni-b._minIni||b._dur-a._dur);
      const grupos=[];let grupo=[],fimGrupo=-1;
      for(const it of itens){
        const fim=it._minIni+it._dur;
        if(grupo.length&&it._minIni>=fimGrupo){grupos.push(grupo);grupo=[];fimGrupo=-1;}
        grupo.push(it);fimGrupo=Math.max(fimGrupo,fim);
      }
      if(grupo.length)grupos.push(grupo);
      for(const g of grupos){
        const faixas=[];
        for(const it of g){
          let f=faixas.findIndex(fimFaixa=>fimFaixa<=it._minIni);
          if(f<0){f=faixas.length;faixas.push(0);}
          faixas[f]=it._minIni+it._dur;it._faixa=f;
        }
        g.forEach(it=>{it._faixas=faixas.length;});
      }
      return itens;
    },
    bloco(a,{posicionar,completo=false}){
      const todos=!$('#semana-terapeuta').value;
      const st=STATUS_AGENDAMENTO[a.status]||{label:a.status};
      const sub=completo?`${a.terapeuta||''} · ${a.especialidade||''}`:(todos?a.terapeuta:a.especialidade);
      const rotulo=`${hhmm(a._minIni)}, ${a.paciente}, ${a.terapeuta}, ${a.especialidade}, ${st.label}`;
      const estilo=[`--esp:${corEspecialidade(a.id_especialidade)}`];
      if(posicionar){
        estilo.push(`top:${(a._minIni-posicionar.h0*60)/60*HORA_PX+1}px`,
          `height:${Math.max(24,a._dur/60*HORA_PX-3)}px`,
          `left:calc(${a._faixa/a._faixas*100}% + 3px)`,
          `width:calc(${100/a._faixas}% - 6px)`);
      }
      return `<button type="button" class="bloco bloco--${esc(a.status)}" data-ag="${a.id}" style="${estilo.join(';')}" aria-label="${esc(rotulo)}">
        <span class="bloco__hora">${hhmm(a._minIni)}</span>${a.status==='REALIZADO'?` <span class="bloco__estado" title="Realizado">${icon('check',12)}</span>`:''}
        <span class="bloco__pac">${esc(a.paciente||'—')}</span>
        <span class="bloco__sub">${esc(sub||'')}</span>
      </button>`;
    },
    // Grade de horários com um ou mais dias (modos dia e semana)
    desenharGrade(itens,dias){
      const hojeIso=dataISO(new Date()),agoraD=new Date();
      let h0=7,h1=19;
      for(const a of itens){h0=Math.min(h0,Math.floor(a._minIni/60));h1=Math.max(h1,Math.ceil((a._minIni+a._dur)/60));}
      h1=Math.min(24,h1);
      const grade=$('#semana-grade');
      grade.style.setProperty('--dias',dias.length);grade.style.setProperty('--hora-h',`${HORA_PX}px`);
      grade.classList.toggle('grade--dia',dias.length===1);
      const completo=dias.length===1;
      const colunas=dias.map(d=>{
        const iso=dataISO(d),hoje=iso===hojeIso;
        const doDia=this.distribuir(itens.filter(a=>a._iso===iso));
        const agora=hoje&&agoraD.getHours()>=h0&&agoraD.getHours()<h1
          ?`<div class="grade__agora" style="top:${((agoraD.getHours()-h0)*60+agoraD.getMinutes())/60*HORA_PX}px"></div>`:'';
        return `<div class="grade__coluna${hoje?' grade__coluna--hoje':''}" style="height:${(h1-h0)*HORA_PX}px">${agora}${doDia.map(a=>this.bloco(a,{posicionar:{h0},completo})).join('')}</div>`;
      }).join('');
      const horas=[...Array(h1-h0)].map((_,i)=>`<div class="grade__hora">${String(h0+i).padStart(2,'0')}:00</div>`).join('');
      grade.innerHTML=`<div class="grade__canto"></div>`+
        dias.map(d=>`<button type="button" class="grade__dia${dataISO(d)===hojeIso?' grade__dia--hoje':''}" data-ir-dia="${dataISO(d)}" title="Ver o dia"><strong>${d.getDate()}</strong><span>${DIAS_CURTOS[d.getDay()]}</span></button>`).join('')+
        `<div class="grade__horas">${horas}</div>`+colunas;
      if(!itens.length)grade.insertAdjacentHTML('beforeend',`<div class="grade__vazio">${ui.emptyState('calendar',this.modo==='dia'?'Nenhum atendimento neste dia':'Nenhum atendimento nesta semana','Use "Agendar" para marcar uma sessão ou navegue para outro período.',true)}</div>`);
      // Abre já perto da hora atual (ou do primeiro atendimento)
      const primeiro=Math.min(...itens.map(a=>a._minIni),dias.some(d=>dataISO(d)===hojeIso)?agoraD.getHours()*60:24*60);
      if(primeiro<24*60)grade.scrollTop=Math.max(0,(primeiro/60-h0-0.5)*HORA_PX);
    },
    desenharMes(itens){
      const [ini,fim]=this.intervalo(),mesRef=this.ref.getMonth(),hojeIso=dataISO(new Date());
      const porDia=new Map();
      for(const a of [...itens].sort((x,y)=>x._minIni-y._minIni)){if(!porDia.has(a._iso))porDia.set(a._iso,[]);porDia.get(a._iso).push(a);}
      const cab=[1,2,3,4,5,6,0].map(d=>`<div class="mes__semana">${DIAS_CURTOS[d]}</div>`).join('');
      const celulas=[];
      for(let d=new Date(ini);d<=fim;d=this.somaDias(d,1)){
        const iso=dataISO(d),lista=porDia.get(iso)||[];
        const cls=['mes__dia',d.getMonth()!==mesRef&&'mes__dia--fora',iso===hojeIso&&'mes__dia--hoje',iso===this.diaAtivo&&'mes__dia--ativo'].filter(Boolean).join(' ');
        const itensHtml=lista.slice(0,MAX_POR_DIA_MES).map(a=>`<button type="button" class="mes__item mes__item--${esc(a.status)}" data-ag="${a.id}" style="--esp:${corEspecialidade(a.id_especialidade)}"><b>${hhmm(a._minIni)}</b> ${esc(a.paciente||'—')}</button>`).join('');
        const mais=lista.length>MAX_POR_DIA_MES?`<button type="button" class="mes__mais" data-ir-dia="${iso}">+${lista.length-MAX_POR_DIA_MES} ${lista.length-MAX_POR_DIA_MES===1?'outro':'outros'}</button>`:'';
        const pontos=lista.slice(0,4).map(a=>`<i style="--esp:${corEspecialidade(a.id_especialidade)}"></i>`).join('');
        celulas.push(`<div class="${cls}" data-dia-iso="${iso}">
          <button type="button" class="mes__num" data-ir-dia="${iso}" aria-label="${d.getDate()} de ${MESES_LONGOS[d.getMonth()]}${lista.length?`, ${lista.length} ${lista.length===1?'atendimento':'atendimentos'}`:''}">${d.getDate()}</button>
          <div class="mes__itens">${itensHtml}${mais}</div>
          <span class="mes__pontos" aria-hidden="true">${pontos}</span>
        </div>`);
      }
      $('#semana-mes').innerHTML=`<div class="mes__grade">${cab}${celulas.join('')}</div>`;
    },
    desenharLista(itens,iso){
      const doDia=itens.filter(a=>a._iso===iso).sort((a,b)=>a._minIni-b._minIni);
      $('#semana-lista').innerHTML=doDia.length
        ?doDia.map(a=>this.bloco(a,{})).join('')
        :ui.emptyState('calendar','Dia livre','Nenhum atendimento marcado para este dia.',true);
    },
    desenhar(){
      const itens=this.visiveis(),[ini,fim]=this.intervalo(),hojeIso=dataISO(new Date());
      const dentro=iso=>iso>=dataISO(ini)&&iso<=dataISO(fim);
      // Dia escolhido para a lista do celular: mantém o atual se estiver no período; senão hoje ou o primeiro dia
      if(this.modo==='dia')this.diaAtivo=dataISO(this.ref);
      else if(!this.diaAtivo||!dentro(this.diaAtivo))this.diaAtivo=dentro(hojeIso)&&(this.modo!=='mes'||new Date().getMonth()===this.ref.getMonth())?hojeIso:dataISO(this.modo==='mes'?new Date(this.ref.getFullYear(),this.ref.getMonth(),1):ini);
      document.querySelector('.page[data-page="semana"]').dataset.modo=this.modo;

      const esps=[...new Map(itens.map(a=>[a.id_especialidade,a.especialidade])).entries()];
      $('#semana-legenda').innerHTML=esps.map(([id,nome])=>badgeEsp(id,nome)).join('');

      $('#semana-mes').hidden=this.modo!=='mes';
      if(this.modo==='mes'){$('#semana-grade').innerHTML='';this.desenharMes(itens);}
      else{
        const dias=this.modo==='dia'?[this.ref]:[...Array(itens.some(a=>new Date(a._ini).getDay()===0)?7:6)].map((_,i)=>this.somaDias(ini,i));
        this.desenharGrade(itens,dias);
      }

      // Celular: chips da semana (modo semana) e a lista do dia escolhido
      if(this.modo==='semana'){
        const dias=[...Array(7)].map((_,i)=>this.somaDias(ini,i));
        $('#semana-dias').innerHTML=dias.map(d=>{
          const iso=dataISO(d);
          const pontos=itens.filter(a=>a._iso===iso).slice(0,4).map(a=>`<i style="--esp:${corEspecialidade(a.id_especialidade)}"></i>`).join('');
          return `<button type="button" class="dia-chip${iso===this.diaAtivo?' dia-chip--ativo':''}" data-dia="${iso}" aria-pressed="${iso===this.diaAtivo}">${DIAS_CURTOS[d.getDay()]}<strong>${d.getDate()}</strong><span class="dia-chip__pontos">${pontos}</span></button>`;
        }).join('');
      }else $('#semana-dias').innerHTML='';
      this.desenharLista(itens,this.diaAtivo);
    },
    abrirDetalhe(id){
      const a=this.dados.find(x=>x.id===id);if(!a)return;
      const st=STATUS_AGENDAMENTO[a.status]||{label:a.status,badge:''};
      const aberto=a.status==='AGENDADO';
      const acoes=[];
      if(aberto&&temPerm(1,20,22))acoes.push(`<button class="btn btn--primary" type="button" data-acao="realizar"><svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>Registrar sessão</button>`);
      if(aberto&&temPerm(1,40,43))acoes.push(`<button class="btn btn--secondary" type="button" data-acao="reagendar"><svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg>Remarcar</button>`);
      if(aberto&&temPerm(1,40,43)&&pages.agenda.passou(a))acoes.push(`<button class="btn btn--secondary" type="button" data-acao="falta"><svg class="icon" aria-hidden="true"><use href="#i-user-off"/></svg>Registrar falta</button>`);
      if(a.status==='FALTOU'&&temPerm(1,40,43))acoes.push(`<button class="btn btn--secondary" type="button" data-acao="desfazer-falta"><svg class="icon" aria-hidden="true"><use href="#i-refresh"/></svg>Desfazer falta</button>`);
      if(a.id_consulta)acoes.push(`<button class="btn btn--secondary" type="button" data-acao="evolucao"><svg class="icon" aria-hidden="true"><use href="#i-printer"/></svg>Registro de evolução</button>`);
      if(temPerm(1,40,45))acoes.push(`<button class="btn btn--ghost" type="button" data-acao="historico"><svg class="icon" aria-hidden="true"><use href="#i-history"/></svg>Histórico</button>`);
      if(aberto&&temPerm(1,40,44))acoes.push(`<button class="btn btn--ghost" type="button" data-acao="cancelar" style="color:var(--perigo)"><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>Cancelar</button>`);
      $('#detalhe-titulo').textContent=a.paciente||'Agendamento';
      $('#detalhe-corpo').innerHTML=`
        <div class="detalhe__linha"><svg class="icon" aria-hidden="true"><use href="#i-calendar"/></svg><span><strong>${esc(DIAS_LONGOS[a._ini.getDay()])}, ${a._ini.getDate()} de ${MESES[a._ini.getMonth()]}</strong>, ${hhmm(a._minIni)} às ${hhmm(a._minIni+a._dur)}</span></div>
        <div class="detalhe__linha"><svg class="icon" aria-hidden="true"><use href="#i-user"/></svg><span>Profissional: <strong>${esc(a.terapeuta||'—')}</strong></span></div>
        <div class="detalhe__linha">${badgeEsp(a.id_especialidade,a.especialidade)} <span class="badge ${st.badge}">${esc(st.label)}</span>${aberto?(a.no_google==='S'?' <span class="badge badge--success">No Google Agenda</span>':''):''}</div>
        ${acoes.length?`<div class="detalhe__acoes">${acoes.join('')}</div>`:''}`;
      $('#detalhe-corpo').querySelectorAll('[data-acao]').forEach(b=>b.addEventListener('click',()=>{
        ui.closeModal('modal-detalhe');
        const acao=b.dataset.acao;
        if(acao==='realizar')pages.consultas.openFromAgendamento(a);
        else if(acao==='reagendar')pages.agenda.abrirEdicao(a);
        else if(acao==='evolucao')evolucao.gerar([a.id_consulta]);
        else if(acao==='historico')pages.agenda.openHistorico(a.id);
        else if(acao==='cancelar')pages.agenda.cancelar(a.id);
        else if(acao==='falta')pages.agenda.falta(a);
        else if(acao==='desfazer-falta')pages.agenda.desfazerFalta(a);
      }));
      ui.openModal('modal-detalhe');
    },
    mover(n){
      const r=new Date(this.ref);
      if(this.modo==='dia')r.setDate(r.getDate()+n);
      else if(this.modo==='semana')r.setDate(r.getDate()+7*n);
      else{r.setDate(1);r.setMonth(r.getMonth()+n);}
      this.ref=r;this.diaAtivo=null;this.load();
    },
    mudarModo(modo,data=null){
      this.modo=modo;try{localStorage.setItem('vindix:cal-modo',modo);}catch{}
      const r=document.querySelector(`input[name="cal-modo"][value="${modo}"]`);if(r)r.checked=true;
      if(data){const [y,m,d]=data.split('-').map(Number);this.ref=new Date(y,m-1,d);}
      this.diaAtivo=data;this.load();
    },
    init(){
      $('#btn-semana-ant').addEventListener('click',()=>this.mover(-1));
      $('#btn-semana-prox').addEventListener('click',()=>this.mover(1));
      $('#btn-semana-hoje').addEventListener('click',()=>{const h=new Date();this.ref=new Date(h.getFullYear(),h.getMonth(),h.getDate());this.diaAtivo=null;this.load();});
      $$('input[name="cal-modo"]').forEach(r=>r.addEventListener('change',()=>{if(r.checked)this.mudarModo(r.value,this.modo==='mes'?this.diaAtivo:dataISO(this.ref));}));
      $('#semana-terapeuta').addEventListener('change',()=>this.load());
      $('#semana-canceladas').addEventListener('change',()=>this.desenhar());
      $('#btn-semana-agendar').addEventListener('click',async()=>{
        await pages.agenda.openNew();
        const ter=$('#semana-terapeuta').value;
        if(ter){$('#a-terapeuta').value=ter;filtrarEspAtendimento('a',null);}
      });
      const celular=()=>matchMedia('(max-width: 760px)').matches;
      const clique=e=>{
        const b=e.target.closest('[data-ag]');if(b){this.abrirDetalhe(parseInt(b.dataset.ag,10));return;}
        const ir=e.target.closest('[data-ir-dia]');
        // No celular, tocar um dia do mês só escolhe o dia da lista abaixo
        if(ir&&this.modo==='mes'&&celular()){this.diaAtivo=ir.dataset.irDia;this.desenhar();return;}
        if(ir){this.mudarModo('dia',ir.dataset.irDia);return;}
        const cel=e.target.closest('[data-dia-iso]');
        if(cel&&celular()){this.diaAtivo=cel.dataset.diaIso;this.desenhar();}
      };
      $('#semana-grade').addEventListener('click',clique);
      $('#semana-mes').addEventListener('click',clique);
      $('#semana-lista').addEventListener('click',clique);
      $('#semana-dias').addEventListener('click',e=>{
        const b=e.target.closest('[data-dia]');if(!b)return;
        this.diaAtivo=b.dataset.dia;this.desenhar();
      });
    },
  };

  /* ===================================================================
     RESUMO: indicadores e gráficos de atendimento (dados agregados)
     =================================================================== */
  pages.resumo = {
    preset:'30', dados:null,
    render(){
      this.popularProfissionais();
      if(!$('#resumo-de').value)this.aplicarPreset(this.preset);else this.load();
    },
    popularProfissionais(){
      const sel=$('#resumo-terapeuta'),atual=sel.value;
      sel.innerHTML='<option value="">Todos</option>'+S.terapeutas
        .map(t=>`<option value="${t.id}" ${String(t.id)===atual?'selected':''}>${esc(t.nome)}</option>`).join('');
    },
    aplicarPreset(p){
      this.preset=p;
      const hoje=new Date(),de=new Date(hoje);
      if(p==='mes')de.setDate(1);else de.setDate(de.getDate()-(parseInt(p,10)-1));
      $('#resumo-de').value=dataISO(de);$('#resumo-ate').value=dataISO(hoje);
      $$('.periodo-btn').forEach(b=>b.classList.toggle('periodo-btn--ativo',b.dataset.periodo===p));
      this.load();
    },
    async load(){
      if(!S.token||!temPerm(1,50))return;
      const p=new URLSearchParams({de:$('#resumo-de').value,ate:$('#resumo-ate').value});
      const ter=$('#resumo-terapeuta').value;if(ter)p.set('terapeuta',ter);
      $('#resumo-kpis').innerHTML=ui.skeleton(1);
      try{this.dados=this.sanear(await api.get(`/resumo?${p}`));}
      catch(err){$('#resumo-kpis').innerHTML=ui.errorState('Não foi possível montar o resumo',err.message);return;}
      this.desenhar();
    },
    // Todo número que entra no HTML passa por Number() (o texto vai por esc())
    sanear(d){
      const n=v=>Number(v)||0;
      const numeros=(o,campos)=>{for(const c of campos)o[c]=n(o[c]);return o;};
      numeros(d.totais,Object.keys(d.totais));
      numeros(d.anterior,['realizadas','canceladas']);
      d.semanas.forEach(s=>numeros(s,['realizadas','canceladas']));
      d.especialidades.forEach(e=>numeros(e,['id','id_cor','agendamentos','realizadas']));
      d.profissionais.forEach(p=>numeros(p,['id','realizadas','minutos','canceladas','faltas']));
      d.faltasSeguidas=(d.faltasSeguidas||[]).map(p=>({id:Number(p.id),nome:String(p.nome),seguidas:Number(p.seguidas)||0}));
      d.ocupacao.forEach(o=>numeros(o,['dia','hora','n']));
      return d;
    },
    variacao(atual,anterior,menorMelhor=false){
      if(!anterior)return atual?'sem base no período anterior':'igual ao período anterior';
      const pct=Math.round((atual-anterior)/anterior*100);
      if(!pct)return 'igual ao período anterior';
      const bom=menorMelhor?pct<0:pct>0;
      return `<span class="kpi__delta--${bom?'sobe':'desce'}">${pct>0?'+':''}${pct}%</span> sobre o período anterior`;
    },
    desenhar(){
      const d=this.dados,t=d.totais;
      const marcadas=t.realizadas+t.canceladas+t.faltas;
      const aproveitamento=marcadas?Math.round(t.realizadas/marcadas*100):null;
      const media=t.realizadas?Math.round(t.minutos/t.realizadas):0;
      const kpi=(rot,valor,nota,destaque)=>`<div class="kpi${destaque?' kpi--destaque':''}"><div class="kpi__rotulo">${rot}</div><div class="kpi__valor">${valor}</div><div class="kpi__nota">${nota}</div></div>`;
      $('#resumo-kpis').innerHTML=[
        kpi('Sessões realizadas',t.realizadas,this.variacao(t.realizadas,d.anterior.realizadas)+(t.avulsas?`, ${t.avulsas} avulsa${t.avulsas>1?'s':''}`:''),true),
        kpi('Horas de atendimento',duracaoTexto(t.minutos),t.realizadas?`média de ${media} min por sessão`:'nenhuma sessão no período'),
        kpi('Aproveitamento',aproveitamento===null?'—':`${aproveitamento}%`,'das sessões marcadas foram realizadas'),
        kpi('Cancelamentos',t.canceladas,this.variacao(t.canceladas,d.anterior.canceladas,true)),
        kpi('Faltas',t.faltas,marcadas?`${Math.round(t.faltas/marcadas*100)}% dos atendimentos marcados${t.faltasJustificadas?`, ${t.faltasJustificadas} ${t.faltasJustificadas>1?'justificadas':'justificada'}`:''}`:'nenhum atendimento no período'),
        kpi('Remarcações',t.remarcadas,'agendamentos que mudaram de data'),
      ].join('');

      $('#resumo-pendencia').innerHTML=t.pendentesRegistro?`
        <div class="pendencia" role="status">
          <svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>
          <p>${t.pendentesRegistro>1
            ?`<strong>${t.pendentesRegistro} agendamentos</strong> já passaram e ainda não têm a sessão registrada nem foram cancelados.`
            :'<strong>1 agendamento</strong> já passou e ainda não tem a sessão registrada nem foi cancelado.'}</p>
          ${temPerm(1,40,41)?'<button class="btn btn--secondary" type="button" id="btn-ver-pendentes">Ver na agenda</button>':''}
        </div>`:'';
      // Pacientes com 3 ou mais faltas seguidas: vale um contato
      const fs=d.faltasSeguidas;
      if(fs.length)$('#resumo-pendencia').insertAdjacentHTML('beforeend',`
        <div class="pendencia" role="status">
          <svg class="icon" aria-hidden="true"><use href="#i-user-off"/></svg>
          <p><strong>${fs.length} ${fs.length>1?'pacientes faltaram':'paciente faltou'}</strong> nas últimas 3 sessões ou mais. Vale entrar em contato.
            <span class="pendencia__nomes">${fs.slice(0,8).map(p=>`${esc(p.nome)} (${p.seguidas})`).join(', ')}${fs.length>8?` e mais ${fs.length-8}`:''}</span></p>
        </div>`);
      $('#btn-ver-pendentes')?.addEventListener('click',()=>{
        $('#agenda-de').value=d.periodo.de;
        $('#agenda-ate').value=dataISO(new Date());
        $('#agenda-status').value='AGENDADO';
        nav.goto('agenda');pages.agenda.load({silent:true});
      });

      this.graficoSemanas(d.semanas);
      this.graficoEspecialidades(d.especialidades);
      this.graficoOcupacao(d.ocupacao);
      this.tabelaProfissionais(d.profissionais);
    },
    rotuloSemana(iso){const x=lerDataHora(iso);return `${x.getDate()} ${MESES[x.getMonth()]}`;},
    // Colunas empilhadas: realizadas (base) e canceladas (topo), por semana
    graficoSemanas(semanas){
      const alvo=$('#resumo-semanas');
      if(!semanas.some(s=>s.realizadas||s.canceladas)){alvo.innerHTML=ui.emptyState('chart','Sem movimento no período','Nenhuma sessão realizada ou cancelada nestas datas.',true);return;}
      const max=Math.max(...semanas.map(s=>s.realizadas+s.canceladas));
      const passo=Math.max(1,Math.ceil(max/4)),topo=passo*Math.ceil(max/passo);
      const marcas=[...Array(Math.floor(topo/passo)+1)].map((_,i)=>i*passo);
      const cada=Math.ceil(semanas.length/12);
      const colunas=semanas.map((s,i)=>{
        const tip=`Semana de ${this.rotuloSemana(s.inicio)}: ${s.realizadas} realizada${s.realizadas===1?'':'s'}, ${s.canceladas} cancelada${s.canceladas===1?'':'s'}`;
        return `<div class="coluna" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">
          <div class="coluna__pilha">
            ${s.canceladas?`<i class="seg seg--2" style="height:${s.canceladas/topo*100}%"></i>`:''}
            ${s.realizadas?`<i class="seg seg--1" style="height:${s.realizadas/topo*100}%"></i>`:''}
          </div>
          <span class="coluna__rot">${i%cada===0?esc(this.rotuloSemana(s.inicio)):''}</span>
        </div>`;
      }).join('');
      alvo.innerHTML=`
        <div class="viz-legenda"><span><i style="background:var(--viz-1)"></i>Realizadas</span><span><i style="background:var(--viz-2)"></i>Canceladas</span></div>
        <div class="colunas">
          <div class="colunas__grade">${marcas.map(m=>`<div class="colunas__linha" style="bottom:${m/topo*100}%"><span>${m}</span></div>`).join('')}</div>
          <div class="colunas__barras">${colunas}</div>
        </div>
        <details class="viz-tabela"><summary>Ver em tabela</summary>
          <table class="tbl"><thead><tr><th>Semana</th><th class="num">Realizadas</th><th class="num">Canceladas</th></tr></thead>
          <tbody>${semanas.map(s=>`<tr><td>${esc(this.rotuloSemana(s.inicio))}</td><td class="num">${s.realizadas}</td><td class="num">${s.canceladas}</td></tr>`).join('')}</tbody></table>
        </details>`;
    },
    // Barras horizontais: agendamentos por especialidade (ordenado)
    graficoEspecialidades(lista){
      const alvo=$('#resumo-especialidades');
      if(!lista.length){alvo.innerHTML=ui.emptyState('heart-pulse','Nenhuma especialidade no período','',true);return;}
      const max=Math.max(...lista.map(e=>e.agendamentos||e.realizadas));
      alvo.innerHTML=`<div class="barras-h">${lista.slice(0,8).map(e=>{
        const tip=`${e.descricao}: ${e.agendamentos} agendamento${e.agendamentos===1?'':'s'}, ${e.realizadas} ${e.realizadas===1?'sessão':'sessões'} realizada${e.realizadas===1?'':'s'}`;
        return `<div class="barra-h" tabindex="0" data-tip="${esc(tip)}">
          <div class="barra-h__nome"><span class="cor-dot" style="background:${corEspecialidade(e.id)}"></span><span>${esc(e.descricao)}</span></div>
          <div class="barra-h__trilho"><div class="barra-h__valor" style="width:${(e.agendamentos||0)/max*100}%"></div></div>
          <div class="barra-h__num">${e.agendamentos}<span class="barra-h__extra">${e.realizadas} realizada${e.realizadas===1?'':'s'}</span></div>
        </div>`;}).join('')}</div>
        ${lista.length>8?`<p class="field__hint" style="margin-top:10px">Mais ${lista.length-8} especialidade${lista.length-8>1?'s':''} com menos agendamentos.</p>`:''}`;
    },
    // Mapa de calor: dia da semana x hora (sequencial, um só tom)
    graficoOcupacao(lista){
      const alvo=$('#resumo-ocupacao');
      if(!lista.length){alvo.innerHTML=ui.emptyState('clock','Sem sessões realizadas no período','',true);return;}
      let h0=8,h1=18;
      for(const o of lista){h0=Math.min(h0,o.hora);h1=Math.max(h1,o.hora);}
      const ordemDias=[1,2,3,4,5,6,0].filter(d=>d!==0||lista.some(o=>o.dia===0));
      const mapa=new Map(lista.map(o=>[`${o.dia}-${o.hora}`,o.n]));
      const max=Math.max(...lista.map(o=>o.n));
      const nivel=n=>n?Math.min(5,Math.max(1,Math.ceil(n/max*5))):0;
      const horas=[...Array(h1-h0+1)].map((_,i)=>h0+i);
      const cabec=`<span></span>`+horas.map(h=>`<span class="heat__hora">${h%2===0||horas.length<=10?h:''}</span>`).join('');
      const linhas=ordemDias.map(d=>`<span class="heat__rot">${DIAS_CURTOS[d]}</span>`+horas.map(h=>{
        const n=mapa.get(`${d}-${h}`)||0;
        const tip=`${DIAS_LONGOS[d]}, ${h}h: ${n} ${n===1?'sessão':'sessões'}`;
        return `<span class="heat__cel" tabindex="0" data-tip="${esc(tip)}" style="background:var(--heat-${nivel(n)})"></span>`;
      }).join('')).join('');
      alvo.innerHTML=`<div class="heat" style="--colunas:${horas.length}">${cabec}${linhas}</div>
        <div class="heat__escala">Menos ${[0,1,2,3,4,5].map(n=>`<i style="background:var(--heat-${n})"></i>`).join('')} Mais</div>`;
    },
    tabelaProfissionais(lista){
      const alvo=$('#resumo-profissionais');
      if(!lista.length){alvo.innerHTML=ui.emptyState('users','Nenhum atendimento no período','',true);return;}
      const max=Math.max(...lista.map(p=>p.realizadas));
      alvo.innerHTML=`<div class="table-scroll"><table class="tbl tbl--prof"><thead><tr>
          <th>Profissional</th><th class="num">Sessões</th><th class="num">Horas</th><th class="num">Cancelamentos</th><th class="num">Faltas</th><th class="num">Aproveitamento</th>
        </tr></thead><tbody>${lista.map(p=>{
          const marc=p.realizadas+p.canceladas+p.faltas;
          return `<tr>
            <td><div style="font-weight:600" title="${esc(p.nome)}">${esc(p.nome)}</div></td>
            <td class="num"><div class="prof-barra"><span class="prof-barra__trilho"><span class="prof-barra__valor" style="display:block;width:${max?p.realizadas/max*100:0}%"></span></span><strong>${p.realizadas}</strong></div></td>
            <td class="num">${duracaoTexto(p.minutos)}</td>
            <td class="num">${p.canceladas}</td>
            <td class="num">${p.faltas}</td>
            <td class="num">${marc?Math.round(p.realizadas/marc*100)+'%':'—'}</td>
          </tr>`;}).join('')}</tbody></table></div>`;
    },
    init(){
      $$('.periodo-btn').forEach(b=>b.addEventListener('click',()=>this.aplicarPreset(b.dataset.periodo)));
      ['#resumo-de','#resumo-ate'].forEach(sel=>$(sel).addEventListener('change',()=>{
        this.preset=null;$$('.periodo-btn').forEach(b=>b.classList.remove('periodo-btn--ativo'));
        if($('#resumo-de').value&&$('#resumo-ate').value)this.load();
      }));
      $('#resumo-terapeuta').addEventListener('change',()=>this.load());
      $('#btn-reload-resumo').addEventListener('click',async e=>{
        const b=e.currentTarget;b.setAttribute('aria-busy','true');
        // "Últimos N dias" acompanha o dia de hoje
        if(this.preset)this.aplicarPreset(this.preset);else await this.load();
        b.removeAttribute('aria-busy');
      });
    },
  };

  /* ===================================================================
     TABELAS NO CELULAR: cada célula recebe o título da coluna
     =================================================================== */
  function rotularTabelas(){
    $$('table.tbl').forEach(t=>{
      const titulos=[...t.querySelectorAll('thead th')].map(th=>th.textContent.trim());
      t.querySelectorAll('tbody tr').forEach(tr=>[...tr.children].forEach((td,i)=>{
        if(!td.hasAttribute('data-label')&&titulos[i])td.setAttribute('data-label',titulos[i]);
      }));
    });
  }
  let rotulagemPendente=false;
  new MutationObserver(()=>{
    if(rotulagemPendente)return;rotulagemPendente=true;
    requestAnimationFrame(()=>{rotulagemPendente=false;rotularTabelas();});
  }).observe(document.documentElement,{childList:true,subtree:true});

  /* BOOT */
  function boot(){
    recuperarSenha.lerLink();
    document.body.dataset.loading='false';
    // Sem limite, o campo de data aceita anos com 5 ou 6 dígitos
    $$('input[type="date"]').forEach(i=>{if(!i.max)i.max='2099-12-31';if(!i.min)i.min='1900-01-01';});
    $$('input[type="datetime-local"]').forEach(i=>{if(!i.max)i.max='2099-12-31T23:59';if(!i.min)i.min='1900-01-01T00:00';});
    ['modal-pessoa','modal-consulta','modal-agendamento','modal-especialidade','modal-usuario'].forEach(initModalTabs);
    auth.init();nav.init();
    pages.agenda.init();pages.consultas.init();pages.pessoas.init();
    pages.especialidades.init();pages.usuarios.init();
    pages.semana.init();pages.resumo.init();dica.init();evolucaoPaciente.init();
    pages.espera.init();pages.financeiro.init();
    $('#btn-connect-google').addEventListener('click',()=>google.handleBotao());
    // Fecha modais via backdrop ou [data-modal-close] — garante que o clique no ícone X também funcione
    document.addEventListener('click',e=>{
      const closeTarget=e.target.closest('[data-modal-close]');
      if(closeTarget){
        const m=closeTarget.closest('.modal');if(m&&!m.dataset.bloqueado)m.classList.remove('is-open');
      }
    });
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&maisAcoes.aberto){maisAcoes.fechar(true);return;}
      if(e.key==='Escape'&&!$('.modal.is-open[data-bloqueado]')){ui.closeAllModals();nav.closeSidebarMobile();}
    });
    maisAcoes.init();fotoPerfil.init();travaRolagem.init();recuperarSenha.init();
  }

  // Recuperação de senha pelo e-mail. O código vem depois do # do link (não chega a servidores nem a logs)
  // e sai do endereço assim que a página abre
  const recuperarSenha = {
    codigo:null,
    init(){
      $('#btn-esqueci-senha').addEventListener('click',()=>this.abrirPedido());
      $('#form-esqueci').addEventListener('submit',e=>this.pedir(e));
      $('#form-nova-senha').addEventListener('submit',e=>this.salvar(e));
      $('#btn-nova-senha-fechar').addEventListener('click',()=>this.fecharNovaSenha());
      if(this.doLink)this.abrirLink(this.doLink);
    },
    // Antes de tudo: logado, o sistema abre a tela inicial e troca o endereço (o link se perderia)
    lerLink(){
      const m=/^#recuperar=([0-9a-f]{64})$/.exec(location.hash);
      if(!m)return;
      history.replaceState(null,'',location.pathname+location.search);
      this.doLink=m[1];
    },
    abrirPedido(){
      $('#esq-login').value=$('#input-user').value.trim();fieldErr($('#esq-login'),false);
      $('#form-esqueci').hidden=false;$('#esqueci-enviado').hidden=true;
      ui.openModal('modal-esqueci');
    },
    async pedir(e){
      e.preventDefault();
      const usuario=$('#esq-login').value.trim();
      fieldErr($('#esq-login'),!usuario);if(!usuario)return;
      const btn=$('#btn-esqueci-enviar');btn.setAttribute('aria-busy','true');
      try{
        const r=await api.post('/recuperar-senha',{usuario});
        const destino=typeof r.email==='string'?r.email:'';
        $('#esqueci-resultado').textContent=r.jaEnviado?`Já enviamos um link para ${destino} há poucos minutos.`
          :r.enviado?`Enviamos um link para ${destino}. Ele vale por 30 minutos.`
          :'Não encontramos um e-mail cadastrado para este login. Entre em contato com o administrador da clínica para redefinir a sua senha.';
        $('#esqueci-dica').textContent=r.jaEnviado?'Veja a caixa de entrada e o spam. Depois de 2 minutos, dá para pedir outro link.'
          :r.enviado?'Não chegou? Veja a caixa de spam. Se o endereço estiver errado, fale com o administrador da clínica.':'';
        $('#esqueci-dica').hidden=!r.enviado;
        $('#form-esqueci').hidden=true;$('#esqueci-enviado').hidden=false;
      }catch(err){ui.error('Não foi possível enviar',err.message);}
      finally{btn.removeAttribute('aria-busy');}
    },
    async abrirLink(codigo){
      let valido=false;
      try{valido=(await api.post('/recuperar-senha/validar',{codigo})).valido===true;}
      catch(err){ui.error('Não foi possível abrir o link',err.message);return;}
      if(!valido){ui.warning('Link inválido','Este link venceu ou já foi usado. Peça a recuperação de novo.');return;}
      this.codigo=codigo;
      ['rec-senha','rec-senha2'].forEach(id=>{$('#'+id).value='';fieldErr($('#'+id),false);});
      $('#modal-nova-senha').dataset.bloqueado='1';
      ui.openModal('modal-nova-senha');
    },
    fecharNovaSenha(){
      this.codigo=null;delete $('#modal-nova-senha').dataset.bloqueado;
      ['rec-senha','rec-senha2'].forEach(id=>{$('#'+id).value='';});
      ui.closeModal('modal-nova-senha');
    },
    async salvar(e){
      e.preventDefault();
      const senha=$('#rec-senha').value,repete=$('#rec-senha2').value;
      const fraca=senha.length<8||senha.length>60||!/[A-Za-z]/.test(senha)||!/\d/.test(senha);
      fieldErr($('#rec-senha'),fraca);fieldErr($('#rec-senha2'),!fraca&&senha!==repete);
      if(fraca||senha!==repete)return;
      const btn=$('#btn-nova-senha');btn.setAttribute('aria-busy','true');
      try{
        await api.post('/recuperar-senha/confirmar',{codigo:this.codigo,novaSenha:senha});
        this.fecharNovaSenha();
        if(S.token)auth.logout({silent:true});
        ui.success('Senha alterada','Entre com a senha nova.');
      }catch(err){ui.error('Não foi possível alterar',err.message);}
      finally{btn.removeAttribute('aria-busy');}
    },
  };

  // Com o menu do celular ou um modal aberto, a página de trás não rola (no iPhone, overflow:hidden
  // sozinho não basta: o body fica fixo e a posição da rolagem é devolvida ao fechar)
  const travaRolagem = {
    travada:false, y:0,
    atualizar(){
      const aberto=!!document.querySelector('.modal.is-open')||$('#sidebar').classList.contains('is-open');
      if(aberto===this.travada)return;
      this.travada=aberto;
      const raiz=document.documentElement;
      if(aberto){
        this.y=scrollY;
        document.body.style.top=`-${this.y}px`;
        raiz.classList.add('rolagem-travada');
      }else{
        raiz.classList.remove('rolagem-travada');
        document.body.style.top='';
        // Sem animação: volta exatamente para onde estava
        raiz.style.scrollBehavior='auto';scrollTo(0,this.y);raiz.style.scrollBehavior='';
      }
    },
    init(){
      // Observa a classe dos modais e do menu: vale para todas as formas de abrir e fechar
      const obs=new MutationObserver(()=>this.atualizar());
      $$('.modal').forEach(m=>obs.observe(m,{attributes:true,attributeFilter:['class']}));
      obs.observe($('#sidebar'),{attributes:true,attributeFilter:['class']});
    },
  };

  // Foto de perfil: guardada no banco; sem foto, ficam as iniciais
  const FOTO_LADO=256, FOTO_MAX_BYTES=24000;
  const fotoPerfil = {
    foto:null,
    async carregar(){
      try{const r=await api.get('/usuarios/me/foto');this.mostrar(r?.imagem||null);}catch{this.mostrar(null);}
    },
    // Só aceita data URI de imagem (vem do nosso back, que já confere o conteúdo)
    mostrar(imagem){
      this.foto=typeof imagem==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imagem)?imagem:null;
      for(const el of [$('#user-avatar'),$('#foto-preview')]){
        if(!el)continue;
        el.replaceChildren();
        if(this.foto){const img=new Image();img.src=this.foto;img.alt='';el.appendChild(img);el.classList.add('avatar--foto');}
        else{el.textContent=initials(S.userName);el.classList.remove('avatar--foto');}
      }
      $('#btn-foto-remover').hidden=!this.foto;
      $('#foto-escolher-txt').textContent=this.foto?'Trocar foto':'Escolher foto';
    },
    abrir(){this.mostrar(this.foto);ui.openModal('modal-foto');},
    // Recorta o centro em quadrado e reduz no próprio navegador (a foto original nunca sai do aparelho)
    async reduzir(arquivo){
      const url=URL.createObjectURL(arquivo);
      try{
        const img=await new Promise((ok,erro)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=erro;i.src=url;});
        const lado=Math.min(img.naturalWidth,img.naturalHeight);
        if(!lado)throw new Error('imagem vazia');
        for(const [tam,qual] of [[FOTO_LADO,.85],[FOTO_LADO,.7],[192,.7],[160,.6]]){
          const c=document.createElement('canvas');c.width=c.height=tam;
          c.getContext('2d').drawImage(img,(img.naturalWidth-lado)/2,(img.naturalHeight-lado)/2,lado,lado,0,0,tam,tam);
          let dados=c.toDataURL('image/webp',qual);
          if(!dados.startsWith('data:image/webp'))dados=c.toDataURL('image/jpeg',qual);
          if(Math.ceil((dados.length-dados.indexOf(',')-1)*3/4)<=FOTO_MAX_BYTES)return dados;
        }
        throw new Error('grande');
      }finally{URL.revokeObjectURL(url);}
    },
    async escolher(arquivo){
      if(!arquivo)return;
      if(!/^image\/(png|jpeg|webp)$/.test(arquivo.type)){ui.warning('Formato não aceito','Escolha uma foto JPG, PNG ou WebP.');return;}
      if(arquivo.size>15*1024*1024){ui.warning('Arquivo muito grande','Escolha uma foto de até 15 MB.');return;}
      let dados;
      try{dados=await this.reduzir(arquivo);}catch{ui.error('Não foi possível usar esta foto','Tente outra imagem.');return;}
      try{await api.put('/usuarios/me/foto',{imagem:dados});this.mostrar(dados);ui.success('Foto atualizada');}
      catch(err){ui.error('Erro',err.message);}
    },
    async remover(){
      try{await api.del('/usuarios/me/foto');this.mostrar(null);ui.success('Foto removida');}
      catch(err){ui.error('Erro',err.message);}
    },
    init(){
      $('#user-avatar').addEventListener('click',()=>this.abrir());
      $('#foto-arquivo').addEventListener('change',e=>{const f=e.target.files?.[0];e.target.value='';this.escolher(f);});
      $('#btn-foto-remover').addEventListener('click',()=>this.remover());
    },
  };

  // Menu "⋯" das linhas das tabelas: fica fixo na tela (a rolagem da tabela não o corta)
  const maisAcoes = {
    aberto:null,
    init(){
      document.addEventListener('click',e=>{
        const botao=e.target.closest('[data-mais]');
        if(botao){const menu=botao.nextElementSibling;const era=this.aberto===menu;this.fechar();if(!era)this.abrir(botao,menu);return;}
        // Clique numa ação do menu: a ação já rodou no próprio botão; aqui só fecha
        if(this.aberto)this.fechar();
      });
      addEventListener('resize',()=>this.fechar());
      document.addEventListener('scroll',e=>{if(this.aberto&&!this.aberto.contains(e.target))this.fechar();},true);
    },
    abrir(botao,menu){
      menu.hidden=false;botao.setAttribute('aria-expanded','true');this.aberto=menu;
      const r=botao.getBoundingClientRect(),alt=menu.offsetHeight,larg=menu.offsetWidth;
      // No celular, a barra de navegação de baixo também conta como limite
      const barra=document.querySelector('.tabbar'),fundo=barra&&barra.offsetParent?barra.getBoundingClientRect().top:innerHeight;
      const abaixo=r.bottom+6+alt<=fundo-8;
      menu.style.top=`${abaixo?r.bottom+6:Math.max(8,r.top-6-alt)}px`;
      menu.style.left=`${Math.max(8,Math.min(r.right-larg,innerWidth-larg-8))}px`;
      menu.dataset.lado=abaixo?'baixo':'cima';
      menu.querySelector('button')?.focus({preventScroll:true});
    },
    fechar(focarBotao=false){
      const menu=this.aberto;if(!menu)return;
      menu.hidden=true;this.aberto=null;
      const botao=menu.previousElementSibling;botao?.setAttribute('aria-expanded','false');
      if(focarBotao)botao?.focus();
    },
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
  else boot();
})();
