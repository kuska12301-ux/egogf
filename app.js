'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const publicRoot = path.resolve(__dirname, 'public');
// Some BotHost deployments flatten the uploaded public directory into /app.
const root = fs.existsSync(publicRoot) ? publicRoot : __dirname;
const dataRoot = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const dataFile = path.join(dataRoot, 'app-data.json');
const port = Number(process.env.PORT) || 3000;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const adminSessions = new Map();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      ticTacToe: Array.isArray(parsed.ticTacToe) ? parsed.ticTacToe : [],
      codebreaker: Array.isArray(parsed.codebreaker) ? parsed.codebreaker : [],
      wordDuel: Array.isArray(parsed.wordDuel) ? parsed.wordDuel : []
    };
  } catch {
    return { users: [], ticTacToe: [], codebreaker: [], wordDuel: [] };
  }
}

const data = loadData();

function persist() {
  fs.mkdirSync(dataRoot, { recursive: true });
  const temp = dataFile + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(temp, dataFile);
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function fail(res, status, error) {
  sendJson(res, status, { error });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 8192) {
        tooLarge = true;
        reject(new Error('Request too large'));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid request')); }
    });
    req.on('error', reject);
  });
}

function cookieValue(req, key) {
  const pair = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(key + '='));
  return pair ? pair.slice(key.length + 1) : '';
}

function secureRequest(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || req.socket.encrypted === true;
}

function sessionCookie(req, token, maxAge) {
  return 'egor_session=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + maxAge + (secureRequest(req) ? '; Secure' : '');
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return parsed.host === forwardedHost;
  } catch { return false; }
}

function sessionUser(req) {
  const token = cookieValue(req, 'egor_session');
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return data.users.find((user) => user.id === session.userId) || null;
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, gamesPlayed: user.gamesPlayed || 0 };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function safeEqualHex(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function getClientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function requestLimit(ip, username) {
  const key = ip + '|' + username;
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  if (recent.length >= 8) {
    loginAttempts.set(key, recent);
    return true;
  }
  recent.push(now);
  loginAttempts.set(key, recent);
  return false;
}

function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (data.ticTacToe.some((room) => room.code === code) || data.codebreaker.some((room) => room.code === code) || data.wordDuel.some((room) => room.code === code));
  return code;
}

function player(user) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

function updateGamesPlayed(players) {
  const ids = new Set(players.filter(Boolean).map((item) => item.id));
  for (const user of data.users) if (ids.has(user.id)) user.gamesPlayed = (user.gamesPlayed || 0) + 1;
}

function publicTtt(room, userId) {
  const mark = room.players.x && room.players.x.id === userId ? 'x' : room.players.o && room.players.o.id === userId ? 'o' : null;
  const turnMark = room.turn;
  return {
    id: room.id,
    code: room.code,
    createdAt: room.createdAt,
    state: room.state,
    board: room.board,
    players: room.players,
    myMark: mark,
    myTurn: room.state === 'playing' && Boolean(mark) && mark === turnMark,
    currentMark: turnMark,
    turnPlayer: turnMark ? room.players[turnMark] : null,
    winner: room.winner || null,
    canJoin: room.state === 'waiting' && !room.players.o && room.players.x.id !== userId
  };
}

function publicCode(room, userId) {
  const mine = room.players.find((item) => item.id === userId);
  const opponent = room.players.find((item) => item.id !== userId);
  return {
    id: room.id,
    code: room.code,
    createdAt: room.createdAt,
    state: room.state,
    players: room.players.map(({ id, username, displayName }) => ({ id, username, displayName })),
    myCode: mine ? mine.secret : null,
    myGuesses: mine ? mine.guesses : [],
    triesLeft: mine ? room.maxTurns - mine.guesses.length : room.maxTurns,
    mySolved: Boolean(mine && mine.solved),
    opponent: opponent ? { id: opponent.id, username: opponent.username, displayName: opponent.displayName } : null,
    opponentSecret: room.state === 'finished' && opponent ? opponent.secret : null,
    opponentTries: opponent ? opponent.guesses.length : 0,
    opponentSolved: Boolean(opponent && opponent.solved),
    canJoin: room.state === 'waiting' && room.players.length === 1 && !mine,
    winner: room.winner || null
  };
}

