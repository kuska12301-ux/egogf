(() => {
  const $ = (selector) => document.querySelector(selector);
  const authCard = $('#authCard');
  const gamesSection = $('#gamesSection');
  const authForm = $('#authForm');
  const authMessage = $('#authMessage');
  const gameMessage = $('#gameMessage');
  let profile = null;
  let authMode = 'login';
  let activeTtt = null;
  let activeCode = null;
  let lobbyData = { ticTacToe: [], codebreaker: [] };
  let lastTttSignature = '';
  let lastCodeSignature = '';
  let modalAction = null;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
    return data;
  }

  function showNotice(element, message, kind = 'error') {
    element.textContent = message;
    element.className = 'notice ' + kind;
    element.hidden = false;
  }

  function clearNotice(element) {
    element.hidden = true;
    element.textContent = '';
  }

  function setAuthMode(mode) {
    authMode = mode;
    $('#loginTab').classList.toggle('active', mode === 'login');
    $('#registerTab').classList.toggle('active', mode === 'register');
    $('#displayNameWrap').hidden = mode !== 'register';
    $('#authSubmit').innerHTML = mode === 'register' ? 'Создать профиль <span>↗</span>' : 'Войти <span>↗</span>';
    authForm.elements.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    clearNotice(authMessage);
  }

  function renderProfile() {
    const loggedIn = Boolean(profile);
    authCard.hidden = loggedIn;
    gamesSection.hidden = !loggedIn;
    $('#profileBar').hidden = !loggedIn;
    $('#accountButton').textContent = loggedIn ? profile.displayName : 'Войти';
    if (!loggedIn) return;
    $('#profileName').textContent = profile.displayName;
    $('#profileHandle').textContent = '@' + profile.username;
    $('#profileAvatar').textContent = Array.from(profile.displayName)[0].toUpperCase();
    $('#profileGames').textContent = String(profile.gamesPlayed || 0);
    pollLobbies();
  }

  function userName(user) {
    return user ? user.displayName : 'Ожидаем игрока';
  }

  function lobbyCard(lobby, game) {
    const card = document.createElement('div');
    card.className = 'lobby-card';
    const badge = document.createElement('div');
    badge.className = 'lobby-badge';
    badge.textContent = game === 'ttt' ? '✕○' : '⌁';
    const meta = document.createElement('div');
    meta.className = 'lobby-meta';
    const title = document.createElement('b');
    title.textContent = game === 'ttt' ? 'Партия ' + lobby.code : 'Комната ' + lobby.code;
    const detail = document.createElement('span');
    if (game === 'ttt') {
      detail.textContent = userName(lobby.players.x) + ' · свободно место для ○';
    } else {
      detail.textContent = userName(lobby.players[0]) + ' · игроков ' + lobby.players.length + '/4';
    }
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'join-button';
    join.textContent = 'Войти →';
    join.addEventListener('click', () => joinLobby(game, lobby.id));
    meta.append(title, detail);
    card.append(badge, meta, join);
    return card;
  }

  function renderLobbyList(element, items, game, countElement) {
    element.replaceChildren();
    countElement.textContent = String(items.length);
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Пока нет открытых комнат. Создай первую!';
      element.append(empty);
      return;
    }
    items.forEach((item) => element.append(lobbyCard(item, game)));
  }

  function renderBoard(lobby) {
    const container = $('#tttActive');
    if (!lobby) {
      container.hidden = true;
      container.replaceChildren();
      lastTttSignature = '';
      return;
    }
    const signature = JSON.stringify(lobby);
    if (signature === lastTttSignature && !container.hidden) return;
    lastTttSignature = signature;
    container.hidden = false;
    container.replaceChildren();
    const header = document.createElement('div');
    header.className = 'active-top';
    const details = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = 'Партия ' + lobby.code;
    const subtitle = document.createElement('p');
    subtitle.textContent = '✕ ' + userName(lobby.players.x) + '  ·  ○ ' + userName(lobby.players.o);
    details.append(title, subtitle);
    const code = document.createElement('button');
    code.type = 'button';
    code.className = 'room-code';
    code.textContent = 'КОМНАТА ' + lobby.code;
    code.title = 'Скопировать код комнаты';
    code.addEventListener('click', () => copyRoomCode(lobby.code));
    header.append(details, code);
    const turn = document.createElement('div');
    turn.className = 'turn-banner' + (lobby.state === 'playing' ? '' : ' neutral');
    if (lobby.state === 'waiting') turn.textContent = 'Ты — ✕. Отправь код комнаты другу, ждём второго игрока.';
    else if (lobby.state === 'won') turn.textContent = '🏆 Победил ' + userName(lobby.winner) + '!';
    else if (lobby.state === 'draw') turn.textContent = 'Ничья! Хорошая партия.';
    else turn.textContent = lobby.myTurn ? 'Твой ход — ' + lobby.myMark : 'Ходит ' + userName(lobby.turnPlayer);
    const board = document.createElement('div');
    board.className = 'board';
    board.setAttribute('aria-label', 'Поле крестики-нолики');
    lobby.board.forEach((mark, index) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell' + (mark === 'o' ? ' mark-o' : '');
      cell.textContent = mark === 'x' ? '×' : mark === 'o' ? '○' : '';
      cell.setAttribute('aria-label', mark ? 'Клетка ' + (index + 1) + ': ' + mark : 'Клетка ' + (index + 1));
      cell.disabled = Boolean(mark) || lobby.state !== 'playing' || !lobby.myTurn;
      cell.addEventListener('click', () => makeMove(lobby.id, index));
      board.append(cell);
    });
    container.append(header, turn, board);
  }

  function renderCodeGame(lobby) {
    const container = $('#codeActive');
    if (!lobby) {
      container.hidden = true;
      container.replaceChildren();
      lastCodeSignature = '';
      return;
    }
    const signature = JSON.stringify(lobby);
    if (signature === lastCodeSignature && !container.hidden) return;
    lastCodeSignature = signature;
    container.hidden = false;
    container.replaceChildren();
    const header = document.createElement('div');
    header.className = 'active-top';
    const details = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = 'Кодовый замок · ' + lobby.code;
    const names = lobby.players.map((player) => player.displayName).join(', ');
    const subtitle = document.createElement('p');
    subtitle.textContent = names + (lobby.players.length < 2 ? ' · позови ещё друга' : ' · команда ' + lobby.players.length + '/4');
    details.append(title, subtitle);
    const roomCode = document.createElement('button');
    roomCode.type = 'button';
    roomCode.className = 'room-code';
    roomCode.textContent = lobby.code;
    roomCode.title = 'Скопировать код комнаты';
    roomCode.addEventListener('click', () => copyRoomCode(lobby.code));
    header.append(details, roomCode);
    const turn = document.createElement('div');
    turn.className = 'turn-banner' + (lobby.state === 'playing' && lobby.myTurn ? '' : ' neutral');
    if (lobby.state === 'waiting') turn.textContent = 'Дождись второго игрока, затем взламывайте код вместе.';
    else if (lobby.state === 'won') turn.textContent = '🔓 Код открыт ' + lobby.secret + '! Команда справилась.';
    else if (lobby.state === 'lost') turn.textContent = 'Попытки закончились. Код был ' + lobby.secret + '.';
    else turn.textContent = lobby.myTurn ? 'Твой ход! Попыток осталось: ' + lobby.triesLeft : 'Ходит ' + userName(lobby.turnPlayer) + ' · осталось ' + lobby.triesLeft;
    container.append(header, turn);
    if (lobby.state === 'playing' && lobby.players.length >= 2) {
      const controls = document.createElement('form');
      controls.className = 'code-controls';
      const input = document.createElement('input');
      input.className = 'code-input';
      input.name = 'guess';
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.placeholder = 'Три разные цифры';
      input.maxLength = 3;
      input.pattern = '[0-9]{3}';
      input.setAttribute('aria-label', 'Трёхзначная догадка');
      input.disabled = !lobby.myTurn;
      const submit = document.createElement('button');
      submit.className = 'primary-button';
      submit.type = 'submit';
      submit.textContent = 'Проверить';
      submit.disabled = !lobby.myTurn;
      controls.append(input, submit);
      controls.addEventListener('submit', (event) => {
        event.preventDefault();
        submitGuess(lobby.id, input.value);
      });
      container.append(controls);
    }
    const history = document.createElement('div');
    history.className = 'guess-list';
    lobby.guesses.slice().reverse().forEach((guess) => {
      const row = document.createElement('div');
      row.className = 'guess-row';
      const player = document.createElement('span');
      player.textContent = guess.by.displayName;
      const digits = document.createElement('b');
      digits.textContent = guess.digits;
      const hint = document.createElement('strong');
      hint.textContent = guess.exact + ' на месте · ' + guess.misplaced + ' рядом';
      row.append(player, digits, hint);
      history.append(row);
    });
    container.append(history);
  }

  async function pollLobbies() {
    if (!profile) return;
    try {
      lobbyData = await api('/api/lobbies');
      profile = lobbyData.profile || profile;
      $('#profileGames').textContent = String(profile.gamesPlayed || 0);
      renderLobbyList($('#tttLobbies'), lobbyData.ticTacToe.open, 'ttt', $('#tttCount'));
      renderLobbyList($('#codeLobbies'), lobbyData.codebreaker.open, 'code', $('#codeCount'));
      activeTtt = lobbyData.ticTacToe.mine.find((game) => game.state === 'waiting' || game.state === 'playing') ||
        lobbyData.ticTacToe.mine.find((game) => game.state === 'won' || game.state === 'draw') || null;
      activeCode = lobbyData.codebreaker.mine.find((game) => game.state === 'waiting' || game.state === 'playing') ||
        lobbyData.codebreaker.mine.find((game) => game.state === 'won' || game.state === 'lost') || null;
      renderBoard(activeTtt);
      renderCodeGame(activeCode);
    } catch (error) {
      if (/Войди|сессия/i.test(error.message)) {
        profile = null;
        renderProfile();
      } else showNotice(gameMessage, error.message);
    }
  }

  async function joinLobby(game, id) {
    clearNotice(gameMessage);
    try {
      const result = game === 'ttt'
        ? await api('/api/ttt/lobbies/' + encodeURIComponent(id) + '/join', { method: 'POST', body: '{}' })
        : await api('/api/code/lobbies/' + encodeURIComponent(id) + '/join', { method: 'POST', body: '{}' });
      if (game === 'ttt') activeTtt = result.lobby;
      else activeCode = result.lobby;
      await pollLobbies();
      showNotice(gameMessage, 'Ты в комнате ' + result.lobby.code + '. Код можно отправить другу.', 'success');
    } catch (error) { showNotice(gameMessage, error.message); }
  }

  async function makeMove(id, cell) {
    clearNotice(gameMessage);
    try {
      await api('/api/ttt/lobbies/' + encodeURIComponent(id) + '/move', {
        method: 'POST', body: JSON.stringify({ cell })
      });
      await pollLobbies();
    } catch (error) { showNotice(gameMessage, error.message); }
  }

  async function submitGuess(id, digits) {
    clearNotice(gameMessage);
    try {
      await api('/api/code/lobbies/' + encodeURIComponent(id) + '/guess', {
        method: 'POST', body: JSON.stringify({ digits })
      });
      await pollLobbies();
    } catch (error) { showNotice(gameMessage, error.message); }
  }

  async function copyRoomCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      showNotice(gameMessage, 'Код комнаты ' + code + ' скопирован — отправь его другу.', 'success');
    } catch (error) {
      showNotice(gameMessage, 'Код комнаты: ' + code + '. Скопируй его вручную.', 'success');
    }
  }

  function setGameTab(game) {
    const ticTacToe = game === 'ttt';
    $('#tttTab').classList.toggle('active', ticTacToe);
    $('#codeTab').classList.toggle('active', !ticTacToe);
    $('#tttSection').hidden = !ticTacToe;
    $('#codeSection').hidden = ticTacToe;
    clearNotice(gameMessage);
  }

  async function createLobby(game) {
    clearNotice(gameMessage);
    try {
      const result = game === 'ttt'
        ? await api('/api/ttt/lobbies', { method: 'POST', body: '{}' })
        : await api('/api/code/lobbies', { method: 'POST', body: '{}' });
      if (game === 'ttt') activeTtt = result.lobby;
      else activeCode = result.lobby;
      await pollLobbies();
      const instructions = game === 'ttt'
        ? 'Отправь другу код ' + result.lobby.code + ' и жди его хода.'
        : 'Отправь другу код ' + result.lobby.code + '. Когда будет хотя бы два игрока, начинайте угадывать!';
      showNotice(gameMessage, instructions, 'success');
    } catch (error) { showNotice(gameMessage, error.message); }
  }

  function showConfirm(title, text, action, icon) {
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    $('#modalIcon').textContent = icon || '✦';
    modalAction = action;
    $('#confirmDialog').showModal();
  }

  $('#modalConfirm').addEventListener('click', (event) => {
    event.preventDefault();
    const dialog = $('#confirmDialog');
    const action = modalAction;
    modalAction = null;
    dialog.close();
    if (action) action();
  });

  $('#loginTab').addEventListener('click', () => setAuthMode('login'));
  $('#registerTab').addEventListener('click', () => setAuthMode('register'));
  $('#accountButton').addEventListener('click', () => {
    if (!profile) {
      authCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      authForm.elements.username.focus();
    }
  });

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearNotice(authMessage);
    const submit = $('#authSubmit');
    submit.disabled = true;
    const form = new FormData(authForm);
    const body = {
      username: String(form.get('username') || '').trim(),
      password: String(form.get('password') || '')
    };
    if (authMode === 'register') body.displayName = String(form.get('displayName') || '').trim();
    try {
      const result = await api('/api/auth/' + authMode, { method: 'POST', body: JSON.stringify(body) });
      profile = result.user;
      authForm.reset();
      clearNotice(authMessage);
      renderProfile();
    } catch (error) { showNotice(authMessage, error.message); }
    finally { submit.disabled = false; }
  });

  $('#logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (error) {}
    profile = null;
    activeTtt = null;
    activeCode = null;
    renderProfile();
    authCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('#createTtt').addEventListener('click', () => createLobby('ttt'));
  $('#createCode').addEventListener('click', () => createLobby('code'));
  $('#tttTab').addEventListener('click', () => setGameTab('ttt'));
  $('#codeTab').addEventListener('click', () => setGameTab('code'));
  $('#refreshButton').addEventListener('click', () => pollLobbies());

  (async () => {
    try {
      const result = await api('/api/auth/me');
      profile = result.user;
      renderProfile();
    } catch (error) {
      profile = null;
      renderProfile();
    }
  })();
  window.setInterval(pollLobbies, 1800);
})();
