// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";

// --- Utilities ---
function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

// --- Game Constants ---
const MAZE_LAYOUT: string[] = [
    "############",
    "#P.#.......#", // Player start
    "#.#.####.#.#",
    "#.#....#.#.#",
    "#.####.#.#R#", // Red Cuboid start
    "#......#...#",
    "############",
];
const MAP_WIDTH = MAZE_LAYOUT[0].length;
const MAP_HEIGHT = MAZE_LAYOUT.length;
const TILE_SIZE = 1.0; // For logical coordinates


const VIEW_WIDTH_CHARS = 21; // Number of rays/columns for rendering (odd number for center view)
const VIEW_HEIGHT_CHARS = 7; // Number of text rows for rendering (may change with new renderer)

const FOV = Math.PI / 3; // 60 degrees field of view (may change/be removed)
const OLD_PLAYER_ROTATION_SPEED = Math.PI / 16; // Radians per turn action
const OLD_PLAYER_MOVE_SPEED = 0.3; // Tiles per move action
const ENEMY_MOVE_SPEED = 0.15; // Old constant
const MAX_RAY_DEPTH = 20.0; // For old rendering

// New Game Specific Constants
const PLAYER_ROTATION_SPEED = Math.PI / 2; // 90 degrees: 0 right, PI/2 down, PI left, 3PI/2 up
const PLAYER_MOVE_SPEED = 1.0; // Move one tile at a time
const BLUE_CUBOID_CHANCE = 0.1; // 10% chance per player move/turn action
const BLUE_CUBOID_REACTION_TURNS = 3; // Player has 3 turns (actions) to react
const BLUE_CUBOID_WARNING_EMOJIS_LIST: string[] = ["🍕", "🌟", "🎉", "🔔", "💡", "🤔", "👻"];


// Old constants to be removed or re-evaluated for the new game:
// const PLAYER_MAX_HEALTH = 5;
// const ENEMY_MAX_HEALTH = 3;
// const SHOOT_DAMAGE = 1;
// const SHOOT_RANGE = 8.0;

// Emojis
const EMOJI_WALL = "🟫"; // Brown Square (Wall)
const EMOJI_FLOOR = "⬜"; // White Square (Floor) - Changed from Green
const EMOJI_CEILING = "🟦"; // Blue Square (Ceiling)
// const EMOJI_ENEMY_ALIVE = "😈"; // Replaced by Red Cuboid
// const EMOJI_ENEMY_DEAD = "💀"; // No concept of dead cuboid, it's just inactive or game over
const EMOJI_PLAYER = "😀"; // Player icon
const EMOJI_RED_CUBOID = "🟥"; // Red Cuboid icon
const EMOJI_EMPTY = "▪️"; // Fallback for empty space if needed
// const EMOJI_BULLET_TRACE = "💥"; // Shooting removed

// --- Game State Interfaces ---
interface PlayerState {
    x: number;
    y: number;
    angle: number; // radians (0: right, PI/2: down, PI: left, 3PI/2: up)
}

interface RedCuboidState {
    x: number;
    y: number;
    isActive: boolean;
}

interface BlueCuboidState {
    warningActive: boolean;
    warningEmoji: string;
    turnsLeft: number;
}

interface GameState {
    player: PlayerState;
    redCuboid: RedCuboidState;
    blueCuboid: BlueCuboidState;
    // map: string[]; // MAZE_LAYOUT is globally available, not storing per state to save space in custom_id
    message: string;
    gameOver: boolean;
    lastInteractionTime: number;
}

// --- Game State Serialization/Deserialization for custom_id ---
// Format: p.x|p.y|p.a|rc.x|rc.y|rc.active|bc.warn|bc.emoji|bc.turns|gameOver|lastTime
// Emoji is URI encoded.
function serializeGameState(state: GameState): string {
    const parts: string[] = [];
    parts.push(state.player.x.toFixed(1)); // x,y are tile centers, .1 precision is enough
    parts.push(state.player.y.toFixed(1));
    parts.push(state.player.angle.toFixed(3)); // Angle needs more precision

    parts.push(state.redCuboid.x.toFixed(1));
    parts.push(state.redCuboid.y.toFixed(1));
    parts.push(state.redCuboid.isActive ? "1" : "0");

    parts.push(state.blueCuboid.warningActive ? "1" : "0");
    parts.push(encodeURIComponent(state.blueCuboid.warningEmoji)); // Encode emoji for safe split
    parts.push(state.blueCuboid.turnsLeft.toString());

    parts.push(state.gameOver ? "1" : "0");
    parts.push(state.lastInteractionTime.toString());

    return parts.join("|");
}

