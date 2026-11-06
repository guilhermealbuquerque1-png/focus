(() => {
  'use strict';

  const STORAGE_KEY = 'focus-organizer-v1';
  const THEME_KEY = 'focus-organizer-theme';
  // Troque pelos dados públicos do seu projeto Supabase; nunca use a service_role key no navegador.
  const SUPABASE_URL = 'https://gqxvpyrxcbgnoqaffkxq.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxeHZweXJ4Y2Jnbm9xYWZma3hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MDk4NzgsImV4cCI6MjEwOTQ4NTg3OH0.W1XsIB87SXMpT8frN86GWBZGRjQo2dCC_TdJ_a0nlxw';
  const DAYS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'SÃ¡bado', 'Domingo'];
  const CHECKLIST_ITEMS = ['Pesquisar produtos', 'Analisar preÃ§o, avaliações e comissão', 'Selecionar produtos', 'Buscar vÃ­deos de referÃªncia', 'Editar vÃ­deos', 'Publicar vÃ­deos'];

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
      console.error('NÃ£o foi possÃ­vel carregar os dados salvos.', error);
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
        console.error('NÃ£o foi possÃ­vel salvar a preferÃªncia de tema.', error);
      }
    }
  }

  function savedTheme() {
    try {
      const theme = localStorage.getItem(THEME_KEY);
      if (theme === 'light' || theme === 'dark') return theme;
    } catch (error) {
      console.error('NÃ£o foi possÃ­vel carregar a preferÃªncia de tema.', error);
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  setTheme(savedTheme(), false);
  const makeId = () => window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  // All persistence passes through this function so storage can later be replaced by a sync layer.
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('NÃ£o foi possÃ­vel salvar os dados.', error);
      window.alert('NÃ£o foi possÃ­vel salvar os dados neste navegador. Verifique o espaÃ§o disponÃ­vel.');
    }
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
      preview.innerHTML = '<p class="empty-note">A prÃ©via das horas aparecerÃ¡ apÃ³s cadastrar matÃ©rias.</p>';
      return;
    }
    if (!Number.isInteger(factor) || factor < 30 || factor > 1000) {
      preview.innerHTML = '<p class="below">Use um fator inteiro entre 30 e 1000.</p>';
      return;
    }
    const items = distribution().map(({ subject }) => ({ subject, hours: hoursFor(subject, factor) }));
    if (items.some((item) => item.hours > 10000)) {
      preview.innerHTML = '<p class="below">A estimativa excede 10.000 horas para uma matÃ©ria. Reduza o fator ou o peso para visualizar os quadradinhos com seguranÃ§a.</p>';
      return;
    }
    const total = items.reduce((sum, item) => sum + item.hours, 0);
    const activeNotice = activeCycle() ? '<p class="hint">AlteraÃ§Ãµes nas matÃ©rias nÃ£o mudam o ciclo em andamento. Use â€œRecalcular cicloâ€ para criar uma nova distribuiÃ§Ã£o; o progresso atual serÃ¡ preservado no histÃ³rico.</p>' : '';
    preview.innerHTML = `<div class="preview-heading"><h3>PrÃ©via da distribuiÃ§Ã£o</h3><strong>${total} h no ciclo</strong></div><ul>${items.map(({ subject, hours }) => `<li><span>${escapeHtml(subject.name)} <small>(D${subject.difficulty} Ã— C${subject.content} Ã— P${subject.weight})</small></span><strong>${hours} h</strong></li>`).join('')}</ul>${activeNotice}`;
  }

  function resetSubjectForm() {
    $('#subject-form').reset();
    $('#subject-id').value = '';
    $('#subject-difficulty').value = '3';
    $('#subject-content').value = '3';
    $('#subject-weight').value = '1';
    $('#subject-submit').textContent = 'Adicionar matÃ©ria';
    $('#subject-cancel').classList.add('hidden');
  }

  $('#subject-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#subject-name').value.trim();
    const difficulty = Number($('#subject-difficulty').value);
    const content = Number($('#subject-content').value);
    const weight = Number($('#subject-weight').value);
    if (!name || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5 || !Number.isInteger(content) || content < 1 || content > 5 || !Number.isSafeInteger(weight) || weight < 1) {
      window.alert('Informe o nome, avaliaÃ§Ãµes de 1 a 5 e um peso inteiro positivo.');
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
      $('#subject-submit').textContent = 'Salvar alteraÃ§Ãµes';
      $('#subject-cancel').classList.remove('hidden');
      $('#subject-name').focus();
    } else if (button.classList.contains('delete-subject')) {
      if (!window.confirm(`Excluir a matÃ©ria â€œ${subject.name}â€? Ciclos existentes preservam seus dados.`)) return;
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
      window.alert('A estimativa de uma matÃ©ria ultrapassa 10.000 horas. Reduza o fator ou o peso.');
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
      window.alert('Cadastre ao menos uma matÃ©ria antes de criar um ciclo.');
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
    const confirmation = current ? `O ciclo â€œ${current.name}â€ serÃ¡ preservado como arquivado, sem perder sessÃµes. Criar â€œ${name}â€ com a prÃ©via atual?` : `Criar â€œ${name}â€ com a distribuiÃ§Ã£o exibida?`;
    if (!window.confirm(confirmation)) return;
    if (startCycle(name, state.factor)) $('#cycle-name').value = '';
  });

  $('#recalculate-cycle-button').addEventListener('click', () => {
    if (!state.subjects.length) {
      window.alert('Cadastre matÃ©rias para calcular uma distribuiÃ§Ã£o.');
      return;
    }
    if (!setFactorFromInput()) {
      window.alert('Informe um fator inteiro entre 30 e 1000.');
      return;
    }
    const current = activeCycle();
    if (!current) {
      window.alert('NÃ£o hÃ¡ ciclo em andamento. Use â€œCriar cicloâ€ para iniciar um.');
      return;
    }
    const nextName = $('#cycle-name').value.trim() || current.name;
    const total = distribution().reduce((sum, item) => sum + hoursFor(item.subject, state.factor), 0);
    if (!window.confirm(`Recalcular â€œ${current.name}â€ para â€œ${nextName}â€ (${total} horas)? O ciclo atual e todas as sessÃµes serÃ£o preservados no histÃ³rico; o novo planejamento comeÃ§a sem progresso.`)) return;
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
      ? remainingSubjects.map((subject) => `<option value="${escapeHtml(subject.subjectId)}">${escapeHtml(subject.name)} â€” restam ${hoursAndMinutes(subject.plannedHours * 60 - subject.studiedMinutes)}</option>`).join('')
      : '<option value="">Todas as matÃ©rias concluÃ­das</option>';
    const dayIndex = (new Date().getDay() + 6) % 7;
    const todaysPeriods = state.schedule[dayIndex]?.periods.filter((period) => period.start && period.end).map((period) => `${period.start}â€“${period.end}`).join(' e ');
    $('#session-status').textContent = todaysPeriods ? `Disponibilidade informada para hoje: ${todaysPeriods}. Ã‰ apenas uma referÃªncia, nÃ£o uma obrigaÃ§Ã£o.` : 'Nenhum perÃ­odo informado para hoje; vocÃª pode registrar estudo quando desejar.';
  }

  function renderReviews() {
    $('#reviews-list').innerHTML = state.reviews.slice().reverse().map((review) => `<li><span>${escapeHtml(review.topic)} Â· ${review.minutes} min</span><span>${formatDate(review.date)}</span></li>`).join('');
  }

  function renderLegacyCycle(cycle) {
    const subjects = cycle.subjects.map((subject) => {
      const completed = subject.completed.filter(Boolean).length;
      const squares = subject.completed.map((done) => `<span class="block legacy-block${done ? ' done' : ''}" aria-label="${done ? 'ConcluÃ­do' : 'Pendente'}"></span>`).join('');
      return `<div class="cycle-subject"><div class="subject-line"><span>${escapeHtml(subject.name)}</span><span class="subject-progress">${completed} / ${subject.blocks} blocos antigos</span></div><div class="blocks">${squares}</div></div>`;
    }).join('');
    const done = cycle.subjects.reduce((sum, subject) => sum + subject.completed.filter(Boolean).length, 0);
    const total = cycle.subjects.reduce((sum, subject) => sum + subject.blocks, 0);
    return `<article class="cycle-card legacy-cycle"><div class="cycle-top"><div><h2>${escapeHtml(cycle.name)} Â· HistÃ³rico anterior</h2><p class="cycle-date">Criado em ${formatDate(cycle.createdAt || new Date().toISOString())} Â· progresso de blocos mantido</p></div><button class="button danger delete-cycle" data-cycle-id="${escapeHtml(cycle.id)}" type="button">Excluir ciclo</button></div><p class="hint">Este ciclo foi criado pela versÃ£o anterior e seus blocos nÃ£o representam horas conhecidas. O progresso foi preservado sem conversÃ£o.</p><p class="progress-info">${done} de ${total} blocos concluÃ­dos</p>${subjects}</article>`;
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
        const squares = Array.from({ length: subject.plannedHours }, (_, index) => `<span class="block${index < completeSquares ? ' done' : ''}" role="img" aria-label="Hora ${index + 1}, ${index < completeSquares ? 'concluÃ­da' : 'pendente'}"></span>`).join('');
        const remainingMinutes = Math.max(0, subject.plannedHours * 60 - subject.studiedMinutes);
        return `<div class="cycle-subject"><div class="subject-line"><span>${escapeHtml(subject.name)} <small>(dificuldade ${subject.difficulty}, conteÃºdo ${subject.content}, peso ${subject.weight})</small></span><span class="subject-progress">${subject.plannedHours} h previstas Â· ${hoursAndMinutes(subject.studiedMinutes)} concluÃ­das Â· ${hoursAndMinutes(remainingMinutes)} restantes</span></div><div class="blocks" aria-label="${escapeHtml(subject.name)}: ${completeSquares} de ${subject.plannedHours} horas concluÃ­das">${squares}</div></div>`;
      }).join('');
      const bySubject = item.subjects.map((subject) => `<li><span>${escapeHtml(subject.name)}</span><strong>${hoursAndMinutes(subject.studiedMinutes)}</strong></li>`).join('');
      const sessions = item.sessions.length ? `<details class="session-history"><summary>SessÃµes registradas (${item.sessions.length})</summary><ul>${item.sessions.slice().reverse().map((session) => `<li><span>${escapeHtml(session.subjectName)} Â· ${hoursAndMinutes(session.minutes)}</span><span>${formatDate(session.date)}</span></li>`).join('')}</ul></details>` : '';
      const actions = `<div class="cycle-actions">${finished ? '<button class="button primary start-cycle" type="button">Iniciar novo ciclo</button>' : ''}<button class="button secondary print-cycle" type="button">Imprimir / salvar PDF</button>${!finished && item.status === 'active' ? '<span class="cycle-active-label">Em andamento</span>' : ''}<button class="button danger delete-cycle" data-cycle-id="${escapeHtml(item.id)}" type="button">Excluir ciclo</button></div>`;
      return `<article class="cycle-card${finished ? ' is-complete' : ''}" data-cycle-id="${escapeHtml(item.id)}"><div class="cycle-top"><div><h2>${escapeHtml(item.name)}${finished ? ' Â· Finalizado' : item.status === 'archived' ? ' Â· Arquivado' : ''}</h2><p class="cycle-date">Criado em ${formatDate(item.createdAt)} Â· fator ${item.factor}</p></div>${actions}</div>
        <div class="cycle-summary"><p><strong>${totals.planned} h</strong><span>planejadas</span></p><p><strong>${hoursAndMinutes(totals.studied)}</strong><span>lÃ­quidas concluÃ­das</span></p><p><strong>${hoursAndMinutes(Math.max(0, totals.planned * 60 - totals.studied))}</strong><span>restantes</span></p></div>
        <div class="progress-info"><div class="progress-summary">Progresso do ciclo<div class="progress-track" role="progressbar" aria-valuenow="${totals.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso do ciclo"><div class="progress-fill" style="width:${totals.percent}%"></div></div></div><span class="progress-label">${totals.percent}%</span></div>${subjects}
        ${finished ? `<div class="cycle-results"><h3>Ciclo concluÃ­do Â· ${hoursAndMinutes(totals.studied)} no total</h3><ul>${bySubject}</ul></div>` : ''}${sessions}</article>`;
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
      window.alert('Selecione uma matÃ©ria pendente e informe um tempo vÃ¡lido maior que zero.');
      return;
    }
    const duration = hours * 60 + minutes;
    const remaining = subject.plannedHours * 60 - subject.studiedMinutes;
    if (duration > remaining) {
      window.alert(`Esta matÃ©ria tem ${hoursAndMinutes(remaining)} restantes neste ciclo. Registre no mÃ¡ximo esse tempo; o excedente pode ser informado em outro registro fora do ciclo.`);
      return;
    }
    subject.studiedMinutes += duration;
    cycle.sessions.push({ id: makeId(), subjectId: subject.subjectId, subjectName: subject.name, minutes: duration, date: todayKey(), createdAt: new Date().toISOString() });
    const completed = finishCycleIfDone(cycle);
    saveState();
    $('#session-hours').value = '0';
    $('#session-minutes').value = '0';
    renderCycles();
    if (completed) window.alert(`Ciclo concluÃ­do! Total lÃ­quido: ${hoursAndMinutes(cycleTotals(cycle).studied)}. O histÃ³rico foi preservado.`);
  });

  $('#review-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const topic = $('#review-topic').value.trim();
    const minutes = Number($('#review-minutes').value);
    if (!topic || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      window.alert('Informe o assunto e uma duraÃ§Ã£o de revisÃ£o entre 1 e 1440 minutos.');
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
      if (!cycle || !window.confirm(`Excluir â€œ${cycle.name}â€ e todo o histÃ³rico deste ciclo?`)) return;
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
      if (!window.confirm(`Iniciar um novo ciclo com as matÃ©rias e a distribuiÃ§Ã£o atuais? â€œ${previous.name}â€ continuarÃ¡ preservado no histÃ³rico.`)) return;
      const name = $('#cycle-name').value.trim() || previous.name.replace(/ â€” ciclo \d+$/, '') + ' â€” novo ciclo';
      startCycle(name, state.factor);
    }
  });

  function renderSchedule() {
    $('#availability-schedule').innerHTML = DAYS.map((day, index) => {
      const saved = state.schedule[index] || { periods: [{ start: '', end: '' }, { start: '', end: '' }] };
      const enabled = saved.periods.some((period) => period.start || period.end);
      const periods = [0, 1, 2].map((slot) => {
        const period = saved.periods[slot] || { start: '', end: '' };
        return `<div class="schedule-period"><label>PerÃ­odo ${slot + 1}<span class="schedule-time"><input type="time" data-day="${index}" data-slot="${slot}" data-part="start" aria-label="${day}, perÃ­odo ${slot + 1}, inÃ­cio" value="${escapeHtml(period.start)}" /><span>Ã s</span><input type="time" data-day="${index}" data-slot="${slot}" data-part="end" aria-label="${day}, perÃ­odo ${slot + 1}, fim" value="${escapeHtml(period.end)}" /></span></label></div>`;
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
          window.alert(`${DAYS[index]}, perÃ­odo ${slot + 1}: informe horÃ¡rios vÃ¡lidos, com tÃ©rmino apÃ³s o inÃ­cio.`);
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
    $('#availability-status').textContent = 'Disponibilidade salva. Ela nÃ£o define matÃ©rias nem metas diÃ¡rias.';
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
      status.textContent = met ? `Meta mÃ­nima atingida: ${record.videos} vÃ­deo${record.videos === 1 ? '' : 's'} publicado${record.videos === 1 ? '' : 's'}.` : `Abaixo da meta mÃ­nima: ${record.videos} de 3 vÃ­deos. Este registro permanece no histÃ³rico.`;
      status.className = `today-status ${met ? 'met' : 'below'}`;
    } else {
      status.textContent = 'Ainda nÃ£o hÃ¡ registro para hoje.';
      status.className = 'today-status';
    }
    $('#affiliate-checklist').innerHTML = CHECKLIST_ITEMS.map((item, index) => `<label><input type="checkbox" data-checklist-index="${index}" ${state.affiliateChecklist[today]?.[index] ? 'checked' : ''} />${escapeHtml(item)}</label>`).join('');
    const records = Object.keys(state.affiliateRecords).sort((a, b) => b.localeCompare(a));
    $('#affiliate-history').innerHTML = records.map((date) => {
      const videos = Number(state.affiliateRecords[date].videos) || 0;
      const met = videos >= 3;
      return `<tr><td>${formatDate(date)}</td><td>${videos}</td><td>3 vÃ­deos</td><td class="${met ? 'met' : 'below'}">${met ? 'Meta atingida' : 'Abaixo da meta'}</td></tr>`;
    }).join('');
    $('#history-empty').classList.toggle('hidden', records.length > 0);
  }

  $('#affiliate-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const videos = Number($('#videos-count').value);
    if (!Number.isSafeInteger(videos) || videos < 0) {
      window.alert('Informe uma quantidade vÃ¡lida de vÃ­deos (zero ou mais).');
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

  const helpChatPanel = $('#help-chat-panel');
  const helpChatToggle = $('#help-chat-toggle');
  const helpChatMessages = $('#help-chat-messages');

  function addChatMessage(message, sender) {
    const bubble = document.createElement('p');
    bubble.className = `chat-message ${sender}`;
    bubble.textContent = message;
    helpChatMessages.appendChild(bubble);
    helpChatMessages.scrollTop = helpChatMessages.scrollHeight;
  }

  function answerHelpQuestion(question) {
    const normalized = question.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const answers = [
      { terms: ['materia', 'cadastrar', 'adicionar', 'editar', 'excluir'], text: 'Em Configurar, cadastre cada matÃ©ria com dificuldade (1â€“5), quantidade de conteÃºdo (1â€“5) e peso/importÃ¢ncia. Esses critÃ©rios sÃ£o separados. VocÃª pode editar ou excluir matÃ©rias; mudanÃ§as nÃ£o alteram automaticamente um ciclo jÃ¡ criado.' },
      { terms: ['dificuldade', 'conteudo', 'peso', 'importancia', 'criterio'], text: 'Dificuldade mede o quanto a matÃ©ria Ã© difÃ­cil; conteÃºdo estima quanto hÃ¡ para estudar; peso representa sua importÃ¢ncia. A estimativa usa dificuldade Ã— conteÃºdo Ã— peso Ã— fator Ã· 60, arredondada para a hora mais prÃ³xima, com mÃ­nimo de 1 hora por matÃ©ria.' },
      { terms: ['fator', 'calculo', 'calcular', 'horas', 'distribuicao'], text: 'O fator comeÃ§a em 60 e ajusta as horas estimadas. A prÃ©via mostra a distribuiÃ§Ã£o antes de criar o ciclo. A fÃ³rmula proporcional combina dificuldade, conteÃºdo e peso; aumentar o fator tende a aumentar as horas de todas as matÃ©rias.' },
      { terms: ['ciclo', 'flexivel', 'reiniciar', 'novo ciclo', 'finalizar', 'concluir'], text: 'Um ciclo Ã© um conjunto de horas planejadas por matÃ©ria, nÃ£o um cronograma semanal. Ele termina quando todas as horas sÃ£o cumpridas. O histÃ³rico Ã© preservado; depois vocÃª pode iniciar outro ciclo. Recalcular cria uma nova distribuiÃ§Ã£o e arquiva o ciclo atual, preservando suas sessÃµes.' },
      { terms: ['quadradinho', 'quadrado', 'progresso', 'bloco'], text: 'Cada quadradinho representa uma hora lÃ­quida completa. Registre uma sessÃ£o na tela Ciclos; horas e minutos sÃ£o acumulados e os quadradinhos avanÃ§am quando cada hora se completa. O progresso restante nÃ£o Ã© apagado por faltar um dia.' },
      { terms: ['sessao', 'estudar', 'minutos', 'tempo liquido', 'registrar'], text: 'Na tela Ciclos, escolha uma matÃ©ria ainda pendente e informe horas e minutos efetivamente estudados. Pausas nÃ£o devem entrar no registro. Ã‰ possÃ­vel registrar minutos; eles acumulam atÃ© completar horas. O sistema nÃ£o exige uma cota diÃ¡ria.' },
      { terms: ['alternar', 'tres materias', 'por dia', 'quantas materias'], text: 'A sugestÃ£o do FOCUS Ã© variar entre Ã¡reas quando fizer sentido e considerar atÃ© trÃªs matÃ©rias no dia. Isso Ã© apenas uma recomendaÃ§Ã£o: vocÃª escolhe livremente o que estudar e pode se concentrar em uma matÃ©ria se preferir.' },
      { terms: ['disponibilidade', 'horario', 'semana', 'periodo', 'rotina'], text: 'Em Configurar, ajuste os perÃ­odos disponÃ­veis por dia e salve. Eles sÃ£o apenas uma referÃªncia para sua rotina: nÃ£o ficam vinculados a matÃ©rias e nÃ£o obrigam vocÃª a estudar em horÃ¡rios especÃ­ficos.' },
      { terms: ['revisao', 'revisar'], text: 'A RevisÃ£o avulsa, na tela Ciclos, registra assunto e duraÃ§Ã£o separadamente. RevisÃµes nÃ£o entram no cÃ¡lculo, nÃ£o contam como sessÃµes do ciclo e nÃ£o preenchem quadradinhos.' },
      { terms: ['afiliado', 'shopee', 'video', 'videos', 'meta', 'checklist'], text: 'A tela Afiliados Ã© independente dos estudos. Registre os vÃ­deos publicados no dia; a meta mÃ­nima Ã© 3 e a ideal Ã© 5. O checklist ajuda a acompanhar tarefas, e o histÃ³rico mantÃ©m tambÃ©m os dias abaixo da meta.' },
      { terms: ['salvar', 'localstorage', 'dados', 'fechar navegador'], text: 'O FOCUS salva matÃ©rias, ciclos, sessÃµes, revisÃµes, disponibilidade e registros de afiliados neste navegador. Os dados permanecem apÃ³s fechar a pÃ¡gina, mas nÃ£o sÃ£o sincronizados entre dispositivos.' },
      { terms: ['tema', 'escuro', 'claro'], text: 'Use o botÃ£o de tema no cabeÃ§alho para alternar entre o tema claro e o escuro. Sua preferÃªncia fica salva neste navegador.' },
      { terms: ['apagar', 'resetar', 'limpar'], text: 'O botÃ£o Apagar dados, no cabeÃ§alho, remove os dados salvos do FOCUS apÃ³s pedir confirmaÃ§Ã£o. Essa aÃ§Ã£o nÃ£o pode ser desfeita.' },
      { terms: ['imprimir', 'pdf'], text: 'Na tela Ciclos, use â€œImprimir / salvar PDFâ€ no ciclo desejado. A janela de impressÃ£o do navegador permite imprimir ou escolher a opÃ§Ã£o de salvar como PDF.' }
    ];
    const match = answers.find((item) => item.terms.some((term) => normalized.includes(term)));
    return match ? match.text : 'Ainda nÃ£o encontrei uma resposta especÃ­fica para isso. Posso explicar matÃ©rias e cÃ¡lculo, ciclos e quadradinhos, sessÃµes, horÃ¡rios disponÃ­veis, revisÃµes, Afiliados, temas, armazenamento ou impressÃ£o. O assistente funciona sem conexÃ£o e responde sobre os recursos do FOCUS.';
  }

  const helpChatFaqAnswers = {
    cycle: 'O ciclo Ã© flexÃ­vel: nÃ£o divide matÃ©rias por dias da semana. VocÃª escolhe o que estudar em cada sessÃ£o e o ciclo sÃ³ termina quando todas as horas planejadas forem cumpridas. Se perder um dia, o progresso continua salvo, sem atraso ou penalidade.',
    calculation: 'As horas sÃ£o estimadas por matÃ©ria usando dificuldade Ã— quantidade de conteÃºdo Ã— peso Ã— fator Ã· 60, arredondadas para a hora mais prÃ³xima e com mÃ­nimo de 1 hora. O fator comeÃ§a em 60. A prÃ©via aparece em Configurar antes de criar o ciclo.',
    sessions: 'Em Ciclos, escolha uma matÃ©ria que ainda tenha horas restantes e registre somente o tempo lÃ­quido estudado, em horas e minutos. Os minutos acumulam; cada hora completa preenche um quadradinho. Pausas e revisÃµes nÃ£o contam para o progresso do ciclo.'
  };

  function setHelpChatOpen(open) {
    helpChatPanel.hidden = !open;
    helpChatToggle.setAttribute('aria-expanded', String(open));
    if (open) $('#help-chat-input').focus();
  }

  helpChatToggle.addEventListener('click', () => setHelpChatOpen(helpChatPanel.hidden));
  $('#help-chat-close').addEventListener('click', () => setHelpChatOpen(false));
  helpChatMessages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-faq]');
    if (!button) return;
    addChatMessage(button.textContent, 'user');
    addChatMessage(helpChatFaqAnswers[button.dataset.faq], 'assistant');
  });
  $('#help-chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#help-chat-input');
    const question = input.value.trim();
    if (!question) return;
    addChatMessage(question, 'user');
    addChatMessage(answerHelpQuestion(question), 'assistant');
    input.value = '';
    input.focus();
  });

  let supabaseClient = null;
  let authMode = 'login';
  let localAccess = false;
  const supabaseConfigured = !SUPABASE_URL.includes('YOUR_PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR_');

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
      if (session) showWorkspace();
      else if (!localAccess) showAuth();
    });
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) setAuthStatus(error.message, true);
      if (data?.session) showWorkspace();
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

  $('#local-login').addEventListener('click', () => showWorkspace(true));
  $('#logout-button').addEventListener('click', async () => {
    if (supabaseClient && !localAccess) {
      const { error } = await supabaseClient.auth.signOut();
      if (error) setAuthStatus(error.message, true);
    } else showAuth();
  });

  const savedSidebarState = localStorage.getItem('focus-sidebar-collapsed') === 'true';
  $('#app-shell').classList.toggle('sidebar-collapsed', savedSidebarState);
  $('#sidebar-toggle').setAttribute('aria-expanded', String(!savedSidebarState));
  $('#sidebar-toggle').setAttribute('aria-label', savedSidebarState ? 'Expandir menu' : 'Recolher menu');
  $('#sidebar-toggle').addEventListener('click', () => {
    const collapsed = $('#app-shell').classList.toggle('sidebar-collapsed');
    $('#sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
    $('#sidebar-toggle').setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
    localStorage.setItem('focus-sidebar-collapsed', String(collapsed));
  });
  initializeAuth();

  $('#theme-toggle').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  $('#reset-data').addEventListener('click', () => {
    if (!window.confirm('Apagar todas as matÃ©rias, ciclos, horÃ¡rios, revisÃµes e registros de afiliados? Esta aÃ§Ã£o nÃ£o pode ser desfeita.')) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    } catch (error) {
      console.error('NÃ£o foi possÃ­vel apagar os dados salvos.', error);
      window.alert('NÃ£o foi possÃ­vel apagar os dados deste navegador.');
    }
  });

  $('#cycle-factor').value = String(state.factor);
  $('#availability').value = state.availability;
  renderSchedule();
  renderSubjects();
  renderReviews();
  document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
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