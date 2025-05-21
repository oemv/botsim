// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";

function hexToUint8Array(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
  throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

// --- Tetris Constants and Logic ---
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const EMPTY_CELL = 0;
const TETROMINOES = {
  1: { shape: [[1, 1, 1, 1]], color: "🟦", name: "I" }, // I
  2: { shape: [[1, 1, 0], [0, 1, 1]], color: "🟥", name: "Z" }, // Z
  3: { shape: [[0, 1, 1], [1, 1, 0]], color: "🟩", name: "S" }, // S
  4: { shape: [[1, 1, 1], [0, 1, 0]], color: "🟪", name: "T" }, // T
  5: { shape: [[1, 1], [1, 1]], color: "🟨", name: "O" },    // O
  6: { shape: [[1, 0, 0], [1, 1, 1]], color: "🟫", name: "J" }, // J
  7: { shape: [[0, 0, 1], [1, 1, 1]], color: "🟧", name: "L" }  // L
};
const PIECE_TYPES = Object.keys(TETROMINOES).map(Number);

const EMOJI_MAP: Record<number, string> = {
  [EMPTY_CELL]: "⬛",
  1: TETROMINOES[1].color,
  2: TETROMINOES[2].color,
  3: TETROMINOES[3].color,
  4: TETROMINOES[4].color,
  5: TETROMINOES[5].color,
  6: TETROMINOES[6].color,
  7: TETROMINOES[7].color,
};

interface TetrisGameState {
  board: number[][];
  currentPiece: { type: number; rotation: number; x: number; y: number } | null;
  nextPieceType: number;
  score: number;
  linesCleared: number;
  level: number;
  gameOver: boolean;
  ownerId: string;
  allowOthers: boolean;
}

function createEmptyBoard(): number[][] {
  return Array(BOARD_HEIGHT).fill(null).map(() => Array(BOARD_WIDTH).fill(EMPTY_CELL));
}

function getRandomPieceType(): number {
  return PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)];
}

function getPieceShape(type: number, rotation: number): number[][] {
  let shape = TETROMINOES[type as keyof typeof TETROMINOES].shape;
  for (let r = 0; r < rotation; r++) {
    shape = shape[0].map((_, colIndex) => shape.map(row => row[colIndex]).reverse());
  }
  return shape;
}

function isValidMove(board: number[][], pieceType: number, rotation: number, x: number, y: number): boolean {
  const shape = getPieceShape(pieceType, rotation);
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        const boardX = x + c;
        const boardY = y + r;
        if (boardX < 0 || boardX >= BOARD_WIDTH || boardY < 0 || boardY >= BOARD_HEIGHT || (board[boardY] && board[boardY][boardX] !== EMPTY_CELL)) {
          return false;
        }
      }
    }
  }
  return true;
}

function spawnNewPiece(state: TetrisGameState): TetrisGameState {
    const type = state.nextPieceType;
    const rotation = 0;
    const shape = getPieceShape(type, rotation);
    const x = Math.floor((BOARD_WIDTH - shape[0].length) / 2);
    const y = 0;

    if (!isValidMove(state.board, type, rotation, x, y)) {
        return { ...state, gameOver: true, currentPiece: null };
    }
    return {
        ...state,
        currentPiece: { type, rotation, x, y },
        nextPieceType: getRandomPieceType(),
    };
}

function initialTetrisState(ownerId: string, allowOthers: boolean): TetrisGameState {
  let state: TetrisGameState = {
    board: createEmptyBoard(),
    currentPiece: null,
    nextPieceType: getRandomPieceType(),
    score: 0,
    linesCleared: 0,
    level: 1,
    gameOver: false,
    ownerId,
    allowOthers,
  };
  return spawnNewPiece(state);
}

function placePieceOnBoard(board: number[][], piece: { type: number; rotation: number; x: number; y: number }): number[][] {
  const newBoard = board.map(row => [...row]);
  const shape = getPieceShape(piece.type, piece.rotation);
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        newBoard[piece.y + r][piece.x + c] = piece.type;
      }
    }
  }
  return newBoard;
}