function publicWordDuel(room, userId) {
  const mine = room.players.find((item) => item.id === userId);
  const opponent = room.players.find((item) => item.id !== userId);
  return {
    id: room.id,
    code: room.code,
    createdAt: room.createdAt,
    state: room.state,
    players: room.players.map(({ id, username, displayName }) => ({ id, username, displayName })),
    myWord: mine ? mine.secret : null,
    myGuesses: mine ? mine.guesses : [],
    triesLeft: mine ? room.maxTurns - mine.guesses.length : room.maxTurns,
    mySolved: Boolean(mine && mine.solved),
    opponent: opponent ? { id: opponent.id, username: opponent.username, displayName: opponent.displayName } : null,
    opponentSecret: room.state === 'finished' && opponent ? opponent.secret : null,
    opponentTries: opponent ? opponent.guesses.length : 0,
    opponentSolved: Boolean(opponent && opponent.solved),
    canJoin: room.state === 'waiting' && room.players.length === 1 && !mine,
    winner: room.winner || null
  };
}

function validSecretCode(value) {
  return /^(?!.*(.).*\1)[0-9]{3}$/.test(String(value || ''));
}

function validSecretWord(value) {
  return /^[А-ЯЁ]{5}$/.test(String(value || '').trim().toLocaleUpperCase('ru-RU'));
}

function wordFeedback(answerText, guessText) {
  const answer = answerText.replace(/Ё/g, 'Е');
  const guess = guessText.replace(/Ё/g, 'Е');
  const counts = {};
  for (const letter of answer) counts[letter] = (counts[letter] || 0) + 1;
  const marks = Array(5).fill('miss');
  for (let i = 0; i < 5; i += 1) if (guess[i] === answer[i]) { marks[i] = 'hit'; counts[guess[i]] -= 1; }
  for (let i = 0; i < 5; i += 1) if (marks[i] !== 'hit' && counts[guess[i]] > 0) { marks[i] = 'near'; counts[guess[i]] -= 1; }
  return marks;
}

function tttWinner(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a, b, c] of lines) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return null;
}

function findRoom(collection, id) {
  return collection.find((room) => room.id === id);
}

function pruneOldGames() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  data.ticTacToe = data.ticTacToe.filter((room) => Date.parse(room.createdAt) > cutoff);
  data.codebreaker = data.codebreaker.filter((room) => Date.parse(room.createdAt) > cutoff);
  data.wordDuel = data.wordDuel.filter((room) => Date.parse(room.createdAt) > cutoff);
}

