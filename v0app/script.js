/* ========================================
   VINDX - SISTEMA DE GESTAO CLINICA
   JavaScript Principal
   ======================================== */

// ========================================
// DADOS (Simulacao - Substituir por chamadas ao backend)
// ========================================
let dados = {
  pacientes: [],
  terapeutas: [],
  especialidades: [],
  evolucoes: []
};

// Carregar dados do localStorage (para demonstracao)
function carregarDados() {
  const dadosSalvos = localStorage.getItem('vindx_dados');
  if (dadosSalvos) {
    dados = JSON.parse(dadosSalvos);
  }
}

// Salvar dados no localStorage (para demonstracao)
function salvarDados() {
  localStorage.setItem('vindx_dados', JSON.stringify(dados));
}

// ========================================
// AUTENTICACAO
// ========================================
function fazerLogin(event) {
  event.preventDefault();
  
  const usuario = document.getElementById('login-usuario').value;
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('login-erro');
  
  // Simulacao de login - Substituir por autenticacao real
  if (usuario === 'admin' && senha === 'admin') {
    // Login bem-sucedido
    sessionStorage.setItem('vindx_logado', 'true');
    sessionStorage.setItem('vindx_usuario', usuario);
    
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-sistema').style.display = 'flex';
    
    document.getElementById('nome-usuario').textContent = usuario;
    
    carregarDados();
    atualizarDashboard();
    mostrarToast('Bem-vindo ao VindX!', 'sucesso');
  } else {
    // Login falhou
    erroEl.textContent = 'Usuario ou senha incorretos';
    erroEl.style.display = 'block';
  }
}

function fazerLogout() {
  sessionStorage.removeItem('vindx_logado');
  sessionStorage.removeItem('vindx_usuario');
  
  document.getElementById('tela-sistema').style.display = 'none';
  document.getElementById('tela-login').style.display = 'flex';
  
  document.getElementById('login-usuario').value = '';
  document.getElementById('login-senha').value = '';
  document.getElementById('login-erro').style.display = 'none';
}

// Verificar se ja esta logado
function verificarLogin() {
  const logado = sessionStorage.getItem('vindx_logado');
  if (logado === 'true') {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-sistema').style.display = 'flex';
    
    const usuario = sessionStorage.getItem('vindx_usuario');
    document.getElementById('nome-usuario').textContent = usuario || 'Usuario';
    
    carregarDados();
    atualizarDashboard();
  }
}

// ========================================
// NAVEGACAO
// ========================================
function navegarPara(pagina) {
  // Esconder todas as paginas
  document.querySelectorAll('.pagina').forEach(p => {
    p.style.display = 'none';
  });
  
  // Mostrar pagina selecionada
  document.getElementById('pagina-' + pagina).style.display = 'block';
  
  // Atualizar menu ativo
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  document.querySelector('.nav-item[data-pagina="' + pagina + '"]').classList.add('active');
  
  // Atualizar titulo
  const titulos = {
    'dashboard': { titulo: 'Dashboard', subtitulo: 'Visao geral do sistema' },
    'pacientes': { titulo: 'Pacientes', subtitulo: 'Gerenciar cadastro de pacientes' },
    'terapeutas': { titulo: 'Terapeutas', subtitulo: 'Gerenciar cadastro de terapeutas' },
    'especialidades': { titulo: 'Especialidades', subtitulo: 'Gerenciar especialidades/funcoes' },
    'evolucoes': { titulo: 'Evolucoes', subtitulo: 'Registros de evolucao clinica' },
    'relatorios': { titulo: 'Relatorios', subtitulo: 'Gerar relatorios e resumos' }
  };
  
  document.getElementById('titulo-pagina').textContent = titulos[pagina].titulo;
  document.getElementById('subtitulo-pagina').textContent = titulos[pagina].subtitulo;
  
  // Atualizar conteudo da pagina
  switch (pagina) {
    case 'dashboard':
      atualizarDashboard();
      break;
    case 'pacientes':
      listarPacientes();
      break;
    case 'terapeutas':
      listarTerapeutas();
      break;
    case 'especialidades':
      listarEspecialidades();
      break;
    case 'evolucoes':
      listarEvolucoes();
      break;
    case 'relatorios':
      carregarFiltrosRelatorio();
      break;
  }
}