function clearLines(board: number[][]): { newBoard: number[][]; linesCleared: number } {
  let newBoard = board.filter(row => row.some(cell => cell === EMPTY_CELL));
  const linesClearedCount = BOARD_HEIGHT - newBoard.length;
  while (newBoard.length < BOARD_HEIGHT) {
    newBoard.unshift(Array(BOARD_WIDTH).fill(EMPTY_CELL));
  }
  return { newBoard, linesCleared: linesClearedCount };
}

function updateScoreAndLevel(state: TetrisGameState, lines: number): TetrisGameState {
    if (lines === 0) return state;
    let scoreToAdd = 0;
    switch(lines) {
        case 1: scoreToAdd = 100 * state.level; break;
        case 2: scoreToAdd = 300 * state.level; break;
        case 3: scoreToAdd = 500 * state.level; break;
        case 4: scoreToAdd = 800 * state.level; break; // Tetris!
    }
    const newLinesCleared = state.linesCleared + lines;
    const newLevel = Math.floor(newLinesCleared / 10) + 1; // Level up every 10 lines
    return { ...state, score: state.score + scoreToAdd, linesCleared: newLinesCleared, level: newLevel };
}

function renderTetrisBoard(state: TetrisGameState): string {
  const displayBoard = state.currentPiece
    ? placePieceOnBoard(state.board, state.currentPiece)
    : state.board;

  let boardStr = "```\n";
  displayBoard.forEach(row => {
    boardStr += row.map(cell => EMOJI_MAP[cell] || EMOJI_MAP[EMPTY_CELL]).join("") + "\n";
  });
  boardStr += "```\n";
  boardStr += `Next: ${EMOJI_MAP[state.nextPieceType]} | Score: ${state.score} | Level: ${state.level} | Lines: ${state.linesCleared}`;
  if (state.gameOver) {
    boardStr += "\n**GAME OVER!**";
  }
  return boardStr;
}

function handleTetrisAction(state: TetrisGameState, action: string): TetrisGameState {
  if (state.gameOver || !state.currentPiece) return state;

  let { type, rotation, x, y } = state.currentPiece;
  let newState = { ...state };

  switch (action) {
    case "left":
      if (isValidMove(state.board, type, rotation, x - 1, y)) {
        newState.currentPiece = { ...state.currentPiece!, x: x - 1 };
      }
      break;
    case "right":
      if (isValidMove(state.board, type, rotation, x + 1, y)) {
        newState.currentPiece = { ...state.currentPiece!, x: x + 1 };
      }
      break;
    case "rotate":
      const newRotation = (rotation + 1) % 4;
      if (isValidMove(state.board, type, newRotation, x, y)) {
        newState.currentPiece = { ...state.currentPiece!, rotation: newRotation };
      }
      break;
    case "down": // Soft drop
      if (isValidMove(state.board, type, rotation, x, y + 1)) {
        newState.currentPiece = { ...state.currentPiece!, y: y + 1 };
      } else { // Lock piece
        newState.board = placePieceOnBoard(state.board, state.currentPiece);
        const { newBoard, linesCleared } = clearLines(newState.board);
        newState.board = newBoard;
        newState = updateScoreAndLevel(newState, linesCleared);
        newState = spawnNewPiece(newState);
      }
      break;
    case "drop": // Hard drop
      let tempY = y;
      while (isValidMove(state.board, type, rotation, x, tempY + 1)) {
        tempY++;
      }
      newState.currentPiece = { ...state.currentPiece!, y: tempY };
      newState.board = placePieceOnBoard(state.board, newState.currentPiece); // Lock immediately
      const clResult = clearLines(newState.board);
      newState.board = clResult.newBoard;
      newState = updateScoreAndLevel(newState, clResult.linesCleared);
      newState = spawnNewPiece(newState);
      break;
  }
  return newState;
}