function deserializeGameState(str: string): GameState | null {
    try {
        const parts = str.split("|");
        let currentIdx = 0;

        const player: PlayerState = {
            x: parseFloat(parts[currentIdx++]),
            y: parseFloat(parts[currentIdx++]),
            angle: parseFloat(parts[currentIdx++]),
        };

        const redCuboid: RedCuboidState = {
            x: parseFloat(parts[currentIdx++]),
            y: parseFloat(parts[currentIdx++]),
            isActive: parts[currentIdx++] === "1",
        };

        const blueCuboid: BlueCuboidState = {
            warningActive: parts[currentIdx++] === "1",
            warningEmoji: decodeURIComponent(parts[currentIdx++]), // Decode emoji
            turnsLeft: parseInt(parts[currentIdx++]),
        };

        const gameOver = parts[currentIdx++] === "1";
        const lastInteractionTime = parseInt(parts[currentIdx++]);

        // Construct the full state object
        const state: GameState = {
            player,
            redCuboid,
            blueCuboid,
            // map: MAZE_LAYOUT, // MAZE_LAYOUT is global, not part of serialized string
            message: "", // Will be populated by game logic or render function
            gameOver,
            lastInteractionTime,
        };

        // Basic validation to catch common errors from parsing
        if (Number.isNaN(player.x) || Number.isNaN(player.y) || Number.isNaN(player.angle) ||
            Number.isNaN(redCuboid.x) || Number.isNaN(redCuboid.y) ||
            Number.isNaN(blueCuboid.turnsLeft)) {
            console.error("Deserialization resulted in NaN values:", str, state);
            return null; // Indicate error
        }
        return state;
    } catch (e) {
        console.error("Failed to deserialize game state:", str, e);
        return null;
    }
}


// --- Map Helper ---
// Takes floating point coordinates and the map, returns the character of the tile at those coordinates.
// Handles out-of-bounds by returning '#'.
function getMapTile(x: number, y: number, map: string[]): string {
    const mapX = Math.floor(x / TILE_SIZE);
    const mapY = Math.floor(y / TILE_SIZE);
    if (mapX < 0 || mapX >= MAP_WIDTH || mapY < 0 || mapY >= MAP_HEIGHT) {
        return "#"; // Treat out-of-bounds as wall
    }
    return map[mapY][mapX];
}

// Takes floating point coordinates and the map, returns true if the tile is a wall ('#'), false otherwise.
// Uses getMapTile.
function isWall(x: number, y: number, map: string[]): boolean {
    return getMapTile(x, y, map) === "#";
}

// Helper function to find the initial x,y coordinates (center of the tile) of a character.
function findCharInitialPosition(char: string, map: string[]): { x: number; y: number } | null {
    for (let y_idx = 0; y_idx < map.length; y_idx++) { // Renamed y to y_idx
        const row = map[y_idx];
        const x_idx = row.indexOf(char); // Renamed x to x_idx
        if (x_idx !== -1) {
            // Return center of the tile
            return { x: x_idx * TILE_SIZE + TILE_SIZE / 2, y: y_idx * TILE_SIZE + TILE_SIZE / 2 };
        }
    }
    return null;
}


// --- Initial Game Setup ---
function getInitialGameState(): GameState {
    const playerInitialPos = findCharInitialPosition('P', MAZE_LAYOUT);
    if (!playerInitialPos) throw new Error("Player start 'P' not found in MAZE_LAYOUT");

    const redCuboidInitialPos = findCharInitialPosition('R', MAZE_LAYOUT);
    if (!redCuboidInitialPos) throw new Error("Red Cuboid start 'R' not found in MAZE_LAYOUT");

    return {
        player: {
            x: playerInitialPos.x,
            y: playerInitialPos.y,
            angle: Math.PI / 2, // Start facing Down (0 right, PI/2 down, PI left, 3PI/2 up)
        },
        redCuboid: {
            x: redCuboidInitialPos.x,
            y: redCuboidInitialPos.y,
            isActive: true,
        },
        blueCuboid: {
            warningActive: false,
            warningEmoji: "",
            turnsLeft: 0,
        },
        // map: MAZE_LAYOUT, // Not storing in state string, MAZE_LAYOUT is global
        message: "Welcome to the Maze! ⬅️⬆️➡️ to move. REACT if 🔔 appears!",
        gameOver: false,
        lastInteractionTime: Date.now(),
    };
}

