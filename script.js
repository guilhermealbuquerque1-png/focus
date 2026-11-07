(() => {
  'use strict';

  const STORAGE_KEY = 'focus-organizer-v1';
  const THEME_KEY = 'focus-organizer-theme';
  // Troque pelos dados públicos do seu projeto Supabase; nunca use a service_role key no navegador.
  const SUPABASE_URL = 'https://gqxvpyrxcbgnoqaffkxq.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxeHZweXJ4Y2Jnbm9xYWZma3hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MDk4NzgsImV4cCI6MjEwOTQ4NTg3OH0.W1XsIB87SXMpT8frN86GWBZGRjQo2dCC_TdJ_a0nlxw';
  const DAYS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
  const CHECKLIST_ITEMS = ['Pesquisar produtos', 'Analisar preço, avaliações e comissão', 'Selecionar produtos', 'Buscar vídeos de referência', 'Editar vídeos', 'Publicar vídeos'];

  function defaultSchedule() {
    const periods = [
      [['05:30', '10:00'], ['13:00', '15:30'], ['15:50', '17:00']],
      [['05:30', '10:00'], ['13:00', '15:30'], ['15:50', '17:00']],
      [['05:30', '10:00'], ['13:00', '15:30'], ['15:50', '17:00']],
      [['05:30', '08:00'], ['11:00', '15:30'], ['15:50', '17:00']],
      [['05:30', '10:00'], ['13:00', '15:30'], ['15:50', '17:00']],
      [['05:30', '12:00'], ['', ''], ['', '']],
      [['', ''], ['', ''], ['', '']]
    ];
    return DAYS.map((name, index) => ({ name, periods: periods[index].map(([start, end]) => ({ start, end })) }));
  }

  function initialState() {
    return { subjects: [], cycles: [], currentCycleId: null, factor: 60, schedule: defaultSchedule(), availability: '', reviews: [], affiliateRecords: {}, affiliateChecklist: {} };
  }

  function normalizeState(parsed) {
    const base = initialState();
    const subjects = Array.isArray(parsed.subjects) ? parsed.subjects.map((subject) => ({
      ...subject,
      difficulty: Number.isInteger(Number(subject.difficulty)) && Number(subject.difficulty) >= 1 && Number(subject.difficulty) <= 5 ? Number(subject.difficulty) : 3,
      content: Number.isInteger(Number(subject.content)) && Number(subject.content) >= 1 && Number(subject.content) <= 5 ? Number(subject.content) : 3,
      weight: Number.isFinite(Number(subject.weight)) && Number(subject.weight) >= 1 ? Number(subject.weight) : 1
    })) : [];
    const cycles = Array.isArray(parsed.cycles) ? parsed.cycles.map((cycle) => {
      if (Array.isArray(cycle.subjects) && cycle.subjects.every((subject) => Array.isArray(subject.completed))) {
        return { ...cycle, legacy: true, status: 'archived' };
      }
      return { ...cycle, subjects: Array.isArray(cycle.subjects) ? cycle.subjects : [], sessions: Array.isArray(cycle.sessions) ? cycle.sessions : [], status: cycle.status || 'archived' };
    }) : [];
    return {
      ...base,
      ...parsed,
      subjects,
      cycles,
      currentCycleId: cycles.some((cycle) => cycle.id === parsed.currentCycleId && cycle.status === 'active' && !cycle.legacy) ? parsed.currentCycleId : null,
      factor: Number.isFinite(Number(parsed.factor)) && Number(parsed.factor) >= 30 && Number(parsed.factor) <= 1000 ? Number(parsed.factor) : 60,
      schedule: Array.isArray(parsed.schedule) && parsed.schedule.length === 7 ? parsed.schedule : base.schedule,
      availability: typeof parsed.availability === 'string' ? parsed.availability : '',
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
      affiliateRecords: parsed.affiliateRecords && typeof parsed.affiliateRecords === 'object' ? parsed.affiliateRecords : {},
      affiliateChecklist: parsed.affiliateChecklist && typeof parsed.affiliateChecklist === 'object' ? parsed.affiliateChecklist : {}
    };
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normalizeState(JSON.parse(saved)) : initialState();
    } catch (error) {
      console.error('Não foi possível carregar os dados salvos.', error);
      return initialState();
    }
  }

  let state = loadState();
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  function setTheme(theme, persist = true) {
    document.documentElement.dataset.theme = theme;
    const button = $('#theme-toggle');
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.setAttribute('aria-label', `Ativar tema ${theme === 'dark' ? 'claro' : 'escuro'}`);
    button.title = `Ativar tema ${theme === 'dark' ? 'claro' : 'escuro'}`;
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (error) {
        console.error('Não foi possível salvar a preferência de tema.', error);
      }
    }
  }

  function savedTheme() {
    try {
      const theme = localStorage.getItem(THEME_KEY);
      if (theme === 'light' || theme === 'dark') return theme;
    } catch (error) {
      console.error('Não foi possível carregar a preferência de tema.', error);
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  setTheme(savedTheme(), false);
  const makeId = () => window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  let supabaseClient = null;
  let cloudUserId = null;
  let cloudReady = false;
  let cloudUpdatedAt = null;
  let cloudSaveTimer = null;
  let cloudSaveInProgress = false;
  let cloudWriteQueue = Promise.resolve();
  let loadingUserId = null;
  let loadingAccountPromise = null;

  function setSyncStatus(message, status = '') {
    const element = $('#sync-status');
    if (!element) return;
    element.textContent = message;
    element.dataset.status = status;
    element.hidden = !message;
  }

  function persistCloudSnapshot() {
    if (!supabaseClient || !cloudReady || !cloudUserId) return cloudWriteQueue;
    const snapshot = JSON.parse(JSON.stringify(state));
    const userId = cloudUserId;
    cloudWriteQueue = cloudWriteQueue.catch(() => {}).then(async () => {
      if (userId !== cloudUserId || !cloudReady) return;
      cloudSaveInProgress = true;
      try {
        const updatedAt = new Date().toISOString();
        const { error } = await supabaseClient.from('user_data').upsert({
          user_id: userId,
          data: snapshot,
          updated_at: updatedAt
        }, { onConflict: 'user_id' });
        if (error) throw error;
        cloudUpdatedAt = updatedAt;
        setSyncStatus('Sincronizado com sua conta', 'success');
      } finally {
        cloudSaveInProgress = false;
      }
    }).catch((error) => {
      console.error('Não foi possível sincronizar com o Supabase.', error);
      setSyncStatus('Falha ao sincronizar. Verifique a conexão e a tabela user_data.', 'error');
    });
    return cloudWriteQueue;
  }

  function queueCloudSave() {
    if (!supabaseClient || !cloudReady || !cloudUserId) return;
    window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
    setSyncStatus('Salvando na sua conta…', 'pending');
    cloudSaveTimer = window.setTimeout(() => {
      cloudSaveTimer = null;
      persistCloudSnapshot();
    }, 350);
  }

  // Salva localmente para acesso offline e sincroniza quando uma conta está autenticada.
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Não foi possível salvar os dados.', error);
      window.alert('Não foi possível salvar os dados neste navegador. Verifique o espaço disponível.');
    }
    queueCloudSave();
  }

  function todayKey() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatDate(dateString) {
    const [year, month, day] = dateString.slice(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function hoursFor(subject, factor = state.factor) {
    // The adjustment factor scales each proportional score; the product sets the relative share.
    return Math.max(1, Math.floor((subject.difficulty * subject.content * subject.weight * factor) / 60 + 0.5));
  }

  function distribution() {
    return state.subjects.map((subject) => ({ subject, hours: hoursFor(subject) }));
  }

  function activeCycle() {
    return state.cycles.find((cycle) => cycle.id === state.currentCycleId && cycle.status === 'active' && !cycle.legacy) || null;
  }

  function cycleTotals(cycle) {
    const planned = cycle.subjects.reduce((sum, subject) => sum + subject.plannedHours, 0);
    const studied = cycle.subjects.reduce((sum, subject) => sum + subject.studiedMinutes, 0);
    return { planned, studied, completedHours: Math.floor(studied / 60), percent: planned ? Math.min(100, Math.round((studied / (planned * 60)) * 100)) : 0 };
  }

  function navigate(viewName) {
    document.querySelectorAll('.view').forEach((view) => {
      const active = view.id === `view-${viewName}`;
      view.classList.toggle('active', active);
      view.hidden = !active;
    });
    document.querySelectorAll('.nav-button').forEach((button) => {
      const active = button.dataset.view === viewName;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (viewName === 'ciclos') renderCycles();
    if (viewName === 'afiliados') renderAffiliates();
    if (viewName === 'configurar') renderSubjects();
  }

  function renderSubjects() {
    $('#subjects-list').innerHTML = state.subjects.map((subject) => `
      <tr><td>${escapeHtml(subject.name)}</td><td>${subject.difficulty} / 5</td><td>${subject.content} / 5</td><td>${subject.weight}</td>
      <td><div class="row-actions"><button class="button secondary small edit-subject" data-id="${escapeHtml(subject.id)}" type="button">Editar</button><button class="button danger small delete-subject" data-id="${escapeHtml(subject.id)}" type="button">Excluir</button></div></td></tr>`).join('');
    $('#subjects-empty').classList.toggle('hidden', state.subjects.length > 0);
    renderPreview();
  }

  function renderPreview() {
    const preview = $('#distribution-preview');
    const factor = Number($('#cycle-factor').value);
    if (!state.subjects.length) {
      preview.innerHTML = '<p class="empty-note">A prévia das horas aparecerá após cadastrar matérias.</p>';
      return;
    }
    if (!Number.isInteger(factor) || factor < 30 || factor > 1000) {
      preview.innerHTML = '<p class="below">Use um fator inteiro entre 30 e 1000.</p>';
      return;
    }
    const items = distribution().map(({ subject }) => ({ subject, hours: hoursFor(subject, factor) }));
    if (items.some((item) => item.hours > 10000)) {
      preview.innerHTML = '<p class="below">A estimativa excede 10.000 horas para uma matéria. Reduza o fator ou o peso para visualizar os quadradinhos com segurança.</p>';
      return;
    }
    const total = items.reduce((sum, item) => sum + item.hours, 0);
    const activeNotice = activeCycle() ? '<p class="hint">Alterações nas matérias não mudam o ciclo em andamento. Use “Recalcular ciclo” para criar uma nova distribuição; o progresso atual será preservado no histórico.</p>' : '';
    preview.innerHTML = `<div class="preview-heading"><h3>Prévia da distribuição</h3><strong>${total} h no ciclo</strong></div><ul>${items.map(({ subject, hours }) => `<li><span>${escapeHtml(subject.name)} <small>(D${subject.difficulty} × C${subject.content} × P${subject.weight})</small></span><strong>${hours} h</strong></li>`).join('')}</ul>${activeNotice}`;
  }

  function resetSubjectForm() {
    $('#subject-form').reset();
    $('#subject-id').value = '';
    $('#subject-difficulty').value = '3';
    $('#subject-content').value = '3';
    $('#subject-weight').value = '1';
    $('#subject-submit').textContent = 'Adicionar matéria';
    $('#subject-cancel').classList.add('hidden');
  }

  $('#subject-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#subject-name').value.trim();
    const difficulty = Number($('#subject-difficulty').value);
    const content = Number($('#subject-content').value);
    const weight = Number($('#subject-weight').value);
    if (!name || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5 || !Number.isInteger(content) || content < 1 || content > 5 || !Number.isSafeInteger(weight) || weight < 1) {
      window.alert('Informe o nome, avaliações de 1 a 5 e um peso inteiro positivo.');
      return;
    }
    const id = $('#subject-id').value;
    if (id) {
      const subject = state.subjects.find((item) => item.id === id);
      if (subject) Object.assign(subject, { name, difficulty, content, weight });
    } else {
      state.subjects.push({ id: makeId(), name, difficulty, content, weight });
    }
    saveState();
    resetSubjectForm();
    renderSubjects();
  });

  $('#subject-cancel').addEventListener('click', resetSubjectForm);
  $('#subjects-list').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const subject = state.subjects.find((item) => item.id === button.dataset.id);
    if (!subject) return;
    if (button.classList.contains('edit-subject')) {
      $('#subject-id').value = subject.id;
      $('#subject-name').value = subject.name;
      $('#subject-difficulty').value = subject.difficulty;
      $('#subject-content').value = subject.content;
      $('#subject-weight').value = subject.weight;
      $('#subject-submit').textContent = 'Salvar alterações';
      $('#subject-cancel').classList.remove('hidden');
      $('#subject-name').focus();
    } else if (button.classList.contains('delete-subject')) {
      if (!window.confirm(`Excluir a matéria “${subject.name}”? Ciclos existentes preservam seus dados.`)) return;
      state.subjects = state.subjects.filter((item) => item.id !== subject.id);
      if ($('#subject-id').value === subject.id) resetSubjectForm();
      saveState();
      renderSubjects();
    }
  });

  function setFactorFromInput() {
    const factor = Number($('#cycle-factor').value);
    if (!Number.isInteger(factor) || factor < 30 || factor > 1000) return false;
    state.factor = factor;
    return true;
  }

  function startCycle(name, factor) {
    const entries = state.subjects.map((subject) => ({ subject, plannedHours: hoursFor(subject, factor) }));
    if (entries.some((entry) => entry.plannedHours > 10000)) {
      window.alert('A estimativa de uma matéria ultrapassa 10.000 horas. Reduza o fator ou o peso.');
      return false;
    }
    const previous = activeCycle();
    if (previous) previous.status = 'archived';
    const cycle = {
      id: makeId(), name, factor, createdAt: new Date().toISOString(), status: 'active', legacy: false, sessions: [],
      subjects: entries.map(({ subject, plannedHours }) => ({ subjectId: subject.id, name: subject.name, difficulty: subject.difficulty, content: subject.content, weight: subject.weight, plannedHours, studiedMinutes: 0 }))
    };
    state.cycles.unshift(cycle);
    state.currentCycleId = cycle.id;
    saveState();
    renderSubjects();
    navigate('ciclos');
    return true;
  }

  $('#create-cycle-button').addEventListener('click', () => {
    if (!state.subjects.length) {
      window.alert('Cadastre ao menos uma matéria antes de criar um ciclo.');
      return;
    }
    if (!setFactorFromInput()) {
      window.alert('Informe um fator inteiro entre 30 e 1000.');
      return;
    }
    const name = $('#cycle-name').value.trim();
    if (!name) {
      window.alert('Informe um nome para o ciclo.');
      $('#cycle-name').focus();
      return;
    }
    const current = activeCycle();
    const confirmation = current ? `O ciclo “${current.name}” será preservado como arquivado, sem perder sessões. Criar “${name}” com a prévia atual?` : `Criar “${name}” com a distribuição exibida?`;
    if (!window.confirm(confirmation)) return;
    if (startCycle(name, state.factor)) $('#cycle-name').value = '';
  });

  $('#recalculate-cycle-button').addEventListener('click', () => {
    if (!state.subjects.length) {
      window.alert('Cadastre matérias para calcular uma distribuição.');
      return;
    }
    if (!setFactorFromInput()) {
      window.alert('Informe um fator inteiro entre 30 e 1000.');
      return;
    }
    const current = activeCycle();
    if (!current) {
      window.alert('Não há ciclo em andamento. Use “Criar ciclo” para iniciar um.');
      return;
    }
    const nextName = $('#cycle-name').value.trim() || current.name;
    const total = distribution().reduce((sum, item) => sum + hoursFor(item.subject, state.factor), 0);
    if (!window.confirm(`Recalcular “${current.name}” para “${nextName}” (${total} horas)? O ciclo atual e todas as sessões serão preservados no histórico; o novo planejamento começa sem progresso.`)) return;
    startCycle(nextName, state.factor);
  });

  function hoursAndMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  function renderSessionForm(cycle) {
    const section = $('#study-session-section');
    section.classList.toggle('hidden', !cycle);
    if (!cycle) {
      $('#session-subject').innerHTML = '<option value="">Nenhum ciclo ativo</option>';
      return;
    }
    const remainingSubjects = cycle.subjects.filter((subject) => subject.studiedMinutes < subject.plannedHours * 60);
    $('#session-subject').innerHTML = remainingSubjects.length
      ? remainingSubjects.map((subject) => `<option value="${escapeHtml(subject.subjectId)}">${escapeHtml(subject.name)} — restam ${hoursAndMinutes(subject.plannedHours * 60 - subject.studiedMinutes)}</option>`).join('')
      : '<option value="">Todas as matérias concluídas</option>';
    const dayIndex = (new Date().getDay() + 6) % 7;
    const todaysPeriods = state.schedule[dayIndex]?.periods.filter((period) => period.start && period.end).map((period) => `${period.start}–${period.end}`).join(' e ');
    $('#session-status').textContent = todaysPeriods ? `Disponibilidade informada para hoje: ${todaysPeriods}. É apenas uma referência, não uma obrigação.` : 'Nenhum período informado para hoje; você pode registrar estudo quando desejar.';
  }

  function renderReviews() {
    $('#reviews-list').innerHTML = state.reviews.slice().reverse().map((review) => `<li><span>${escapeHtml(review.topic)} · ${review.minutes} min</span><span>${formatDate(review.date)}</span></li>`).join('');
  }

  function renderLegacyCycle(cycle) {
    const subjects = cycle.subjects.map((subject) => {
      const completed = subject.completed.filter(Boolean).length;
      const squares = subject.completed.map((done) => `<span class="block legacy-block${done ? ' done' : ''}" aria-label="${done ? 'Concluído' : 'Pendente'}"></span>`).join('');
      return `<div class="cycle-subject"><div class="subject-line"><span>${escapeHtml(subject.name)}</span><span class="subject-progress">${completed} / ${subject.blocks} blocos antigos</span></div><div class="blocks">${squares}</div></div>`;
    }).join('');
    const done = cycle.subjects.reduce((sum, subject) => sum + subject.completed.filter(Boolean).length, 0);
    const total = cycle.subjects.reduce((sum, subject) => sum + subject.blocks, 0);
    return `<article class="cycle-card legacy-cycle"><div class="cycle-top"><div><h2>${escapeHtml(cycle.name)} · Histórico anterior</h2><p class="cycle-date">Criado em ${formatDate(cycle.createdAt || new Date().toISOString())} · progresso de blocos mantido</p></div><button class="button danger delete-cycle" data-cycle-id="${escapeHtml(cycle.id)}" type="button">Excluir ciclo</button></div><p class="hint">Este ciclo foi criado pela versão anterior e seus blocos não representam horas conhecidas. O progresso foi preservado sem conversão.</p><p class="progress-info">${done} de ${total} blocos concluídos</p>${subjects}</article>`;
  }

  function renderCycles() {
    const cycle = activeCycle();
    renderSessionForm(cycle);
    renderReviews();
    const ordered = state.cycles.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    $('#cycles-list').innerHTML = ordered.map((item) => {
      if (item.legacy) return renderLegacyCycle(item);
      const totals = cycleTotals(item);
      const finished = item.status === 'completed';
      const subjects = item.subjects.map((subject) => {
        const completeSquares = Math.min(subject.plannedHours, Math.floor(subject.studiedMinutes / 60));
        const squares = Array.from({ length: subject.plannedHours }, (_, index) => `<span class="block${index < completeSquares ? ' done' : ''}" role="img" aria-label="Hora ${index + 1}, ${index < completeSquares ? 'concluída' : 'pendente'}"></span>`).join('');
        const remainingMinutes = Math.max(0, subject.plannedHours * 60 - subject.studiedMinutes);
        return `<div class="cycle-subject"><div class="subject-line"><span>${escapeHtml(subject.name)} <small>(dificuldade ${subject.difficulty}, conteúdo ${subject.content}, peso ${subject.weight})</small></span><span class="subject-progress">${subject.plannedHours} h previstas · ${hoursAndMinutes(subject.studiedMinutes)} concluídas · ${hoursAndMinutes(remainingMinutes)} restantes</span></div><div class="blocks" aria-label="${escapeHtml(subject.name)}: ${completeSquares} de ${subject.plannedHours} horas concluídas">${squares}</div></div>`;
      }).join('');
      const bySubject = item.subjects.map((subject) => `<li><span>${escapeHtml(subject.name)}</span><strong>${hoursAndMinutes(subject.studiedMinutes)}</strong></li>`).join('');
      const sessions = item.sessions.length ? `<details class="session-history"><summary>Sessões registradas (${item.sessions.length})</summary><ul>${item.sessions.slice().reverse().map((session) => `<li><span>${escapeHtml(session.subjectName)} · ${hoursAndMinutes(session.minutes)}</span><span>${formatDate(session.date)}</span></li>`).join('')}</ul></details>` : '';
      const actions = `<div class="cycle-actions">${finished ? '<button class="button primary start-cycle" type="button">Iniciar novo ciclo</button>' : ''}<button class="button secondary print-cycle" type="button">Imprimir / salvar PDF</button>${!finished && item.status === 'active' ? '<span class="cycle-active-label">Em andamento</span>' : ''}<button class="button danger delete-cycle" data-cycle-id="${escapeHtml(item.id)}" type="button">Excluir ciclo</button></div>`;
      return `<article class="cycle-card${finished ? ' is-complete' : ''}" data-cycle-id="${escapeHtml(item.id)}"><div class="cycle-top"><div><h2>${escapeHtml(item.name)}${finished ? ' · Finalizado' : item.status === 'archived' ? ' · Arquivado' : ''}</h2><p class="cycle-date">Criado em ${formatDate(item.createdAt)} · fator ${item.factor}</p></div>${actions}</div>
        <div class="cycle-summary"><p><strong>${totals.planned} h</strong><span>planejadas</span></p><p><strong>${hoursAndMinutes(totals.studied)}</strong><span>líquidas concluídas</span></p><p><strong>${hoursAndMinutes(Math.max(0, totals.planned * 60 - totals.studied))}</strong><span>restantes</span></p></div>
        <div class="progress-info"><div class="progress-summary">Progresso do ciclo<div class="progress-track" role="progressbar" aria-valuenow="${totals.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso do ciclo"><div class="progress-fill" style="width:${totals.percent}%"></div></div></div><span class="progress-label">${totals.percent}%</span></div>${subjects}
        ${finished ? `<div class="cycle-results"><h3>Ciclo concluído · ${hoursAndMinutes(totals.studied)} no total</h3><ul>${bySubject}</ul></div>` : ''}${sessions}</article>`;
    }).join('');
    $('#cycles-empty').classList.toggle('hidden', state.cycles.length > 0);
  }

  function finishCycleIfDone(cycle) {
    const complete = cycle.subjects.every((subject) => subject.studiedMinutes >= subject.plannedHours * 60);
    if (complete) {
      cycle.status = 'completed';
      state.currentCycleId = null;
      return true;
    }
    return false;
  }

  $('#study-session-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const cycle = activeCycle();
    const subject = cycle?.subjects.find((item) => item.subjectId === $('#session-subject').value);
    const hours = Number($('#session-hours').value);
    const minutes = Number($('#session-minutes').value);
    if (!cycle || !subject || !Number.isInteger(hours) || hours < 0 || hours > 100 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59 || hours * 60 + minutes <= 0) {
      window.alert('Selecione uma matéria pendente e informe um tempo válido maior que zero.');
      return;
    }
    const duration = hours * 60 + minutes;
    const remaining = subject.plannedHours * 60 - subject.studiedMinutes;
    if (duration > remaining) {
      window.alert(`Esta matéria tem ${hoursAndMinutes(remaining)} restantes neste ciclo. Registre no máximo esse tempo; o excedente pode ser informado em outro registro fora do ciclo.`);
      return;
    }
    subject.studiedMinutes += duration;
    cycle.sessions.push({ id: makeId(), subjectId: subject.subjectId, subjectName: subject.name, minutes: duration, date: todayKey(), createdAt: new Date().toISOString() });
    const completed = finishCycleIfDone(cycle);
    saveState();
    $('#session-hours').value = '0';
    $('#session-minutes').value = '0';
    renderCycles();
    if (completed) window.alert(`Ciclo concluído! Total líquido: ${hoursAndMinutes(cycleTotals(cycle).studied)}. O histórico foi preservado.`);
  });

  $('#review-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const topic = $('#review-topic').value.trim();
    const minutes = Number($('#review-minutes').value);
    if (!topic || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      window.alert('Informe o assunto e uma duração de revisão entre 1 e 1440 minutos.');
      return;
    }
    state.reviews.push({ id: makeId(), topic, minutes, date: todayKey() });
    saveState();
    $('#review-form').reset();
    renderReviews();
  });

  $('#cycles-list').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.classList.contains('delete-cycle')) {
      const cycle = state.cycles.find((item) => item.id === button.dataset.cycleId);
      if (!cycle || !window.confirm(`Excluir “${cycle.name}” e todo o histórico deste ciclo?`)) return;
      state.cycles = state.cycles.filter((item) => item.id !== cycle.id);
      if (state.currentCycleId === cycle.id) state.currentCycleId = null;
      saveState();
      renderCycles();
    } else if (button.classList.contains('print-cycle')) {
      document.querySelectorAll('.cycle-card').forEach((card) => card.classList.remove('print-target'));
      button.closest('.cycle-card').classList.add('print-target');
      document.body.classList.add('printing-cycle');
      window.print();
    } else if (button.classList.contains('start-cycle')) {
      const previous = state.cycles.find((item) => item.id === button.closest('.cycle-card').dataset.cycleId);
      if (!previous || !setFactorFromInput()) {
        window.alert('Informe um fator inteiro entre 30 e 1000 antes de iniciar o ciclo.');
        return;
      }
      if (!window.confirm(`Iniciar um novo ciclo com as matérias e a distribuição atuais? “${previous.name}” continuará preservado no histórico.`)) return;
      const name = $('#cycle-name').value.trim() || previous.name.replace(/ — ciclo \d+$/, '') + ' — novo ciclo';
      startCycle(name, state.factor);
    }
  });

  function renderSchedule() {
    $('#availability-schedule').innerHTML = DAYS.map((day, index) => {
      const saved = state.schedule[index] || { periods: [{ start: '', end: '' }, { start: '', end: '' }] };
      const enabled = saved.periods.some((period) => period.start || period.end);
      const periods = [0, 1, 2].map((slot) => {
        const period = saved.periods[slot] || { start: '', end: '' };
        return `<div class="schedule-period"><label>Período ${slot + 1}<span class="schedule-time"><input type="time" data-day="${index}" data-slot="${slot}" data-part="start" aria-label="${day}, período ${slot + 1}, início" value="${escapeHtml(period.start)}" /><span>às</span><input type="time" data-day="${index}" data-slot="${slot}" data-part="end" aria-label="${day}, período ${slot + 1}, fim" value="${escapeHtml(period.end)}" /></span></label></div>`;
      }).join('');
      return `<fieldset class="schedule-day"><label class="schedule-day-toggle"><input type="checkbox" data-schedule-day="${index}" ${enabled ? 'checked' : ''} />${day}</label><div class="schedule-periods">${periods}</div></fieldset>`;
    }).join('');
  }

  $('#save-availability').addEventListener('click', () => {
    for (let index = 0; index < DAYS.length; index += 1) {
      const enabled = $(`[data-schedule-day="${index}"]`).checked;
      for (let slot = 0; slot < 3; slot += 1) {
        const start = $(`[data-day="${index}"][data-slot="${slot}"][data-part="start"]`).value;
        const end = $(`[data-day="${index}"][data-slot="${slot}"][data-part="end"]`).value;
        if (enabled && (start || end) && (!start || !end || start >= end)) {
          window.alert(`${DAYS[index]}, período ${slot + 1}: informe horários válidos, com término após o início.`);
          return;
        }
      }
    }
    const schedule = DAYS.map((name, index) => {
      const enabled = $(`[data-schedule-day="${index}"]`).checked;
      const periods = [0, 1, 2].map((slot) => {
        const start = $(`[data-day="${index}"][data-slot="${slot}"][data-part="start"]`).value;
        const end = $(`[data-day="${index}"][data-slot="${slot}"][data-part="end"]`).value;
        return enabled ? { start, end } : { start: '', end: '' };
      });
      return { name, periods };
    });
    state.schedule = schedule;
    state.availability = $('#availability').value.trim();
    saveState();
    $('#availability-status').textContent = 'Disponibilidade salva. Ela não define matérias nem metas diárias.';
    renderCycles();
    window.setTimeout(() => { $('#availability-status').textContent = ''; }, 3000);
  });

  $('#availability-schedule').addEventListener('change', (event) => {
    if (event.target.matches('[data-schedule-day]')) {
      const index = event.target.dataset.scheduleDay;
      document.querySelectorAll(`[data-day="${index}"]`).forEach((input) => { input.disabled = !event.target.checked; });
    }
  });

  function renderAffiliates() {
    const today = todayKey();
    $('#affiliate-date').textContent = formatDate(today);
    const record = state.affiliateRecords[today];
    $('#videos-count').value = record ? record.videos : 0;
    const status = $('#today-status');
    if (record) {
      const met = record.videos >= 3;
      status.textContent = met ? `Meta mínima atingida: ${record.videos} vídeo${record.videos === 1 ? '' : 's'} publicado${record.videos === 1 ? '' : 's'}.` : `Abaixo da meta mínima: ${record.videos} de 3 vídeos. Este registro permanece no histórico.`;
      status.className = `today-status ${met ? 'met' : 'below'}`;
    } else {
      status.textContent = 'Ainda não há registro para hoje.';
      status.className = 'today-status';
    }
    $('#affiliate-checklist').innerHTML = CHECKLIST_ITEMS.map((item, index) => `<label><input type="checkbox" data-checklist-index="${index}" ${state.affiliateChecklist[today]?.[index] ? 'checked' : ''} />${escapeHtml(item)}</label>`).join('');
    const records = Object.keys(state.affiliateRecords).sort((a, b) => b.localeCompare(a));
    $('#affiliate-history').innerHTML = records.map((date) => {
      const videos = Number(state.affiliateRecords[date].videos) || 0;
      const met = videos >= 3;
      return `<tr><td>${formatDate(date)}</td><td>${videos}</td><td>3 vídeos</td><td class="${met ? 'met' : 'below'}">${met ? 'Meta atingida' : 'Abaixo da meta'}</td></tr>`;
    }).join('');
    $('#history-empty').classList.toggle('hidden', records.length > 0);
  }

  $('#affiliate-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const videos = Number($('#videos-count').value);
    if (!Number.isSafeInteger(videos) || videos < 0) {
      window.alert('Informe uma quantidade válida de vídeos (zero ou mais).');
      return;
    }
    state.affiliateRecords[todayKey()] = { videos };
    saveState();
    renderAffiliates();
  });

  $('#affiliate-checklist').addEventListener('change', (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const today = todayKey();
    if (!state.affiliateChecklist[today]) state.affiliateChecklist[today] = Array(CHECKLIST_ITEMS.length).fill(false);
    state.affiliateChecklist[today][Number(event.target.dataset.checklistIndex)] = event.target.checked;
    saveState();
  });

  let authMode = 'login';
  let localAccess = false;
  let accountLoadToken = 0;
  const supabaseConfigured = !SUPABASE_URL.includes('YOUR_PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR_');

  function hasSavedContent(data) {
    if (!data) return false;
    const customSchedule = Array.isArray(data.schedule) && JSON.stringify(data.schedule) !== JSON.stringify(initialState().schedule);
    return Boolean(
      (Array.isArray(data.subjects) && data.subjects.length) ||
      (Array.isArray(data.cycles) && data.cycles.length) ||
      (Array.isArray(data.reviews) && data.reviews.length) ||
      (data.affiliateRecords && Object.keys(data.affiliateRecords).length) ||
      (data.affiliateChecklist && Object.keys(data.affiliateChecklist).length) ||
      (typeof data.availability === 'string' && data.availability.trim()) ||
      customSchedule ||
      (Number(data.factor) && Number(data.factor) !== 60)
    );
  }

  function renderWorkspaceState() {
    $('#cycle-factor').value = String(state.factor);
    $('#availability').value = state.availability;
    renderSchedule();
    document.querySelectorAll('[data-day]').forEach((input) => {
      const enabled = $(`[data-schedule-day="${input.dataset.day}"]`).checked;
      input.disabled = !enabled;
    });
    renderSubjects();
    renderReviews();
    renderCycles();
    renderAffiliates();
  }

  async function loadAccountData(userId) {
    if (cloudReady && cloudUserId === userId) {
      showWorkspace();
      return;
    }
    if (loadingUserId === userId && loadingAccountPromise) return loadingAccountPromise;
    loadingUserId = userId;
    const token = ++accountLoadToken;
    cloudReady = false;
    window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
    setSyncStatus('Carregando dados da sua conta…', 'pending');
    loadingAccountPromise = (async () => {
      try {
        const { data: row, error } = await supabaseClient
          .from('user_data')
          .select('data, updated_at')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;
        if (token !== accountLoadToken) return;

        const localState = state;
        const localHasData = hasSavedContent(localState);
        let accountRow = row;
        if (accountRow && !hasSavedContent(accountRow.data) && localHasData && window.confirm('A conta na nuvem está vazia, mas este dispositivo tem dados locais. Deseja enviar os dados locais (incluindo ciclos) para a conta e sincronizá-los nos outros dispositivos?')) {
          const candidate = normalizeState(localState);
          const updatedAt = new Date().toISOString();
          const { error: migrationError } = await supabaseClient.from('user_data').upsert({
            user_id: userId,
            data: candidate,
            updated_at: updatedAt
          }, { onConflict: 'user_id' });
          if (migrationError) throw migrationError;
          accountRow = { data: candidate, updated_at: updatedAt };
        }
        if (!accountRow) {
          const candidate = normalizeState(localHasData ? localState : initialState());
          const updatedAt = new Date().toISOString();
          const { error: insertError } = await supabaseClient.from('user_data').insert({
            user_id: userId,
            data: candidate,
            updated_at: updatedAt
          });
          if (insertError?.code === '23505') {
            // Outro dispositivo criou a linha primeiro; carregue a conta em vez de sobrescrevê-la.
            const { data: existingRow, error: reloadError } = await supabaseClient
              .from('user_data')
              .select('data, updated_at')
              .eq('user_id', userId)
              .single();
            if (reloadError) throw reloadError;
            accountRow = existingRow;
          } else if (insertError) {
            throw insertError;
          } else {
            accountRow = { data: candidate, updated_at: updatedAt };
          }
        }
        if (token !== accountLoadToken) return;

        // A linha da conta é a fonte oficial após a migração inicial, inclusive se estiver vazia.
        state = normalizeState(accountRow.data);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (storageError) {
          console.warn('Os dados foram carregados da conta, mas não puderam ser guardados neste navegador.', storageError);
        }
        cloudUserId = userId;
        cloudUpdatedAt = accountRow.updated_at || null;
        cloudReady = true;
        renderWorkspaceState();
        setSyncStatus('Sincronizado com sua conta', 'success');
        showWorkspace();
      } catch (error) {
        if (token !== accountLoadToken) return;
        console.error('Não foi possível carregar os dados da conta.', error);
        cloudReady = false;
        cloudUserId = null;
        setSyncStatus('');
        setAuthStatus(`Não foi possível acessar user_data no Supabase: ${error.message}. Confira a tabela e as políticas RLS no README.`, true);
        showAuth();
      } finally {
        if (loadingUserId === userId) {
          loadingUserId = null;
          loadingAccountPromise = null;
        }
      }
    })();
    return loadingAccountPromise;
  }

  async function refreshAccountData() {
    if (!supabaseClient || !cloudReady || !cloudUserId || document.hidden || cloudSaveTimer !== null || cloudSaveInProgress) return;
    const userId = cloudUserId;
    try {
      const { data: row, error } = await supabaseClient
        .from('user_data')
        .select('data, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (userId !== cloudUserId || !row) return;
      const remoteTime = Date.parse(row.updated_at || '');
      const localTime = Date.parse(cloudUpdatedAt || '');
      if (Number.isFinite(remoteTime) && remoteTime > localTime) {
        state = normalizeState(row.data);
        cloudUpdatedAt = row.updated_at;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (storageError) {
          console.warn('Dados atualizados da conta, mas o cache local não pôde ser atualizado.', storageError);
        }
        renderWorkspaceState();
        setSyncStatus('Dados atualizados da sua conta', 'success');
      }
    } catch (error) {
      console.error('Não foi possível atualizar os dados da conta.', error);
      setSyncStatus('Não foi possível atualizar da nuvem. Verifique sua conexão.', 'error');
    }
  }

  window.addEventListener('focus', refreshAccountData);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAccountData();
  });


  function showWorkspace(localOnly = false) {
    localAccess = localOnly;
    $('#auth-screen').hidden = true;
    $('#app-shell').hidden = false;
  }

  function showAuth() {
    $('#app-shell').hidden = true;
    $('#auth-screen').hidden = false;
  }

  function setAuthStatus(message, isError = false) {
    const status = $('#auth-status');
    status.textContent = message;
    status.classList.toggle('below', isError);
    status.classList.toggle('met', !isError && Boolean(message));
  }

  function initializeAuth() {
    if (!supabaseConfigured) return;
    if (!window.supabase?.createClient) {
      setAuthStatus('A biblioteca do Supabase não foi carregada. Você ainda pode continuar sem conta.', true);
      return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (session) {
        localAccess = false;
        window.setTimeout(() => loadAccountData(session.user.id), 0);
      } else {
        accountLoadToken += 1;
        cloudReady = false;
        cloudUserId = null;
        window.clearTimeout(cloudSaveTimer);
        cloudSaveTimer = null;
        if (!localAccess) showAuth();
      }
    });
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) setAuthStatus(error.message, true);
      if (data?.session) loadAccountData(data.session.user.id);
    }).catch((error) => {
      setAuthStatus(`Não foi possível restaurar a sessão: ${error.message}`, true);
    });
  }

  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!supabaseConfigured || !supabaseClient) {
      setAuthStatus('Configure SUPABASE_URL e SUPABASE_ANON_KEY no script.js para ativar o login. Para usar agora, continue sem conta.', true);
      return;
    }
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const result = authMode === 'login'
      ? await supabaseClient.auth.signInWithPassword({ email, password })
      : await supabaseClient.auth.signUp({ email, password });
    if (result.error) setAuthStatus(result.error.message, true);
    else if (authMode === 'signup' && !result.data.session) setAuthStatus('Conta criada. Confira seu e-mail para confirmar o cadastro.');
    else setAuthStatus('Acesso realizado.');
  });

  $('#auth-mode-toggle').addEventListener('click', () => {
    authMode = authMode === 'login' ? 'signup' : 'login';
    $('#auth-title').textContent = authMode === 'login' ? 'Acesse sua conta' : 'Crie sua conta';
    $('#auth-submit').textContent = authMode === 'login' ? 'Entrar' : 'Criar conta';
    $('#auth-mode-toggle').textContent = authMode === 'login' ? 'Criar uma conta' : 'Já tenho uma conta';
    $('#auth-password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    setAuthStatus('');
  });

  $('#google-login').addEventListener('click', async () => {
    if (!supabaseConfigured || !supabaseClient) {
      setAuthStatus('Configure as credenciais do Supabase e habilite Google em Authentication > Providers para usar este acesso.', true);
      return;
    }
    const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
    if (error) setAuthStatus(error.message, true);
  });

  $('#local-login').addEventListener('click', () => {
    cloudReady = false;
    cloudUserId = null;
    localAccess = true;
    setSyncStatus('Modo sem conta: dados apenas neste navegador', 'local');
    showWorkspace(true);
  });
  $('#logout-button').addEventListener('click', async () => {
    if (supabaseClient && !localAccess) {
      window.clearTimeout(cloudSaveTimer);
      cloudSaveTimer = null;
      await persistCloudSnapshot();
      const { error } = await supabaseClient.auth.signOut();
      if (error) setAuthStatus(error.message, true);
    } else showAuth();
  });

  const sidebarToggle = $('#sidebar-toggle');
  const mobileMenuTrigger = $('#mobile-menu-trigger');
  const mobileMenuBackdrop = $('#mobile-menu-backdrop');
  const appShell = $('#app-shell');
  const mobileMenuQuery = window.matchMedia('(max-width: 760px)');
  appShell.classList.remove('sidebar-collapsed');

  function updateSidebarToggle() {
    const menuOpen = appShell.classList.contains('mobile-menu-open');
    sidebarToggle.setAttribute('aria-expanded', String(menuOpen));
    sidebarToggle.setAttribute('aria-label', menuOpen ? 'Fechar menu' : 'Abrir menu');
    mobileMenuTrigger.setAttribute('aria-expanded', String(menuOpen));
    mobileMenuTrigger.setAttribute('aria-label', menuOpen ? 'Fechar menu' : 'Abrir menu');
    mobileMenuBackdrop.hidden = !menuOpen;
  }

  updateSidebarToggle();
  mobileMenuTrigger.addEventListener('click', () => {
    appShell.classList.add('mobile-menu-open');
    updateSidebarToggle();
    sidebarToggle.focus();
  });
  mobileMenuBackdrop.addEventListener('click', () => {
    appShell.classList.remove('mobile-menu-open');
    updateSidebarToggle();
    mobileMenuTrigger.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appShell.classList.contains('mobile-menu-open')) {
      appShell.classList.remove('mobile-menu-open');
      updateSidebarToggle();
      mobileMenuTrigger.focus();
    }
  });
  sidebarToggle.addEventListener('click', () => {
    appShell.classList.remove('mobile-menu-open');
    updateSidebarToggle();
    mobileMenuTrigger.focus();
  });
  mobileMenuQuery.addEventListener('change', updateSidebarToggle);
  initializeAuth();

  $('#theme-toggle').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  $('#reset-data').addEventListener('click', async () => {
    if (!window.confirm('Apagar todas as matérias, ciclos, horários, revisões e registros de afiliados? Esta ação não pode ser desfeita.')) return;
    try {
      window.clearTimeout(cloudSaveTimer);
      cloudSaveTimer = null;
      await cloudWriteQueue;
      if (cloudReady && cloudUserId) {
        const { error } = await supabaseClient.from('user_data').upsert({
          user_id: cloudUserId,
          data: initialState(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) throw error;
      }
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    } catch (error) {
      console.error('Não foi possível apagar os dados salvos.', error);
      window.alert(`Não foi possível apagar os dados: ${error.message}`);
    }
  });

  $('#cycle-factor').value = String(state.factor);
  $('#availability').value = state.availability;
  renderSchedule();
  renderSubjects();
  renderReviews();
  document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => {
    navigate(button.dataset.view);
    appShell.classList.remove('mobile-menu-open');
    updateSidebarToggle();
    mobileMenuTrigger.focus();
  }));
  document.querySelectorAll('[data-day]').forEach((input) => {
    const day = input.dataset.day;
    const enabled = $(`[data-schedule-day="${day}"]`).checked;
    input.disabled = !enabled;
  });
  $('#cycle-factor').addEventListener('input', renderPreview);
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing-cycle');
    document.querySelectorAll('.cycle-card').forEach((card) => card.classList.remove('print-target'));
  });
  navigate('configurar');
})();