function getTetrisComponents(gameOver: boolean) { // gameStateJson removed as state is now in embed
    if (gameOver) return [];
    return [
        {
            type: 1, // Action Row
            components: [
                { type: 2, style: 2, label: "⬅️", custom_id: "tetris_left" },
                { type: 2, style: 2, label: "⬇️", custom_id: "tetris_down" },
                { type: 2, style: 2, label: "➡️", custom_id: "tetris_right" },
                { type: 2, style: 2, label: "🔄", custom_id: "tetris_rotate" },
                { type: 2, style: 1, label: "⏬", custom_id: "tetris_drop" }, // Hard Drop
            ]
        }
    ];
}
// --- End Tetris Logic ---

// --- Quote Message Logic ---
function getQuoteComponents(counts: { up: number; down: number; fire: number; skull: number; }) {
    return [{
        type: 1, // Action Row
        components: [
            { type: 2, style: 2, label: `👍 ${counts.up}`, custom_id: `quote_up` },
            { type: 2, style: 2, label: `👎 ${counts.down}`, custom_id: `quote_down` },
            { type: 2, style: 2, label: `🔥 ${counts.fire}`, custom_id: `quote_fire` },
            { type: 2, style: 2, label: `💀 ${counts.skull}`, custom_id: `quote_skull` },
        ]
    }];
}
// --- End Quote Message Logic ---

// --- Maze Game Constants and Logic ---
const MAZE_VIEW_WIDTH = 28;
const MAZE_VIEW_HEIGHT = 14;
const MAZE_MAX_VIEW_DISTANCE = 10;

const MAZE_WALL_N_S_CLOSE = "🟥";
const MAZE_WALL_N_S_MID = "♦️";
const MAZE_WALL_E_W_CLOSE = "🟦";
const MAZE_WALL_E_W_MID = "🔹";
const MAZE_WALL_FAR = "⬛";

const MAZE_FLOOR_CLOSE = "🟩";
const MAZE_FLOOR_MID = "🟫";
const MAZE_FLOOR_FAR = "⬛";
const MAZE_CEILING = "🌑";

const MAZE_EMPTY = 0;
const MAZE_WALL = 1;
const MAZE_EXIT_TILE = 9; // Renamed from MAZE_EXIT to avoid conflict

const initialMazeMapData = [
  [1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,1,0,0,0,0,0,0,1],
  [1,0,1,0,1,0,1,1,1,0,1,1],
  [1,0,1,0,0,0,0,0,1,0,0,1],
  [1,0,1,1,1,0,1,0,1,1,0,1],
  [1,0,0,0,1,0,1,0,0,0,'E',1],
  [1,1,1,0,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1],
].map(row => row.map(cell => cell === 'E' ? MAZE_EXIT_TILE : cell as number));

interface MazePlayerState {
  x: number; y: number; angle: number;
  dirX: number; dirY: number; planeX: number; planeY: number;
}

interface MazeGameState {
  map: number[][];
  player: MazePlayerState;
  heldKeys: { w: boolean; s: boolean; a: boolean; d: boolean; sprint: boolean };
  health: number; stamina: number; maxHealth: number; maxStamina: number;
  sprintCost: number; staminaRegen: number; wallBumpDamage: number; sprintBumpDamage: number;
  gameOver: boolean; win: boolean; message: string;
  ownerId: string; allowOthers: boolean;
}

function initialMazePlayerState(): MazePlayerState {
  const angle = Math.PI / 4;
  return {
    x: 1.5, y: 1.5, angle: angle,
    dirX: Math.cos(angle), dirY: Math.sin(angle),
    planeX: Math.cos(angle + Math.PI / 2) * 0.66, planeY: Math.sin(angle + Math.PI / 2) * 0.66,
  };
}

function initialMazeState(ownerId: string, allowOthers: boolean): MazeGameState {
  return {
    map: JSON.parse(JSON.stringify(initialMazeMapData)),
    player: initialMazePlayerState(),
    heldKeys: { w: false, s: false, a: false, d: false, sprint: false },
    health: 100, stamina: 100, maxHealth: 100, maxStamina: 100,
    sprintCost: 0.5, staminaRegen: 0.3, wallBumpDamage: 2, sprintBumpDamage: 5,
    gameOver: false, win: false, message: "Find the exit!",
    ownerId, allowOthers,
  };
}