// --- Game Logic Update ---
function updateGameState(currentState: GameState, action: string): GameState {
    let newState = JSON.parse(JSON.stringify(currentState)) as GameState; // Deep copy
    newState.message = ""; // Clear previous message
    newState.lastInteractionTime = Date.now();

    if (newState.gameOver) {
        // Keep current message if already game over, but update timestamp.
        return newState;
    }

    // Player Actions: "turn_left", "turn_right", "move_forward"
    // Blue Cuboid Action: "react_blue_cuboid"
    const playerMovementActions = ["turn_left", "turn_right", "move_forward"];

    if (playerMovementActions.includes(action)) {
        switch (action) {
            case "turn_left":
                newState.player.angle -= PLAYER_ROTATION_SPEED;
                newState.message = "Turned left.";
                break;
            case "turn_right":
                newState.player.angle += PLAYER_ROTATION_SPEED;
                newState.message = "Turned right.";
                break;
            case "move_forward":
                let nextX = newState.player.x;
                let nextY = newState.player.y;

                // Normalize angle to handle floating point inaccuracies for direct comparisons
                const normalizedAngle = (newState.player.angle % (2 * Math.PI) + (2 * Math.PI)) % (2 * Math.PI);

                if (Math.abs(normalizedAngle - 0) < 0.01) { // Facing Right (0 rad)
                    nextX += PLAYER_MOVE_SPEED * TILE_SIZE;
                } else if (Math.abs(normalizedAngle - Math.PI / 2) < 0.01) { // Facing Down (PI/2 rad)
                    nextY += PLAYER_MOVE_SPEED * TILE_SIZE;
                } else if (Math.abs(normalizedAngle - Math.PI) < 0.01) { // Facing Left (PI rad)
                    nextX -= PLAYER_MOVE_SPEED * TILE_SIZE;
                } else if (Math.abs(normalizedAngle - (3 * Math.PI / 2)) < 0.01) { // Facing Up (3PI/2 rad)
                    nextY -= PLAYER_MOVE_SPEED * TILE_SIZE;
                } else {
                    // Fallback for slight angle deviations - should ideally not be needed with discrete turns
                    // Or, if angles can be slightly off, use Math.cos and Math.sin and round to nearest tile center
                    console.warn("Player angle not aligned for discrete movement:", normalizedAngle);
                    nextX += Math.cos(newState.player.angle) * PLAYER_MOVE_SPEED * TILE_SIZE;
                    nextY += Math.sin(newState.player.angle) * PLAYER_MOVE_SPEED * TILE_SIZE;
                    // Snap to grid center after move
                    nextX = Math.floor(nextX / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
                    nextY = Math.floor(nextY / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
                }

                if (!isWall(nextX, nextY, MAZE_LAYOUT)) {
                    newState.player.x = nextX;
                    newState.player.y = nextY;
                    newState.message = "Moved forward.";
                } else {
                    newState.message = "Bonk! Hit a wall.";
                }
                break;
        }
        newState.player.angle = (newState.player.angle + 2 * Math.PI) % (2 * Math.PI); // Normalize angle

        // Blue Cuboid Activation & Countdown (only after player movement/turn actions)
        if (newState.blueCuboid.warningActive) {
            newState.blueCuboid.turnsLeft--;
            if (newState.blueCuboid.turnsLeft <= 0) {
                newState.gameOver = true;
                newState.message = `Too slow! The Blue Cuboid ${newState.blueCuboid.warningEmoji} got you! Game Over.`;
                return newState; // Game over, no further processing for Red Cuboid or catch
            } else {
                 // Append to existing message if any, or set new
                 newState.message = (newState.message ? newState.message + " " : "") +
                                  `Blue Cuboid ${newState.blueCuboid.warningEmoji} countdown: ${newState.blueCuboid.turnsLeft}.`;
            }
        } else { // Warning not active, try to activate
            if (Math.random() < BLUE_CUBOID_CHANCE) {
                newState.blueCuboid.warningActive = true;
                const randomEmojiIdx = Math.floor(Math.random() * BLUE_CUBOID_WARNING_EMOJIS_LIST.length);
                newState.blueCuboid.warningEmoji = BLUE_CUBOID_WARNING_EMOJIS_LIST[randomEmojiIdx];
                newState.blueCuboid.turnsLeft = BLUE_CUBOID_REACTION_TURNS;
                newState.message = (newState.message ? newState.message + " " : "") +
                                   `Warning! A strange presence (${newState.blueCuboid.warningEmoji}) appears! You have ${newState.blueCuboid.turnsLeft} turns to REACT.`;
            }
        }
    } else if (action === "react_blue_cuboid") {
        if (newState.blueCuboid.warningActive) {
            newState.blueCuboid.warningActive = false;
            newState.blueCuboid.turnsLeft = 0;
            const reactedEmoji = newState.blueCuboid.warningEmoji; // Save for message
            newState.blueCuboid.warningEmoji = '';
            newState.message = `You reacted to the ${reactedEmoji} presence in time!`;
        } else {
            newState.message = "You reacted, but nothing seems to be there.";
        }
        // Note: Reacting does not trigger Red Cuboid movement or Blue Cuboid activation/countdown.
        // It's a free action in that sense for this turn.
    }

    // Red Cuboid AI (moves after player action and Blue Cuboid logic, if game not over)
    if (!newState.gameOver && newState.redCuboid.isActive) {
        const playerPos = newState.player;
        const cuboidPos = newState.redCuboid;

        const dx = playerPos.x - cuboidPos.x;
        const dy = playerPos.y - cuboidPos.y;

        let movedThisTurn = false;

        // Determine preferred axis of movement (the one with greater distance)
        if (Math.abs(dx) > Math.abs(dy)) { // Try X first
            const nextCuboidX = cuboidPos.x + Math.sign(dx) * TILE_SIZE;
            if (!isWall(nextCuboidX, cuboidPos.y, MAZE_LAYOUT)) {
                newState.redCuboid.x = nextCuboidX;
                movedThisTurn = true;
            }
        }

        if (!movedThisTurn && Math.abs(dy) > 0) { // Then try Y (if X was blocked or Y is preferred/equal)
            const nextCuboidY = cuboidPos.y + Math.sign(dy) * TILE_SIZE;
            if (!isWall(cuboidPos.x, nextCuboidY, MAZE_LAYOUT)) {
                newState.redCuboid.y = nextCuboidY;
                movedThisTurn = true;
            }
        }

        // If preferred axis was blocked and the other axis still has distance, try it
        if (!movedThisTurn && Math.abs(dx) > 0 && Math.abs(dx) <= Math.abs(dy)) { // Try X if Y was preferred but blocked
             const nextCuboidX = cuboidPos.x + Math.sign(dx) * TILE_SIZE;
            if (!isWall(nextCuboidX, cuboidPos.y, MAZE_LAYOUT)) {
                newState.redCuboid.x = nextCuboidX;
                // movedThisTurn = true; // Not strictly needed to set here as it's the last attempt
            }
        }
    }

    // Catch Condition (Red Cuboid catches Player)
    // Check if player and red cuboid are in the same tile.
    // Compare tile coordinates by flooring their center coordinates.
    if (!newState.gameOver && newState.redCuboid.isActive &&
        Math.floor(newState.player.x / TILE_SIZE) === Math.floor(newState.redCuboid.x / TILE_SIZE) &&
        Math.floor(newState.player.y / TILE_SIZE) === Math.floor(newState.redCuboid.y / TILE_SIZE)) {
        newState.gameOver = true;
        newState.message = "Caught by the Red Cuboid! Game Over.";
    }

    // Win Condition: Player reaches the Red Cuboid's original starting tile *after* 'R' has moved from it.
    const redCuboidInitialPos = findCharInitialPosition('R', MAZE_LAYOUT); // Should always be found
    if (!newState.gameOver && redCuboidInitialPos &&
        Math.floor(newState.player.x / TILE_SIZE) === Math.floor(redCuboidInitialPos.x / TILE_SIZE) &&
        Math.floor(newState.player.y / TILE_SIZE) === Math.floor(redCuboidInitialPos.y / TILE_SIZE) &&
        (Math.floor(newState.redCuboid.x / TILE_SIZE) !== Math.floor(redCuboidInitialPos.x / TILE_SIZE) || // R has moved X
         Math.floor(newState.redCuboid.y / TILE_SIZE) !== Math.floor(redCuboidInitialPos.y / TILE_SIZE))    // R has moved Y
    ) {
        newState.gameOver = true;
        newState.message = "You reached the Red Cuboid's starting point after it moved! YOU WIN!";
    }

    return newState;
}

// --- Game Rendering ---
function renderGameView(state: GameState): string {
    if (state.gameOver) {
        return `\`\`\`\n${state.message}\n\`\`\``;
    }

    const screenBuffer: string[][] = Array(VIEW_HEIGHT_CHARS)
        .fill(null).map(() => Array(VIEW_WIDTH_CHARS).fill(EMOJI_EMPTY));

    const wallDistances: number[] = Array(VIEW_WIDTH_CHARS).fill(Infinity);

    // Raycasting for walls
    for (let col = 0; col < VIEW_WIDTH_CHARS; col++) {
        const rayAngle = state.player.angle - FOV / 2 + (col / VIEW_WIDTH_CHARS) * FOV;
        let distToWall = 0;
        let hitWall = false;
        
        const eyeX = Math.cos(rayAngle); // Unit vector for ray in X direction
        const eyeY = Math.sin(rayAngle); // Unit vector for ray in Y direction

        while (!hitWall && distToWall < MAX_RAY_DEPTH) {
            distToWall += 0.1; // Increment ray
            const testX = state.player.x + eyeX * distToWall;
            const testY = state.player.y + eyeY * distToWall;

            if (isWall(testX, testY, MAZE_LAYOUT)) {
                hitWall = true;
                // Fish-eye correction: distToWall * cos(angle difference between ray and player view)
                const correctedDist = distToWall * Math.cos(rayAngle - state.player.angle);
                wallDistances[col] = correctedDist;

                // Calculate wall slice height (prevent division by zero with +0.001)
                const lineHeight = Math.max(1, Math.floor(VIEW_HEIGHT_CHARS / (correctedDist + 0.001)));
                const drawStart = Math.max(0, Math.floor((VIEW_HEIGHT_CHARS - lineHeight) / 2));
                const drawEnd = Math.min(VIEW_HEIGHT_CHARS - 1, drawStart + lineHeight -1); // Ensure drawEnd is within bounds
                
                for (let row = 0; row < VIEW_HEIGHT_CHARS; row++) {
                    if (row < drawStart) {
                        screenBuffer[row][col] = EMOJI_CEILING;
                    } else if (row >= drawStart && row <= drawEnd) {
                        screenBuffer[row][col] = EMOJI_WALL;
                    } else {
                        screenBuffer[row][col] = EMOJI_FLOOR;
                    }
                }
            }
        }
         if (!hitWall) { // No wall hit within MAX_RAY_DEPTH, draw ceiling/floor
            for (let row = 0; row < VIEW_HEIGHT_CHARS; row++) {
                if (row < VIEW_HEIGHT_CHARS / 2) {
                    screenBuffer[row][col] = EMOJI_CEILING;
                } else {
                    screenBuffer[row][col] = EMOJI_FLOOR;
                }
            }
        }
    }
    
    // Sprite (Red Cuboid) Rendering
    if (state.redCuboid.isActive) {
        const rcX = state.redCuboid.x;
        const rcY = state.redCuboid.y;
        const playerX = state.player.x;
        const playerY = state.player.y;
        const playerA = state.player.angle;

        // Transform cuboid position to player's relative coordinate system
        const dx = rcX - playerX;
        const dy = rcY - playerY;
        const relativeX = dx * Math.cos(-playerA) - dy * Math.sin(-playerA);
        const relativeY = dx * Math.sin(-playerA) + dy * Math.cos(-playerA); // This is the depth

        const enemyDist = Math.sqrt(dx*dx + dy*dy);

        if (relativeY > 0.5 && enemyDist < MAX_RAY_DEPTH) { // Cuboid is in front of player and within view depth
            // Calculate angle of the cuboid relative to player's facing direction
            // atan2(relativeX, relativeY) gives angle from player's forward vector (positive Y in relative coords)
            const enemyAngleRelativeToPlayer = Math.atan2(relativeX, relativeY);

            // Check if the cuboid is within FOV
            if (Math.abs(enemyAngleRelativeToPlayer) < FOV / 1.8) { // Slightly narrower FOV for sprite to feel more centered
                // Project cuboid onto the screen
                // (FOV / 2) is the angle from center to edge of screen.
                // enemyAngleRelativeToPlayer / (FOV / 2) gives a ratio from -1 to 1.
                // Multiply by (VIEW_WIDTH_CHARS / 2) to get screen column offset.
                const enemyScreenX = Math.floor(VIEW_WIDTH_CHARS / 2 + (enemyAngleRelativeToPlayer / (FOV / 2)) * (VIEW_WIDTH_CHARS / 2));
                
                if (enemyScreenX >= 0 && enemyScreenX < VIEW_WIDTH_CHARS && enemyDist < wallDistances[enemyScreenX]) {
                    // Cuboid is visible on this column and in front of the wall
                    const enemySize = Math.max(1, Math.floor(VIEW_HEIGHT_CHARS / (enemyDist * Math.cos(enemyAngleRelativeToPlayer) + 0.001))); // Correct for perspective
                    const drawStartY = Math.max(0, Math.floor((VIEW_HEIGHT_CHARS - enemySize) / 2));
                    const drawEndY = Math.min(VIEW_HEIGHT_CHARS - 1, drawStartY + enemySize - 1);

                    for (let y = drawStartY; y <= drawEndY; y++) {
                        screenBuffer[y][enemyScreenX] = EMOJI_RED_CUBOID;
                    }
                    // Optional: make cuboid wider (e.g. 2-3 columns)
                    // For a simple centered line, this is fine.
                    // if (enemyScreenX > 0) screenBuffer[y][enemyScreenX-1] = EMOJI_RED_CUBOID;
                    // if (enemyScreenX < VIEW_WIDTH_CHARS-1) screenBuffer[y][enemyScreenX+1] = EMOJI_RED_CUBOID;
                }
            }
        }
    }

    // Assemble screenBuffer into string
    let viewString = screenBuffer.map(row => row.join("")).join("\n");
    
    let statusLines = state.message; // Main game message first
    if (state.blueCuboid.warningActive) {
        // Append Blue Cuboid warning as a new line for clarity
        statusLines += `\nALERT! ${state.blueCuboid.warningEmoji} is active! Turns left: ${state.blueCuboid.turnsLeft}. Use REACT button!`;
    }

    return `\`\`\`\n${viewString}\n\`\`\`\n${statusLines}`;
}

// --- Discord Interaction Handler ---
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

    try { // Wrap main logic in try-catch for robustness
        switch (interaction.type) {
            case 1: // PING
                return new Response(JSON.stringify({ type: 1 }), {
                    headers: { "Content-Type": "application/json" },
                });
            case 2: // APPLICATION_COMMAND
                {
                    const commandName = interaction.data.name;
                    if (commandName === "ping") {
                        return new Response(
                            JSON.stringify({ type: 4, data: { content: "Pong!" } }),
                            { headers: { "Content-Type": "application/json" } }
                        );
                    // Changed command name to "maze"
                    } else if (commandName === "maze" || commandName === "doom") { // Keep "doom" for now for easy testing
                        const initialGameState = getInitialGameState();
                        const gameStateString = serializeGameState(initialGameState);
                        const gameView = renderGameView(initialGameState);

                        return new Response(
                            JSON.stringify({
                                type: 4,
                                data: {
                                    content: gameView,
                                    components: [ // Updated buttons for the new game
                                        {
                                            type: 1,
                                            components: [
                                                { type: 2, style: 2, label: "Turn Left ⬅️", custom_id: `maze_turn_left_${gameStateString}` },
                                                { type: 2, style: 2, label: "Forward ⬆️", custom_id: `maze_move_forward_${gameStateString}` },
                                                { type: 2, style: 2, label: "Turn Right ➡️", custom_id: `maze_turn_right_${gameStateString}` },
                                            ],
                                        },
                                        {
                                            type: 1,
                                            components: [ // REACT button on its own row
                                                 { type: 2, style: 1, label: "REACT 🔔", custom_id: `maze_react_blue_cuboid_${gameStateString}`},
                                            ]
                                        }
                                    ],
                                },
                            }),
                            { headers: { "Content-Type": "application/json" } }
                        );
                    } else {
                        return new Response(
                            JSON.stringify({ type: 4, data: { content: "Unknown command." } }),
                            { headers: { "Content-Type": "application/json" } }
                        );
                    }
                }
            case 3: // MESSAGE_COMPONENT (Button press)
                {
                    const customIdFull = interaction.data.custom_id;
                    const [prefix, action, ...gameStateParts] = customIdFull.split("_");
                    const gameStateString = gameStateParts.join("_");

                    // Updated prefix to "maze"
                    if (prefix !== "maze" || !action || !gameStateString) {
                         console.error("Invalid custom_id format (expected maze_...):", customIdFull);
                         // Return an ephemeral message for invalid format
                         return new Response(JSON.stringify({ type: 4, data: { content: "Error: Invalid button data. Please try starting a new game.", flags: 64 } }),
                                            { headers: { "Content-Type": "application/json" } });
                    }

                    const currentGameState = deserializeGameState(gameStateString);
                    if (!currentGameState) {
                        console.error("Failed to deserialize game state from custom_id:", gameStateString);
                         return new Response(JSON.stringify({ type: 4, data: { content: "Error: Corrupted game state. Please start a new game with /maze.", flags: 64 } }),
                                            { headers: { "Content-Type": "application/json" } });
                    }
                    
                    // Updated inactivity message and command
                    if (Date.now() - currentGameState.lastInteractionTime > 600000 && !currentGameState.gameOver) { // 10 min
                        return new Response(
                            JSON.stringify({
                                type: 7,
                                data: {
                                    content: "This game session has expired due to inactivity. Please start a new game with `/maze`.",
                                    components: []
                                }
                            }), { headers: { "Content-Type": "application/json" } }
                        );
                    }

                    const updatedGameState = updateGameState(currentGameState, action);
                    const newGameStateString = serializeGameState(updatedGameState);

                    // Check custom_id length (limit is 100). Prefix "maze_react_blue_cuboid_" is 25 chars.
                    if (newGameStateString.length + 25 > 100) {
                        console.warn("Serialized game state might be too long for custom_id:", newGameStateString.length, newGameStateString);
                        // Respond with an error if it's definitely too long
                        return new Response(JSON.stringify({ type: 4, data: { content: "Error: Game state data is too large. This is a bug. Please start a new game.", flags: 64 } }),
                                            { headers: { "Content-Type": "application/json" } });
                    }

                    const gameView = renderGameView(updatedGameState);
                    
                    return new Response(
                        JSON.stringify({
                            type: 7, // UPDATE_MESSAGE
                            data: {
                                content: gameView,
                                // Update buttons based on new game state and actions
                                components: updatedGameState.gameOver ? [] : [
                                    {
                                        type: 1, components: [
                                            { type: 2, style: 2, label: "Turn Left ⬅️", custom_id: `maze_turn_left_${newGameStateString}` },
                                            { type: 2, style: 2, label: "Forward ⬆️", custom_id: `maze_move_forward_${newGameStateString}` },
                                            { type: 2, style: 2, label: "Turn Right ➡️", custom_id: `maze_turn_right_${newGameStateString}` },
                                        ]
                                    },
                                     { // REACT button on its own row
                                        type: 1,
                                        components: [
                                            // Style of REACT button changes if warning is active (e.g., primary blue -> success green)
                                            // Label also includes the warning emoji if active
                                            {
                                                type: 2,
                                                style: updatedGameState.blueCuboid.warningActive ? 3 : 1, // Green if warning, Blue if not
                                                label: `REACT ${updatedGameState.blueCuboid.warningActive ? updatedGameState.blueCuboid.warningEmoji : "🔔"}`,
                                                custom_id: `maze_react_blue_cuboid_${newGameStateString}`
                                            },
                                        ]
                                    }
                                ],
                            },
                        }),
                        { headers: { "Content-Type": "application/json" } }
                    );
                }
            default:
                return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
        }
    } catch (e) {
        console.error("Error processing interaction:", e);
        // Generic error response for the interaction
        // Check if it's an ApplicationCommand or MessageComponent to determine if ephemeral is possible/appropriate
        let responseData = { content: "An unexpected error occurred. Please try again." };
        // if (interaction.type === 2 || interaction.type === 3) { // Add ephemeral if possible
        //    responseData.flags = 64; // EPHEMERAL
        // }
        // Discord might auto-respond if function crashes. If not, this is a fallback.
        // Best effort to send an ephemeral message for known interaction types that support it.
        if (interaction.type === 2 || interaction.type === 3) {
             return new Response(JSON.stringify({ type: 4, data: { content: "An error occurred processing your request.", flags: 64 } }), 
                                { status: 200, headers: { "Content-Type": "application/json" } }); // Must be 200 OK for Discord to show it
        }
        return new Response("Internal Server Error", { status: 500 });
    }
});
