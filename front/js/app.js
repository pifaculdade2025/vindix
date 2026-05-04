/* ===============================================================
   VINDIX — Front-end v2.2
   =============================================================== */
(() => {
  'use strict';

  const CONFIG = {
    API_BASE:      'http://localhost:8080',
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
    gStatus:'/google/status', gConectar:'/google/conectar', gEvento:'/google/evento',
  };

  const PERMS_MAP = {
    1:{label:'Acesso total'}, 2:{label:'Usuários — Geral'},
    10:{label:'Cadastro — Geral'}, 11:{label:'Cadastro — Acessar'},
    12:{label:'Cadastro — Inserir'}, 13:{label:'Cadastro — Alterar'},
    14:{label:'Cadastro — Excluir'}, 15:{label:'Cadastro — Histórico'},
    20:{label:'Consultas — Geral'}, 21:{label:'Consultas — Acessar'},
    22:{label:'Consultas — Inserir'}, 23:{label:'Consultas — Alterar'},
    24:{label:'Consultas — Excluir'}, 25:{label:'Consultas — Histórico'},
    26:{label:'Consultas — Google Agenda'},
    30:{label:'Especialidades — Geral'}, 31:{label:'Especialidades — Acessar'},
    32:{label:'Especialidades — Inserir'}, 33:{label:'Especialidades — Alterar'},
    34:{label:'Especialidades — Excluir'}, 35:{label:'Especialidades — Histórico'},
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

  /* STATE */
  const S = {
    token:null, userName:'', userId:null, permissoes:[],
    currentPage:'dashboard',
    cadastros:[], consultas:[], especialidades:[], usuarios:[], todasPerms:[],
    cadastrosFilter:'all',
    sidebarCollapsed:false,
    ed:{ pessoaId:null, pessoaUA:null, consultaId:null, consultaUA:null,
         espId:null, espUA:null, usuarioId:null, usuarioUA:null },
  };

  /* API */
  const api = {
    async req(method, path, body=null) {
      const h = {'Content-Type':'application/json'};
      if (S.token) h['Authorization'] = `Bearer ${S.token}`;
      const opts = {method, headers:h};
      if (body !== null) opts.body = JSON.stringify(body);
      let r;
      try { r = await fetch(CONFIG.API_BASE + path, opts); }
      catch { throw new Error('Sem conexão com o servidor.'); }
      if (r.status === 401 || r.status === 403) {
        auth.logout({silent:true});
        throw new Error('Sessão expirada.');
      }
      if (!r.ok) { const d=await r.json().catch(()=>({})); throw new Error(d.erro||`HTTP ${r.status}`); }
      if (r.status === 204) return null;
      return r.json();
    },
    async login(u, s) {
      let r;
      try { r = await fetch(CONFIG.API_BASE+EP.login,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); }
      catch { throw new Error('Sem conexão com o servidor.'); }
      if (r.status===429) throw new Error('Muitas tentativas. Aguarde 15 minutos.');
      const d = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(d.erro||`HTTP ${r.status}`);
      return d;
    },
    get:  p     => api.req('GET', p),
    post: (p,b) => api.req('POST', p, b),
    put:  (p,b) => api.req('PUT', p, b),
    del:  (p,b) => api.req('DELETE', p, b||null),

    cadastros:       (pg=1,n=100) => api.get(`${EP.cadastros}?pagina=${pg}&por_pagina=${n}`),
    cadastroById:    id  => api.get(`${EP.cadastros}/${id}`),
    cadastroPost:    b   => api.post(EP.cadastros, b),
    cadastroPut:     (id,b) => api.put(`${EP.cadastros}/${id}`, b),
    cadastroDel:     id  => api.del(`${EP.cadastros}/${id}`),
    cadastroHist:    id  => api.get(`${EP.cadastros}/historico/${id}`),
    cadastroHistDel: ()  => api.get(`${EP.cadastros}/historico/delete`),
    relacaoGet:      id  => api.get(`${EP.relacao}?idCadastro=${id}`),
    relacaoPost:     b   => api.post(EP.relacao, b),
    relacaoDel:      id  => api.del(`${EP.relacao}/${id}`),
    consultas:       (pg=1,n=100) => api.get(`${EP.consultas}?pagina=${pg}&por_pagina=${n}`),
    consultaPost:    b   => api.post(EP.consultas, b),
    consultaPut:     (id,b) => api.put(`${EP.consultas}/${id}`, b),
    consultaDel:     id  => api.del(`${EP.consultas}/${id}`),
    consultaHist:    id  => api.get(`${EP.consultas}/historico/${id}`),
    consultaHistDel: ()  => api.get(`${EP.consultas}/historico/delete`),
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
    permsGet:        ()  => api.get(EP.perms),
    permsUser:       id  => api.get(`${EP.usrPerms}?usuario=${id}`),
    permAdd:         b   => api.post(EP.usrPerms, b),
    permDel:         b   => api.del(EP.usrPerms, b),
    permHist:        id  => api.get(`${EP.usrPerms}/historico/${id}`),
    gStatus:         ()  => api.get(EP.gStatus),
    gDesconectar:    ()  => api.del(EP.gConectar),
    gEvento:         id  => api.post(EP.gEvento, {consulta:id}),
    gConectar() {
      const p=window.open(CONFIG.API_BASE+EP.gConectar,'google-oauth','width=520,height=680,noopener');
      if(!p) ui.warning('Popup bloqueado','Permita popups e tente novamente.');
    },
  };

  /* UTILS */
  const $  = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => Array.from(r.querySelectorAll(s));
  const esc = s => s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const icon = (id,sz=16) => `<svg class="icon" aria-hidden="true" style="width:${sz}px;height:${sz}px"><use href="#i-${id}"></use></svg>`;
  const initials = n => n?n.trim().split(/\s+/).slice(0,2).map(s=>s[0].toUpperCase()).join(''):'?';
  const debounce = (fn,w=200) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),w); }; };
  const temPerm = (...ids) => ids.some(id=>S.permissoes.includes(id));
  const fieldErr = (el,show) => el?.closest('.field')?.classList.toggle('has-error',show);

  function formatDateBR(s) {
    if (!s) return '—';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [d,t]=s.split(/[T\s]/), [Y,M,D]=d.split('-');
      return `${D}/${M}/${Y}${t?' '+t.slice(0,5):''}`;
    }
    return s;
  }
  function animateCounter(el,target,dur=900) {
    if (!el) return;
    const start=parseInt(el.textContent.replace(/\D/g,''),10)||0;
    if (start===target){el.textContent=target;return;}
    const diff=target-start,t0=performance.now();
    (function tick(now){
      const p=Math.min(1,(now-t0)/dur);
      el.textContent=Math.round(start+diff*(1-Math.pow(1-p,3)));
      if(p<1) requestAnimationFrame(tick);
    })(performance.now());
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
  const nomeCad = id => { const c=S.cadastros.find(x=>x.id===+id); return c?c.nome:`#${id}`; };
  const nomeEsp = id => { const e=S.especialidades.find(x=>x.id===+id); return e?e.descricao:`#${id}`; };
  function corDot(idCor, size=12) {
    const cor=COR_GOOGLE[idCor||0];
    return cor
      ? `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${cor};border:1.5px solid rgba(0,0,0,.15);vertical-align:middle;flex-shrink:0"></span>`
      : `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:var(--border);border:1.5px solid var(--border-strong);vertical-align:middle;flex-shrink:0"></span>`;
  }

  /* UI */
  const ui = {
    toast(type,title,msg) {
      const box=$('#toasts'); if(!box)return;
      const toasts=$$('.toast',box);
      if(toasts.length>=CONFIG.MAX_TOASTS) { toasts[0].classList.add('toast--closing'); setTimeout(()=>toasts[0].remove(),150); }
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
      m.classList.add('is-open');
      const f=m.querySelector('input:not([disabled]),select,textarea');
      if(f) setTimeout(()=>f.focus(),80);
    },
    closeModal(id){document.getElementById(id)?.classList.remove('is-open');},
    closeAllModals(){$$('.modal.is-open').forEach(m=>m.classList.remove('is-open'));},

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
    renderHistorico(container,rows){
      if(!rows||!rows.length){container.innerHTML=this.emptyState('history','Sem alterações','Nenhuma modificação registrada.',true);return;}
      const extra=rows[0]?.tipo!==undefined?'<th>Tipo</th>':'';
      const trs=rows.map(r=>`<tr>
        <td class="td-date">${esc(formatDateBR(r.dthr))}</td>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--fg-dim)">${esc(r.campo||'—')}</td>
        <td><span class="hist-valor-ant">${esc(r.valor_antigo??'—')}</span></td>
        <td><span class="hist-valor-nov">${esc(r.valor_novo??'—')}</span></td>
        <td style="font-size:11px;color:var(--fg-dim)">${esc(r.id_usuario||'—')}</td>
        ${r.tipo!==undefined?`<td><span class="badge">${esc(r.tipo)}</span></td>`:''}
      </tr>`).join('');
      container.innerHTML=`<div class="table-scroll"><table class="hist-table">
        <thead><tr><th>Data/Hora</th><th>Campo</th><th>Antes</th><th>Depois</th><th>Usuário</th>${extra}</tr></thead>
        <tbody>${trs}</tbody></table></div>`;
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
  function resetModalTabs(modalId){
    const m=document.getElementById(modalId); if(!m)return;
    m.querySelectorAll('.modal-tab').forEach((t,i)=>t.classList.toggle('modal-tab--active',i===0));
    m.querySelectorAll('.modal-tab-panel').forEach((p,i)=>p.classList.toggle('modal-tab-panel--active',i===0));
  }
  function gotoModalTab(modalId,tabName){
    const m=document.getElementById(modalId); if(!m)return;
    m.querySelectorAll('.modal-tab').forEach(t=>t.classList.toggle('modal-tab--active',t.dataset.tab===tabName));
    m.querySelectorAll('.modal-tab-panel').forEach(p=>p.classList.toggle('modal-tab-panel--active',p.id===`tab-${tabName}`));
  }

  /* AUTH */
  const auth = {
    init(){
      const token=localStorage.getItem(CONFIG.TOKEN_KEY);
      const user=localStorage.getItem(CONFIG.USER_KEY);
      const perms=localStorage.getItem(CONFIG.PERMS_KEY);
      const uid=localStorage.getItem(CONFIG.USER_ID_KEY);
      if(token&&user){
        S.token=token; S.userName=user;
        S.userId=uid?parseInt(uid,10):null;
        S.permissoes=perms?JSON.parse(perms):[];
        this.enterApp();
      } else this.showLogin();

      $('#form-login').addEventListener('submit',async e=>{e.preventDefault();await this.handleLogin();});
      $('#btn-toggle-pass').addEventListener('click',()=>{
        const i=$('#input-pass'),hide=i.type==='password';
        i.type=hide?'text':'password';
        $('#btn-toggle-pass svg use').setAttribute('href',hide?'#i-eye-off':'#i-eye');
      });
      $('#btn-logout').addEventListener('click',()=>ui.confirm('Sair do sistema?','Você precisará fazer login novamente.',()=>this.logout()));
    },

    async handleLogin(){
      const btn=$('#btn-login');
      const usuario=$('#input-user').value.trim();
      const senha=$('#input-pass').value;
      if(!usuario||!senha){ui.error('Campos obrigatórios','Preencha usuário e senha.');return;}
      if(senha.length>60){ui.error('Senha inválida','Máximo 60 caracteres.');return;}
      btn.setAttribute('aria-busy','true');
      btn.querySelector('.btn__label').textContent='Verificando…';
      try {
        const data=await api.login(usuario,senha);
        S.token=data.token; S.userName=data.nome||usuario;
        S.permissoes=Array.isArray(data.permissoes)?data.permissoes:[];
        localStorage.setItem(CONFIG.TOKEN_KEY,S.token);
        localStorage.setItem(CONFIG.USER_KEY,S.userName);
        localStorage.setItem(CONFIG.PERMS_KEY,JSON.stringify(S.permissoes));
        ui.success('Bem-vindo!',`Olá, ${S.userName}.`);
        this.enterApp();
      } catch(err){
        $('#login-error-msg').textContent=err.message;
        $('#login-error').hidden=false;
      } finally{
        btn.removeAttribute('aria-busy');
        btn.querySelector('.btn__label').textContent='Entrar no sistema';
      }
    },

    enterApp(){
      $('#screen-login').classList.remove('screen--active');
      $('#screen-app').classList.add('screen--active');
      document.body.style.overflow='hidden';
      $('#user-name').textContent=S.userName;
      $('#user-avatar').textContent=initials(S.userName);
      this.applyNavPerms();
      nav.goto('dashboard');
      this.carregarDados();
      google.verificarStatus();
    },

    async carregarDados(){
      await Promise.allSettled([
        temPerm(1,10,11)?pages.pessoas.load({silent:true}):Promise.resolve(),
        temPerm(1,20,21)?pages.consultas.load({silent:true}):Promise.resolve(),
        temPerm(1,30,31)?pages.especialidades.load({silent:true}):Promise.resolve(),
        temPerm(1,2)?pages.usuarios.load({silent:true}):Promise.resolve(),
        temPerm(1,2)?pages.usuarios.loadPerms({silent:true}):Promise.resolve(),
      ]);
      if(!S.userId&&S.usuarios.length){
        const me=S.usuarios.find(u=>u.nome===S.userName);
        if(me){S.userId=me.id;localStorage.setItem(CONFIG.USER_ID_KEY,me.id);}
      }
      const rl=$('#user-role-label');
      if(rl)rl.textContent=temPerm(1)?'Administrador':temPerm(2)?'Gestor':'Operador';
    },

    applyNavPerms(){
      const show=(id,cond)=>{const el=document.getElementById(id);if(el)el.style.display=cond?'':'none';};
      show('nav-consultas',     temPerm(1,20,21));
      show('nav-pessoas',       temPerm(1,10,11));
      show('nav-especialidades',temPerm(1,30,31));
      show('nav-usuarios',      temPerm(1,2));
      const gAdm=$('#nav-group-admin');if(gAdm)gAdm.style.display=temPerm(1,2)?'':'none';
      const gCad=$('#nav-group-cadastros');if(gCad)gCad.style.display=temPerm(1,10,11,30,31)?'':'none';
      const gBtn=$('#btn-connect-google');if(gBtn)gBtn.style.display=temPerm(1)?'':'none';
      const nc=$('#btn-new-consulta');if(nc)nc.style.display=temPerm(1,20,22)?'':'none';
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
      S.token=null;S.userName='';S.permissoes=[];S.userId=null;
      S.cadastros=[];S.consultas=[];S.especialidades=[];S.usuarios=[];
      [CONFIG.TOKEN_KEY,CONFIG.USER_KEY,CONFIG.PERMS_KEY,CONFIG.USER_ID_KEY].forEach(k=>localStorage.removeItem(k));
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
    },
    async handleBotao(){
      const btn=$('#btn-connect-google');if(!btn)return;
      if(btn.dataset.gc==='true'){
        ui.confirm('Desconectar Google Agenda?','Os eventos já enviados não serão removidos.',async()=>{
          try{await api.gDesconectar();this.atualizarBotao(false);ui.success('Google desconectado');}
          catch(err){ui.error('Erro',err.message);}
        });
      }else{
        api.gConectar();
        ui.info('Conectando…','Conclua a autenticação na janela do Google.');
        setTimeout(()=>this.verificarStatus(),5000);
      }
    },
  };

  /* NAV */
  const PAGE_TITLES={dashboard:'Dashboard',consultas:'Consultas',pessoas:'Pessoas',especialidades:'Especialidades',usuarios:'Usuários',relatorios:'Relatórios'};

  const nav = {
    init(){
      $$('.nav__item').forEach(b=>b.addEventListener('click',()=>this.goto(b.dataset.page)));
      $$('[data-goto]').forEach(b=>b.addEventListener('click',()=>this.goto(b.dataset.goto)));
      $('#btn-open-sidebar').addEventListener('click',()=>this.toggleSidebar());
      $('#btn-close-sidebar').addEventListener('click',()=>this.closeSidebarMobile());
      $('#backdrop-sidebar').addEventListener('click',()=>this.closeSidebarMobile());
      $$('.brand--clickable').forEach(b=>b.addEventListener('click',()=>this.goto('dashboard')));
    },
    goto(page){
      if(!PAGE_TITLES[page])page='dashboard';
      const guards={consultas:[1,20,21],pessoas:[1,10,11],especialidades:[1,30,31],usuarios:[1,2]};
      if(guards[page]&&!temPerm(...guards[page])){ui.warning('Sem acesso','Você não tem permissão para esta seção.');return;}
      S.currentPage=page;
      $$('.page').forEach(p=>p.classList.toggle('page--active',p.dataset.page===page));
      $$('.nav__item').forEach(n=>n.classList.toggle('nav__item--active',n.dataset.page===page));
      $('#page-title').textContent=PAGE_TITLES[page];
      const r=pages[page]?.render;if(typeof r==='function')r.call(pages[page]);
      if(window.innerWidth<960)this.closeSidebarMobile();
      $('#content').scrollTo({top:0,behavior:'smooth'});
    },
    toggleSidebar(){
      if(window.innerWidth<960){
        $('#sidebar').classList.toggle('is-open');
        $('#backdrop-sidebar').classList.toggle('is-open');
      } else {
        S.sidebarCollapsed=!S.sidebarCollapsed;
        $('#app-shell').classList.toggle('sidebar--collapsed',S.sidebarCollapsed);
      }
    },
    closeSidebarMobile(){
      $('#sidebar').classList.remove('is-open');
      $('#backdrop-sidebar').classList.remove('is-open');
    },
  };

  /* PAGES */
  const pages = {};

  /* Dashboard */
  pages.dashboard = {
    render(){
      animateCounter($('#stat-pacientes'),  S.cadastros.filter(p=>p.tipo==='Paciente').length);
      animateCounter($('#stat-terapeutas'), S.cadastros.filter(p=>p.tipo==='Terapeuta').length);
      animateCounter($('#stat-consultas'),  S.consultas.length);
      animateCounter($('#stat-especialidades'),S.especialidades.length);
      const box=$('#dash-timeline'),items=S.consultas.slice(0,6);
      if(!items.length){box.innerHTML=ui.emptyState('calendar','Sem consultas','Recarregue os dados.',true);return;}
      box.innerHTML=items.map(c=>`<div class="tl-item">
        <div class="tl-dot"></div>
        <div class="tl-main">
          <div class="tl-title">${esc(c.paciente||'—')} <span style="color:var(--fg-dim)">com</span> ${esc(c.terapeuta||'—')}</div>
          <div class="tl-sub">${esc(c.especialidade||'—')}</div>
        </div>
        <div class="tl-date">${esc(formatDateBR(c.data_hora))}</div>
      </div>`).join('');
    },
  };

  function updateNavBadges(){$('#nav-badge-consultas').textContent=S.consultas.length;}

  /* Consultas */
  pages.consultas = {
    render(){this.renderTable();},
    async load({silent=false}={}){
      if(!S.token||!temPerm(1,20,21))return;
      const body=$('#consultas-body'),cnt=$('#count-consultas');
      if(!silent){body.innerHTML=ui.skeleton(5);cnt.textContent='—';}
      try{
        const data=await api.consultas();
        S.consultas=Array.isArray(data)?data:[];
        this.renderTable();updateNavBadges();pages.dashboard.render();
        if(!silent)ui.success('Consultas atualizadas',`${S.consultas.length} registro(s).`);
      }catch(err){
        if(!silent){body.innerHTML=ui.errorState('Falha',err.message);cnt.textContent='—';ui.error('Erro',err.message);}
      }
    },
    renderTable(){
      const body=$('#consultas-body'),cnt=$('#count-consultas');
      const q=($('#search-consultas').value||'').toLowerCase();
      const list=S.consultas.filter(c=>!q||[c.paciente,c.terapeuta,c.especialidade].some(v=>(v||'').toLowerCase().includes(q)));
      cnt.textContent=`${list.length} registro${list.length===1?'':'s'}`;
      if(!list.length){body.innerHTML=!S.consultas.length?ui.emptyState('calendar','Sem consultas','Clique em Recarregar.'):ui.emptyState('search','Nada encontrado','Ajuste a busca.');return;}
      const pG=temPerm(1,26),pE=temPerm(1,20,23),pX=temPerm(1,20,24),pH=temPerm(1,20,25);
      const rows=list.map(c=>{
        const env=c.enviado_google==='S';
        return `<tr>
          <td><div style="font-weight:500">${esc(c.paciente||'—')}</div></td>
          <td>${esc(c.terapeuta||'—')}</td>
          <td class="td-date">${esc(formatDateBR(c.data_hora))}</td>
          <td><span class="badge badge--accent">${esc(c.especialidade||'—')}</span></td>
          <td>${pG?`<span class="badge ${env?'badge--success':'badge--warning'}">${env?icon('check',11)+' Enviado':'Não enviado'}</span>`:'—'}</td>
          <td class="td-actions">
            ${pG&&!env?`<button class="icon-btn" data-act="google" data-id="${c.id}" title="Enviar ao Google Agenda">${icon('google')}</button>`:''}
            ${pE?`<button class="icon-btn" data-act="edit" data-id="${c.id}" title="Editar">${icon('edit')}</button>`:''}
            ${pH?`<button class="icon-btn" data-act="hist" data-id="${c.id}" title="Histórico">${icon('history')}</button>`:''}
            ${pX?`<button class="icon-btn icon-btn--danger" data-act="del" data-id="${c.id}" title="Excluir">${icon('trash')}</button>`:''}
          </td></tr>`;
      }).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Paciente</th><th>Terapeuta</th><th>Data/Hora</th><th>Especialidade</th><th>Google</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
      body.querySelectorAll('[data-act]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const id=parseInt(btn.dataset.id,10);
          if(btn.dataset.act==='google')this._enviarGoogle(btn,id);
          else if(btn.dataset.act==='edit')this.openEdit(id);
          else if(btn.dataset.act==='hist')this.openHistorico(id);
          else if(btn.dataset.act==='del')this.excluir(id);
        });
      });
    },
    async _enviarGoogle(btn,id){
      btn.setAttribute('aria-busy','true');btn.disabled=true;
      try{await api.gEvento(id);const c=S.consultas.find(x=>x.id===id);if(c)c.enviado_google='S';ui.success('Enviado!');this.renderTable();}
      catch(err){btn.disabled=false;ui.error('Erro',err.message);}
      finally{btn.removeAttribute('aria-busy');}
    },
    openNew(){
      resetModalTabs('modal-consulta');
      S.ed.consultaId=null;S.ed.consultaUA=null;
      $('#modal-consulta-title').textContent='Nova consulta';
      $$('#form-consulta .field').forEach(f=>f.classList.remove('has-error'));
      const now=new Date();now.setSeconds(0,0);
      $('#c-data').value=now.toISOString().slice(0,16);
      $('#c-tempo').value='01:00';$('#c-resumo').value='';
      this._popularSelects(null);
      ui.openModal('modal-consulta');
    },
    async openEdit(id){
      const c=S.consultas.find(x=>x.id===id);if(!c)return;
      resetModalTabs('modal-consulta');
      S.ed.consultaId=id;S.ed.consultaUA=c.updated_at;
      $('#modal-consulta-title').textContent='Editar consulta';
      $('#c-data').value=(c.data_hora||'').replace(' ','T').slice(0,16);
      $('#c-tempo').value=(c.tempo_sessao||'01:00:00').slice(0,5);
      $('#c-resumo').value=c.resumo_sessao||'';
      $$('#form-consulta .field').forEach(f=>f.classList.remove('has-error'));
      // id_terapeuta, id_paciente, id_especialidade vêm do backend agora
      await this._popularSelects(c);
      ui.openModal('modal-consulta');
    },
    async _popularSelects(c){
      const terapeutas=S.cadastros.filter(x=>x.tipo==='Terapeuta');
      const selT=$('#c-terapeuta');
      selT.innerHTML='<option value="">— selecione —</option>'+
        terapeutas.map(t=>`<option value="${t.id}" ${c&&c.id_terapeuta===t.id?'selected':''}>${esc(t.nome)}</option>`).join('');
      // Quando muda terapeuta, refiltra especialidades
      selT.onchange=()=>this._filtrarEsp(null);
      // Paciente — todos os pacientes
      const pacientes=S.cadastros.filter(x=>x.tipo==='Paciente');
      $('#c-paciente').innerHTML='<option value="">— selecione —</option>'+
        pacientes.map(p=>`<option value="${p.id}" ${c&&c.id_paciente===p.id?'selected':''}>${esc(p.nome)}</option>`).join('');
      // Filtra especialidades com base no terapeuta selecionado (ou o da consulta)
      await this._filtrarEsp(c);
    },
    async _filtrarEsp(c){
      const tid=parseInt($('#c-terapeuta').value,10)||null;
      const selE=$('#c-especialidade');
      if(!tid){selE.innerHTML='<option value="">— selecione o terapeuta primeiro —</option>';return;}
      // Garante relacoes do terapeuta carregadas
      let ter=S.cadastros.find(x=>x.id===tid);
      if(ter&&!ter._relacoes){
        try{const r=await api.relacaoGet(tid);ter._relacoes=Array.isArray(r)?r:[];}
        catch{ter._relacoes=[];}
      }
      const rels=ter?._relacoes||[];
      // Especialidades vinculadas ao terapeuta
      const esps=rels.length
        ?S.especialidades.filter(e=>e.inativo!=='S'&&rels.some(r=>r.id_especialidade_terapeuta===e.id))
        :S.especialidades.filter(e=>e.inativo!=='S');
      selE.innerHTML='<option value="">— selecione —</option>'+
        esps.map(e=>`<option value="${e.id}" ${c&&c.id_especialidade===e.id?'selected':''}>${esc(e.descricao)}</option>`).join('');
    },
    async saveConsulta(e){
      e.preventDefault();
      const dataVal=$('#c-data').value,tempo=$('#c-tempo').value;
      const terapeuta=parseInt($('#c-terapeuta').value,10)||null;
      const especialidade=parseInt($('#c-especialidade').value,10)||null;
      const paciente=parseInt($('#c-paciente').value,10)||null;
      const resumo=$('#c-resumo').value.trim();
      let ok=true;
      fieldErr($('#c-data'),!dataVal);if(!dataVal)ok=false;
      fieldErr($('#c-terapeuta'),!terapeuta);if(!terapeuta)ok=false;
      fieldErr($('#c-especialidade'),!especialidade);if(!especialidade)ok=false;
      fieldErr($('#c-paciente'),!paciente);if(!paciente)ok=false;
      if(!ok)return;
      // Validar vínculo paciente-terapeuta via relacoes
      const pac=S.cadastros.find(x=>x.id===paciente);
      if(pac?._relacoes?.length){
        const vinculado=pac._relacoes.some(r=>r.id_especialidade_terapeuta===terapeuta);
        if(!vinculado){
          ui.error('Vínculo inválido','Este paciente não está vinculado a este terapeuta. Verifique o cadastro.');
          return;
        }
      }
      const btn=$('#btn-salvar-consulta');btn.setAttribute('aria-busy','true');
      try{
        const body={
          id_terapeuta:terapeuta,id_especialidade:especialidade,id_paciente:paciente,
          dt_hr_sessao:dataVal.replace('T',' '),tempo_sessao:tempo+':00',resumo_sessao:resumo,
        };
        if(S.ed.consultaId){
          body.campos={...body};body.updatedAt=S.ed.consultaUA;
          await api.consultaPut(S.ed.consultaId,body);
          const idx=S.consultas.findIndex(x=>x.id===S.ed.consultaId);
          if(idx>=0)Object.assign(S.consultas[idx],{
            data_hora:body.dt_hr_sessao,tempo_sessao:body.tempo_sessao,resumo_sessao:resumo,
            id_terapeuta:terapeuta,id_paciente:paciente,id_especialidade:especialidade,
            paciente:S.cadastros.find(x=>x.id===paciente)?.nome||'—',
            terapeuta:S.cadastros.find(x=>x.id===terapeuta)?.nome||'—',
            especialidade:S.especialidades.find(x=>x.id===especialidade)?.descricao||'—',
          });
          ui.success('Consulta atualizada');
        }else{
          await api.consultaPost(body);
          await pages.consultas.load({silent:true});
          ui.success('Consulta criada');
        }
        ui.closeModal('modal-consulta');this.renderTable();pages.dashboard.render();
      }catch(err){
        if(err.message.includes('409')||err.message.toLowerCase().includes('desatualizado')){
          ui.warning('Registro desatualizado','Recarregando…');
          await pages.consultas.load({silent:true});
          ui.info('Dados atualizados','Tente editar novamente.');
        }else ui.error('Erro ao salvar',err.message);
      }
      finally{btn.removeAttribute('aria-busy');}
    },
    async openHistorico(id){
      const c=$('#historico-consulta-body');c.innerHTML=ui.skeleton(4);
      gotoModalTab('modal-consulta','consulta-historico');
      ui.openModal('modal-consulta');
      try{ui.renderHistorico(c,await api.consultaHist(id));}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    async openHistoricoDeletes(){
      const c=$('#historico-consulta-body');c.innerHTML=ui.skeleton(4);
      gotoModalTab('modal-consulta','consulta-historico');
      $('#modal-consulta-title').textContent='Consultas excluídas';
      ui.openModal('modal-consulta');
      try{ui.renderHistorico(c,await api.consultaHistDel());}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    excluir(id){
      ui.confirm('Excluir consulta?','Esta ação não pode ser desfeita.',async()=>{
        try{await api.consultaDel(id);S.consultas=S.consultas.filter(x=>x.id!==id);this.renderTable();updateNavBadges();pages.dashboard.render();ui.success('Excluída');}
        catch(err){ui.error('Erro',err.message);}
      });
    },
    init(){
      $('#btn-reload-consultas').addEventListener('click',()=>this.load());
      $('#btn-new-consulta').addEventListener('click',()=>this.openNew());
      $('#btn-hist-del-consultas').addEventListener('click',()=>this.openHistoricoDeletes());
      $('#search-consultas').addEventListener('input',debounce(()=>this.renderTable(),180));
      $('#form-consulta').addEventListener('submit',e=>this.saveConsulta(e));
    },
  };

  /* Pessoas */
  pages.pessoas = {
    render(){this.renderTable();},
    async load({silent=false}={}){
      if(!S.token||!temPerm(1,10,11))return;
      const body=$('#pessoas-body'),cnt=$('#count-pessoas');
      if(!silent){body.innerHTML=ui.skeleton(5);cnt.textContent='—';}
      try{
        const data=await api.cadastros();
        S.cadastros=Array.isArray(data)?data:[];
        this._preloadRelacoes();
        this.renderTable();pages.dashboard.render();
        if(!silent)ui.success('Cadastros atualizados',`${S.cadastros.length} registro(s).`);
      }catch(err){
        if(!silent){body.innerHTML=ui.errorState('Falha',err.message);cnt.textContent='—';ui.error('Erro',err.message);}
      }
    },
    async _preloadRelacoes(){
      await Promise.allSettled(S.cadastros.map(async c=>{
        try{const r=await api.relacaoGet(c.id);c._relacoes=Array.isArray(r)?r:[];}
        catch{c._relacoes=[];}
      }));
    },
    renderTable(){
      const body=$('#pessoas-body'),cnt=$('#count-pessoas');
      const q=($('#search-pessoas').value||'').toLowerCase();
      const tipo=S.cadastrosFilter;
      const list=S.cadastros.filter(p=>{
        if(tipo!=='all'&&p.tipo!==tipo)return false;
        if(!q)return true;
        return[p.nome,p.telefone].some(v=>(v||'').toLowerCase().includes(q));
      });
      cnt.textContent=`${list.length} registro${list.length===1?'':'s'}`;
      if(!list.length){body.innerHTML=!S.cadastros.length?ui.emptyState('users','Nenhuma pessoa','Clique em "Nova pessoa".'):ui.emptyState('search','Nada encontrado','Ajuste a busca.');return;}
      const pE=temPerm(1,10,13),pX=temPerm(1,10,14),pH=temPerm(1,10,15);
      const rows=list.map(p=>`<tr>
        <td><div style="font-weight:500">${esc(p.nome)}</div></td>
        <td><span class="badge badge--${p.tipo==='Paciente'?'info':'accent'}">${esc(p.tipo||'—')}</span></td>
        <td style="color:var(--fg-muted)">${esc(p.telefone||'—')}</td>
        <td class="td-date">${esc(formatDateBR(p.dt_nasc))}</td>
        <td class="td-actions">
          ${pE?`<button class="icon-btn" data-act="edit" data-id="${p.id}" title="Editar">${icon('edit')}</button>`:''}
          ${pH?`<button class="icon-btn" data-act="hist" data-id="${p.id}" title="Histórico">${icon('history')}</button>`:''}
          ${pX?`<button class="icon-btn icon-btn--danger" data-act="del" data-id="${p.id}" title="Excluir">${icon('trash')}</button>`:''}
        </td></tr>`).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nome</th><th>Tipo</th><th>Telefone</th><th>Nascimento</th><th style="text-align:right">Ações</th></tr></thead>
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
      resetModalTabs('modal-pessoa');
      S.ed.pessoaId=null;S.ed.pessoaUA=null;
      $('#modal-pessoa-title').textContent='Nova pessoa';
      ['p-nome','p-tel','p-cpf','p-reg','p-diag'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      $('#p-tipo').value='Paciente';$('#p-nasc').value='';
      this._syncCampos();
      $$('#modal-pessoa .field').forEach(f=>f.classList.remove('has-error'));
      // Ocultar aba vínculos ao inserir
      const tabRel=$('#modal-pessoa .modal-tab[data-tab="relacao"]');
      if(tabRel)tabRel.style.display='none';
      ui.openModal('modal-pessoa');
    },
    async openEdit(id){
      let p=S.cadastros.find(x=>x.id===id);
      try{ const fr=await api.cadastroById(id); if(fr&&p)Object.assign(p,fr); else if(fr)p=fr; }catch{}
      if(!p)return;
      resetModalTabs('modal-pessoa');
      S.ed.pessoaId=id;S.ed.pessoaUA=p.updated_at;
      $('#modal-pessoa-title').textContent='Editar — '+p.nome;
      $('#p-nome').value=p.nome||'';$('#p-tipo').value=p.tipo||'Paciente';
      $('#p-nasc').value=(p.dt_nasc||'').slice(0,10);
      $('#p-tel').value=p.telefone||'';$('#p-cpf').value=p.cpf||'';
      $('#p-reg').value=p.registro_profissional||'';$('#p-diag').value=p.diagnostico||'';
      this._syncCampos();
      $$('#modal-pessoa .field').forEach(f=>f.classList.remove('has-error'));
      const tabRel=$('#modal-pessoa .modal-tab[data-tab="relacao"]');
      if(tabRel)tabRel.style.display='';
      ui.openModal('modal-pessoa');
      this._renderRelacoes(id,p.tipo);
    },
    _syncCampos(){
      const tipo=$('#p-tipo').value;
      const wd=$('#p-diag-wrap');if(wd)wd.style.display=tipo==='Paciente'?'':'none';
      const wr=$('#p-reg-wrap');if(wr)wr.style.display=tipo==='Terapeuta'?'':'none';
    },
    async openHistorico(id){
      const c=$('#historico-pessoa-body');c.innerHTML=ui.skeleton(4);
      const p=S.cadastros.find(x=>x.id===id);
      if(p){$('#modal-pessoa-title').textContent=p.nome||'Histórico';}
      const tabRel=$('#modal-pessoa .modal-tab[data-tab="relacao"]');
      if(tabRel)tabRel.style.display='';
      gotoModalTab('modal-pessoa','historico-pessoa');
      ui.openModal('modal-pessoa');
      try{ui.renderHistorico(c,await api.cadastroHist(id));}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    async openHistoricoDeletes(){
      const c=$('#historico-pessoa-body');c.innerHTML=ui.skeleton(4);
      const tabRel=$('#modal-pessoa .modal-tab[data-tab="relacao"]');
      if(tabRel)tabRel.style.display='none';
      $('#modal-pessoa-title').textContent='Cadastros excluídos';
      gotoModalTab('modal-pessoa','historico-pessoa');
      ui.openModal('modal-pessoa');
      try{ui.renderHistorico(c,await api.cadastroHistDel());}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    async _renderRelacoes(pessoaId,tipo){
      const container=$('#relacao-list'),addWrap=$('#relacao-add-wrap');
      const titleEl=$('#relacao-title'),descEl=$('#relacao-desc');
      container.innerHTML='<div class="spinner" style="margin:12px auto"></div>';
      if(addWrap)addWrap.style.display='none';
      try{
        const p=S.cadastros.find(x=>x.id===pessoaId);
        if(!p._relacoes){const r=await api.relacaoGet(pessoaId);if(p)p._relacoes=Array.isArray(r)?r:[];}
        const rels=p?._relacoes||[];
        if(tipo==='Paciente'){
          titleEl.textContent='Terapeutas vinculados';
          descEl.textContent='Este paciente só pode ter consultas com os terapeutas abaixo.';
          container.innerHTML=rels.length?rels.map(r=>`<div class="relacao-item">
            <span class="relacao-item__label">${icon('users',14)} ${esc(nomeCad(r.id_especialidade_terapeuta))}</span>
            ${temPerm(1,10,14)?`<button class="icon-btn icon-btn--danger" data-rid="${r.id}" title="Remover">${icon('trash',14)}</button>`:''}</div>`).join('')
            :'<p style="color:var(--fg-dim);font-size:13px;padding:8px 0">Nenhum terapeuta vinculado.</p>';
        }else{
          titleEl.textContent='Especialidades vinculadas';
          descEl.textContent='Este terapeuta só pode atender nas especialidades abaixo.';
          container.innerHTML=rels.length?rels.map(r=>`<div class="relacao-item">
            <span class="relacao-item__label">${corDot((S.especialidades.find(e=>e.id===r.id_especialidade_terapeuta)?.id_cor)||0)} ${esc(nomeEsp(r.id_especialidade_terapeuta))}</span>
            ${temPerm(1,10,14)?`<button class="icon-btn icon-btn--danger" data-rid="${r.id}" title="Remover">${icon('trash',14)}</button>`:''}</div>`).join('')
            :'<p style="color:var(--fg-dim);font-size:13px;padding:8px 0">Nenhuma especialidade vinculada.</p>';
        }
        if(addWrap)addWrap.style.display=temPerm(1,10,12)?'':'none';
        this._popularSelectRelacao(tipo,rels);
        container.querySelectorAll('[data-rid]').forEach(btn=>{
          btn.addEventListener('click',()=>{
            ui.confirm('Remover vínculo?','Esta ação não pode ser desfeita.',async()=>{
              try{
                await api.relacaoDel(parseInt(btn.dataset.rid,10));
                if(p)p._relacoes=p._relacoes.filter(r=>r.id!==+btn.dataset.rid);
                this._renderRelacoes(pessoaId,tipo);ui.success('Vínculo removido');
              }catch(err){ui.error('Erro',err.message);}
            });
          });
        });
      }catch(err){container.innerHTML=ui.errorState('Erro',err.message);}
    },
    _popularSelectRelacao(tipo,existentes){
      const selR=$('#relacao-select'),busca=$('#relacao-busca');
      const existentesIds=new Set(existentes.map(r=>r.id_especialidade_terapeuta));
      let lista=[];
      if(tipo==='Paciente'){
        lista=S.cadastros.filter(c=>c.tipo==='Terapeuta'&&!existentesIds.has(c.id));
        if(busca)busca.placeholder='Buscar terapeuta…';
      }else{
        lista=S.especialidades.filter(e=>e.inativo!=='S'&&!existentesIds.has(e.id));
        if(busca)busca.placeholder='Buscar especialidade…';
      }
      const render=(arr)=>{
        selR.innerHTML='<option value="">— selecione —</option>'+
          arr.map(x=>`<option value="${x.id}">${esc(x.nome||x.descricao)}</option>`).join('');
      };
      render(lista);
      if(busca){
        busca.value='';
        busca.oninput=()=>{
          const q=busca.value.toLowerCase();
          render(lista.filter(x=>(x.nome||x.descricao||'').toLowerCase().includes(q)));
        };
      }
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
      if(!['Paciente','Terapeuta'].includes(tipo))ok=false;
      if(!ok)return;
      const btn=$('#btn-salvar-pessoa');btn.setAttribute('aria-busy','true');
      try{
        const body={
          nome,tipo,telefone:tel||null,dt_nasc:nasc||null,
          registro_profissional:tipo==='Terapeuta'?(reg||null):null,
          cpf:cpfRaw||null,
          diagnostico:tipo==='Paciente'?(diag||null):null,
        };
        if(S.ed.pessoaId){
          body.campos={...body};body.updatedAt=S.ed.pessoaUA;
          await api.cadastroPut(S.ed.pessoaId,body);
          const idx=S.cadastros.findIndex(c=>c.id===S.ed.pessoaId);
          if(idx>=0)Object.assign(S.cadastros[idx],{nome,tipo,telefone:tel,dt_nasc:nasc,cpf:cpfRaw,registro_profissional:reg,diagnostico:diag});
          ui.success('Cadastro atualizado');
        }else{
          await api.cadastroPost(body);
          await pages.pessoas.load({silent:true});
          ui.success('Cadastro criado');
        }
        ui.closeModal('modal-pessoa');this.renderTable();pages.dashboard.render();
      }catch(err){
        if(err.message.includes('409')||err.message.toLowerCase().includes('desatualizado')){
          ui.warning('Registro desatualizado','Recarregando…');
          await pages.pessoas.load({silent:true});
          ui.info('Dados atualizados','Tente editar novamente.');
        }else ui.error('Erro ao salvar',err.message);
      }
      finally{btn.removeAttribute('aria-busy');}
    },
    excluir(id){
      const p=S.cadastros.find(x=>x.id===id);
      ui.confirm(`Excluir "${p?.nome||id}"?`,'Esta ação não pode ser desfeita.',async()=>{
        try{await api.cadastroDel(id);S.cadastros=S.cadastros.filter(c=>c.id!==id);this.renderTable();pages.dashboard.render();ui.success('Excluído');}
        catch(err){ui.error('Erro',err.message);}
      });
    },
    init(){
      $('#btn-reload-pessoas').addEventListener('click',()=>this.load());
      $('#btn-new-pessoa').addEventListener('click',()=>this.openNew());
      $('#btn-hist-del-pessoas').addEventListener('click',()=>this.openHistoricoDeletes());
      $('#search-pessoas').addEventListener('input',debounce(()=>this.renderTable(),180));
      $('#p-tipo').addEventListener('change',()=>this._syncCampos());
      $('#p-cpf').addEventListener('input',e=>{e.target.value=maskCPF(e.target.value);});
      $('#p-tel').addEventListener('input',e=>{e.target.value=maskTel(e.target.value);});
      $('#form-pessoa').addEventListener('submit',e=>this.savePessoa(e));
      $('#btn-add-relacao').addEventListener('click',async()=>{
        const id=parseInt($('#relacao-select').value,10)||null;
        const pessoaId=S.ed.pessoaId;
        const p=S.cadastros.find(x=>x.id===pessoaId);
        if(!id||!pessoaId){ui.warning('Selecione','Escolha um item antes de adicionar.');return;}
        const btn=$('#btn-add-relacao');btn.setAttribute('aria-busy','true');
        try{
          await api.relacaoPost({idCadastro:pessoaId,idRelacao:id});
          const r=await api.relacaoGet(pessoaId);if(p)p._relacoes=Array.isArray(r)?r:[];
          this._renderRelacoes(pessoaId,p?.tipo||'Paciente');ui.success('Vínculo adicionado');
        }catch(err){ui.error('Erro',err.message);}
        finally{btn.removeAttribute('aria-busy');}
      });
      $$('.tabs .tab').forEach(tab=>{
        tab.addEventListener('click',()=>{
          $$('.tabs .tab').forEach(t=>t.classList.remove('tab--active'));
          tab.classList.add('tab--active');S.cadastrosFilter=tab.dataset.filter;this.renderTable();
        });
      });
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
        pages.dashboard.render();
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
          ?ui.emptyState('heart-pulse','Nenhuma especialidade','Adicione a primeira no formulário acima.')
          :ui.emptyState('search','Nada encontrado','Ajuste a busca.');
        return;
      }
      const pE=temPerm(1,30,33),pX=temPerm(1,30,34),pH=temPerm(1,30,35);
      const rows=list.map(e=>{
        const cor=COR_GOOGLE[e.id_cor||0];
        return `<tr>
          <td><div style="font-weight:500">${esc(e.descricao)}</div></td>
          <td><span style="display:inline-flex;align-items:center;gap:8px">${corDot(e.id_cor||0)} <span style="font-size:12px;color:var(--fg-dim)">${esc(NOME_COR[e.id_cor||0])}</span></span></td>
          <td><span class="badge badge--${e.inativo==='S'?'warning':'success'}">${e.inativo==='S'?'Inativo':'Ativo'}</span></td>
          <td class="td-actions">
            ${pE?`<button class="icon-btn" data-act="edit" data-id="${e.id}" title="Editar">${icon('edit')}</button>`:''}
            ${pH?`<button class="icon-btn" data-act="hist" data-id="${e.id}" title="Histórico">${icon('history')}</button>`:''}
            ${pX?`<button class="icon-btn icon-btn--danger" data-act="del" data-id="${e.id}" title="Excluir">${icon('trash')}</button>`:''}
          </td></tr>`;
      }).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Descrição</th><th>Cor Google Agenda</th><th>Status</th><th style="text-align:right">Ações</th></tr></thead>
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
      resetModalTabs('modal-especialidade');
      S.ed.espId=null;S.ed.espUA=null;
      $('#modal-esp-title').textContent='Nova especialidade';
      $('#esp-descricao').value='';$('#esp-cor').value=0;$('#esp-inativo').value='N';
      $$('#form-especialidade .field').forEach(f=>f.classList.remove('has-error'));
      // Esconde aba histórico ao inserir
      const tabH=$('#modal-especialidade .modal-tab[data-tab="esp-historico"]');
      if(tabH)tabH.style.display='none';
      ui.openModal('modal-especialidade');
    },
    openEdit(id){
      const e=S.especialidades.find(x=>x.id===id);if(!e)return;
      resetModalTabs('modal-especialidade');
      S.ed.espId=id;S.ed.espUA=e.updated_at;
      $('#modal-esp-title').textContent='Editar — '+e.descricao;
      $('#esp-descricao').value=e.descricao||'';
      $('#esp-cor').value=e.id_cor||0;$('#esp-inativo').value=e.inativo||'N';
      $$('#form-especialidade .field').forEach(f=>f.classList.remove('has-error'));
      const tabH=$('#modal-especialidade .modal-tab[data-tab="esp-historico"]');
      if(tabH)tabH.style.display='';
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
      gotoModalTab('modal-especialidade','esp-historico');
      ui.openModal('modal-especialidade');
      try{ui.renderHistorico(c,await api.espHistDel());}
      catch(err){c.innerHTML=ui.errorState('Erro',err.message);}
    },
    async saveEsp(e){
      e.preventDefault();
      const desc=$('#esp-descricao').value.trim();
      fieldErr($('#esp-descricao'),!desc);if(!desc)return;
      const id_cor=parseInt($('#esp-cor').value,10)||0;
      const inativo=S.ed.espId?($('#esp-inativo').value):'N';
      const btn=$('#form-especialidade .btn--primary');btn.setAttribute('aria-busy','true');
      try{
        if(S.ed.espId){
          await api.espPut(S.ed.espId,{campos:{descricao:desc,inativo,id_cor},updatedAt:S.ed.espUA});
          const idx=S.especialidades.findIndex(x=>x.id===S.ed.espId);
          if(idx>=0)Object.assign(S.especialidades[idx],{descricao:desc,inativo,id_cor});
          ui.success('Atualizada');
        }else{
          await api.espPost({descricao:desc,inativo:'N',id_cor});
          await this.load({silent:true});
          ui.success('Especialidade criada');
        }
        ui.closeModal('modal-especialidade');this.renderTable();
      }catch(err){
        if(err.message.includes('409')||err.message.toLowerCase().includes('desatualizado')){
          ui.warning('Registro desatualizado','Recarregando…');
          await this.load({silent:true});ui.info('Dados atualizados','Tente editar novamente.');
        }else ui.error('Erro',err.message);
      }
      finally{btn.removeAttribute('aria-busy');}
    },
    excluir(id){
      const e=S.especialidades.find(x=>x.id===id);
      ui.confirm(`Remover "${e?.descricao||id}"?`,'Esta ação não pode ser desfeita.',async()=>{
        try{await api.espDel(id);S.especialidades=S.especialidades.filter(x=>x.id!==id);this.renderTable();pages.dashboard.render();ui.success('Removida');}
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
  pages.usuarios = {
    render(){this.renderTable();},
    async load({silent=false}={}){
      if(!S.token||!temPerm(1,2))return;
      try{const data=await api.usuariosGet();S.usuarios=Array.isArray(data)?data:[];if(S.currentPage==='usuarios')this.renderTable();}
      catch(err){if(!silent)ui.error('Erro',err.message);}
    },
    async loadPerms({silent=false}={}){
      if(!temPerm(1,2))return;
      try{const data=await api.permsGet();S.todasPerms=Array.isArray(data)?data:[];}
      catch(err){if(!silent)ui.error('Erro',err.message);}
    },
    renderTable(){
      const body=$('#usuarios-body'),cnt=$('#count-usuarios');
      const q=($('#search-usuarios').value||'').toLowerCase();
      const list=S.usuarios.filter(u=>!q||u.nome?.toLowerCase().includes(q));
      if(cnt)cnt.textContent=`${list.length} registro${list.length===1?'':'s'}`;
      if(!list.length){body.innerHTML=ui.emptyState('users','Nenhum usuário','Adicione o primeiro.');return;}
      const rows=list.map(u=>`<tr>
        <td><div style="font-weight:500">${esc(u.nome)}</div></td>
        <td class="td-actions">
          <button class="icon-btn" data-act="edit" data-id="${u.id}" title="Editar">${icon('edit')}</button>
          <button class="icon-btn" data-act="perm" data-id="${u.id}" title="Permissões">${icon('shield')}</button>
          <button class="icon-btn" data-act="senha" data-id="${u.id}" title="Alterar senha">${icon('key')}</button>
        </td></tr>`).join('');
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nome</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
      body.querySelectorAll('[data-act]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const id=parseInt(btn.dataset.id,10),ac=btn.dataset.act;
          if(ac==='edit')this.openEdit(id);
          else if(ac==='perm'){this.openEdit(id);setTimeout(()=>gotoModalTab('modal-usuario','usr-permissoes'),80);}
          else if(ac==='senha'){this.openEdit(id);setTimeout(()=>gotoModalTab('modal-usuario','usr-senha'),80);}
        });
      });
    },
    openNew(){
      resetModalTabs('modal-usuario');
      S.ed.usuarioId=null;S.ed.usuarioUA=null;
      $('#modal-usuario-title').textContent='Novo usuário';
      ['u-nome','u-login','u-senha','u-senha2'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      $('#u-login-wrap').style.display='';$('#u-senha-wrap').style.display='';
      $$('#tab-usr-dados .field').forEach(f=>f.classList.remove('has-error'));
      ui.openModal('modal-usuario');
    },
    openEdit(id){
      const u=S.usuarios.find(x=>x.id===id);if(!u)return;
      resetModalTabs('modal-usuario');
      S.ed.usuarioId=id;S.ed.usuarioUA=u.updated_at;
      $('#modal-usuario-title').textContent='Editar — '+u.nome;
      $('#u-nome').value=u.nome||'';
      $('#u-login-wrap').style.display='none';$('#u-senha-wrap').style.display='none';
      $$('#tab-usr-dados .field').forEach(f=>f.classList.remove('has-error'));
      const editandoSiMesmo=S.userId===id;
      const wrap=$('#u-senha-atual-wrap');if(wrap)wrap.style.display=editandoSiMesmo?'':'none';
      ui.openModal('modal-usuario');
      this._loadPermsUsuario(id);this._loadHistPerms(id);
    },
    async _loadPermsUsuario(userId){
      const container=$('#usr-perms-list'),selP=$('#usr-perm-select');
      container.innerHTML='<div class="spinner" style="margin:10px auto"></div>';
      try{
        const perms=await api.permsUser(userId);
        const ids=perms.map(p=>p.id_permissao);
        container.innerHTML=perms.length?perms.map(p=>{
          const info=PERMS_MAP[p.id_permissao]||{label:`Permissão #${p.id_permissao}`};
          return `<div class="perm-tag">
            <div><div class="perm-tag__name">${esc(info.label)}</div><div class="perm-tag__tipo">ID ${p.id_permissao}</div></div>
            <button class="icon-btn icon-btn--danger" data-prid="${p.id}" title="Remover">${icon('trash',13)}</button>
          </div>`;
        }).join(''):'<p style="color:var(--fg-dim);font-size:13px">Nenhuma permissão.</p>';
        container.querySelectorAll('[data-prid]').forEach(btn=>{
          btn.addEventListener('click',()=>{
            ui.confirm('Remover permissão?','A sessão do usuário será encerrada.',async()=>{
              try{await api.permDel({idPermissao:parseInt(btn.dataset.prid,10)});this._loadPermsUsuario(userId);ui.success('Permissão removida');}
              catch(err){ui.error('Erro',err.message);}
            });
          });
        });
        const disp=S.todasPerms.filter(p=>!ids.includes(p.id));
        selP.innerHTML='<option value="">— selecione —</option>'+disp.map(p=>{
          const info=PERMS_MAP[p.id]||{label:p.descricao||`#${p.id}`};
          return `<option value="${p.id}">${esc(info.label)}</option>`;
        }).join('');
      }catch(err){container.innerHTML=ui.errorState('Erro',err.message);}
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
      fieldErr($('#u-nome'),nomeInvalido);if(nomeInvalido)return;
      if(!S.ed.usuarioId){
        const login=$('#u-login').value.trim(),senha=$('#u-senha').value,senha2=$('#u-senha2').value;
        let ok=true;
        const loginInv=!/^[a-zA-Z0-9._@\-]{3,64}$/.test(login);
        fieldErr($('#u-login'),loginInv);if(loginInv)ok=false;
        const senhaInv=senha.length<8||senha.length>60;
        fieldErr($('#u-senha'),senhaInv);if(senhaInv)ok=false;
        const senhasDiff=senha!==senha2;
        fieldErr($('#u-senha2'),senhasDiff);if(senhasDiff)ok=false;
        if(!ok)return;
        const btn=$('#btn-salvar-usuario');btn.setAttribute('aria-busy','true');
        try{await api.usuarioPost({login,senha,nome});await this.load({silent:true});ui.closeModal('modal-usuario');this.renderTable();ui.success('Usuário criado');}
        catch(err){ui.error('Erro',err.message);}
        finally{btn.removeAttribute('aria-busy');}
      }else{
        const btn=$('#btn-salvar-usuario');btn.setAttribute('aria-busy','true');
        try{
          await api.usuarioNome({usuario:S.ed.usuarioId,novonome:nome,updatedAt:S.ed.usuarioUA});
          const idx=S.usuarios.findIndex(u=>u.id===S.ed.usuarioId);if(idx>=0)S.usuarios[idx].nome=nome;
          ui.closeModal('modal-usuario');this.renderTable();ui.success('Nome atualizado');
        }catch(err){ui.error('Erro',err.message);}
        finally{btn.removeAttribute('aria-busy');}
      }
    },
    async alterarSenha(e){
      e.preventDefault();
      const senhaAtual=$('#u-senha-atual').value;
      const novaSenha=$('#u-nova-senha').value,novaSenha2=$('#u-nova-senha2').value;
      let ok=true;
      const s1inv=novaSenha.length<8||novaSenha.length>60;
      fieldErr($('#u-nova-senha'),s1inv);if(s1inv)ok=false;
      const s2inv=novaSenha!==novaSenha2;
      fieldErr($('#u-nova-senha2'),s2inv);if(s2inv)ok=false;
      if(!ok)return;
      const btn=$('#form-alterar-senha .btn--primary');btn.setAttribute('aria-busy','true');
      try{
        await api.usuarioSenha({senhaAtual,novaSenha,updatedAt:S.ed.usuarioUA});
        ui.closeModal('modal-usuario');ui.success('Senha alterada','Faça login novamente.');
        auth.logout({silent:true});auth.showLogin();
      }catch(err){ui.error('Erro',err.message);}
      finally{btn.removeAttribute('aria-busy');}
    },
    init(){
      $('#btn-reload-usuarios').addEventListener('click',()=>this.load());
      $('#btn-new-usuario').addEventListener('click',()=>this.openNew());
      $('#search-usuarios').addEventListener('input',debounce(()=>this.renderTable(),180));
      $('#form-usuario').addEventListener('submit',e=>this.saveUsuario(e));
      $('#form-alterar-senha').addEventListener('submit',e=>this.alterarSenha(e));
      $('#btn-add-perm').addEventListener('click',async()=>{
        const permId=parseInt($('#usr-perm-select').value,10)||null;
        if(!permId||!S.ed.usuarioId){ui.warning('Selecione uma permissão.');return;}
        const btn=$('#btn-add-perm');btn.setAttribute('aria-busy','true');
        try{await api.permAdd({usuario:S.ed.usuarioId,permissao:permId});this._loadPermsUsuario(S.ed.usuarioId);ui.success('Permissão adicionada');}
        catch(err){ui.error('Erro',err.message);}
        finally{btn.removeAttribute('aria-busy');}
      });
    },
  };

  /* Relatórios */
  pages.relatorios = {
    render(){this.populate();this.renderTable();},
    populate(){
      const pac=S.cadastros.filter(p=>p.tipo==='Paciente');
      const ter=S.cadastros.filter(p=>p.tipo==='Terapeuta');
      const fill=(sel,list,lk,vk,ph)=>{
        const cur=$(sel).value;
        $(sel).innerHTML=`<option value="">${ph}</option>`+list.map(v=>`<option value="${esc(String(v[vk]))}" ${String(v[vk])===cur?'selected':''}>${esc(v[lk])}</option>`).join('');
      };
      fill('#filter-paciente',pac,'nome','nome','Todos');
      fill('#filter-terapeuta',ter,'nome','nome','Todos');
      fill('#filter-especialidade',S.especialidades,'descricao','descricao','Todas');
    },
    filtered(){
      const f={pac:$('#filter-paciente').value,ter:$('#filter-terapeuta').value,
        esp:$('#filter-especialidade').value,di:$('#filter-di').value,df:$('#filter-df').value};
      return S.consultas.filter(c=>{
        const d=(c.data_hora||'').slice(0,10);
        if(f.pac&&c.paciente!==f.pac)return false;
        if(f.ter&&c.terapeuta!==f.ter)return false;
        if(f.esp&&c.especialidade!==f.esp)return false;
        if(f.di&&d<f.di)return false;
        if(f.df&&d>f.df)return false;
        return true;
      });
    },
    renderTable(){
      const body=$('#relatorio-body'),cnt=$('#count-relatorio');
      const list=this.filtered();
      cnt.textContent=`${list.length} registro${list.length===1?'':'s'}`;
      if(!list.length){body.innerHTML=ui.emptyState('clipboard','Sem resultados','Ajuste os filtros.');return;}
      body.innerHTML=`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Data/Hora</th><th>Paciente</th><th>Terapeuta</th><th>Especialidade</th></tr></thead>
        <tbody>${list.map(c=>`<tr>
          <td class="td-date">${esc(formatDateBR(c.data_hora))}</td>
          <td>${esc(c.paciente||'—')}</td><td>${esc(c.terapeuta||'—')}</td>
          <td><span class="badge badge--accent">${esc(c.especialidade||'—')}</span></td>
        </tr>`).join('')}</tbody></table></div>`;
    },
    exportCsv(){
      const list=this.filtered();if(!list.length){ui.warning('Sem dados');return;}
      const hdr=['Data/Hora','Paciente','Terapeuta','Especialidade'];
      const csv=[hdr,...list.map(c=>[c.data_hora||'',c.paciente||'',c.terapeuta||'',c.especialidade||''])]
        .map(r=>r.map(cell=>{const s=String(cell??'');return/[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`  :s;}).join(';')).join('\n');
      const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=`vindix-${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
      ui.success('CSV exportado',`${list.length} registro(s).`);
    },
    init(){
      ['#filter-paciente','#filter-terapeuta','#filter-especialidade','#filter-di','#filter-df']
        .forEach(sel=>$(sel).addEventListener('change',()=>this.renderTable()));
      $('#btn-clear-filter').addEventListener('click',()=>setTimeout(()=>this.renderTable(),10));
      $('#btn-export').addEventListener('click',()=>this.exportCsv());
      $('#btn-print').addEventListener('click',()=>{if(!this.filtered().length){ui.warning('Sem dados');return;}window.print();});
    },
  };

  /* BOOT */
  function boot(){
    document.body.dataset.loading='false';
    ['modal-pessoa','modal-consulta','modal-especialidade','modal-usuario'].forEach(initModalTabs);
    auth.init();nav.init();
    pages.consultas.init();pages.pessoas.init();
    pages.especialidades.init();pages.usuarios.init();pages.relatorios.init();
    $('#btn-connect-google').addEventListener('click',()=>google.handleBotao());
    $('#btn-refresh-dash').addEventListener('click',async()=>{
      await Promise.allSettled([
        pages.consultas.load({silent:true}),
        pages.pessoas.load({silent:true}),
        pages.especialidades.load({silent:true}),
      ]);
      pages.dashboard.render();
    });
    // Fecha modais via backdrop ou [data-modal-close] — garante que o clique no ícone X também funcione
    document.addEventListener('click',e=>{
      const closeTarget=e.target.closest('[data-modal-close]');
      if(closeTarget){
        const m=closeTarget.closest('.modal');if(m)m.classList.remove('is-open');
      }
    });
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'){ui.closeAllModals();nav.closeSidebarMobile();}
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
  else boot();
})();