function renderMazeView(gameState: MazeGameState): string {
  const { player, map } = gameState;
  let screenBuffer: string[][] = Array(MAZE_VIEW_HEIGHT).fill(null).map(() => Array(MAZE_VIEW_WIDTH).fill(MAZE_CEILING));

  for (let x = 0; x < MAZE_VIEW_WIDTH; x++) {
    const cameraX = 2 * x / MAZE_VIEW_WIDTH - 1;
    const rayDirX = player.dirX + player.planeX * cameraX;
    const rayDirY = player.dirY + player.planeY * cameraX;

    let mapX = Math.floor(player.x);
    let mapY = Math.floor(player.y);

    let sideDistX: number, sideDistY: number;
    const deltaDistX = (rayDirX === 0) ? Infinity : Math.abs(1 / rayDirX);
    const deltaDistY = (rayDirY === 0) ? Infinity : Math.abs(1 / rayDirY);
    let perpWallDist: number;
    let stepX: number, stepY: number;
    let hit = 0, side: number = 0; // side=0 EW, side=1 NS

    if (rayDirX < 0) { stepX = -1; sideDistX = (player.x - mapX) * deltaDistX; }
    else { stepX = 1; sideDistX = (mapX + 1.0 - player.x) * deltaDistX; }
    if (rayDirY < 0) { stepY = -1; sideDistY = (player.y - mapY) * deltaDistY; }
    else { stepY = 1; sideDistY = (mapY + 1.0 - player.y) * deltaDistY; }

    while (hit === 0) {
      if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
      else { sideDistY += deltaDistY; mapY += stepY; side = 1; }
      
      if (mapX < 0 || mapX >= map[0].length || mapY < 0 || mapY >= map.length) {
        perpWallDist = MAZE_MAX_VIEW_DISTANCE; hit = 1; break;
      }
      if (map[mapY][mapX] > 0 && map[mapY][mapX] !== MAZE_EXIT_TILE) hit = 1;
      
      let tempPerpWallDist;
      if (side === 0) tempPerpWallDist = (mapX - player.x + (1 - stepX) / 2) / rayDirX;
      else            tempPerpWallDist = (mapY - player.y + (1 - stepY) / 2) / rayDirY;
      if (tempPerpWallDist > MAZE_MAX_VIEW_DISTANCE) { hit = 1; perpWallDist = MAZE_MAX_VIEW_DISTANCE; }
    }
    
    if (side === 0) perpWallDist = (mapX - player.x + (1 - stepX) / 2) / rayDirX;
    else            perpWallDist = (mapY - player.y + (1 - stepY) / 2) / rayDirY;
    perpWallDist = Math.max(0.1, perpWallDist);

    const lineHeight = Math.floor(MAZE_VIEW_HEIGHT / perpWallDist);
    let drawStart = -lineHeight / 2 + MAZE_VIEW_HEIGHT / 2; if (drawStart < 0) drawStart = 0;
    let drawEnd = lineHeight / 2 + MAZE_VIEW_HEIGHT / 2; if (drawEnd >= MAZE_VIEW_HEIGHT) drawEnd = MAZE_VIEW_HEIGHT - 1;

    let wallColor: string;
    if (perpWallDist >= MAZE_MAX_VIEW_DISTANCE * 0.85) wallColor = MAZE_WALL_FAR;
    else if (perpWallDist > MAZE_MAX_VIEW_DISTANCE * 0.5) wallColor = (side === 0) ? MAZE_WALL_E_W_MID : MAZE_WALL_N_S_MID;
    else wallColor = (side === 0) ? MAZE_WALL_E_W_CLOSE : MAZE_WALL_N_S_CLOSE;
    if (map[mapY]?.[mapX] === MAZE_EXIT_TILE && perpWallDist < 1.5) wallColor = "🌟";

    for (let y = 0; y < MAZE_VIEW_HEIGHT; y++) {
      if (y < drawStart) screenBuffer[y][x] = MAZE_CEILING;
      else if (y >= drawStart && y <= drawEnd) screenBuffer[y][x] = wallColor;
      else {
        const currentDist = MAZE_VIEW_HEIGHT / (2.0 * y - MAZE_VIEW_HEIGHT);
        if (currentDist > MAZE_MAX_VIEW_DISTANCE * 0.6) screenBuffer[y][x] = MAZE_FLOOR_FAR;
        else if (currentDist > MAZE_MAX_VIEW_DISTANCE * 0.3) screenBuffer[y][x] = MAZE_FLOOR_MID;
        else screenBuffer[y][x] = MAZE_FLOOR_CLOSE;
      }
    }
  }
  return "```\n" + screenBuffer.map(row => row.join("")).join("\n") + "\n```";
}

