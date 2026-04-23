/* ===============================================================
   VINDIX — Front-end Application
   Arquitetura modular (IIFE) em Vanilla JS (ES6+)
   Seções:
     1. CONFIG        — constantes e endpoints
     2. STATE         — estado global
     3. API           — camada de comunicação com backend
     4. UTILS         — helpers (escape, date, debounce…)
     5. UI            — toast, modal, loading
     6. AUTH          — login/logout
     7. NAV           — navegação entre páginas
     8. PAGES         — lógica de cada tela
     9. BOOT          — bootstrap da aplicação
   =============================================================== */

(() => {
  'use strict';

  /* ============================================================
     1. CONFIG
  ============================================================ */
  const CONFIG = {
    API_BASE:      'http://localhost:8080',
    TOKEN_KEY:     'vindix:token',
    USER_KEY:      'vindix:user',
    PERMS_KEY:     'vindix:perms',
    TOAST_TIMEOUT: 4000,
  };

  /*
    Rotas do backend (server.js):

    POST   /login                         — sem auth
    GET    /health                        — sem auth

    GET    /usuarios                      — perm 1, 2
    POST   /usuarios                      — perm 1, 2
    PUT    /usuarios/nome                 — perm 1, 2
    PUT    /usuarios/senha                — perm 1, 2
    GET    /usuarios/permissoes           — perm 1, 2
    POST   /usuarios/permissoes           — perm 1, 2
    DELETE /usuarios/permissoes           — perm 1, 2

    GET    /permissoes                    — perm 1, 2

    GET    /cadastros                     — perm 1, 10, 11
    GET    /consultas                     — perm 1, 20, 21
    GET    /especialidade                 — perm 1, 30, 31

    GET    /google/status                 — perm 1
    GET    /google/conectar               — perm 1  (redireciona para OAuth — abre popup)
    GET    /google/callback               — sem auth (callback do OAuth)
    POST   /google/evento                 — perm 1, 26
    DELETE /google/conectar               — perm 1
  */
  const ENDPOINTS = {
    login:              '/login',
    health:             '/health',

    usuarios:           '/usuarios',
    usuariosNome:       '/usuarios/nome',
    usuariosSenha:      '/usuarios/senha',
    usuariosPermissoes: '/usuarios/permissoes',

    permissoes:         '/permissoes',

    cadastros:          '/cadastros',
    consultas:          '/consultas',
    especialidade:      '/especialidade',

    googleStatus:       '/google/status',
    googleConectar:     '/google/conectar',
    googleEvento:       '/google/evento',
  };

  /* ============================================================
     2. STATE
  ============================================================ */
  const state = {
    token:          null,
    userName:       '',
    permissoes:     [],   // array de IDs vindos do JWT: [1, 20, 21, ...]
    currentPage:    'dashboard',

    // dados carregados do backend
    cadastros:      [],   // GET /cadastros
    consultas:      [],   // GET /consultas
    especialidades: [],   // GET /especialidade

    // controle de UI
    cadastrosFilter: 'all',
    editing: { pessoaId: null, evolucaoId: null },

    // cache de paginação
    paginacao: {
      cadastros:  { pagina: 1, por_pagina: 50, fim: false },
      consultas:  { pagina: 1, por_pagina: 50, fim: false },
    },
  };

  /* ============================================================
     3. API — todas as chamadas passam por aqui
  ============================================================ */
  const api = {
    /*
      Método base para todas as requisições autenticadas.
      Injeta o header Authorization: Bearer <token> automaticamente.
    */
    async req(method, path, body = null) {
      const headers = { 'Content-Type': 'application/json' };
      if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
      }
      const opts = { method, headers };
      if (body !== null) opts.body = JSON.stringify(body);

      const res = await fetch(`${CONFIG.API_BASE}${path}`, opts);

      // sessão expirada ou invalidada
      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        // token inválido ou sessão encerrada — força logout silencioso
        if (res.status === 401) {
          auth.logout({ silent: true });
        }
        throw new Error(data.erro || `Erro HTTP ${res.status}`);
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.erro || `Erro HTTP ${res.status}`);
      }

      // 204 No Content
      if (res.status === 204) return null;
      return res.json();
    },

    // POST /login — { usuario, senha } → { token, nome, permissoes[] }
    async login(usuario, senha) {
      const res = await fetch(`${CONFIG.API_BASE}${ENDPOINTS.login}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ usuario, senha }),
      });
      if (res.status === 429) {
        throw new Error('Muitas tentativas. Aguarde 15 minutos.');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || `Erro HTTP ${res.status}`);
      return data;
    },

    // GET /cadastros?pagina=N&por_pagina=50  — perm 1, 10, 11
    async cadastros(pagina = 1, por_pagina = 50) {
      return this.req('GET', `${ENDPOINTS.cadastros}?pagina=${pagina}&por_pagina=${por_pagina}`);
    },

    // GET /consultas?pagina=N&por_pagina=50  — perm 1, 20, 21
    async consultas(pagina = 1, por_pagina = 50) {
      return this.req('GET', `${ENDPOINTS.consultas}?pagina=${pagina}&por_pagina=${por_pagina}`);
    },

    // GET /especialidade  — perm 1, 30, 31
    async especialidade() {
      return this.req('GET', ENDPOINTS.especialidade);
    },

    // GET /google/status  — perm 1  → { conectado: bool }
    async googleStatus() {
      return this.req('GET', ENDPOINTS.googleStatus);
    },

    /*
      GET /google/conectar  — perm 1
      O backend faz redirect para o OAuth do Google.
      Abrimos em popup; o callback fecha a janela automaticamente.
      Token precisa ir via query param pois é redirect do browser,
      não uma fetch com header.
    */
    googleConectar() {
      const url = `${CONFIG.API_BASE}${ENDPOINTS.googleConectar}?token=${encodeURIComponent(state.token)}`;
      const popup = window.open(url, 'google-oauth', 'width=500,height=650,noopener');
      if (!popup) {
        ui.warning('Popup bloqueado', 'Permita popups para este site e tente novamente.');
      }
    },

    // DELETE /google/conectar  — perm 1
    async googleDesconectar() {
      return this.req('DELETE', ENDPOINTS.googleConectar);
    },

    // POST /google/evento  — { consulta: id }  — perm 1, 26
    async googleEvento(idConsulta) {
      return this.req('POST', ENDPOINTS.googleEvento, { consulta: idConsulta });
    },
  };

  /* ============================================================
     4. UTILS
  ============================================================ */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // cria elemento DOM programaticamente
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
    });
    children.flat().forEach(c => {
      if (c == null || c === false) return;
      node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  // escapa HTML para evitar XSS
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icon(id, size = 16) {
    return `<svg class="icon" aria-hidden="true" style="width:${size}px;height:${size}px"><use href="#i-${id}"></use></svg>`;
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  }

  function debounce(fn, wait = 200) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  // formata ISO → DD/MM/YYYY HH:MM  ou  DD/MM/YYYY
  function formatDateBR(s) {
    if (!s) return '—';
    const iso = /^\d{4}-\d{2}-\d{2}/.test(s);
    if (iso) {
      const [d, t] = s.split(/[T\s]/);
      const [Y, M, D] = d.split('-');
      const hh = t ? ` ${t.slice(0, 5)}` : '';
      return `${D}/${M}/${Y}${hh}`;
    }
    return s;
  }

  function formatDateISOToLongBR(s) {
    if (!s) return '—';
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    try {
      const date = new Date(s.slice(0, 10) + 'T00:00:00');
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return s; }
  }

  function animateCounter(element, target, duration = 900) {
    if (!element) return;
    const start = parseInt(element.textContent.replace(/\D/g, ''), 10) || 0;
    if (start === target) { element.textContent = target; return; }
    const diff = target - start;
    const t0 = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      element.textContent = Math.round(start + diff * eased);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // verifica se o usuário tem ao menos uma das permissões exigidas
  function temPermissao(...ids) {
    return ids.some(id => state.permissoes.includes(id));
  }

  /* ============================================================
     5. UI — toast, modal, loading
  ============================================================ */
  const ui = {
    toast(type, title, msg) {
      const container = $('#toasts');
      if (!container) return;
      const iconId = ({ success: 'check', error: 'alert', warning: 'alert', info: 'info' })[type] || 'info';
      const t = el('div', { class: `toast toast--${type}`, role: 'status' });
      t.innerHTML = `
        <div class="toast__icon">${icon(iconId, 16)}</div>
        <div class="toast__body">
          <div class="toast__title">${esc(title)}</div>
          ${msg ? `<div class="toast__msg">${esc(msg)}</div>` : ''}
        </div>
        <button class="toast__close" aria-label="Fechar">${icon('close', 14)}</button>
      `;
      container.appendChild(t);
      const close = () => {
        t.classList.add('toast--closing');
        setTimeout(() => t.remove(), 200);
      };
      t.querySelector('.toast__close').addEventListener('click', close);
      setTimeout(close, CONFIG.TOAST_TIMEOUT);
    },

    success(title, msg) { this.toast('success', title, msg); },
    error(title, msg)   { this.toast('error',   title, msg); },
    warning(title, msg) { this.toast('warning', title, msg); },
    info(title, msg)    { this.toast('info',    title, msg); },

    openModal(id) {
      const modal = document.getElementById(id);
      if (!modal) return;
      modal.classList.add('is-open');
      const firstInput = modal.querySelector('input:not([disabled]), select, textarea, button');
      if (firstInput) setTimeout(() => firstInput.focus(), 50);
    },
    closeModal(id) {
      document.getElementById(id)?.classList.remove('is-open');
    },
    closeAllModals() {
      $$('.modal.is-open').forEach(m => m.classList.remove('is-open'));
    },

    confirm(title, msg, onOk) {
      $('#confirm-title').textContent = title;
      $('#confirm-msg').textContent   = msg;
      const btn = $('#confirm-ok');
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', () => {
        this.closeModal('modal-confirm');
        onOk && onOk();
      });
      this.openModal('modal-confirm');
    },

    skeleton(rows = 5) {
      let html = '<div class="skeleton-rows">';
      for (let i = 0; i < rows; i++) {
        const w = 30 + Math.random() * 60;
        html += `
          <div class="sk-row">
            <div class="sk-bar" style="width:60px"></div>
            <div class="sk-bar" style="width:${w}%"></div>
            <div class="sk-bar" style="width:90px"></div>
          </div>`;
      }
      html += '</div>';
      return html;
    },

    emptyState(iconId, title, msg) {
      return `
        <div class="state state--empty">
          <div class="state__icon">${icon(iconId, 24)}</div>
          <h4>${esc(title)}</h4>
          <p>${esc(msg || '')}</p>
        </div>`;
    },

    errorState(title, msg) {
      return `
        <div class="state state--error">
          <div class="state__icon">${icon('alert', 24)}</div>
          <h4>${esc(title)}</h4>
          <p>${esc(msg || '')}</p>
        </div>`;
    },

    loadingState(msg = 'Carregando…') {
      return `
        <div class="state">
          <div class="spinner"></div>
          <p>${esc(msg)}</p>
        </div>`;
    },
  };

  /* ============================================================
     6. AUTH
  ============================================================ */
  const auth = {
    init() {
      // restaura sessão persistida
      const token = localStorage.getItem(CONFIG.TOKEN_KEY);
      const user  = localStorage.getItem(CONFIG.USER_KEY);
      const perms = localStorage.getItem(CONFIG.PERMS_KEY);

      if (token && user) {
        state.token     = token;
        state.userName  = user;
        state.permissoes = perms ? JSON.parse(perms) : [];
        this.enterApp();
      } else {
        this.showLogin();
      }

      $('#form-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleLogin();
      });

      $('#btn-toggle-pass').addEventListener('click', () => {
        const i = $('#input-pass');
        const isPass = i.type === 'password';
        i.type = isPass ? 'text' : 'password';
        $('#btn-toggle-pass use').setAttribute('href', isPass ? '#i-eye-off' : '#i-eye');
        $('#btn-toggle-pass').setAttribute('aria-label', isPass ? 'Ocultar senha' : 'Mostrar senha');
      });

      $('#btn-logout').addEventListener('click', () => {
        ui.confirm('Sair do sistema?', 'Você precisará fazer login novamente para acessar.', () => this.logout());
      });
    },

    async handleLogin() {
      const btn     = $('#btn-login');
      const usuario = $('#input-user').value.trim();
      const senha   = $('#input-pass').value;

      if (!usuario || !senha) {
        ui.error('Campos obrigatórios', 'Preencha usuário e senha.');
        return;
      }

      btn.setAttribute('aria-busy', 'true');
      btn.querySelector('.btn__label').textContent = 'Verificando';

      try {
        /*
          POST /login
          Body: { usuario, senha }
          Retorna: { token, nome, permissoes[] }
        */
        const data = await api.login(usuario, senha);

        state.token      = data.token;
        state.userName   = data.nome || usuario;
        state.permissoes = Array.isArray(data.permissoes) ? data.permissoes : [];

        localStorage.setItem(CONFIG.TOKEN_KEY, state.token);
        localStorage.setItem(CONFIG.USER_KEY,  state.userName);
        localStorage.setItem(CONFIG.PERMS_KEY, JSON.stringify(state.permissoes));

        ui.success('Bem-vindo!', `Olá, ${state.userName}.`);
        this.enterApp();

      } catch (err) {
        ui.error('Falha no login', err.message || 'Não foi possível conectar ao backend.');
      } finally {
        btn.removeAttribute('aria-busy');
        btn.querySelector('.btn__label').textContent = 'Entrar';
      }
    },

    enterApp() {
      $('#screen-login').classList.remove('screen--active');
      $('#screen-app').classList.add('screen--active');
      document.body.style.overflow = 'hidden';

      $('#user-name').textContent   = state.userName;
      $('#user-avatar').textContent = initials(state.userName);

      // esconde itens de nav sem permissão
      this.applyNavPermissoes();

      nav.goto(state.currentPage);

      // carrega dados base em background após login
      this.carregarDadosIniciais();

      // verifica status do Google
      google.verificarStatus();
    },

    async carregarDadosIniciais() {
      // Carrega os dados que alimentam múltiplas telas.
      // Erros silenciosos — cada página exibe seu próprio estado de erro ao renderizar.
      await Promise.allSettled([
        temPermissao(1, 10, 11) ? pages.pessoas.load({ silent: true }) : Promise.resolve(),
        temPermissao(1, 20, 21) ? pages.consultas.load({ silent: true }) : Promise.resolve(),
        temPermissao(1, 30, 31) ? pages.especialidades.load({ silent: true }) : Promise.resolve(),
      ]);
    },

    applyNavPermissoes() {
      // Oculta botões de nav para os quais o usuário não tem permissão
      const regras = [
        { page: 'consultas',      perms: [1, 20, 21] },
        { page: 'pessoas',        perms: [1, 10, 11] },
        { page: 'especialidades', perms: [1, 30, 31] },
      ];
      regras.forEach(({ page, perms }) => {
        const btn = $(`.nav__item[data-page="${page}"]`);
        if (btn) btn.style.display = temPermissao(...perms) ? '' : 'none';
      });

      // botão do Google só aparece para perm 1
      const btnGoogle = $('#btn-connect-google');
      if (btnGoogle) btnGoogle.style.display = temPermissao(1) ? '' : 'none';
    },

    showLogin() {
      $('#screen-login').classList.add('screen--active');
      $('#screen-app').classList.remove('screen--active');
      $('#input-user').value = '';
      $('#input-pass').value = '';
    },

    logout({ silent = false } = {}) {
      state.token      = null;
      state.userName   = '';
      state.permissoes = [];
      state.cadastros  = [];
      state.consultas  = [];
      state.especialidades = [];
      localStorage.removeItem(CONFIG.TOKEN_KEY);
      localStorage.removeItem(CONFIG.USER_KEY);
      localStorage.removeItem(CONFIG.PERMS_KEY);
      if (!silent) ui.info('Sessão encerrada', 'Até logo!');
      this.showLogin();
    },
  };

  /* ============================================================
     Google — status e conexão
  ============================================================ */
  const google = {
    async verificarStatus() {
      if (!temPermissao(1)) return;
      try {
        // GET /google/status → { conectado: bool }
        const data = await api.googleStatus();
        this.atualizarBotao(data.conectado);
      } catch {
        // silencioso — não crítico para uso do sistema
      }
    },

    atualizarBotao(conectado) {
      const btn = $('#btn-connect-google');
      if (!btn) return;
      const label = btn.querySelector('span.only-desktop');
      if (conectado) {
        btn.title = 'Desconectar Google Agenda';
        btn.dataset.googleConectado = 'true';
        if (label) label.textContent = 'Google conectado';
      } else {
        btn.title = 'Conectar ao Google Agenda';
        btn.dataset.googleConectado = 'false';
        if (label) label.textContent = 'Conectar Google';
      }
    },

    async handleBotao() {
      const btn = $('#btn-connect-google');
      if (!btn) return;
      const conectado = btn.dataset.googleConectado === 'true';

      if (conectado) {
        ui.confirm(
          'Desconectar Google Agenda?',
          'Os eventos já enviados não serão removidos do Google.',
          async () => {
            try {
              // DELETE /google/conectar
              await api.googleDesconectar();
              this.atualizarBotao(false);
              ui.success('Google desconectado');
            } catch (err) {
              ui.error('Erro ao desconectar', err.message);
            }
          }
        );
      } else {
        // GET /google/conectar — abre popup OAuth
        // O token vai via query param pois é redirect do browser
        api.googleConectar();
        ui.info('Conectando…', 'Conclua a autenticação na janela do Google.');

        // após 3s verifica se o popup já concluiu
        setTimeout(() => this.verificarStatus(), 3000);
      }
    },
  };

  /* ============================================================
     7. NAV
  ============================================================ */
  const PAGE_TITLES = {
    dashboard:      'Dashboard',
    consultas:      'Consultas',
    pessoas:        'Pessoas',
    especialidades: 'Especialidades',
    evolucao:       'Registros Clínicos',
    relatorios:     'Relatórios',
  };

  const nav = {
    init() {
      $$('.nav__item').forEach(btn => {
        btn.addEventListener('click', () => this.goto(btn.dataset.page));
      });
      $$('[data-goto]').forEach(btn => {
        btn.addEventListener('click', () => this.goto(btn.dataset.goto));
      });
      $('#btn-open-sidebar').addEventListener('click',  () => this.toggleSidebar(true));
      $('#btn-close-sidebar').addEventListener('click', () => this.toggleSidebar(false));
      $('#backdrop-sidebar').addEventListener('click',  () => this.toggleSidebar(false));
    },

    goto(page) {
      if (!PAGE_TITLES[page]) page = 'dashboard';
      state.currentPage = page;

      $$('.page').forEach(p => p.classList.toggle('page--active', p.dataset.page === page));
      $$('.nav__item').forEach(n => n.classList.toggle('nav__item--active', n.dataset.page === page));
      $('#page-title').textContent = PAGE_TITLES[page];

      const renderer = pages[page]?.render;
      if (typeof renderer === 'function') renderer.call(pages[page]);

      if (window.innerWidth < 960) this.toggleSidebar(false);
      $('#content').scrollTo({ top: 0, behavior: 'smooth' });
    },

    toggleSidebar(open) {
      $('#sidebar').classList.toggle('is-open', open);
      $('#backdrop-sidebar').classList.toggle('is-open', open);
    },
  };

  /* ============================================================
     8. PAGES
  ============================================================ */
  const pages = {};

  /* ---------- Dashboard ---------- */
  pages.dashboard = {
    render() {
      // Conta por tipo nos cadastros já carregados
      const pacientes  = state.cadastros.filter(p => p.tipo === 'Paciente').length;
      const terapeutas = state.cadastros.filter(p => p.tipo === 'Profissional').length;
      const consultas  = state.consultas.length;
      const esps       = state.especialidades.length;

      animateCounter($('#stat-pacientes'),     pacientes);
      animateCounter($('#stat-terapeutas'),    terapeutas);
      animateCounter($('#stat-consultas'),     consultas);
      animateCounter($('#stat-especialidades'),esps);

      // timeline — últimas 6 consultas (já ordenadas DESC pelo backend)
      const box   = $('#dash-timeline');
      const items = state.consultas.slice(0, 6);
      if (!items.length) {
        box.innerHTML = ui.emptyState('calendar', 'Sem consultas', 'Carregue dados para ver o histórico.');
        return;
      }
      box.innerHTML = items.map(c => `
        <div class="tl-item">
          <div class="tl-dot"></div>
          <div class="tl-main">
            <div class="tl-title">${esc(c.paciente || '—')} <span style="color:var(--fg-dim)">com</span> ${esc(c.terapeuta || '—')}</div>
            <div class="tl-sub">${esc(c.especialidade || '—')}</div>
          </div>
          <div class="tl-date">${esc(formatDateBR(c.data_hora))}</div>
        </div>
      `).join('');
    }
  };

  function updateNavBadges() {
    $('#nav-badge-consultas').textContent = state.consultas.length;
  }

  /* ---------- Consultas ---------- */
  /*
    GET /consultas?pagina=N&por_pagina=50
    Permissões: 1, 20, 21
    Resposta: [{ id, paciente, terapeuta, data_hora, especialidade }]

    POST /google/evento
    Body: { consulta: id }
    Permissões: 1, 26
  */
  pages.consultas = {
    render() { this.renderTable(); },

    async load({ silent = false } = {}) {
      if (!state.token) return;
      if (!temPermissao(1, 20, 21)) return;

      const body  = $('#consultas-body');
      const count = $('#count-consultas');

      if (!silent) {
        body.innerHTML = ui.skeleton(5);
        count.textContent = '—';
      }

      try {
        const data = await api.consultas(1, 50);
        state.consultas = Array.isArray(data) ? data : [];
        this.renderTable();
        updateNavBadges();
        pages.dashboard.render();
        if (!silent) ui.success('Consultas atualizadas', `${state.consultas.length} registro(s) carregados.`);
      } catch (err) {
        if (!silent) {
          body.innerHTML = ui.errorState('Falha ao carregar', err.message);
          count.textContent = '—';
          ui.error('Erro ao carregar consultas', err.message);
        }
      }
    },

    renderTable() {
      const body  = $('#consultas-body');
      const count = $('#count-consultas');
      const q     = ($('#search-consultas').value || '').toLowerCase();

      const list = state.consultas.filter(c => {
        if (!q) return true;
        return [c.paciente, c.terapeuta, c.especialidade].some(v => (v || '').toLowerCase().includes(q));
      });

      count.textContent = `${list.length} registro${list.length === 1 ? '' : 's'}`;

      if (!list.length) {
        body.innerHTML = !state.consultas.length
          ? ui.emptyState('calendar', 'Sem consultas ainda', 'Clique em Recarregar para buscar os dados.')
          : ui.emptyState('search', 'Nada encontrado', 'Ajuste o termo de busca.');
        return;
      }

      const podeEnviarGoogle = temPermissao(1, 26);

      const rows = list.map(c => `
        <tr>
          <td class="td-id">#${esc(c.id)}</td>
          <td><div style="font-weight:500">${esc(c.paciente || '—')}</div></td>
          <td>${esc(c.terapeuta || '—')}</td>
          <td class="td-date">${esc(formatDateBR(c.data_hora))}</td>
          <td><span class="badge badge--accent">${esc(c.especialidade || '—')}</span></td>
          <td class="td-actions">
            ${podeEnviarGoogle ? `
              <button class="icon-btn" data-act="google" data-id="${esc(c.id)}"
                      title="${c.enviado_google === 'S' ? 'Já enviado ao Google Agenda' : 'Enviar para Google Agenda'}"
                      aria-label="Enviar consulta ${esc(c.id)} para Google Agenda"
                      ${c.enviado_google === 'S' ? 'disabled' : ''}>
                ${icon('google')}
              </button>
            ` : ''}
          </td>
        </tr>
      `).join('');

      body.innerHTML = `
        <div class="table-scroll">
          <table class="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Paciente</th>
                <th>Terapeuta</th>
                <th>Data / Hora</th>
                <th>Especialidade</th>
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

      body.querySelectorAll('[data-act="google"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = parseInt(btn.dataset.id, 10);
          btn.setAttribute('aria-busy', 'true');
          btn.disabled = true;
          try {
            // POST /google/evento — { consulta: id }
            await api.googleEvento(id);
            // atualiza flag localmente para evitar re-request
            const c = state.consultas.find(x => x.id === id);
            if (c) c.enviado_google = 'S';
            ui.success('Enviado!', 'Evento criado no Google Agenda.');
            this.renderTable();
          } catch (err) {
            btn.disabled = false;
            ui.error('Erro ao enviar', err.message);
          } finally {
            btn.removeAttribute('aria-busy');
          }
        });
      });
    },

    init() {
      $('#btn-reload-consultas').addEventListener('click', () => this.load());
      $('#search-consultas').addEventListener('input', debounce(() => this.renderTable(), 180));
    }
  };

  /* ---------- Pessoas / Cadastros ---------- */
  /*
    GET /cadastros?pagina=N&por_pagina=50
    Permissões: 1, 10, 11
    Resposta: [{ id, nome, telefone, dt_nasc, dt_cadastro, registro_profissional, tipo }]
    Nota: CPF e diagnostico NÃO são retornados na listagem (dados sensíveis LGPD).
          Serão retornados apenas em endpoint de detalhe individual (a implementar).

    Inserir/Editar/Excluir: rotas ainda não implementadas no backend.
    Permissões futuras: INSERT=12, ALTER=13, DELETE=14
  */
  pages.pessoas = {
    render() { this.renderTable(); },

    async load({ silent = false } = {}) {
      if (!state.token) return;
      if (!temPermissao(1, 10, 11)) return;

      const body  = $('#pessoas-body');
      const count = $('#count-pessoas');

      if (!silent) {
        body.innerHTML = ui.skeleton(5);
        count.textContent = '—';
      }

      try {
        const data = await api.cadastros(1, 50);
        state.cadastros = Array.isArray(data) ? data : [];
        this.renderTable();
        pages.dashboard.render();
        if (!silent) ui.success('Cadastros atualizados', `${state.cadastros.length} registro(s) carregados.`);
      } catch (err) {
        if (!silent) {
          body.innerHTML = ui.errorState('Falha ao carregar', err.message);
          count.textContent = '—';
          ui.error('Erro ao carregar cadastros', err.message);
        }
      }
    },

    renderTable() {
      const body  = $('#pessoas-body');
      const count = $('#count-pessoas');
      const q     = ($('#search-pessoas').value || '').toLowerCase();
      const tipo  = state.cadastrosFilter;

      const list = state.cadastros.filter(p => {
        if (tipo !== 'all' && p.tipo !== tipo) return false;
        if (!q) return true;
        return [p.nome, p.telefone, p.registro_profissional].some(v => (v || '').toLowerCase().includes(q));
      });

      count.textContent = `${list.length} registro${list.length === 1 ? '' : 's'}`;

      if (!list.length) {
        body.innerHTML = !state.cadastros.length
          ? ui.emptyState('users', 'Nenhuma pessoa', 'Clique em "Nova pessoa" para cadastrar.')
          : ui.emptyState('search', 'Nada encontrado', 'Ajuste o termo de busca ou o filtro.');
        return;
      }

      const rows = list.map(p => {
        const badgeType = p.tipo === 'Profissional' ? 'accent' : 'info';
        return `
          <tr>
            <td class="td-id">#${esc(p.id)}</td>
            <td><div style="font-weight:500">${esc(p.nome)}</div></td>
            <td><span class="badge badge--${badgeType}">${esc(p.tipo || '—')}</span></td>
            <td class="mono" style="font-size:12.5px;color:var(--fg-muted)">${esc(p.telefone || '—')}</td>
            <td class="td-date">${esc(formatDateBR(p.dt_nasc))}</td>
            <td class="td-actions">
              <button class="icon-btn" data-act="edit" data-id="${p.id}" title="Editar" aria-label="Editar ${esc(p.nome)}">${icon('edit')}</button>
            </td>
          </tr>`;
      }).join('');

      body.innerHTML = `
        <div class="table-scroll">
          <table class="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Telefone</th>
                <th>Nascimento</th>
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

      body.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.act === 'edit') this.openEdit(parseInt(btn.dataset.id, 10));
        });
      });
    },

    openNew() {
      state.editing.pessoaId = null;
      $('#modal-pessoa-title').textContent = 'Nova pessoa';
      $('#p-codigo').value = '';
      $('#p-nome').value   = '';
      $('#p-tipo').value   = 'Paciente';
      $('#p-nasc').value   = '';
      $('#p-tel').value    = '';
      this.syncEspInputs();
      this.renderEspChecks([]);
      ui.openModal('modal-pessoa');
    },

    openEdit(id) {
      const p = state.cadastros.find(x => x.id === id);
      if (!p) return;
      state.editing.pessoaId = id;
      $('#modal-pessoa-title').textContent = 'Editar pessoa';
      $('#p-codigo').value = p.id;
      $('#p-nome').value   = p.nome || '';
      $('#p-tipo').value   = p.tipo || 'Paciente';
      $('#p-nasc').value   = (p.dt_nasc || '').slice(0, 10);
      $('#p-tel').value    = p.telefone || '';
      this.syncEspInputs();
      this.renderEspChecks([]);
      ui.openModal('modal-pessoa');
    },

    syncEspInputs() {
      const tipo = $('#p-tipo').value;
      $('#p-esp-wrap').hidden = (tipo !== 'Profissional');
    },

    renderEspChecks(selected = []) {
      const box = $('#p-esp-checks');
      if (!state.especialidades.length) {
        box.innerHTML = '<p style="color:var(--fg-dim);font-size:13px">Nenhuma especialidade cadastrada ainda.</p>';
        return;
      }
      box.innerHTML = state.especialidades.map(e => `
        <label class="check">
          <input type="checkbox" value="${esc(e.id)}" ${selected.includes(e.id) ? 'checked' : ''}/>
          <span>${esc(e.descricao)}</span>
        </label>
      `).join('');
    },

    save(e) {
      e.preventDefault();
      // Rota de INSERT/UPDATE ainda não implementada no backend.
      // Quando implementada: POST /cadastros (perm 12) ou PUT /cadastros/:id (perm 13)
      ui.warning('Em breve', 'A criação e edição de cadastros ainda não está disponível.');
      ui.closeModal('modal-pessoa');
    },

    init() {
      $('#btn-new-pessoa').addEventListener('click', () => this.openNew());
      $('#p-tipo').addEventListener('change', () => this.syncEspInputs());
      $('#form-pessoa').addEventListener('submit', (e) => this.save(e));
      $('#search-pessoas').addEventListener('input', debounce(() => this.renderTable(), 180));
      $$('.tabs [data-filter]').forEach(tab => {
        tab.addEventListener('click', () => {
          $$('.tabs [data-filter]').forEach(t => t.classList.remove('tab--active'));
          tab.classList.add('tab--active');
          state.cadastrosFilter = tab.dataset.filter;
          this.renderTable();
        });
      });
    }
  };

  /* ---------- Especialidades ---------- */
  /*
    GET /especialidade
    Permissões: 1, 30, 31
    Resposta: [{ id, descricao, inativo, id_cor }]

    Inserir/Editar/Excluir: rotas ainda não implementadas no backend.
    Permissões futuras: INSERT=32, ALTER=33, DELETE=34
  */
  pages.especialidades = {
    render() { this.renderChips(); },

    async load({ silent = false } = {}) {
      if (!state.token) return;
      if (!temPermissao(1, 30, 31)) return;
      try {
        const data = await api.especialidade();
        state.especialidades = Array.isArray(data) ? data : [];
        if (state.currentPage === 'especialidades') this.renderChips();
        pages.dashboard.render();
      } catch (err) {
        if (!silent) ui.error('Erro ao carregar especialidades', err.message);
      }
    },

    renderChips() {
      const box = $('#esp-chips');
      if (!state.especialidades.length) {
        box.innerHTML = ui.emptyState('heart-pulse', 'Nenhuma especialidade', 'Adicione a primeira no campo acima.');
        return;
      }
      box.innerHTML = state.especialidades.map(e => `
        <span class="chip ${e.inativo === 'S' ? 'chip--inativo' : ''}">
          ${esc(e.descricao)}
          <button class="chip__remove" data-id="${e.id}" aria-label="Remover ${esc(e.descricao)}">${icon('close', 12)}</button>
        </span>
      `).join('');

      box.querySelectorAll('.chip__remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.id);
          const esp = state.especialidades.find(x => x.id === id);
          if (!esp) return;
          ui.confirm(
            `Remover "${esp.descricao}"?`,
            'Rota de exclusão ainda não implementada no backend.',
            () => {
              // DELETE /especialidade/:id — perm 34 (a implementar)
              ui.warning('Em breve', 'A exclusão de especialidades ainda não está disponível.');
            }
          );
        });
      });
    },

    add(e) {
      e.preventDefault();
      // POST /especialidade — perm 32 (a implementar)
      ui.warning('Em breve', 'A criação de especialidades via frontend ainda não está disponível.');
      $('#input-nova-esp').value = '';
    },

    init() {
      $('#form-nova-esp').addEventListener('submit', (e) => this.add(e));
    }
  };

  /* ---------- Evolução / Registros Clínicos ---------- */
  /*
    Rotas ainda não implementadas no backend.
    Dados de selects (paciente, profissional, especialidade) virão de:
      GET /cadastros     → pacientes e profissionais
      GET /especialidade → especialidades

    Permissões futuras: ACESSAR=25, INSERIR≈22, ALTERAR≈23, EXCLUIR≈24
  */
  pages.evolucao = {
    render() { this.renderTable(); },

    renderTable() {
      const body  = $('#evolucao-body');
      const count = $('#count-evolucao');

      count.textContent = '0 registros';
      body.innerHTML = ui.emptyState('chart', 'Registros clínicos em breve', 'Esta funcionalidade ainda não está disponível no backend.');
    },

    populateSelects() {
      // GET /cadastros → filtrar tipo=Paciente e tipo=Profissional client-side
      const pacientes     = state.cadastros.filter(p => p.tipo === 'Paciente');
      const profissionais = state.cadastros.filter(p => p.tipo === 'Profissional');

      $('#e-paciente').innerHTML = '<option value="">Selecionar paciente…</option>' +
        pacientes.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');

      $('#e-profissional').innerHTML = '<option value="">Selecionar profissional…</option>' +
        profissionais.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');

      // GET /especialidade
      $('#e-especialidade').innerHTML = '<option value="">Selecionar especialidade…</option>' +
        state.especialidades.map(e => `<option value="${e.id}">${esc(e.descricao)}</option>`).join('');
    },

    openNew() {
      state.editing.evolucaoId = null;
      $('#modal-evolucao-title').textContent = 'Novo registro clínico';
      $('#e-codigo').value  = '';
      $('#e-data').value    = new Date().toISOString().slice(0, 10);
      $('#e-idade').value   = '';
      $('#e-diag').value    = '';
      $('#e-resumo').value  = '';
      this.populateSelects();
      $('#e-paciente').value     = '';
      $('#e-profissional').value = '';
      $('#e-especialidade').value= '';
      ui.openModal('modal-evolucao');
    },

    save(ev) {
      ev.preventDefault();
      // POST /evolucao — a implementar no backend
      ui.warning('Em breve', 'A criação de registros clínicos ainda não está disponível.');
      ui.closeModal('modal-evolucao');
    },

    init() {
      $('#btn-new-evolucao').addEventListener('click', () => this.openNew());
      $('#form-evolucao').addEventListener('submit', (e) => this.save(e));
      $('#search-evolucao').addEventListener('input', debounce(() => this.renderTable(), 180));
    }
  };

  /* ---------- Relatórios ---------- */
  /*
    Opera sobre dados já carregados em memória:
      state.consultas      → base dos registros
      state.cadastros      → nomes para os selects
      state.especialidades → especialidades para o select

    Exportação CSV e impressão são operações client-side.
  */
  pages.relatorios = {
    render() {
      this.populate();
      this.renderTable();
    },

    populate() {
      const pacientes     = state.cadastros.filter(p => p.tipo === 'Paciente');
      const profissionais = state.cadastros.filter(p => p.tipo === 'Profissional');

      const fill = (sel, list, labelKey, valKey, placeholder) => {
        const cur = $(sel).value;
        $(sel).innerHTML = `<option value="">${placeholder}</option>` +
          list.map(v => `<option value="${esc(v[valKey])}" ${String(v[valKey]) === cur ? 'selected' : ''}>${esc(v[labelKey])}</option>`).join('');
      };

      fill('#filter-paciente',      pacientes,             'nome',     'nome', 'Todos');
      fill('#filter-terapeuta',     profissionais,         'nome',     'nome', 'Todos');
      fill('#filter-especialidade', state.especialidades,  'descricao','descricao', 'Todas');
    },

    currentFilters() {
      return {
        paciente:      $('#filter-paciente').value,
        terapeuta:     $('#filter-terapeuta').value,
        especialidade: $('#filter-especialidade').value,
        dataInicial:   $('#filter-di').value,
        dataFinal:     $('#filter-df').value,
      };
    },

    filtered() {
      const f = this.currentFilters();
      // Filtra sobre state.consultas — campo data_hora vem do backend
      return state.consultas.filter(c => {
        const dataISO = (c.data_hora || '').slice(0, 10);
        if (f.paciente      && c.paciente      !== f.paciente)      return false;
        if (f.terapeuta     && c.terapeuta     !== f.terapeuta)      return false;
        if (f.especialidade && c.especialidade !== f.especialidade)  return false;
        if (f.dataInicial   && dataISO < f.dataInicial)              return false;
        if (f.dataFinal     && dataISO > f.dataFinal)                return false;
        return true;
      });
    },

    renderTable() {
      const body  = $('#relatorio-body');
      const count = $('#count-relatorio');
      const list  = this.filtered();

      count.textContent = `${list.length} registro${list.length === 1 ? '' : 's'}`;

      if (!list.length) {
        body.innerHTML = ui.emptyState('clipboard', 'Sem resultados', 'Ajuste os filtros e tente novamente.');
        return;
      }

      const rows = list.map(c => `
        <tr>
          <td class="td-date">${esc(formatDateBR(c.data_hora))}</td>
          <td>${esc(c.paciente || '—')}</td>
          <td>${esc(c.terapeuta || '—')}</td>
          <td><span class="badge badge--accent">${esc(c.especialidade || '—')}</span></td>
        </tr>
      `).join('');

      body.innerHTML = `
        <div class="table-scroll">
          <table class="tbl">
            <thead>
              <tr>
                <th>Data / Hora</th>
                <th>Paciente</th>
                <th>Terapeuta</th>
                <th>Especialidade</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    },

    exportCsv() {
      const list = this.filtered();
      if (!list.length) { ui.warning('Sem dados', 'Não há registros para exportar.'); return; }
      const header = ['Data/Hora', 'Paciente', 'Terapeuta', 'Especialidade'];
      const rows   = list.map(c => [c.data_hora || '', c.paciente || '', c.terapeuta || '', c.especialidade || '']);
      const csv    = [header, ...rows]
        .map(row => row.map(cell => {
          const s = String(cell ?? '');
          return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(';'))
        .join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = el('a', { href: url, download: `vindix-relatorio-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      ui.success('CSV exportado', `${list.length} registro(s).`);
    },

    print() {
      if (!this.filtered().length) { ui.warning('Sem dados', 'Não há registros para imprimir.'); return; }
      window.print();
    },

    init() {
      ['#filter-paciente', '#filter-terapeuta', '#filter-especialidade', '#filter-di', '#filter-df'].forEach(sel => {
        $(sel).addEventListener('change', () => this.renderTable());
      });
      $('#btn-clear-filter').addEventListener('click', () => {
        setTimeout(() => this.renderTable(), 10);
      });
      $('#btn-export').addEventListener('click', () => this.exportCsv());
      $('#btn-print').addEventListener('click',  () => this.print());
    }
  };

  /* ============================================================
     9. BOOT
  ============================================================ */
  function bindGlobal() {
    // fecha modais via backdrop ou botão com data-modal-close
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-modal-close]')) {
        const modal = e.target.closest('.modal');
        if (modal) modal.classList.remove('is-open');
      }
    });

    // ESC fecha modal / sidebar; Cmd+K foca busca
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ui.closeAllModals();
        nav.toggleSidebar(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const map = { consultas: '#search-consultas', pessoas: '#search-pessoas', evolucao: '#search-evolucao' };
        const sel = map[state.currentPage];
        if (sel) { e.preventDefault(); $(sel)?.focus(); }
      }
    });

    // botão Google — conectar / desconectar
    $('#btn-connect-google').addEventListener('click', () => google.handleBotao());

    // refresh dashboard
    $('#btn-refresh-dash').addEventListener('click', async () => {
      await Promise.allSettled([
        pages.consultas.load(),
        pages.pessoas.load(),
        pages.especialidades.load(),
      ]);
      pages.dashboard.render();
    });
  }

  function boot() {
    document.body.dataset.loading = 'false';

    auth.init();
    nav.init();
    pages.consultas.init();
    pages.pessoas.init();
    pages.especialidades.init();
    pages.evolucao.init();
    pages.relatorios.init();
    bindGlobal();
    updateNavBadges();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