// ========================================
// DASHBOARD
// ========================================
function atualizarDashboard() {
  // Atualizar contadores
  document.getElementById('total-pacientes').textContent = dados.pacientes.length;
  document.getElementById('total-terapeutas').textContent = dados.terapeutas.length;
  document.getElementById('total-especialidades').textContent = dados.especialidades.length;
  document.getElementById('total-evolucoes').textContent = dados.evolucoes.length;
  
  // Atualizar ultimas evolucoes
  const tbody = document.getElementById('tbody-ultimas-evolucoes');
  const ultimasEvolucoes = dados.evolucoes.slice(-5).reverse();
  
  if (ultimasEvolucoes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Nenhuma evolucao registrada</td></tr>';
  } else {
    tbody.innerHTML = ultimasEvolucoes.map(evo => {
      const paciente = dados.pacientes.find(p => p.id === evo.pacienteId);
      const terapeuta = dados.terapeutas.find(t => t.id === evo.terapeutaId);
      return `
        <tr>
          <td>${formatarData(evo.data)}</td>
          <td>${paciente ? paciente.nome : '-'}</td>
          <td>${terapeuta ? terapeuta.nome : '-'}</td>
        </tr>
      `;
    }).join('');
  }
  
  // Atualizar grafico de especialidades
  const chartContainer = document.getElementById('chart-especialidades');
  if (dados.especialidades.length === 0) {
    chartContainer.innerHTML = '<p class="empty-state">Nenhum dado disponivel</p>';
  } else {
    const maxTerapeutas = Math.max(...dados.especialidades.map(e => {
      return dados.terapeutas.filter(t => t.especialidadeId === e.id).length;
    }), 1);
    
    chartContainer.innerHTML = dados.especialidades.map(esp => {
      const qtd = dados.terapeutas.filter(t => t.especialidadeId === esp.id).length;
      const porcentagem = (qtd / maxTerapeutas) * 100;
      return `
        <div class="chart-bar">
          <span class="chart-bar-label">${esp.nome}</span>
          <div class="chart-bar-track">
            <div class="chart-bar-fill" style="width: ${porcentagem}%; background-color: ${esp.cor};">
              ${qtd}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ========================================
// PACIENTES
// ========================================
function listarPacientes() {
  const tbody = document.getElementById('tbody-pacientes');
  
  if (dados.pacientes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum paciente cadastrado</td></tr>';
    return;
  }
  
  tbody.innerHTML = dados.pacientes.map(paciente => {
    const terapeutasVinculados = paciente.terapeutasIds 
      ? paciente.terapeutasIds.map(id => {
          const t = dados.terapeutas.find(ter => ter.id === id);
          return t ? t.nome.split(' ')[0] : '';
        }).filter(n => n).join(', ')
      : '-';
    
    return `
      <tr>
        <td>${paciente.id}</td>
        <td>${paciente.nome}</td>
        <td>${paciente.nascimento ? formatarData(paciente.nascimento) : '-'}</td>
        <td>${paciente.telefone || '-'}</td>
        <td>${terapeutasVinculados || '-'}</td>
        <td class="acoes-cell">
          <button class="btn btn-icon btn-editar" onclick="editarPaciente(${paciente.id})" title="Editar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-excluir" onclick="excluirPaciente(${paciente.id})" title="Excluir">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filtrarPacientes() {
  const busca = document.getElementById('busca-pacientes').value.toLowerCase();
  const tbody = document.getElementById('tbody-pacientes');
  
  const filtrados = dados.pacientes.filter(p => 
    p.nome.toLowerCase().includes(busca) ||
    (p.telefone && p.telefone.includes(busca)) ||
    (p.email && p.email.toLowerCase().includes(busca))
  );
  
  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum paciente encontrado</td></tr>';
    return;
  }
  
  tbody.innerHTML = filtrados.map(paciente => {
    const terapeutasVinculados = paciente.terapeutasIds 
      ? paciente.terapeutasIds.map(id => {
          const t = dados.terapeutas.find(ter => ter.id === id);
          return t ? t.nome.split(' ')[0] : '';
        }).filter(n => n).join(', ')
      : '-';
    
    return `
      <tr>
        <td>${paciente.id}</td>
        <td>${paciente.nome}</td>
        <td>${paciente.nascimento ? formatarData(paciente.nascimento) : '-'}</td>
        <td>${paciente.telefone || '-'}</td>
        <td>${terapeutasVinculados || '-'}</td>
        <td class="acoes-cell">
          <button class="btn btn-icon btn-editar" onclick="editarPaciente(${paciente.id})" title="Editar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-excluir" onclick="excluirPaciente(${paciente.id})" title="Excluir">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function abrirModalPaciente() {
  document.getElementById('modal-paciente-titulo').textContent = 'Novo Paciente';
  document.getElementById('form-paciente').reset();
  document.getElementById('paciente-id').value = '';
  
  // Carregar terapeutas para vincular
  const container = document.getElementById('paciente-terapeutas');
  if (dados.terapeutas.length === 0) {
    container.innerHTML = '<p class="empty-state">Cadastre terapeutas primeiro</p>';
  } else {
    container.innerHTML = dados.terapeutas.map(t => `
      <label class="checkbox-item">
        <input type="checkbox" name="paciente-terapeuta" value="${t.id}">
        <span>${t.nome}</span>
      </label>
    `).join('');
  }
  
  document.getElementById('modal-paciente').style.display = 'flex';
}

function editarPaciente(id) {
  const paciente = dados.pacientes.find(p => p.id === id);
  if (!paciente) return;
  
  document.getElementById('modal-paciente-titulo').textContent = 'Editar Paciente';
  document.getElementById('paciente-id').value = paciente.id;
  document.getElementById('paciente-nome').value = paciente.nome;
  document.getElementById('paciente-nascimento').value = paciente.nascimento || '';
  document.getElementById('paciente-cpf').value = paciente.cpf || '';
  document.getElementById('paciente-telefone').value = paciente.telefone || '';
  document.getElementById('paciente-email').value = paciente.email || '';
  document.getElementById('paciente-endereco').value = paciente.endereco || '';
  document.getElementById('paciente-observacoes').value = paciente.observacoes || '';
  
  // Carregar terapeutas
  const container = document.getElementById('paciente-terapeutas');
  if (dados.terapeutas.length === 0) {
    container.innerHTML = '<p class="empty-state">Cadastre terapeutas primeiro</p>';
  } else {
    container.innerHTML = dados.terapeutas.map(t => `
      <label class="checkbox-item">
        <input type="checkbox" name="paciente-terapeuta" value="${t.id}" 
          ${paciente.terapeutasIds && paciente.terapeutasIds.includes(t.id) ? 'checked' : ''}>
        <span>${t.nome}</span>
      </label>
    `).join('');
  }
  
  document.getElementById('modal-paciente').style.display = 'flex';
}

function salvarPaciente(event) {
  event.preventDefault();
  
  const id = document.getElementById('paciente-id').value;
  const terapeutasIds = Array.from(document.querySelectorAll('input[name="paciente-terapeuta"]:checked'))
    .map(cb => parseInt(cb.value));
  
  const paciente = {
    id: id ? parseInt(id) : Date.now(),
    nome: document.getElementById('paciente-nome').value,
    nascimento: document.getElementById('paciente-nascimento').value,
    cpf: document.getElementById('paciente-cpf').value,
    telefone: document.getElementById('paciente-telefone').value,
    email: document.getElementById('paciente-email').value,
    endereco: document.getElementById('paciente-endereco').value,
    observacoes: document.getElementById('paciente-observacoes').value,
    terapeutasIds: terapeutasIds
  };
  
  if (id) {
    // Atualizar existente
    const index = dados.pacientes.findIndex(p => p.id === parseInt(id));
    if (index !== -1) {
      dados.pacientes[index] = paciente;
    }
    mostrarToast('Paciente atualizado com sucesso!', 'sucesso');
  } else {
    // Novo paciente
    dados.pacientes.push(paciente);
    mostrarToast('Paciente cadastrado com sucesso!', 'sucesso');
  }
  
  salvarDados();
  fecharModal('modal-paciente');
  listarPacientes();
  atualizarDashboard();
}

function excluirPaciente(id) {
  if (!confirm('Deseja realmente excluir este paciente?')) return;
  
  dados.pacientes = dados.pacientes.filter(p => p.id !== id);
  salvarDados();
  listarPacientes();
  atualizarDashboard();
  mostrarToast('Paciente excluido com sucesso!', 'sucesso');
}

// ========================================
// TERAPEUTAS
// ========================================
function listarTerapeutas() {
  const tbody = document.getElementById('tbody-terapeutas');
  
  if (dados.terapeutas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum terapeuta cadastrado</td></tr>';
    return;
  }
  
  tbody.innerHTML = dados.terapeutas.map(terapeuta => {
    const especialidade = dados.especialidades.find(e => e.id === terapeuta.especialidadeId);
    return `
      <tr>
        <td>${terapeuta.id}</td>
        <td>${terapeuta.nome}</td>
        <td>
          ${especialidade ? `
            <span class="badge" style="background: ${especialidade.cor}20; color: ${especialidade.cor};">
              <span class="badge-color" style="background: ${especialidade.cor};"></span>
              ${especialidade.nome}
            </span>
          ` : '-'}
        </td>
        <td>${terapeuta.email || '-'}</td>
        <td>${terapeuta.telefone || '-'}</td>
        <td class="acoes-cell">
          <button class="btn btn-icon btn-editar" onclick="editarTerapeuta(${terapeuta.id})" title="Editar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-excluir" onclick="excluirTerapeuta(${terapeuta.id})" title="Excluir">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filtrarTerapeutas() {
  const busca = document.getElementById('busca-terapeutas').value.toLowerCase();
  const tbody = document.getElementById('tbody-terapeutas');
  
  const filtrados = dados.terapeutas.filter(t => 
    t.nome.toLowerCase().includes(busca) ||
    (t.email && t.email.toLowerCase().includes(busca))
  );
  
  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum terapeuta encontrado</td></tr>';
    return;
  }
  
  tbody.innerHTML = filtrados.map(terapeuta => {
    const especialidade = dados.especialidades.find(e => e.id === terapeuta.especialidadeId);
    return `
      <tr>
        <td>${terapeuta.id}</td>
        <td>${terapeuta.nome}</td>
        <td>
          ${especialidade ? `
            <span class="badge" style="background: ${especialidade.cor}20; color: ${especialidade.cor};">
              <span class="badge-color" style="background: ${especialidade.cor};"></span>
              ${especialidade.nome}
            </span>
          ` : '-'}
        </td>
        <td>${terapeuta.email || '-'}</td>
        <td>${terapeuta.telefone || '-'}</td>
        <td class="acoes-cell">
          <button class="btn btn-icon btn-editar" onclick="editarTerapeuta(${terapeuta.id})" title="Editar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-excluir" onclick="excluirTerapeuta(${terapeuta.id})" title="Excluir">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function abrirModalTerapeuta() {
  document.getElementById('modal-terapeuta-titulo').textContent = 'Novo Terapeuta';
  document.getElementById('form-terapeuta').reset();
  document.getElementById('terapeuta-id').value = '';
  
  // Carregar especialidades
  const select = document.getElementById('terapeuta-especialidade');
  select.innerHTML = '<option value="">Selecione...</option>' +
    dados.especialidades.map(e => `<option value="${e.id}">${e.nome}</option>`).join('');
  
  document.getElementById('modal-terapeuta').style.display = 'flex';
}

function editarTerapeuta(id) {
  const terapeuta = dados.terapeutas.find(t => t.id === id);
  if (!terapeuta) return;
  
  document.getElementById('modal-terapeuta-titulo').textContent = 'Editar Terapeuta';
  document.getElementById('terapeuta-id').value = terapeuta.id;
  document.getElementById('terapeuta-nome').value = terapeuta.nome;
  document.getElementById('terapeuta-crp').value = terapeuta.crp || '';
  document.getElementById('terapeuta-telefone').value = terapeuta.telefone || '';
  document.getElementById('terapeuta-email').value = terapeuta.email || '';
  
  // Carregar especialidades
  const select = document.getElementById('terapeuta-especialidade');
  select.innerHTML = '<option value="">Selecione...</option>' +
    dados.especialidades.map(e => 
      `<option value="${e.id}" ${e.id === terapeuta.especialidadeId ? 'selected' : ''}>${e.nome}</option>`
    ).join('');
  
  document.getElementById('modal-terapeuta').style.display = 'flex';
}

function salvarTerapeuta(event) {
  event.preventDefault();
  
  const id = document.getElementById('terapeuta-id').value;
  
  const terapeuta = {
    id: id ? parseInt(id) : Date.now(),
    nome: document.getElementById('terapeuta-nome').value,
    especialidadeId: parseInt(document.getElementById('terapeuta-especialidade').value),
    crp: document.getElementById('terapeuta-crp').value,
    telefone: document.getElementById('terapeuta-telefone').value,
    email: document.getElementById('terapeuta-email').value
  };
  
  if (id) {
    const index = dados.terapeutas.findIndex(t => t.id === parseInt(id));
    if (index !== -1) {
      dados.terapeutas[index] = terapeuta;
    }
    mostrarToast('Terapeuta atualizado com sucesso!', 'sucesso');
  } else {
    dados.terapeutas.push(terapeuta);
    mostrarToast('Terapeuta cadastrado com sucesso!', 'sucesso');
  }
  
  salvarDados();
  fecharModal('modal-terapeuta');
  listarTerapeutas();
  atualizarDashboard();
}

function excluirTerapeuta(id) {
  if (!confirm('Deseja realmente excluir este terapeuta?')) return;
  
  dados.terapeutas = dados.terapeutas.filter(t => t.id !== id);
  salvarDados();
  listarTerapeutas();
  atualizarDashboard();
  mostrarToast('Terapeuta excluido com sucesso!', 'sucesso');
}

// ========================================
// ESPECIALIDADES
// ========================================
function listarEspecialidades() {
  const tbody = document.getElementById('tbody-especialidades');
  
  if (dados.especialidades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhuma especialidade cadastrada</td></tr>';
    return;
  }
  
  tbody.innerHTML = dados.especialidades.map(especialidade => {
    const qtdTerapeutas = dados.terapeutas.filter(t => t.especialidadeId === especialidade.id).length;
    return `
      <tr>
        <td>${especialidade.id}</td>
        <td>${especialidade.nome}</td>
        <td>
          <span class="badge" style="background: ${especialidade.cor}20; color: ${especialidade.cor};">
            <span class="badge-color" style="background: ${especialidade.cor};"></span>
            ${especialidade.cor}
          </span>
        </td>
        <td>${qtdTerapeutas}</td>
        <td class="acoes-cell">
          <button class="btn btn-icon btn-editar" onclick="editarEspecialidade(${especialidade.id})" title="Editar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-excluir" onclick="excluirEspecialidade(${especialidade.id})" title="Excluir">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function abrirModalEspecialidade() {
  document.getElementById('modal-especialidade-titulo').textContent = 'Nova Especialidade';
  document.getElementById('form-especialidade').reset();
  document.getElementById('especialidade-id').value = '';
  document.getElementById('especialidade-cor').value = '#10b981';
  document.getElementById('especialidade-cor-valor').textContent = '#10b981';
  
  document.getElementById('modal-especialidade').style.display = 'flex';
}

function editarEspecialidade(id) {
  const especialidade = dados.especialidades.find(e => e.id === id);
  if (!especialidade) return;
  
  document.getElementById('modal-especialidade-titulo').textContent = 'Editar Especialidade';
  document.getElementById('especialidade-id').value = especialidade.id;
  document.getElementById('especialidade-nome').value = especialidade.nome;
  document.getElementById('especialidade-cor').value = especialidade.cor;
  document.getElementById('especialidade-cor-valor').textContent = especialidade.cor;
  document.getElementById('especialidade-descricao').value = especialidade.descricao || '';
  
  document.getElementById('modal-especialidade').style.display = 'flex';
}

function salvarEspecialidade(event) {
  event.preventDefault();
  
  const id = document.getElementById('especialidade-id').value;
  
  const especialidade = {
    id: id ? parseInt(id) : Date.now(),
    nome: document.getElementById('especialidade-nome').value,
    cor: document.getElementById('especialidade-cor').value,
    descricao: document.getElementById('especialidade-descricao').value
  };
  
  if (id) {
    const index = dados.especialidades.findIndex(e => e.id === parseInt(id));
    if (index !== -1) {
      dados.especialidades[index] = especialidade;
    }
    mostrarToast('Especialidade atualizada com sucesso!', 'sucesso');
  } else {
    dados.especialidades.push(especialidade);
    mostrarToast('Especialidade cadastrada com sucesso!', 'sucesso');
  }
  
  salvarDados();
  fecharModal('modal-especialidade');
  listarEspecialidades();
  atualizarDashboard();
}

function excluirEspecialidade(id) {
  // Verificar se ha terapeutas vinculados
  const terapeutasVinculados = dados.terapeutas.filter(t => t.especialidadeId === id);
  if (terapeutasVinculados.length > 0) {
    mostrarToast('Nao e possivel excluir. Ha terapeutas vinculados a esta especialidade.', 'erro');
    return;
  }
  
  if (!confirm('Deseja realmente excluir esta especialidade?')) return;
  
  dados.especialidades = dados.especialidades.filter(e => e.id !== id);
  salvarDados();
  listarEspecialidades();
  atualizarDashboard();
  mostrarToast('Especialidade excluida com sucesso!', 'sucesso');
}

// Atualizar cor em tempo real
document.getElementById('especialidade-cor').addEventListener('input', function(e) {
  document.getElementById('especialidade-cor-valor').textContent = e.target.value;
});

// ========================================
// EVOLUCOES
// ========================================
function listarEvolucoes() {
  const tbody = document.getElementById('tbody-evolucoes');
  
  if (dados.evolucoes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma evolucao registrada</td></tr>';
    return;
  }
  
  tbody.innerHTML = dados.evolucoes.map(evolucao => {
    const paciente = dados.pacientes.find(p => p.id === evolucao.pacienteId);
    const terapeuta = dados.terapeutas.find(t => t.id === evolucao.terapeutaId);
    return `
      <tr>
        <td>${evolucao.id}</td>
        <td>${formatarData(evolucao.data)}</td>
        <td>${paciente ? paciente.nome : '-'}</td>
        <td>${terapeuta ? terapeuta.nome : '-'}</td>
        <td>${evolucao.resumo ? evolucao.resumo.substring(0, 50) + '...' : '-'}</td>
        <td class="acoes-cell">
          <button class="btn btn-icon btn-ver" onclick="verEvolucao(${evolucao.id})" title="Ver">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-editar" onclick="editarEvolucao(${evolucao.id})" title="Editar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-excluir" onclick="excluirEvolucao(${evolucao.id})" title="Excluir">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filtrarEvolucoes() {
  const busca = document.getElementById('busca-evolucoes').value.toLowerCase();
  const tbody = document.getElementById('tbody-evolucoes');
  
  const filtrados = dados.evolucoes.filter(e => {
    const paciente = dados.pacientes.find(p => p.id === e.pacienteId);
    const terapeuta = dados.terapeutas.find(t => t.id === e.terapeutaId);
    return (paciente && paciente.nome.toLowerCase().includes(busca)) ||
           (terapeuta && terapeuta.nome.toLowerCase().includes(busca)) ||
           (e.resumo && e.resumo.toLowerCase().includes(busca));
  });
  
  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma evolucao encontrada</td></tr>';
    return;
  }
  
  tbody.innerHTML = filtrados.map(evolucao => {
    const paciente = dados.pacientes.find(p => p.id === evolucao.pacienteId);
    const terapeuta = dados.terapeutas.find(t => t.id === evolucao.terapeutaId);
    return `
      <tr>
        <td>${evolucao.id}</td>
        <td>${formatarData(evolucao.data)}</td>
        <td>${paciente ? paciente.nome : '-'}</td>
        <td>${terapeuta ? terapeuta.nome : '-'}</td>
        <td>${evolucao.resumo ? evolucao.resumo.substring(0, 50) + '...' : '-'}</td>
        <td class="acoes-cell">
          <button class="btn btn-icon btn-ver" onclick="verEvolucao(${evolucao.id})" title="Ver">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-editar" onclick="editarEvolucao(${evolucao.id})" title="Editar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-excluir" onclick="excluirEvolucao(${evolucao.id})" title="Excluir">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function abrirModalEvolucao() {
  document.getElementById('modal-evolucao-titulo').textContent = 'Novo Registro de Evolucao';
  document.getElementById('form-evolucao').reset();
  document.getElementById('evolucao-id').value = '';
  
  // Definir data atual
  document.getElementById('evolucao-data').value = new Date().toISOString().split('T')[0];
  
  // Carregar pacientes
  const selectPaciente = document.getElementById('evolucao-paciente');
  selectPaciente.innerHTML = '<option value="">Selecione...</option>' +
    dados.pacientes.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
  
  // Carregar terapeutas
  const selectTerapeuta = document.getElementById('evolucao-terapeuta');
  selectTerapeuta.innerHTML = '<option value="">Selecione...</option>' +
    dados.terapeutas.map(t => `<option value="${t.id}">${t.nome}</option>`).join('');
  
  document.getElementById('modal-evolucao').style.display = 'flex';
}

function editarEvolucao(id) {
  const evolucao = dados.evolucoes.find(e => e.id === id);
  if (!evolucao) return;
  
  document.getElementById('modal-evolucao-titulo').textContent = 'Editar Evolucao';
  document.getElementById('evolucao-id').value = evolucao.id;
  document.getElementById('evolucao-data').value = evolucao.data;
  document.getElementById('evolucao-hora').value = evolucao.hora || '';
  document.getElementById('evolucao-objetivos').value = evolucao.objetivos || '';
  document.getElementById('evolucao-atividades').value = evolucao.atividades || '';
  document.getElementById('evolucao-observacoes').value = evolucao.observacoes || '';
  document.getElementById('evolucao-resumo').value = evolucao.resumo || '';
  document.getElementById('evolucao-proxima').value = evolucao.proximaSessao || '';
  
  // Carregar pacientes
  const selectPaciente = document.getElementById('evolucao-paciente');
  selectPaciente.innerHTML = '<option value="">Selecione...</option>' +
    dados.pacientes.map(p => 
      `<option value="${p.id}" ${p.id === evolucao.pacienteId ? 'selected' : ''}>${p.nome}</option>`
    ).join('');
  
  // Carregar terapeutas
  const selectTerapeuta = document.getElementById('evolucao-terapeuta');
  selectTerapeuta.innerHTML = '<option value="">Selecione...</option>' +
    dados.terapeutas.map(t => 
      `<option value="${t.id}" ${t.id === evolucao.terapeutaId ? 'selected' : ''}>${t.nome}</option>`
    ).join('');
  
  document.getElementById('modal-evolucao').style.display = 'flex';
}

function verEvolucao(id) {
  const evolucao = dados.evolucoes.find(e => e.id === id);
  if (!evolucao) return;
  
  const paciente = dados.pacientes.find(p => p.id === evolucao.pacienteId);
  const terapeuta = dados.terapeutas.find(t => t.id === evolucao.terapeutaId);
  const especialidade = terapeuta ? dados.especialidades.find(e => e.id === terapeuta.especialidadeId) : null;
  
  const detalhes = document.getElementById('evolucao-detalhes');
  detalhes.innerHTML = `
    <div class="info-row">
      <div class="info-item">
        <label>Data</label>
        <p>${formatarData(evolucao.data)}</p>
      </div>
      <div class="info-item">
        <label>Hora</label>
        <p>${evolucao.hora || '-'}</p>
      </div>
    </div>
    
    <div class="info-row">
      <div class="info-item">
        <label>Paciente</label>
        <p>${paciente ? paciente.nome : '-'}</p>
      </div>
      <div class="info-item">
        <label>Terapeuta</label>
        <p>${terapeuta ? terapeuta.nome : '-'}</p>
      </div>
      <div class="info-item">
        <label>Especialidade</label>
        <p>${especialidade ? especialidade.nome : '-'}</p>
      </div>
    </div>
    
    ${evolucao.objetivos ? `
      <div class="info-section">
        <h4>Objetivos da Sessao</h4>
        <p>${evolucao.objetivos}</p>
      </div>
    ` : ''}
    
    ${evolucao.atividades ? `
      <div class="info-section">
        <h4>Atividades Realizadas</h4>
        <p>${evolucao.atividades}</p>
      </div>
    ` : ''}
    
    ${evolucao.observacoes ? `
      <div class="info-section">
        <h4>Observacoes Clinicas</h4>
        <p>${evolucao.observacoes}</p>
      </div>
    ` : ''}
    
    <div class="info-section">
      <h4>Resumo</h4>
      <p>${evolucao.resumo || '-'}</p>
    </div>
    
    ${evolucao.proximaSessao ? `
      <div class="info-section">
        <h4>Planejamento Proxima Sessao</h4>
        <p>${evolucao.proximaSessao}</p>
      </div>
    ` : ''}
  `;
  
  document.getElementById('modal-ver-evolucao').style.display = 'flex';
}

function salvarEvolucao(event) {
  event.preventDefault();
  
  const id = document.getElementById('evolucao-id').value;
  
  const evolucao = {
    id: id ? parseInt(id) : Date.now(),
    data: document.getElementById('evolucao-data').value,
    hora: document.getElementById('evolucao-hora').value,
    pacienteId: parseInt(document.getElementById('evolucao-paciente').value),
    terapeutaId: parseInt(document.getElementById('evolucao-terapeuta').value),
    objetivos: document.getElementById('evolucao-objetivos').value,
    atividades: document.getElementById('evolucao-atividades').value,
    observacoes: document.getElementById('evolucao-observacoes').value,
    resumo: document.getElementById('evolucao-resumo').value,
    proximaSessao: document.getElementById('evolucao-proxima').value
  };
  
  if (id) {
    const index = dados.evolucoes.findIndex(e => e.id === parseInt(id));
    if (index !== -1) {
      dados.evolucoes[index] = evolucao;
    }
    mostrarToast('Evolucao atualizada com sucesso!', 'sucesso');
  } else {
    dados.evolucoes.push(evolucao);
    mostrarToast('Evolucao registrada com sucesso!', 'sucesso');
  }
  
  salvarDados();
  fecharModal('modal-evolucao');
  listarEvolucoes();
  atualizarDashboard();
}

function excluirEvolucao(id) {
  if (!confirm('Deseja realmente excluir esta evolucao?')) return;
  
  dados.evolucoes = dados.evolucoes.filter(e => e.id !== id);
  salvarDados();
  listarEvolucoes();
  atualizarDashboard();
  mostrarToast('Evolucao excluida com sucesso!', 'sucesso');
}

// ========================================
// RELATORIOS
// ========================================
function carregarFiltrosRelatorio() {
  // Carregar pacientes
  const selectPaciente = document.getElementById('relatorio-paciente');
  selectPaciente.innerHTML = '<option value="">Todos</option>' +
    dados.pacientes.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
  
  // Carregar terapeutas
  const selectTerapeuta = document.getElementById('relatorio-terapeuta');
  selectTerapeuta.innerHTML = '<option value="">Todos</option>' +
    dados.terapeutas.map(t => `<option value="${t.id}">${t.nome}</option>`).join('');
  
  // Carregar especialidades
  const selectEspecialidade = document.getElementById('relatorio-especialidade');
  selectEspecialidade.innerHTML = '<option value="">Todas</option>' +
    dados.especialidades.map(e => `<option value="${e.id}">${e.nome}</option>`).join('');
}

function gerarRelatorio() {
  const pacienteId = document.getElementById('relatorio-paciente').value;
  const terapeutaId = document.getElementById('relatorio-terapeuta').value;
  const especialidadeId = document.getElementById('relatorio-especialidade').value;
  const dataInicio = document.getElementById('relatorio-data-inicio').value;
  const dataFim = document.getElementById('relatorio-data-fim').value;
  
  let evolucoesFiltradas = [...dados.evolucoes];
  
  // Filtrar por paciente
  if (pacienteId) {
    evolucoesFiltradas = evolucoesFiltradas.filter(e => e.pacienteId === parseInt(pacienteId));
  }
  
  // Filtrar por terapeuta
  if (terapeutaId) {
    evolucoesFiltradas = evolucoesFiltradas.filter(e => e.terapeutaId === parseInt(terapeutaId));
  }
  
  // Filtrar por especialidade
  if (especialidadeId) {
    const terapeutasEsp = dados.terapeutas.filter(t => t.especialidadeId === parseInt(especialidadeId));
    const terapeutasIds = terapeutasEsp.map(t => t.id);
    evolucoesFiltradas = evolucoesFiltradas.filter(e => terapeutasIds.includes(e.terapeutaId));
  }
  
  // Filtrar por data
  if (dataInicio) {
    evolucoesFiltradas = evolucoesFiltradas.filter(e => e.data >= dataInicio);
  }
  if (dataFim) {
    evolucoesFiltradas = evolucoesFiltradas.filter(e => e.data <= dataFim);
  }
  
  // Renderizar resultado
  const tbody = document.getElementById('tbody-relatorio');
  
  if (evolucoesFiltradas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum registro encontrado com os filtros selecionados</td></tr>';
    return;
  }
  
  tbody.innerHTML = evolucoesFiltradas.map(evolucao => {
    const paciente = dados.pacientes.find(p => p.id === evolucao.pacienteId);
    const terapeuta = dados.terapeutas.find(t => t.id === evolucao.terapeutaId);
    const especialidade = terapeuta ? dados.especialidades.find(e => e.id === terapeuta.especialidadeId) : null;
    
    return `
      <tr>
        <td>${formatarData(evolucao.data)}</td>
        <td>${paciente ? paciente.nome : '-'}</td>
        <td>${terapeuta ? terapeuta.nome : '-'}</td>
        <td>${especialidade ? especialidade.nome : '-'}</td>
        <td>${evolucao.resumo || '-'}</td>
      </tr>
    `;
  }).join('');
  
  mostrarToast(`Relatorio gerado: ${evolucoesFiltradas.length} registro(s)`, 'info');
}

function limparFiltros() {
  document.getElementById('form-relatorio').reset();
  document.getElementById('tbody-relatorio').innerHTML = 
    '<tr><td colspan="5" class="empty-state">Use os filtros acima para gerar o relatorio</td></tr>';
}

function exportarRelatorio() {
  const tabela = document.getElementById('tbody-relatorio');
  const linhas = tabela.querySelectorAll('tr');
  
  if (linhas.length === 1 && linhas[0].querySelector('.empty-state')) {
    mostrarToast('Gere um relatorio primeiro', 'alerta');
    return;
  }
  
  // Criar CSV
  let csv = 'Data,Paciente,Terapeuta,Especialidade,Resumo\n';
  linhas.forEach(linha => {
    const colunas = linha.querySelectorAll('td');
    const valores = Array.from(colunas).map(col => `"${col.textContent.replace(/"/g, '""')}"`);
    csv += valores.join(',') + '\n';
  });
  
  // Download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `relatorio_vindx_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  
  mostrarToast('Relatorio exportado com sucesso!', 'sucesso');
}

// ========================================
// UTILITARIOS
// ========================================
function fecharModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

function formatarData(data) {
  if (!data) return '-';
  const partes = data.split('-');
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function mostrarToast(mensagem, tipo = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensagem;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Fechar modal ao clicar fora
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', function(e) {
    if (e.target === this) {
      this.style.display = 'none';
    }
  });
});

// ========================================
// INICIALIZACAO
// ========================================
document.addEventListener('DOMContentLoaded', function() {
  verificarLogin();
});