function updateMazeGame(gameState: MazeGameState): MazeGameState {
  if (gameState.gameOver || gameState.win) return gameState;
  const { player, map, heldKeys } = gameState;
  const moveSpeedBase = 0.06; const rotationSpeed = 0.05;
  let moveSpeed = moveSpeedBase;

  if (heldKeys.sprint && gameState.stamina > 0 && (heldKeys.w || heldKeys.s)) {
    moveSpeed *= 1.75; gameState.stamina -= gameState.sprintCost;
    if (gameState.stamina < 0) gameState.stamina = 0;
  } else {
    if (gameState.stamina < gameState.maxStamina) {
      gameState.stamina += gameState.staminaRegen;
      if (gameState.stamina > gameState.maxStamina) gameState.stamina = gameState.maxStamina;
    }
  }
  if(heldKeys.sprint && gameState.stamina <=0) heldKeys.sprint = false;

  if (heldKeys.a) {
    const oldDirX = player.dirX; player.dirX = player.dirX * Math.cos(rotationSpeed) - player.dirY * Math.sin(rotationSpeed);
    player.dirY = oldDirX * Math.sin(rotationSpeed) + player.dirY * Math.cos(rotationSpeed);
    const oldPlaneX = player.planeX; player.planeX = player.planeX * Math.cos(rotationSpeed) - player.planeY * Math.sin(rotationSpeed);
    player.planeY = oldPlaneX * Math.sin(rotationSpeed) + player.planeY * Math.cos(rotationSpeed); player.angle -= rotationSpeed;
  }
  if (heldKeys.d) {
    const oldDirX = player.dirX; player.dirX = player.dirX * Math.cos(-rotationSpeed) - player.dirY * Math.sin(-rotationSpeed);
    player.dirY = oldDirX * Math.sin(-rotationSpeed) + player.dirY * Math.cos(-rotationSpeed);
    const oldPlaneX = player.planeX; player.planeX = player.planeX * Math.cos(-rotationSpeed) - player.planeY * Math.sin(-rotationSpeed);
    player.planeY = oldPlaneX * Math.sin(-rotationSpeed) + player.planeY * Math.cos(-rotationSpeed); player.angle += rotationSpeed;
  }

  let newX = player.x, newY = player.y; let moved = false, collided = false;
  if (heldKeys.w) { newX += player.dirX * moveSpeed; newY += player.dirY * moveSpeed; moved = true; }
  if (heldKeys.s) { newX -= player.dirX * moveSpeed * 0.7; newY -= player.dirY * moveSpeed * 0.7; moved = true; }
  
  const checkRadius = 0.2;
  const targetMapCellXForXMove = Math.floor(newX + Math.sign(newX - player.x) * checkRadius);
  if (map[Math.floor(player.y)]?.[targetMapCellXForXMove] > 0 && map[Math.floor(player.y)]?.[targetMapCellXForXMove] !== MAZE_EXIT_TILE) { newX = player.x; collided = true; }
  else { player.x = newX; }

  const targetMapCellYForYMove = Math.floor(newY + Math.sign(newY - player.y) * checkRadius);
  if (map[targetMapCellYForYMove]?.[Math.floor(player.x)] > 0 && map[targetMapCellYForYMove]?.[Math.floor(player.x)] !== MAZE_EXIT_TILE) { newY = player.y; collided = true; } // Use current player.x for this check
  else { player.y = newY; }


  if (moved && collided) {
    gameState.health -= heldKeys.sprint ? gameState.sprintBumpDamage : gameState.wallBumpDamage;
    gameState.message = heldKeys.sprint ? "Ouch! Ran into a wall!" : "Bump!";
    if (gameState.health <= 0) { gameState.health = 0; gameState.gameOver = true; gameState.message = "You collapsed..."; }
  } else if (moved) gameState.message = "";

  if (map[Math.floor(player.y)]?.[Math.floor(player.x)] === MAZE_EXIT_TILE) {
    gameState.win = true; gameState.message = "You found the exit!";
  }
  return gameState;
}

