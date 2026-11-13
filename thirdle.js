const MAX_ATTEMPTS = 6;
const WORD_BANK = {
  3: [
    "ant", "art", "ash", "bat", "bee", "box", "cat", "cod", "cup", "dew",
    "dog", "ear", "egg", "fan", "fox", "gem", "hat", "ice", "jar", "joy",
    "key", "map", "oak", "owl", "pen", "pig", "red", "sea", "sky", "sun",
    "tea", "top", "toy", "web", "win", "zip"
  ],
  4: [
    "arch", "bark", "bear", "bird", "blue", "book", "calm", "care", "card",
    "cave", "clay", "code", "dawn", "desk", "drum", "dusk", "face", "farm",
    "fern", "film", "fire", "fish", "flag", "game", "gate", "gift", "glow",
    "gold", "hand", "hike", "home", "hope", "iron", "jump", "kind", "lake",
    "lamp", "leaf", "lime", "love", "mask", "moon", "moss", "nest", "note",
    "open", "oval", "path", "play", "poem", "rain", "read", "reef", "ring",
    "rose", "seed", "ship", "shoe", "silk", "song", "star", "stay", "stew",
    "swim", "teal", "tent", "time", "tree", "tune", "wave", "wind", "wing",
    "wish", "work", "yarn", "zero"
  ],
  5: [
    "amber", "apple", "blaze", "brave", "brick", "brush", "cabin", "cable",
    "cedar", "chair", "chalk", "chase", "clean", "clock", "coast", "coral",
    "craft", "dance", "dream", "earth", "flame", "flour", "focus", "frame",
    "fresh", "glass", "globe", "grace", "green", "heart", "honey", "image",
    "jewel", "light", "lunar", "maple", "metal", "music", "night", "ocean",
    "olive", "paint", "paper", "pearl", "piano", "pilot", "place", "plant",
    "point", "prize", "quiet", "river", "robin", "scale", "shape", "sharp",
    "shore", "smile", "smoke", "sound", "space", "spice", "stone", "storm",
    "story", "sugar", "sweet", "table", "teach", "theme", "tiger", "trail",
    "trend", "trust", "union", "vivid", "wheel", "white", "world", "youth",
    "zebra"
  ]
};

const wordLengthSelect = document.getElementById("thirdle-word-length");
const newGameButton = document.getElementById("thirdle-new-game");
const hintButton = document.getElementById("thirdle-hint");
const attemptCount = document.getElementById("thirdle-attempt-count");
const gameStatus = document.getElementById("thirdle-status");
const board = document.getElementById("thirdle-board");
const keyboard = document.getElementById("thirdle-keyboard");
const guessForm = document.getElementById("thirdle-guess-form");
const guessInput = document.getElementById("thirdle-guess");
const submitGuessButton = document.getElementById("thirdle-submit-guess");

const game = {
  wordLength: Number(wordLengthSelect.value),
  secret: "",
  turns: [],
  letterStates: new Map(),
  isOver: false
};

const setStatus = (message, state = "info") => {
  gameStatus.textContent = message;
  gameStatus.dataset.state = state;
};

const createKeyboardButton = (label, { key = "", action = "", wide = false } = {}) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `thirdle-key${wide ? " thirdle-key-wide" : ""}`;
  button.textContent = label;
  button.setAttribute("aria-label", action === "delete" ? "Delete letter" : label);
  if (key) {
    button.dataset.key = key;
  }
  if (action) {
    button.dataset.action = action;
  }
  return button;
};

const buildKeyboard = () => {
  keyboard.replaceChildren();
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

  rows.forEach((letters, rowIndex) => {
    const row = document.createElement("div");
    row.className = "thirdle-key-row";

    if (rowIndex === 2) {
      row.appendChild(createKeyboardButton("Del", { action: "delete", wide: true }));
    }

    for (const letter of letters) {
      row.appendChild(createKeyboardButton(letter, { key: letter }));
    }

    if (rowIndex === 2) {
      row.appendChild(createKeyboardButton("Enter", { action: "enter", wide: true }));
    }

    keyboard.appendChild(row);
  });
};