async function handleApi(req, res, url) {
  if (!sameOrigin(req)) return fail(res, 403, 'Запрос отклонён.');

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    let body;
    try { body = await readJson(req); } catch { return fail(res, 400, 'Проверь поля и попробуй ещё раз.'); }
    const username = cleanText(body.username, 20).toLowerCase();
    const displayName = cleanText(body.displayName, 24);
    const password = String(body.password || '');
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return fail(res, 400, 'Логин: 3–20 символов, латинские буквы, цифры и _.');
    if (!displayName || displayName.length < 2) return fail(res, 400, 'Имя в игре должно быть не короче 2 символов.');
    if (password.length < 8 || password.length > 72) return fail(res, 400, 'Пароль должен быть длиной от 8 до 72 символов.');
    if (data.users.some((user) => user.username === username)) return fail(res, 409, 'Такой логин уже занят.');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: crypto.randomBytes(16).toString('hex'),
      username,
      displayName,
      salt,
      passwordHash: hashPassword(password, salt),
      gamesPlayed: 0,
      createdAt: new Date().toISOString()
    };
    data.users.push(user);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_MS });
    persist();
    return sendJson(res, 201, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, token, Math.floor(SESSION_MS / 1000)) });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      let body;
      try { body = await readJson(req); } catch { return fail(res, 400, 'Проверь логин и пароль.'); }
    const username = cleanText(body.username, 20).toLowerCase();
    if (requestLimit(getClientIp(req), username)) return fail(res, 429, 'Слишком много попыток. Подожди 15 минут.');
    const user = data.users.find((item) => item.username === username);
    const suppliedPassword = String(body.password || '');
    const passwordOk = user && suppliedPassword.length <= 72 && safeEqualHex(hashPassword(suppliedPassword, user.salt), user.passwordHash);
    if (!passwordOk) return fail(res, 401, 'Логин или пароль не подошёл.');
    loginAttempts.delete(getClientIp(req) + '|' + username);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_MS });
    return sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, token, Math.floor(SESSION_MS / 1000)) });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    sessions.delete(cookieValue(req, 'egor_session'));
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = sessionUser(req);
    if (!user) return fail(res, 401, 'Войди в профиль, чтобы продолжить.');
    return sendJson(res, 200, { user: publicUser(user) });
  }

  const user = sessionUser(req);
  if (!user) return fail(res, 401, 'Войди в профиль, чтобы продолжить.');

  if (req.method === 'GET' && url.pathname === '/api/lobbies') {
    pruneOldGames();
    const own = (room) => {
      if (room.players && room.players.x) return room.players.x.id === user.id || (room.players.o && room.players.o.id === user.id);
      return room.players.some((item) => item.id === user.id);
    };
    return sendJson(res, 200, {
      profile: publicUser(user),
      ticTacToe: {
        open: data.ticTacToe.filter((room) => room.state === 'waiting' && room.players.x && !room.players.o && room.players.x.id !== user.id).map((room) => publicTtt(room, user.id)),
        mine: data.ticTacToe.filter(own).slice(-20).reverse().map((room) => publicTtt(room, user.id))
      },
      codebreaker: {
        open: data.codebreaker.filter((room) => room.players && room.players[0] && room.players[0].secret && room.state === 'waiting' && !room.players.some((item) => item.id === user.id)).map((room) => publicCode(room, user.id)),
        mine: data.codebreaker.filter((room) => room.players && room.players.some((item) => item.id === user.id && item.secret)).slice(-20).reverse().map((room) => publicCode(room, user.id))
      },
      wordDuel: {
        open: data.wordDuel.filter((room) => room.state === 'waiting' && !room.players.some((item) => item.id === user.id)).map((room) => publicWordDuel(room, user.id)),
        mine: data.wordDuel.filter(own).slice(-20).reverse().map((room) => publicWordDuel(room, user.id))
      }
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ttt/lobbies') {
    const room = {
      id: crypto.randomBytes(12).toString('hex'),
      code: randomRoomCode(),
      createdAt: new Date().toISOString(),
      state: 'waiting',
      players: { x: player(user), o: null },
      board: Array(9).fill(''),
      turn: 'x',
      winner: null
    };
    data.ticTacToe.push(room);
    persist();
    return sendJson(res, 201, { lobby: publicTtt(room, user.id) });
  }

  let match = url.pathname.match(/^\/api\/ttt\/lobbies\/([a-f0-9]+)\/(join|move)$/);
  if (req.method === 'POST' && match) {
    const room = findRoom(data.ticTacToe, match[1]);
    if (!room) return fail(res, 404, 'Лобби не найдено.');
    if (match[2] === 'join') {
      if (room.state !== 'waiting' || !room.players.x || room.players.o) return fail(res, 409, 'В это лобби уже нельзя войти.');
      if (room.players.x.id === user.id) return fail(res, 409, 'Это твоё лобби. Подожди второго игрока.');
      room.players.o = player(user);
      room.state = 'playing';
      persist();
      return sendJson(res, 200, { lobby: publicTtt(room, user.id) });
    }
    let body;
    try { body = await readJson(req); } catch { return fail(res, 400, 'Некорректный ход.'); }
    if (room.state !== 'playing') return fail(res, 409, 'Партия уже завершена.');
    const mark = room.players.x.id === user.id ? 'x' : room.players.o && room.players.o.id === user.id ? 'o' : null;
    if (!mark) return fail(res, 403, 'Ты не участник этой партии.');
    if (mark !== room.turn) return fail(res, 409, 'Сейчас ход другого игрока.');
    const cell = Number(body.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || room.board[cell]) return fail(res, 400, 'Эта клетка уже занята.');
    room.board[cell] = mark;
    const winnerMark = tttWinner(room.board);
    if (winnerMark) {
      room.state = 'won';
      room.winner = room.players[winnerMark];
      updateGamesPlayed([room.players.x, room.players.o]);
    } else if (room.board.every(Boolean)) {
      room.state = 'draw';
      updateGamesPlayed([room.players.x, room.players.o]);
    } else room.turn = mark === 'x' ? 'o' : 'x';
    persist();
    return sendJson(res, 200, { lobby: publicTtt(room, user.id) });
  }

  if (req.method === 'POST' && url.pathname === '/api/code/lobbies') {
    let body;
    try { body = await readJson(req); } catch { return fail(res, 400, 'Введи свой трёхзначный код.'); }
    const secret = String(body.secret || '');
    if (!validSecretCode(secret)) return fail(res, 400, 'Задай три разные цифры, например 482.');
    const room = {
      id: crypto.randomBytes(12).toString('hex'),
      code: randomRoomCode(),
      createdAt: new Date().toISOString(),
      state: 'waiting',
      players: [{ ...player(user), secret, guesses: [], solved: false }],
      maxTurns: 8,
      winner: null
    };
    data.codebreaker.push(room);
    persist();
    return sendJson(res, 201, { lobby: publicCode(room, user.id) });
  }

  match = url.pathname.match(/^\/api\/code\/lobbies\/([a-f0-9]+)\/(join|guess)$/);
  if (req.method === 'POST' && match) {
    const room = findRoom(data.codebreaker, match[1]);
    if (!room) return fail(res, 404, 'Комната не найдена.');
    if (match[2] === 'join') {
      if (room.state !== 'waiting') return fail(res, 409, 'Эта игра уже началась.');
      if (room.players.some((item) => item.id === user.id)) return fail(res, 409, 'Ты уже в этой комнате.');
      let body;
      try { body = await readJson(req); } catch { return fail(res, 400, 'Введи свой трёхзначный код.'); }
      const secret = String(body.secret || '');
      if (!validSecretCode(secret)) return fail(res, 400, 'Задай три разные цифры, например 739.');
      room.players.push({ ...player(user), secret, guesses: [], solved: false });
      room.state = 'playing';
      persist();
      return sendJson(res, 200, { lobby: publicCode(room, user.id) });
    }
    let body;
    try { body = await readJson(req); } catch { return fail(res, 400, 'Введи три разные цифры.'); }
    if (room.state !== 'playing') return fail(res, 409, 'Игра пока ждёт второго игрока или уже закончена.');
    const current = room.players.find((item) => item.id === user.id);
    const target = room.players.find((item) => item.id !== user.id);
    if (!current || !target) return fail(res, 403, 'Ты не участник этой дуэли.');
    if (current.solved || current.guesses.length >= room.maxTurns) return fail(res, 409, 'Твои попытки уже закончились.');
    const digits = String(body.digits || '');
    if (!validSecretCode(digits)) return fail(res, 400, 'Нужны три разные цифры от 0 до 9.');
    const exact = [...digits].filter((digit, index) => digit === target.secret[index]).length;
    const common = [...digits].filter((digit) => target.secret.includes(digit)).length;
    current.guesses.push({ digits, exact, misplaced: common - exact, at: new Date().toISOString() });
    if (exact === 3) current.solved = true;
    const finished = room.players.every((item) => item.solved || item.guesses.length >= room.maxTurns);
    if (finished) {
      room.state = 'finished';
      const solved = room.players.filter((item) => item.solved);
      if (solved.length === 1) room.winner = player(data.users.find((item) => item.id === solved[0].id));
      else if (solved.length === 2 && solved[0].guesses.length !== solved[1].guesses.length) {
        const quicker = solved[0].guesses.length < solved[1].guesses.length ? solved[0] : solved[1];
        room.winner = player(data.users.find((item) => item.id === quicker.id));
      } else room.winner = null;
      updateGamesPlayed(room.players);
    }
    persist();
    return sendJson(res, 200, { lobby: publicCode(room, user.id) });
  }

  if (req.method === 'POST' && url.pathname === '/api/word/lobbies') {
    let body;
    try { body = await readJson(req); } catch { return fail(res, 400, 'Введи слово из пяти букв.'); }
    const secret = cleanText(body.secret, 5).toLocaleUpperCase('ru-RU');
    if (!validSecretWord(secret)) return fail(res, 400, 'Загадай слово из пяти русских букв.');
    const room = {
      id: crypto.randomBytes(12).toString('hex'),
      code: randomRoomCode(),
      createdAt: new Date().toISOString(),
      state: 'waiting',
      players: [{ ...player(user), secret, guesses: [], solved: false }],
      maxTurns: 8,
      winner: null
    };
    data.wordDuel.push(room);
    persist();
    return sendJson(res, 201, { lobby: publicWordDuel(room, user.id) });
  }

  match = url.pathname.match(/^\/api\/word\/lobbies\/([a-f0-9]+)\/(join|guess)$/);
  if (req.method === 'POST' && match) {
    const room = findRoom(data.wordDuel, match[1]);
    if (!room) return fail(res, 404, 'Комната не найдена.');
    let body;
    try { body = await readJson(req); } catch { return fail(res, 400, 'Проверь слово и попробуй ещё раз.'); }
    if (match[2] === 'join') {
      if (room.state !== 'waiting') return fail(res, 409, 'Эта игра уже началась.');
      if (room.players.some((item) => item.id === user.id)) return fail(res, 409, 'Ты уже в этой комнате.');
      const secret = cleanText(body.secret, 5).toLocaleUpperCase('ru-RU');
      if (!validSecretWord(secret)) return fail(res, 400, 'Загадай слово из пяти русских букв.');
      room.players.push({ ...player(user), secret, guesses: [], solved: false });
      room.state = 'playing';
      persist();
      return sendJson(res, 200, { lobby: publicWordDuel(room, user.id) });
    }
    if (room.state !== 'playing') return fail(res, 409, 'Дождись второго игрока или игра уже закончилась.');
    const current = room.players.find((item) => item.id === user.id);
    const target = room.players.find((item) => item.id !== user.id);
    if (!current || !target) return fail(res, 403, 'Ты не участник этой дуэли.');
    if (current.solved || current.guesses.length >= room.maxTurns) return fail(res, 409, 'Твои попытки уже закончились.');
    const guess = cleanText(body.guess, 5).toLocaleUpperCase('ru-RU');
    if (!validSecretWord(guess)) return fail(res, 400, 'Введи слово из пяти русских букв.');
    const marks = wordFeedback(target.secret, guess);
    current.guesses.push({ guess, marks, at: new Date().toISOString() });
    if (marks.every((mark) => mark === 'hit')) current.solved = true;
    const finished = room.players.every((item) => item.solved || item.guesses.length >= room.maxTurns);
    if (finished) {
      room.state = 'finished';
      const solved = room.players.filter((item) => item.solved);
      if (solved.length === 1) room.winner = player(data.users.find((item) => item.id === solved[0].id));
      else if (solved.length === 2 && solved[0].guesses.length !== solved[1].guesses.length) {
        const quicker = solved[0].guesses.length < solved[1].guesses.length ? solved[0] : solved[1];
        room.winner = player(data.users.find((item) => item.id === quicker.id));
      } else room.winner = null;
      updateGamesPlayed(room.players);
    }
    persist();
    return sendJson(res, 200, { lobby: publicWordDuel(room, user.id) });
  }

  return fail(res, 404, 'Такого действия нет.');
}

function getAdminSession(req) {
  const token = cookieValue(req, 'egor_admin_session');
  const expires = adminSessions.get(token);
  if (!expires || expires < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname.startsWith('/api/') && !['/api/admin-login', '/api/admin-logout', '/api/admin-session'].includes(url.pathname)) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      console.error('API error:', error && error.message);
      if (!res.headersSent) fail(res, 500, 'На сервере произошла ошибка. Попробуй ещё раз.');
      else res.end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin-login') {
    const secret = process.env.ADMIN_PASSWORD;
    if (!secret) return sendJson(res, 503, { error: 'Admin password is not configured' });
    let body;
    try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'Invalid request' }); }
    const supplied = Buffer.from(String(body.password || ''), 'utf8');
    const expected = Buffer.from(secret, 'utf8');
    const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!valid) return sendJson(res, 401, { error: 'Invalid password' });
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': 'egor_admin_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200' + (secureRequest(req) ? '; Secure' : '')
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin-logout') {
    adminSessions.delete(cookieValue(req, 'egor_admin_session'));
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': 'egor_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + (secureRequest(req) ? '; Secure' : '')
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin-session') {
    return sendJson(res, 200, { authenticated: getAdminSession(req) });
  }

  let relative;
  try { relative = decodeURIComponent(url.pathname).slice(1) || 'index.html'; }
  catch { return res.writeHead(400).end('Bad request'); }
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end('Forbidden');

  fs.readFile(file, (error, body) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      ...(path.basename(file).endsWith('.html') ? { 'Cache-Control': 'no-cache' } : {}),
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
  });
});

server.listen(port, '0.0.0.0', () => console.log('Egor Mini App listening on ' + port));