function getMazeStatsDisplay(gameState: MazeGameState): string {
  const healthSegments = Math.max(0, Math.ceil(gameState.health / (gameState.maxHealth / 10)));
  const healthBar = "🟥".repeat(healthSegments) + "▪️".repeat(10 - healthSegments);
  const staminaSegments = Math.max(0, Math.ceil(gameState.stamina / (gameState.maxStamina / 10)));
  const staminaBar = "🟦".repeat(staminaSegments) + "▫️".repeat(10 - staminaSegments);
  let text = `\`\`\`asciidoc\n=Health: [${healthBar}] ${Math.floor(gameState.health)}/${gameState.maxHealth}\n\`\`\`\n`;
  text += `\`\`\`asciidoc\n=Stamina: [${staminaBar}] ${Math.floor(gameState.stamina)}/${gameState.maxStamina}\n\`\`\``;
  if (gameState.message) text += `\n*${gameState.message}*`;
  return text;
}

function getMazeComponents(gameOver: boolean, win: boolean, heldKeys: MazeGameState['heldKeys']) {
  if (gameOver || win) return [{ type: 1, components: [{ type: 2, style: 1, label: "New Game", custom_id: "maze_restart" }] }];
  return [
    { type: 1, components: [
        { type: 2, style: heldKeys.w ? 3 : 2, label: "⬆️ W (Fwd)", custom_id: "maze_w_toggle" },
        { type: 2, style: heldKeys.sprint ? 3 : 2, label: "💨 Sprint", custom_id: "maze_sprint_toggle" },
    ]},
    { type: 1, components: [
        { type: 2, style: heldKeys.a ? 3 : 2, label: "⬅️ A (L)", custom_id: "maze_a_toggle" },
        { type: 2, style: heldKeys.s ? 3 : 2, label: "⬇️ S (Bwd)", custom_id: "maze_s_toggle" },
        { type: 2, style: heldKeys.d ? 3 : 2, label: "➡️ D (R)", custom_id: "maze_d_toggle" },
    ]}
  ];
}
// --- End Maze Game Logic ---