const renderBoard = () => {
  board.replaceChildren();
  board.style.setProperty("--thirdle-word-length", String(game.wordLength));

  for (let rowIndex = 0; rowIndex < MAX_ATTEMPTS; rowIndex += 1) {
    const turn = game.turns[rowIndex];
    const isDraftRow = !turn && rowIndex === game.turns.length && !game.isOver;
    const draft = isDraftRow ? guessInput.value : "";
    const row = document.createElement("div");
    row.className = "thirdle-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-label", `Guess ${rowIndex + 1}`);

    for (let column = 0; column < game.wordLength; column += 1) {
      const tile = document.createElement("div");
      tile.className = "thirdle-tile";
      tile.setAttribute("role", "gridcell");

      if (turn && turn.type === "guess") {
        const letter = turn.word[column];
        const result = turn.results[column];
        tile.textContent = letter;
        tile.dataset.state = result;
        tile.setAttribute("aria-label", `${letter}: ${result}`);
      } else if (turn && turn.type === "hint") {
        tile.dataset.state = "hint";
        tile.setAttribute("aria-label", `Hint cost row ${rowIndex + 1}`);
      } else if (draft[column]) {
        tile.textContent = draft[column];
        tile.dataset.state = "draft";
        tile.setAttribute("aria-label", `${draft[column]}, current guess`);
      } else {
        tile.setAttribute(
          "aria-label",
          `Empty tile ${column + 1} of guess ${rowIndex + 1}`
        );
      }

      row.appendChild(tile);
    }

    board.appendChild(row);
  }
};

const renderKeyboard = () => {
  keyboard.querySelectorAll("[data-key]").forEach((button) => {
    const state = game.letterStates.get(button.dataset.key.toUpperCase());
    if (state) {
      button.dataset.state = state;
    } else {
      delete button.dataset.state;
    }
  });

  keyboard.querySelectorAll("button").forEach((button) => {
    button.disabled = game.isOver;
  });
};

const render = () => {
  const remaining = MAX_ATTEMPTS - game.turns.length;
  attemptCount.textContent = `${remaining} of ${MAX_ATTEMPTS} guess rows remaining`;
  guessInput.disabled = game.isOver;
  submitGuessButton.disabled = game.isOver;
  hintButton.disabled = game.isOver || remaining < 3;
  hintButton.title = remaining < 3 && !game.isOver
    ? "At least three guess rows must remain to use a hint."
    : "A hint uses two guess rows.";
  renderBoard();
  renderKeyboard();
};

const startNewGame = () => {
  game.wordLength = Number(wordLengthSelect.value);
  const words = WORD_BANK[game.wordLength];
  game.secret = words[Math.floor(Math.random() * words.length)].toUpperCase();
  game.turns = [];
  game.letterStates = new Map();
  game.isOver = false;
  guessInput.value = "";
  guessInput.maxLength = game.wordLength;
  setStatus(`New ${game.wordLength}-letter game. Good luck!`);
  render();
};

const getGuessResults = (word) =>
  Array.from(word, (letter, index) => {
    if (letter === game.secret[index]) {
      return "correct";
    }
    return game.secret.includes(letter) ? "present" : "absent";
  });

const updateKeyboardStates = (word, results) => {
  const priority = { absent: 1, present: 2, correct: 3 };
  Array.from(word).forEach((letter, index) => {
    const nextState = results[index];
    const currentState = game.letterStates.get(letter);
    if (!currentState || priority[nextState] > priority[currentState]) {
      game.letterStates.set(letter, nextState);
    }
  });
};

guessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (game.isOver) {
    return;
  }

  const word = guessInput.value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(word) || word.length !== game.wordLength) {
    setStatus(`Enter a ${game.wordLength}-letter word to submit your guess.`, "error");
    return;
  }

  const results = getGuessResults(word);
  game.turns.push({ type: "guess", word, results });
  updateKeyboardStates(word, results);
  guessInput.value = "";

  if (word === game.secret) {
    game.isOver = true;
    setStatus(`Solved! The word was ${game.secret}.`);
  } else if (game.turns.length === MAX_ATTEMPTS) {
    game.isOver = true;
    setStatus(`No guesses remaining. The word was ${game.secret}.`);
  } else {
    setStatus("Guess recorded. Keep going.");
  }

  render();
});

guessInput.addEventListener("input", () => {
  const cleaned = guessInput.value.replace(/[^a-z]/gi, "").slice(0, game.wordLength);
  guessInput.value = cleaned.toUpperCase();
  renderBoard();
});

newGameButton.addEventListener("click", startNewGame);
wordLengthSelect.addEventListener("change", startNewGame);

hintButton.addEventListener("click", () => {
  const remaining = MAX_ATTEMPTS - game.turns.length;
  if (game.isOver || remaining < 3) {
    setStatus("A hint is available only when at least three guess rows remain.", "error");
    return;
  }

  const position = Math.floor(Math.random() * game.wordLength);
  game.turns.push({ type: "hint" }, { type: "hint" });
  setStatus(
    `Hint: ${game.secret[position]} is in position ${position + 1}. Two guess rows were used.`
  );
  render();
});

keyboard.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || game.isOver) {
    return;
  }

  if (button.dataset.action === "enter") {
    guessForm.requestSubmit();
  } else if (button.dataset.action === "delete") {
    guessInput.value = guessInput.value.slice(0, -1);
    renderBoard();
  } else if (button.dataset.key && guessInput.value.length < game.wordLength) {
    guessInput.value += button.dataset.key.toUpperCase();
    renderBoard();
  }
});

buildKeyboard();
startNewGame();
