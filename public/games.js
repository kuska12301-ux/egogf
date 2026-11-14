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
  let lobbyData = { ticTacToe: [], codebreaker: [], wordDuel: [] };
  let lastTttSignature = '';
  let lastCodeSignature = '';
  let lastWordSignature = '';
  let modalAction = null;
  let pendingDuel = null;

  const themeToggle = $('#themeToggle');
  function setTheme(theme) {
    const blue = theme === 'blue';
    document.body.dataset.theme = blue ? 'blue' : 'pink';
    themeToggle.setAttribute('aria-label', blue ? 'Включить розовую тему' : 'Включить голубую тему');
    themeToggle.setAttribute('aria-pressed', String(blue));
    document.querySelector('meta[name="theme-color"]').content = blue ? '#c6e8fa' : '#f7b7d0';
    localStorage.setItem('egor_theme', blue ? 'blue' : 'pink');
  }
  setTheme(localStorage.getItem('egor_theme') || 'pink');
  themeToggle.addEventListener('click', () => setTheme(document.body.dataset.theme === 'blue' ? 'pink' : 'blue'));

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
    badge.textContent = game === 'ttt' ? '✕○' : game === 'word' ? 'АБ' : '⌁';
    const meta = document.createElement('div');
    meta.className = 'lobby-meta';
    const title = document.createElement('b');
    title.textContent = (game === 'ttt' ? 'Партия ' : game === 'word' ? 'Дуэль слов ' : 'Дуэль кодов ') + lobby.code;
    const detail = document.createElement('span');
    if (game === 'ttt') {
      detail.textContent = userName(lobby.players.x) + ' · свободно место для ○';
    } else {
      detail.textContent = userName(lobby.players[0]) + ' · ждёт соперника';
    }
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'join-button';
    join.textContent = 'Войти →';
    join.addEventListener('click', () => game === 'ttt' ? joinLobby(game, lobby.id) : openDuelSecret(game, lobby.id));
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

  function renderDuelGame(lobby, kind) {
    const isWord = kind === 'word';
    const container = $(isWord ? '#wordActive' : '#codeActive');
    const signature = JSON.stringify(lobby);
    const previous = isWord ? lastWordSignature : lastCodeSignature;
    if (!lobby) {
      container.hidden = true;
      container.replaceChildren();
      if (isWord) lastWordSignature = '';
      else lastCodeSignature = '';
      return;
    }
    if (signature === previous && !container.hidden) return;
    if (isWord) lastWordSignature = signature;
    else lastCodeSignature = signature;
    container.hidden = false;
    container.replaceChildren();
    const header = document.createElement('div');
    header.className = 'active-top';
    const details = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = (isWord ? 'Дуэль слов · ' : 'Дуэль кодов · ') + lobby.code;
    const subtitle = document.createElement('p');
    subtitle.textContent = lobby.players.map((item) => item.displayName).join(' · ') + (lobby.opponent ? ' · играют друг против друга' : ' · отправь код другу');
    details.append(title, subtitle);
    const roomCode = document.createElement('button');
    roomCode.type = 'button';
    roomCode.className = 'room-code';
    roomCode.textContent = lobby.code;
    roomCode.title = 'Скопировать код комнаты';
    roomCode.addEventListener('click', () => copyRoomCode(lobby.code));
    header.append(details, roomCode);
    container.append(header);

    const ownSecret = document.createElement('div');
    ownSecret.className = 'secret-pill';
    ownSecret.textContent = (isWord ? 'Твоё слово: ' : 'Твой код: ') + (lobby.myWord || lobby.myCode || '•••••');
    container.append(ownSecret);

    const status = document.createElement('div');
    const finished = lobby.state === 'finished';
    status.className = 'turn-banner' + (finished ? ' neutral' : '');
    if (lobby.state === 'waiting') status.textContent = 'Комната готова. Друг загадает свой секрет, когда присоединится.';
    else if (finished && lobby.winner) status.textContent = lobby.winner.id === profile.id ? '🏆 Ты победил! Другой секрет пока остался закрытым.' : '🏆 Победил ' + lobby.winner.displayName + '!';
    else if (finished) status.textContent = 'Ничья! Оба секрета оказались непростыми.';
    else if (lobby.mySolved) status.textContent = '🎉 Ты угадал секрет друга! Ждём результат соперника.';
    else if (lobby.opponentSolved) status.textContent = 'Друг угадал твой секрет. Успей разгадать его слово!';
    else status.textContent = 'Твои попытки: ' + lobby.triesLeft + ' · попытки друга: ' + lobby.opponentTries + '/8';
    container.append(status);
    if (finished && lobby.opponentSecret) {
      const reveal = document.createElement('div');
      reveal.className = 'secret-reveal';
      reveal.textContent = (isWord ? 'Слово друга: ' : 'Код друга: ') + lobby.opponentSecret;
      container.append(reveal);
    }

    if (lobby.state === 'playing' && !lobby.mySolved && lobby.triesLeft > 0) {
      const controls = document.createElement('form');
      controls.className = isWord ? 'word-form' : 'code-controls';
      const input = document.createElement('input');
      input.className = 'code-input';
      input.name = isWord ? 'guessWord' : 'guessCode';
      input.type = 'text';
      input.inputMode = isWord ? 'text' : 'numeric';
      input.autocomplete = 'off';
      input.placeholder = isWord ? 'СЛОВО ИЗ 5 БУКВ' : 'ТРИ РАЗНЫЕ ЦИФРЫ';
      input.maxLength = isWord ? 5 : 3;
      input.pattern = isWord ? '[А-Яа-яЁё]{5}' : '[0-9]{3}';
      input.setAttribute('aria-label', isWord ? 'Попробуй угадать слово соперника' : 'Попробуй угадать код соперника');
      const submit = document.createElement('button');
      submit.className = 'primary-button';
      submit.type = 'submit';
      submit.textContent = 'Проверить ↗';
      controls.append(input, submit);
      controls.addEventListener('submit', (event) => {
        event.preventDefault();
        submitGuess(lobby.id, input.value, kind);
      });
      container.append(controls);
    }

    const history = document.createElement('div');
    history.className = 'guess-list';
    lobby.myGuesses.slice().reverse().forEach((guess, index) => {
      const row = document.createElement('div');
      row.className = 'guess-row' + (isWord ? ' word-guess-row' : '');
      if (isWord) {
        const turn = document.createElement('span');
        turn.textContent = 'Попытка ' + (lobby.myGuesses.length - index);
        const letters = document.createElement('div');
        letters.className = 'guess-letters';
        [...guess.guess].forEach((letter, i) => {
          const tile = document.createElement('b');
          tile.textContent = letter;
          tile.className = 'word-tile ' + guess.marks[i];
          letters.append(tile);
        });
        row.append(turn, letters);
      } else {
        const turn = document.createElement('span');
        turn.textContent = 'Попытка ' + (lobby.myGuesses.length - index);
        const digits = document.createElement('b');
        digits.textContent = guess.digits;
        const hint = document.createElement('strong');
        hint.textContent = guess.exact + ' на месте · ' + guess.misplaced + ' рядом';
        row.append(turn, digits, hint);
      }
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
      renderLobbyList($('#wordLobbies'), lobbyData.wordDuel.open, 'word', $('#wordCount'));
      activeTtt = lobbyData.ticTacToe.mine.find((game) => game.state === 'waiting' || game.state === 'playing') ||
        lobbyData.ticTacToe.mine.find((game) => game.state === 'won' || game.state === 'draw') || null;
      activeCode = lobbyData.codebreaker.mine.find((game) => game.state === 'waiting' || game.state === 'playing') ||
        lobbyData.codebreaker.mine.find((game) => game.state === 'finished') || null;
      const activeWord = lobbyData.wordDuel.mine.find((game) => game.state === 'waiting' || game.state === 'playing') ||
        lobbyData.wordDuel.mine.find((game) => game.state === 'finished') || null;
      renderBoard(activeTtt);
      renderDuelGame(activeCode, 'code');
      renderDuelGame(activeWord, 'word');
    } catch (error) {
      if (/Войди|сессия/i.test(error.message)) {
        profile = null;
        renderProfile();
      } else showNotice(gameMessage, error.message);
    }
  }

  async function joinLobby(game, id, secret = '') {
    clearNotice(gameMessage);
    try {
      const path = game === 'ttt' ? '/api/ttt/lobbies/' : game === 'word' ? '/api/word/lobbies/' : '/api/code/lobbies/';
      const payload = game === 'ttt' ? {} : { secret };
      const result = await api(path + encodeURIComponent(id) + '/join', { method: 'POST', body: JSON.stringify(payload) });
      if (game === 'ttt') activeTtt = result.lobby;
      else if (game === 'word') setGameTab('word');
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

  async function submitGuess(id, value, game) {
    clearNotice(gameMessage);
    try {
      await api('/api/' + (game === 'word' ? 'word' : 'code') + '/lobbies/' + encodeURIComponent(id) + '/guess', {
        method: 'POST', body: JSON.stringify(game === 'word' ? { guess: value } : { digits: value })
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

  function openDuelSecret(game, id = null) {
    pendingDuel = { game, id };
    const isWord = game === 'word';
    $('#duelSecretTitle').textContent = isWord ? 'Загадай слово' : 'Задай свой код';
    $('#duelSecretHelp').textContent = isWord
      ? 'Соперник будет угадывать твоё слово, а ты — его. Используй русские буквы.'
      : 'У каждого будет свой код. Не показывай его другу — он будет угадывать.';
    $('#duelSecretField').firstChild.textContent = isWord ? 'Секретное слово' : 'Секретный код';
    const input = $('#duelSecretInput');
    input.value = '';
    input.type = 'password';
    input.inputMode = isWord ? 'text' : 'numeric';
    input.placeholder = isWord ? 'ПЯТЬ БУКВ' : 'ТРИ ЦИФРЫ';
    input.maxLength = isWord ? 5 : 3;
    input.pattern = isWord ? '[А-Яа-яЁё]{5}' : '[0-9]{3}';
    input.setAttribute('aria-label', isWord ? 'Загадай слово из пяти русских букв' : 'Задай код из трёх разных цифр');
    $('#duelSecretMessage').hidden = true;
    $('#duelSecretDialog').showModal();
    input.focus();
  }

  $('#duelSecretForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!pendingDuel) return;
    const { game, id } = pendingDuel;
    const value = $('#duelSecretInput').value.trim();
    const secret = game === 'word' ? value.toLocaleUpperCase('ru-RU') : value;
    const valid = game === 'word' ? /^[А-ЯЁ]{5}$/.test(secret) : /^(?!.*(.).*\1)[0-9]{3}$/.test(secret);
    if (!valid) return showNotice($('#duelSecretMessage'), game === 'word' ? 'Нужно ровно пять русских букв.' : 'Нужны три разные цифры.');
    const dialog = $('#duelSecretDialog');
    dialog.close();
    const pending = pendingDuel;
    pendingDuel = null;
    if (pending.id) await joinLobby(game, pending.id, secret);
    else await createLobby(game, secret);
  });
  $('#duelSecretCancel').addEventListener('click', () => { pendingDuel = null; $('#duelSecretDialog').close(); });

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

  $('#memoryRestart').addEventListener('click', startMemory);
  startMemory();
  $('#memoryBest').textContent = localStorage.getItem('egor_memory_best') ? localStorage.getItem('egor_memory_best') + ' очков' : '—';
  $('#reactionBest').textContent = localStorage.getItem('egor_reaction_best') ? localStorage.getItem('egor_reaction_best') + ' мс' : '—';
  $('#reactionStart').addEventListener('click', reactionClick);
  async function createLobby(game, secret = '') {
    clearNotice(gameMessage);
    try {
      const path = game === 'ttt' ? '/api/ttt/lobbies' : game === 'word' ? '/api/word/lobbies' : '/api/code/lobbies';
      const result = await api(path, { method: 'POST', body: JSON.stringify(game === 'ttt' ? {} : { secret }) });
      if (game === 'code') $('#codeSecret').value = '';
      if (game === 'word') $('#wordSecret').value = '';
      if (game === 'ttt') activeTtt = result.lobby;
      else if (game === 'word') setGameTab('word');
      else activeCode = result.lobby;
      await pollLobbies();
      const instructions = game === 'ttt'
        ? 'Отправь другу код ' + result.lobby.code + ' и жди его хода.'
        : 'Отправь другу код комнаты ' + result.lobby.code + '. Секрет уже сохранён — друг задаст свой, и начнётся дуэль!';
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

  $('#createTtt').addEventListener('click', () => createLobby('ttt'));
  $('#createCode').addEventListener('click', () => createLobby('code', $('#codeSecret').value.trim()));
  $('#createWord').addEventListener('click', () => createLobby('word', $('#wordSecret').value.trim().toLocaleUpperCase('ru-RU')));
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
