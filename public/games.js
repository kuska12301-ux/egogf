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
    setGameTab(null);
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
    const games = ['ttt', 'code', 'memory', 'reaction', 'word'];
    $('#gameCatalog').hidden = Boolean(game);
    $('#gameStage').hidden = !game;
    games.forEach((name) => {
      $('#' + name + 'Section').hidden = game !== name;
    });
    clearNotice(gameMessage);
    if (game) $('#gameStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Solo arcade games: these run locally, so a profile is not required for the mini-game logic.
  const memoryIcons = ['🌙', '🍓', '🛴', '🧸', '⭐', '🎧'];
  let memoryDeck = [];
  let memoryOpen = [];
  let memoryMatched = new Set();
  let memoryMoves = 0;
  let memoryStarted = 0;
  let memoryTimer = 0;
  let reactionPhase = 'idle';
  let reactionTimeout = 0;
  let reactionResults = [];
  let reactionRound = 0;
  const todayWord = ['МЕЧТА', 'ИСКРА', 'ВЕСНА', 'ПТИЦА', 'ДОЖДЬ'][Math.floor(Date.now() / 86400000) % 5];
  let wordAttempt = 0;
  let wordDone = false;

  function startMemory() {
    clearInterval(memoryTimer);
    memoryDeck = [...memoryIcons, ...memoryIcons].map((icon, id) => ({ icon, id, sort: Math.random() })).sort((a, b) => a.sort - b.sort);
    memoryOpen = [];
    memoryMatched = new Set();
    memoryMoves = 0;
    memoryStarted = Date.now();
    $('#memoryMoves').textContent = '0';
    $('#memoryMessage').hidden = true;
    renderMemory();
    memoryTimer = window.setInterval(() => {
      if (!memoryStarted || memoryMatched.size === memoryDeck.length) return;
      const seconds = Math.floor((Date.now() - memoryStarted) / 1000);
      $('#memoryTime').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }, 500);
  }

  function renderMemory() {
    const board = $('#memoryBoard');
    board.replaceChildren();
    memoryDeck.forEach((card, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'memory-card' + (memoryOpen.includes(index) ? ' is-open' : '') + (memoryMatched.has(index) ? ' is-matched' : '');
      button.textContent = memoryOpen.includes(index) || memoryMatched.has(index) ? card.icon : '✦';
      button.setAttribute('aria-label', memoryOpen.includes(index) || memoryMatched.has(index) ? card.icon : 'Скрытая карточка');
      button.disabled = memoryMatched.has(index) || memoryOpen.includes(index) || memoryOpen.length >= 2;
      button.addEventListener('click', () => flipMemory(index));
      board.append(button);
    });
  }

  function flipMemory(index) {
    if (memoryOpen.length >= 2 || memoryMatched.has(index)) return;
    memoryOpen.push(index);
    renderMemory();
    if (memoryOpen.length !== 2) return;
    memoryMoves += 1;
    $('#memoryMoves').textContent = String(memoryMoves);
    const [first, second] = memoryOpen;
    if (memoryDeck[first].icon === memoryDeck[second].icon) {
      memoryMatched.add(first);
      memoryMatched.add(second);
      memoryOpen = [];
      renderMemory();
      if (memoryMatched.size === memoryDeck.length) {
        clearInterval(memoryTimer);
        const seconds = Math.floor((Date.now() - memoryStarted) / 1000);
        const score = memoryMoves + Math.ceil(seconds / 10);
        const old = Number(localStorage.getItem('egor_memory_best') || '0');
        if (!old || score < old) localStorage.setItem('egor_memory_best', String(score));
        $('#memoryBest').textContent = localStorage.getItem('egor_memory_best') + ' очков';
        showNotice($('#memoryMessage'), 'Все пары найдены! Отличная память ✨', 'success');
        $('#memoryBoard').classList.add('game-win');
        setTimeout(() => $('#memoryBoard').classList.remove('game-win'), 900);
      }
    } else {
      window.setTimeout(() => { memoryOpen = []; renderMemory(); }, 700);
    }
  }

  function nextReactionRound() {
    clearTimeout(reactionTimeout);
    reactionPhase = 'waiting';
    $('#reactionArena').className = 'reaction-arena is-waiting';
    $('#reactionLabel').textContent = 'Смотри на центр…';
    $('#reactionStart').textContent = 'Жду сигнал';
    $('#reactionStart').disabled = true;
    reactionTimeout = window.setTimeout(() => {
      reactionPhase = 'go';
      $('#reactionArena').className = 'reaction-arena is-go';
      $('#reactionLabel').textContent = 'ЖМИ!';
      $('#reactionStart').textContent = 'НАЖМИ СЕЙЧАС';
      $('#reactionStart').disabled = false;
      reactionTimeout = Date.now();
    }, 1200 + Math.random() * 2600);
  }

  function reactionClick() {
    if (reactionPhase === 'idle' || reactionPhase === 'done') {
      reactionResults = [];
      reactionRound = 0;
      $('#reactionRounds').textContent = '0/5';
      nextReactionRound();
      return;
    }
    if (reactionPhase === 'between') return nextReactionRound();
    if (reactionPhase === 'waiting') {
      clearTimeout(reactionTimeout);
      reactionPhase = 'idle';
      $('#reactionArena').className = 'reaction-arena is-false';
      $('#reactionLabel').textContent = 'Фальстарт! Подожди сигнал.';
      $('#reactionStart').textContent = 'Попробовать ещё';
      $('#reactionStart').disabled = false;
      return;
    }
    if (reactionPhase !== 'go') return;
    const ms = Date.now() - reactionTimeout;
    reactionResults.push(ms);
    reactionRound += 1;
    $('#reactionResult').textContent = ms + ' мс';
    $('#reactionRounds').textContent = reactionRound + '/5';
    const old = Number(localStorage.getItem('egor_reaction_best') || '0');
    if (!old || ms < old) localStorage.setItem('egor_reaction_best', String(ms));
    $('#reactionBest').textContent = localStorage.getItem('egor_reaction_best') + ' мс';
    if (reactionRound >= 5) {
      reactionPhase = 'done';
      const avg = Math.round(reactionResults.reduce((sum, value) => sum + value, 0) / reactionResults.length);
      $('#reactionArena').className = 'reaction-arena is-done';
      $('#reactionLabel').textContent = 'Среднее: ' + avg + ' мс — ' + (avg < 260 ? 'молниеносно!' : avg < 360 ? 'классный результат!' : 'ещё раунд?');
      $('#reactionStart').textContent = 'Играть ещё раз';
      return;
    }
    reactionPhase = 'between';
    $('#reactionArena').className = 'reaction-arena';
    $('#reactionLabel').textContent = 'Раунд ' + reactionRound + '/5 · ' + ms + ' мс';
    $('#reactionStart').disabled = false;
    $('#reactionStart').textContent = 'Следующий раунд →';
  }

  function setupWordGame() {
    const board = $('#wordBoard');
    board.replaceChildren();
    for (let row = 0; row < 6; row += 1) {
      const line = document.createElement('div');
      line.className = 'word-row';
      for (let col = 0; col < 5; col += 1) {
        const tile = document.createElement('span');
        tile.className = 'word-tile';
        tile.dataset.row = String(row);
        tile.dataset.col = String(col);
        line.append(tile);
      }
      board.append(line);
    }
  }

  $('#memoryRestart').addEventListener('click', startMemory);
  startMemory();
  $('#memoryBest').textContent = localStorage.getItem('egor_memory_best') ? localStorage.getItem('egor_memory_best') + ' очков' : '—';
  $('#reactionBest').textContent = localStorage.getItem('egor_reaction_best') ? localStorage.getItem('egor_reaction_best') + ' мс' : '—';
  $('#reactionStart').addEventListener('click', reactionClick);
  setupWordGame();
  $('#wordForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (wordDone) return;
    const input = $('#wordInput');
    const guess = input.value.trim().toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е');
    if (!/^[А-Я]{5}$/.test(guess)) return showNotice($('#wordMessage'), 'Нужно ввести ровно пять русских букв.');
    const answer = todayWord.replace(/Ё/g, 'Е');
    const counts = {};
    for (const letter of answer) counts[letter] = (counts[letter] || 0) + 1;
    const marks = Array(5).fill('miss');
    for (let i = 0; i < 5; i += 1) if (guess[i] === answer[i]) { marks[i] = 'hit'; counts[guess[i]] -= 1; }
    for (let i = 0; i < 5; i += 1) if (marks[i] !== 'hit' && counts[guess[i]] > 0) { marks[i] = 'near'; counts[guess[i]] -= 1; }
    const row = wordAttempt++;
    [...document.querySelectorAll('.word-tile')].filter((tile) => Number(tile.dataset.row) === row).forEach((tile, i) => {
      tile.textContent = guess[i];
      tile.classList.add(marks[i]);
      tile.style.animationDelay = (i * 90) + 'ms';
    });
    input.value = '';
    if (guess === answer || wordAttempt === 6) {
      wordDone = true;
      $('#wordInput').disabled = true;
      $('#wordForm button').disabled = true;
      showNotice($('#wordMessage'), guess === answer ? 'Угадал за ' + wordAttempt + (wordAttempt === 1 ? ' попытку! ✨' : ' попытки! ✨') : 'Сегодня было слово «' + todayWord + '». Новое появится завтра.', guess === answer ? 'success' : 'error');
      if (guess === answer) $('#wordBoard').classList.add('game-win');
    }
  });


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
  document.querySelectorAll('[data-game]').forEach((card) => {
    card.addEventListener('click', () => setGameTab(card.dataset.game));
  });
  $('#backToGames').addEventListener('click', () => setGameTab(null));
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
