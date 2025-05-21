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
  6: { shape: [[1, 0, 0], [1, 1, 1]], color: "🟫", name: "J" }, // J (brown for J)
  7: { shape: [[0, 0, 1], [1, 1, 1]], color: "🟧", name: "L" }  // L
};
const PIECE_TYPES = Object.keys(TETROMINOES).map(Number);

const EMOJI_MAP = {
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
  let shape = TETROMINOES[type].shape;
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
  const linesCleared = BOARD_HEIGHT - newBoard.length;
  while (newBoard.length < BOARD_HEIGHT) {
    newBoard.unshift(Array(BOARD_WIDTH).fill(EMPTY_CELL));
  }
  return { newBoard, linesCleared };
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
      const { newBoard, linesCleared } = clearLines(newState.board);
      newState.board = newBoard;
      newState = updateScoreAndLevel(newState, linesCleared);
      newState = spawnNewPiece(newState);
      break;
  }
  return newState;
}

function getTetrisComponents(gameStateJson: string, gameOver: boolean) {
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


Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  const body = await req.text(); // Read body once

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

        if (commandName === "ping") {
          return new Response(
            JSON.stringify({ type: 4, data: { content: "Pong!" } }),
            { headers: { "Content-Type": "application/json" } }
          );
        } else if (commandName === "Quote Message" && interaction.data.type === 3) { // Message Context Menu
            const targetMessageId = interaction.data.target_id;
            const messageData = interaction.data.resolved.messages[targetMessageId];
            
            const author = messageData.author;
            const displayName = author.global_name || author.username;
            const timestamp = new Date(messageData.timestamp);
            const year = timestamp.getFullYear();

            const embed = {
                color: 0x7289DA, // Discord blurple
                description: messageData.content || "*No text content in this message.*",
                author: {
                    name: `${displayName}`,
                    icon_url: author.avatar ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(author.discriminator) % 5}.png`
                },
                footer: {
                    text: `- ${displayName}, ${year}`
                },
                timestamp: messageData.timestamp,
            };
            if (messageData.attachments && messageData.attachments.length > 0) {
                const firstAttachment = messageData.attachments[0];
                if (firstAttachment.content_type && firstAttachment.content_type.startsWith("image/")) {
                    embed.image = { url: firstAttachment.url };
                }
            }

            const initialCounts = { up: 0, down: 0, fire: 0, skull: 0 };
            return new Response(JSON.stringify({
                type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                data: {
                    embeds: [embed],
                    components: getQuoteComponents(initialCounts)
                }
            }), { headers: { "Content-Type": "application/json" } });

        } else if (commandName === "tetris") {
            const allowOthers = interaction.data.options?.find(opt => opt.name === "allow_others_to_control")?.value || false;
            const initialGameStateObj = initialTetrisState(userId, allowOthers);
            const gameStateJson = JSON.stringify(initialGameStateObj);

            return new Response(JSON.stringify({
                type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                data: {
                    content: renderTetrisBoard(initialGameStateObj),
                    components: getTetrisComponents(gameStateJson, initialGameStateObj.gameOver),
                    embeds: [{ // Store game state in a non-prominent embed part
                        footer: { text: `डू नॉट टच: ${gameStateJson}` } // Use a "hidden" marker
                    }]
                }
            }), { headers: { "Content-Type": "application/json" } });
        } else {
          return new Response(
            JSON.stringify({ type: 4, data: { content: "Unknown command." } }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
      }
    case 3: // MESSAGE_COMPONENT
      {
        const customId = interaction.data.custom_id;
        const actingUserId = interaction.member.user.id;

        if (customId.startsWith("quote_")) {
            const action = customId.split("_")[1];
            const currentComponents = interaction.message.components;
            let counts = { up: 0, down: 0, fire: 0, skull: 0 };

            // Extract current counts from button labels
            currentComponents[0].components.forEach(button => {
                const labelParts = button.label.split(" ");
                const count = parseInt(labelParts[labelParts.length -1]) || 0;
                if (button.custom_id === "quote_up") counts.up = count;
                else if (button.custom_id === "quote_down") counts.down = count;
                else if (button.custom_id === "quote_fire") counts.fire = count;
                else if (button.custom_id === "quote_skull") counts.skull = count;
            });
            
            if (action === "up") counts.up++;
            else if (action === "down") counts.down++;
            else if (action === "fire") counts.fire++;
            else if (action === "skull") counts.skull++;

            return new Response(JSON.stringify({
                type: 7, // UPDATE_MESSAGE
                data: {
                    embeds: interaction.message.embeds, // Keep original embed
                    components: getQuoteComponents(counts)
                }
            }), { headers: { "Content-Type": "application/json" } });

        } else if (customId.startsWith("tetris_")) {
            const action = customId.substring("tetris_".length);
            
            // Extract game state from embed footer
            const oldEmbedFooter = interaction.message.embeds?.[0]?.footer?.text;
            if (!oldEmbedFooter || !oldEmbedFooter.startsWith("डू नॉट टच: ")) {
                 return new Response(JSON.stringify({ type: 4, data: { content: "Error: Could not retrieve game state.", flags: 64 } }), { headers: { "Content-Type": "application/json" } });
            }
            const gameStateJson = oldEmbedFooter.substring("डू नॉट टच: ".length);
            let gameState: TetrisGameState;
            try {
                gameState = JSON.parse(gameStateJson);
            } catch (e) {
                console.error("Error parsing game state:", e);
                return new Response(JSON.stringify({ type: 4, data: { content: "Error: Corrupted game state.", flags: 64 } }), { headers: { "Content-Type": "application/json" } });
            }

            if (actingUserId !== gameState.ownerId && !gameState.allowOthers) {
                return new Response(JSON.stringify({
                    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                    data: { content: "You are not allowed to control this Tetris game.", flags: 64 /* EPHEMERAL */ }
                }), { headers: { "Content-Type": "application/json" } });
            }
            
            if (gameState.gameOver) {
                 return new Response(JSON.stringify({ type: 7, data: { content: renderTetrisBoard(gameState), components: [], embeds: interaction.message.embeds } }), { headers: { "Content-Type": "application/json" } });
            }

            const updatedGameState = handleTetrisAction(gameState, action);
            const updatedGameStateJson = JSON.stringify(updatedGameState);

            return new Response(JSON.stringify({
                type: 7, // UPDATE_MESSAGE
                data: {
                    content: renderTetrisBoard(updatedGameState),
                    components: getTetrisComponents(updatedGameStateJson, updatedGameState.gameOver),
                    embeds: [{ footer: { text: `डू नॉट टच: ${updatedGameStateJson}` } }]
                }
            }), { headers: { "Content-Type": "application/json" } });
        }
        return new Response("Bad Request: Unknown Component Interaction", { status: 400 });
      }
    default:
      return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
  }
});

console.log("Discord bot server running...");