// --- Main Server Logic ---
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  const body = await req.text();

  if (!signature || !timestamp) {
    return new Response("Bad Request: Missing Signature Headers", { status: 400 });
  }

  const isVerified = nacl.sign.detached.verify(
    new TextEncoder().encode(timestamp + body),
    hexToUint8Array(signature),
    hexToUint8Array(DISCORD_PUBLIC_KEY)
  );

  if (!isVerified) {
    return new Response("Unauthorized: Invalid Discord Signature", { status: 401 });
  }

  const interaction = JSON.parse(body);

  switch (interaction.type) {
    case 1: // PING
      return new Response(JSON.stringify({ type: 1 }), { // PONG
        headers: { "Content-Type": "application/json" },
      });
    case 2: // APPLICATION_COMMAND
      {
        const commandName = interaction.data.name;
        const userId = interaction.member.user.id;
        const options = interaction.data.options;

        if (commandName === "ping") {
          return new Response(
            JSON.stringify({ type: 4, data: { content: "Pong!" } }),
            { headers: { "Content-Type": "application/json" } }
          );
        } else if (commandName === "Quote Message" && interaction.data.type === 3) {
            const targetMessageId = interaction.data.target_id;
            const messageData = interaction.data.resolved.messages[targetMessageId];
            const author = messageData.author;
            const displayName = author.global_name || author.username;
            const msgTimestamp = new Date(messageData.timestamp);
            const year = msgTimestamp.getFullYear();
            const embed = {
                color: 0x7289DA, description: messageData.content || "*No text content.*",
                author: { name: `${displayName}`, icon_url: author.avatar ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(author.discriminator) % 5}.png` },
                footer: { text: `- ${displayName}, ${year}` }, timestamp: messageData.timestamp,
            };
            if (messageData.attachments?.[0]?.content_type?.startsWith("image/")) {
                (embed as any).image = { url: messageData.attachments[0].url };
            }
            const initialCounts = { up: 0, down: 0, fire: 0, skull: 0 };
            return new Response(JSON.stringify({ type: 4, data: { embeds: [embed], components: getQuoteComponents(initialCounts) }}), { headers: { "Content-Type": "application/json" } });
        } else if (commandName === "tetris") {
            const allowOthers = options?.find((opt:any) => opt.name === "allow_others_to_control")?.value || false;
            const initialGameStateObj = initialTetrisState(userId, allowOthers);
            const gameStateJson = JSON.stringify(initialGameStateObj);
            return new Response(JSON.stringify({ type: 4, data: {
                content: renderTetrisBoard(initialGameStateObj),
                components: getTetrisComponents(initialGameStateObj.gameOver),
                embeds: [{ footer: { text: `TETRIS_STATE:${gameStateJson}` } }] // Store state
            }}), { headers: { "Content-Type": "application/json" } });
        } else if (commandName === "horrormaze") {
            const allowOthers = options?.find((opt:any) => opt.name === "allow_others_to_control")?.value || false;
            const initialGameState = initialMazeState(userId, allowOthers);
            const gameStateJson = JSON.stringify(initialGameState);
            const view = renderMazeView(initialGameState);
            const stats = getMazeStatsDisplay(initialGameState);
            return new Response(JSON.stringify({ type: 4, data: {
                content: view + "\n" + stats,
                components: getMazeComponents(initialGameState.gameOver, initialGameState.win, initialGameState.heldKeys),
                embeds: [{ footer: { text: `MAZE_STATE:${gameStateJson}` } }]
            }}), { headers: { "Content-Type": "application/json" } });
        } else {
          return new Response(JSON.stringify({ type: 4, data: { content: "Unknown command." } }), { headers: { "Content-Type": "application/json" } });
        }
      }
    case 3: // MESSAGE_COMPONENT
      {
        const customId = interaction.data.custom_id;
        const actingUserId = interaction.member.user.id;

        if (customId.startsWith("quote_")) {
            const action = customId.split("_")[1];
            let counts = { up: 0, down: 0, fire: 0, skull: 0 };
            interaction.message.components[0].components.forEach((button: any) => {
                const count = parseInt(button.label.split(" ").pop()) || 0;
                if (button.custom_id === "quote_up") counts.up = count;
                else if (button.custom_id === "quote_down") counts.down = count;
                else if (button.custom_id === "quote_fire") counts.fire = count;
                else if (button.custom_id === "quote_skull") counts.skull = count;
            });
            if (action === "up") counts.up++; else if (action === "down") counts.down++;
            else if (action === "fire") counts.fire++; else if (action === "skull") counts.skull++;
            return new Response(JSON.stringify({ type: 7, data: { embeds: interaction.message.embeds, components: getQuoteComponents(counts) }}), { headers: { "Content-Type": "application/json" } });
        } else if (customId.startsWith("tetris_")) {
            const oldEmbedFooter = interaction.message.embeds?.[0]?.footer?.text;
            if (!oldEmbedFooter || !oldEmbedFooter.startsWith("TETRIS_STATE:")) return new Response(JSON.stringify({ type: 4, data: { content: "Error: Missing Tetris game state.", flags: 64 } }), { headers: { "Content-Type": "application/json" } });
            const gameStateJson = oldEmbedFooter.substring("TETRIS_STATE:".length);
            let gameState: TetrisGameState;
            try { gameState = JSON.parse(gameStateJson); }
            catch (e) { return new Response(JSON.stringify({ type: 4, data: { content: "Error: Corrupted Tetris game state.", flags: 64 } }), { headers: { "Content-Type": "application/json" } }); }

            if (actingUserId !== gameState.ownerId && !gameState.allowOthers) return new Response(JSON.stringify({ type: 4, data: { content: "Not your Tetris game!", flags: 64 } }), { headers: { "Content-Type": "application/json" } });
            if (gameState.gameOver) return new Response(JSON.stringify({ type: 7, data: { content: renderTetrisBoard(gameState), components: [], embeds: interaction.message.embeds } }), { headers: { "Content-Type": "application/json" } });
            
            const action = customId.substring("tetris_".length);
            const updatedGameState = handleTetrisAction(gameState, action);
            const updatedGameStateJson = JSON.stringify(updatedGameState);
            return new Response(JSON.stringify({ type: 7, data: {
                content: renderTetrisBoard(updatedGameState),
                components: getTetrisComponents(updatedGameState.gameOver),
                embeds: [{ footer: { text: `TETRIS_STATE:${updatedGameStateJson}` } }]
            }}), { headers: { "Content-Type": "application/json" } });
        } else if (customId.startsWith("maze_")) {
            const oldEmbedFooter = interaction.message.embeds?.[0]?.footer?.text;
            if (!oldEmbedFooter || !oldEmbedFooter.startsWith("MAZE_STATE:")) return new Response(JSON.stringify({ type: 4, data: { content: "Error: Missing Maze game state.", flags: 64 } }), { headers: { "Content-Type": "application/json" } });
            const gameStateJson = oldEmbedFooter.substring("MAZE_STATE:".length);
            let gameState: MazeGameState;
            try { gameState = JSON.parse(gameStateJson); }
            catch (e) { return new Response(JSON.stringify({ type: 4, data: { content: "Error: Corrupted Maze game state.", flags: 64 } }), { headers: { "Content-Type": "application/json" } }); }

            if (actingUserId !== gameState.ownerId && !gameState.allowOthers) return new Response(JSON.stringify({ type: 4, data: { content: "Not your Maze game!", flags: 64 } }), { headers: { "Content-Type": "application/json" } });
            
            const action = customId.substring("maze_".length);
            if (action === "restart") gameState = initialMazeState(gameState.ownerId, gameState.allowOthers);
            else if (action.endsWith("_toggle")) {
                const key = action.split("_")[0] as keyof MazeGameState['heldKeys'];
                if (gameState.heldKeys.hasOwnProperty(key)) (gameState.heldKeys[key] as boolean) = !(gameState.heldKeys[key] as boolean);
            }
            if (!gameState.gameOver && !gameState.win) gameState = updateMazeGame(gameState);

            const newGameStateJson = JSON.stringify(gameState);
            const view = renderMazeView(gameState);
            const stats = getMazeStatsDisplay(gameState);
            return new Response(JSON.stringify({ type: 7, data: {
                content: view + "\n" + stats,
                components: getMazeComponents(gameState.gameOver, gameState.win, gameState.heldKeys),
                embeds: [{ footer: { text: `MAZE_STATE:${newGameStateJson}` } }]
            }}), { headers: { "Content-Type": "application/json" } });
        }
        return new Response("Bad Request: Unknown Component Interaction", { status: 400 });
      }
    default:
      return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
  }
});

console.log("Discord bot server running with Ping, Quote, Tetris, and Horror Maze...");
