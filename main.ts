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
const MAP_WIDTH = 16;
const MAP_HEIGHT = 10;
const TILE_SIZE = 1.0; // For logical coordinates

// P = Player Start, E = Enemy Start, # = Wall, . = Floor
const INITIAL_MAP_LAYOUT: string[] = [
    "################",
    "#P.............#",
    "#..##........E.#",
    "#...#..........#",
    "#...#....######",
    "#..............#",
    "#......E.......#",
    "#..............#",
    "#..............#",
    "################",
];

const VIEW_WIDTH_CHARS = 21; // Number of rays/columns for rendering (odd number for center view)
const VIEW_HEIGHT_CHARS = 7; // Number of text rows for rendering

const FOV = Math.PI / 3; // 60 degrees field of view
const PLAYER_ROTATION_SPEED = Math.PI / 16; // Radians per turn action
const PLAYER_MOVE_SPEED = 0.3; // Tiles per move action
const ENEMY_MOVE_SPEED = 0.15;
const MAX_RAY_DEPTH = 20.0;

const PLAYER_MAX_HEALTH = 5;
const ENEMY_MAX_HEALTH = 3;
const SHOOT_DAMAGE = 1;
const SHOOT_RANGE = 8.0; // Max distance for a shot to hit

// Emojis
const EMOJI_WALL = "🟫"; // Brown Square (Wall)
const EMOJI_FLOOR = "🟩"; // Green Square (Floor)
const EMOJI_CEILING = "🟦"; // Blue Square (Ceiling)
const EMOJI_ENEMY_ALIVE = "😈";
const EMOJI_ENEMY_DEAD = "💀";
const EMOJI_EMPTY = "▪️"; // Fallback for empty space if needed in renderer, or a very dark grey.
const EMOJI_BULLET_TRACE = "💥"; // For temporary shot feedback

// --- Game State Interfaces ---
interface Coords { x: number; y: number; }
interface EnemyState extends Coords {
    hp: number;
    angle: number; // For potential future use (e.g. facing direction)
    isActive: boolean;
}
interface GameState {
    px: number; // Player X
    py: number; // Player Y
    pa: number; // Player Angle (radians)
    php: number; // Player Health
    enemies: EnemyState[];
    message: string; // Short message to display (e.g., "Ouch!", "Enemy Hit!")
    gameOver: boolean;
    // Movement toggles
    isMovingForward: boolean;
    isTurningLeft: boolean;
    isTurningRight: boolean;
    lastInteractionTime: number;
}

// --- Game State Serialization/Deserialization for custom_id ---
// Format: px;py;pa;php;mf;tl;tr;[e1x;e1y;e1hp;e1active;...];gameOver;lastTime
// All numbers rounded to 2 decimal places for compactness where applicable
function serializeGameState(state: GameState): string {
    const parts: string[] = [];
    parts.push(state.px.toFixed(2));
    parts.push(state.py.toFixed(2));
    parts.push(state.pa.toFixed(3)); // Angle needs more precision
    parts.push(state.php.toString());
    parts.push(state.isMovingForward ? "1" : "0");
    parts.push(state.isTurningLeft ? "1" : "0");
    parts.push(state.isTurningRight ? "1" : "0");

    state.enemies.forEach(e => {
        parts.push(e.x.toFixed(2));
        parts.push(e.y.toFixed(2));
        parts.push(e.hp.toString());
        parts.push(e.isActive ? "1" : "0");
    });
    parts.push(state.gameOver ? "1" : "0");
    parts.push(state.lastInteractionTime.toString()); // For inactivity tracking

    return parts.join("|"); // Using pipe as less common in numbers
}

function deserializeGameState(str: string): GameState | null {
    try {
        const parts = str.split("|");
        let currentIdx = 0;
        const state: GameState = {
            px: parseFloat(parts[currentIdx++]),
            py: parseFloat(parts[currentIdx++]),
            pa: parseFloat(parts[currentIdx++]),
            php: parseInt(parts[currentIdx++]),
            isMovingForward: parts[currentIdx++] === "1",
            isTurningLeft: parts[currentIdx++] === "1",
            isTurningRight: parts[currentIdx++] === "1",
            enemies: [],
            message: "",
            gameOver: false,
            lastInteractionTime: 0,
        };

        // Assuming 2 enemies for fixed parsing, can be made dynamic
        for (let i = 0; i < 2; i++) { // Adjust if num enemies changes
            if (parts.length > currentIdx + 3) {
                state.enemies.push({
                    x: parseFloat(parts[currentIdx++]),
                    y: parseFloat(parts[currentIdx++]),
                    hp: parseInt(parts[currentIdx++]),
                    isActive: parts[currentIdx++] === "1",
                    angle: 0,
                });
            } else { // In case of malformed string for enemies part
                 state.enemies.push({ x: 0, y: 0, hp: 0, isActive: false, angle: 0 });
            }
        }
        state.gameOver = parts[currentIdx++] === "1";
        state.lastInteractionTime = parseInt(parts[currentIdx++]);

        if (Number.isNaN(state.px) || Number.isNaN(state.php) || state.enemies.some(e => Number.isNaN(e.x))) {
            console.error("Deserialization resulted in NaN values:", str);
            return null; // Invalid state
        }
        return state;
    } catch (e) {
        console.error("Failed to deserialize game state:", str, e);
        return null;
    }
}


// --- Map Helper ---
function getMapTile(x: number, y: number): string {
    const mapX = Math.floor(x / TILE_SIZE);
    const mapY = Math.floor(y / TILE_SIZE);
    if (mapX < 0 || mapX >= MAP_WIDTH || mapY < 0 || mapY >= MAP_HEIGHT) {
        return "#"; // Treat out-of-bounds as wall
    }
    return INITIAL_MAP_LAYOUT[mapY][mapX];
}

function isWall(x: number, y: number): boolean {
    return getMapTile(x,y) === "#";
}

// --- Initial Game Setup ---
function getInitialGameState(): GameState {
    const enemies: EnemyState[] = [];
    let playerPos = { x: 1.5, y: 1.5 }; // Default player start

    INITIAL_MAP_LAYOUT.forEach((row, y) => {
        row.split("").forEach((char, x) => {
            if (char === 'P') {
                playerPos = { x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 };
            } else if (char === 'E') {
                enemies.push({
                    x: x * TILE_SIZE + TILE_SIZE / 2,
                    y: y * TILE_SIZE + TILE_SIZE / 2,
                    hp: ENEMY_MAX_HEALTH,
                    angle: 0,
                    isActive: true,
                });
            }
        });
    });
     // Ensure we have a fixed number of enemies for consistent serialization
    while (enemies.length < 2) { // Assuming we want 2 enemies
        enemies.push({ x: -1, y: -1, hp: 0, angle: 0, isActive: false }); // Inactive, off-map
    }

    return {
        px: playerPos.x,
        py: playerPos.y,
        pa: Math.PI / 4, // Initial angle (45 degrees)
        php: PLAYER_MAX_HEALTH,
        enemies: enemies.slice(0, 2), // Ensure only 2 enemies
        message: "Game started! Use buttons to play.",
        gameOver: false,
        isMovingForward: false,
        isTurningLeft: false,
        isTurningRight: false,
        lastInteractionTime: Date.now(),
    };
}

// --- Game Logic Update ---
function updateGameState(currentState: GameState, action: string): GameState {
    let newState = JSON.parse(JSON.stringify(currentState)) as GameState; // Deep copy
    newState.message = ""; // Clear previous message

    const now = Date.now();
    if (now - newState.lastInteractionTime > 30000 && !newState.gameOver) { // 30s inactivity check, example
        // newState.message = "Game resumed after pause.";
        // Could add logic here if game should change after long pause, but simple resume is fine.
    }
    newState.lastInteractionTime = now;


    if (newState.gameOver) {
        newState.message = "Game Over! Start a new game with /doom.";
        return newState;
    }
    if (newState.php <= 0) {
        newState.gameOver = true;
        newState.message = "You died! Game Over.";
        return newState;
    }

    // Handle action toggles
    switch (action) {
        case "toggle_forward": newState.isMovingForward = !newState.isMovingForward; break;
        case "toggle_turn_left": newState.isTurningLeft = !newState.isTurningLeft; break;
        case "toggle_turn_right": newState.isTurningRight = !newState.isTurningRight; break;
    }
    
    // Apply continuous actions (turning)
    if (newState.isTurningLeft) newState.pa -= PLAYER_ROTATION_SPEED;
    if (newState.isTurningRight) newState.pa += PLAYER_ROTATION_SPEED;
    newState.pa = (newState.pa + 2 * Math.PI) % (2 * Math.PI); // Normalize angle

    // Apply continuous actions (movement)
    if (newState.isMovingForward) {
        const newX = newState.px + Math.cos(newState.pa) * PLAYER_MOVE_SPEED;
        const newY = newState.py + Math.sin(newState.pa) * PLAYER_MOVE_SPEED;
        // Basic collision detection
        if (!isWall(newX, newState.py)) newState.px = newX;
        if (!isWall(newState.px, newY)) newState.py = newY;
    }


    // Player shoot action
    if (action === "shoot") {
        newState.message = "Pew!";
        let shotHit = false;
        newState.enemies.forEach(enemy => {
            if (!enemy.isActive) return;
            const dx = enemy.x - newState.px;
            const dy = enemy.y - newState.py;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < SHOOT_RANGE) {
                const angleToEnemy = Math.atan2(dy, dx);
                let angleDiff = newState.pa - angleToEnemy;
                // Normalize angle_diff to be between -pi and pi
                angleDiff = (angleDiff + Math.PI) % (2 * Math.PI) - Math.PI;
                if (Math.abs(angleDiff) < FOV / 4) { // Check if enemy is roughly in front
                    enemy.hp -= SHOOT_DAMAGE;
                    newState.message = `Hit enemy! (HP: ${enemy.hp})`;
                    shotHit = true;
                    if (enemy.hp <= 0) {
                        enemy.isActive = false;
                        newState.message = "Enemy eliminated!";
                    }
                }
            }
        });
        if (!shotHit) newState.message = "Missed!";
    }

    // Enemy AI (simple: move towards player, basic attack)
    newState.enemies.forEach(enemy => {
        if (!enemy.isActive || newState.gameOver) return;

        const dx = newState.px - enemy.x;
        const dy = newState.py - enemy.y;
        const distToPlayer = Math.sqrt(dx * dx + dy * dy);

        if (distToPlayer < 0.5 * TILE_SIZE) { // Close enough to attack
            newState.php -= 1;
            newState.message = `Ouch! Enemy hit you! (HP: ${newState.php})`;
            if (newState.php <= 0) {
                newState.gameOver = true;
                newState.message = "You died! Game Over.";
            }
        } else if (distToPlayer < 5 * TILE_SIZE) { // Agro range
            const angleToPlayer = Math.atan2(dy, dx);
            const moveX = Math.cos(angleToPlayer) * ENEMY_MOVE_SPEED;
            const moveY = Math.sin(angleToPlayer) * ENEMY_MOVE_SPEED;

            const newEnemyX = enemy.x + moveX;
            const newEnemyY = enemy.y + moveY;

            if (!isWall(newEnemyX, enemy.y)) enemy.x = newEnemyX;
            if (!isWall(enemy.x, newEnemyY)) enemy.y = newEnemyY;
        }
    });

    if (newState.enemies.every(e => !e.isActive) && !newState.gameOver) {
        newState.message = "All enemies defeated! You WIN!";
        newState.gameOver = true; // Or advance level
    }

    return newState;
}

// --- Game Rendering ---
function renderGameView(state: GameState): string {
    if (state.gameOver) {
        return `\`\`\`\n${state.message}\nPlayer HP: ${state.php}\n\`\`\``;
    }

    const screenBuffer: string[][] = Array(VIEW_HEIGHT_CHARS)
        .fill(null).map(() => Array(VIEW_WIDTH_CHARS).fill(EMOJI_EMPTY));

    const wallDistances: number[] = Array(VIEW_WIDTH_CHARS).fill(Infinity);

    // Raycasting for walls
    for (let col = 0; col < VIEW_WIDTH_CHARS; col++) {
        const rayAngle = state.pa - FOV / 2 + (col / VIEW_WIDTH_CHARS) * FOV;
        let distToWall = 0;
        let hitWall = false;
        
        const eyeX = Math.cos(rayAngle);
        const eyeY = Math.sin(rayAngle);

        while (!hitWall && distToWall < MAX_RAY_DEPTH) {
            distToWall += 0.1; // Step along ray
            const testX = state.px + eyeX * distToWall;
            const testY = state.py + eyeY * distToWall;

            if (isWall(testX,testY)) {
                hitWall = true;
                // Fish-eye correction
                const correctedDist = distToWall * Math.cos(rayAngle - state.pa);
                wallDistances[col] = correctedDist;

                const lineHeight = Math.max(1, Math.floor(VIEW_HEIGHT_CHARS / (correctedDist + 0.001))); // Avoid division by zero
                const drawStart = Math.max(0, Math.floor((VIEW_HEIGHT_CHARS - lineHeight) / 2));
                const drawEnd = Math.min(VIEW_HEIGHT_CHARS - 1, Math.floor((VIEW_HEIGHT_CHARS + lineHeight) / 2));
                
                for (let row = 0; row < VIEW_HEIGHT_CHARS; row++) {
                    if (row < drawStart) screenBuffer[row][col] = EMOJI_CEILING;
                    else if (row >= drawStart && row <= drawEnd) screenBuffer[row][col] = EMOJI_WALL;
                    else screenBuffer[row][col] = EMOJI_FLOOR;
                }
            }
        }
         if (!hitWall) { // No wall hit within MAX_RAY_DEPTH, draw sky/floor
            for (let row = 0; row < VIEW_HEIGHT_CHARS; row++) {
                if (row < VIEW_HEIGHT_CHARS / 2) screenBuffer[row][col] = EMOJI_CEILING;
                else screenBuffer[row][col] = EMOJI_FLOOR;
            }
        }
    }
    
    // Sprite (Enemy) Rendering (very basic, sort by distance for proper overlap)
    const sortedEnemies = state.enemies
        .filter(e => e.isActive)
        .map(enemy => {
            const dx = enemy.x - state.px;
            const dy = enemy.y - state.py;
            return { ...enemy, dist: dx * dx + dy * dy }; // Store squared distance
        })
        .sort((a, b) => b.dist - a.dist); // Furthest first

    sortedEnemies.forEach(enemy => {
        const dx = enemy.x - state.px;
        const dy = enemy.y - state.py;
        const enemyDist = Math.sqrt(enemy.dist);

        // Transform enemy position to player's view space
        const relativeX = dx * Math.cos(-state.pa) - dy * Math.sin(-state.pa);
        const relativeY = dx * Math.sin(-state.pa) + dy * Math.cos(-state.pa); // This is depth

        if (relativeY > 0.5 && enemyDist < MAX_RAY_DEPTH) { // Enemy is in front and within range
            const enemyAngleRelativeToPlayer = Math.atan2(relativeX, relativeY); // Angle from player's forward vector

            if (Math.abs(enemyAngleRelativeToPlayer) < FOV / 2) { // Enemy is within FOV
                const enemyScreenX = Math.floor(VIEW_WIDTH_CHARS / 2 + (enemyAngleRelativeToPlayer / (FOV/2)) * (VIEW_WIDTH_CHARS / 2));
                
                if (enemyScreenX >= 0 && enemyScreenX < VIEW_WIDTH_CHARS && enemyDist < wallDistances[enemyScreenX]) {
                    const enemySize = Math.max(1, Math.floor(VIEW_HEIGHT_CHARS / (enemyDist + 0.001)));
                    const drawStartY = Math.max(0, Math.floor((VIEW_HEIGHT_CHARS - enemySize) / 2));
                    const drawEndY = Math.min(VIEW_HEIGHT_CHARS - 1, drawStartY + enemySize -1);

                    const enemyEmoji = enemy.hp > 0 ? EMOJI_ENEMY_ALIVE : EMOJI_ENEMY_DEAD;
                    for (let y = drawStartY; y <= drawEndY; y++) {
                         // A bit of horizontal spread for the sprite
                        for (let x_offset = -Math.floor(enemySize/4); x_offset <= Math.floor(enemySize/4); x_offset++) {
                            const currentScreenX = enemyScreenX + x_offset;
                            if (currentScreenX >= 0 && currentScreenX < VIEW_WIDTH_CHARS && enemyDist < wallDistances[currentScreenX]) {
                                screenBuffer[y][currentScreenX] = enemyEmoji;
                            }
                        }
                    }
                }
            }
        }
    });


    // Add bullet trace if player just shot (visual feedback, very simple)
    if (state.message.startsWith("Pew!") || state.message.startsWith("Hit enemy!") || state.message.startsWith("Missed!")) {
        const midY = Math.floor(VIEW_HEIGHT_CHARS / 2);
        const midX = Math.floor(VIEW_WIDTH_CHARS / 2);
        if (screenBuffer[midY] && screenBuffer[midY][midX] !== EMOJI_WALL) { // Don't draw over wall
             screenBuffer[midY][midX] = EMOJI_BULLET_TRACE;
        }
    }


    // Assemble screenBuffer into string
    let viewString = screenBuffer.map(row => row.join("")).join("\n");
    
    const healthBar = `HP: ${"❤️".repeat(Math.max(0, state.php))}${"🖤".repeat(Math.max(0, PLAYER_MAX_HEALTH - state.php))}`;
    const enemyCount = state.enemies.filter(e => e.isActive).length;
    const statusLine = `${healthBar} | Enemies: ${enemyCount}`;
    const movementStatus = 
        `Fwd:${state.isMovingForward ? "ON" : "OFF"} ` +
        `Lt:${state.isTurningLeft ? "ON" : "OFF"} ` +
        `Rt:${state.isTurningRight ? "ON" : "OFF"}`;

    return `\`\`\`\n${viewString}\n\`\`\`\n${statusLine}\n${movementStatus}\n${state.message}`;
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
                    } else if (commandName === "doom") {
                        const initialGameState = getInitialGameState();
                        const gameStateString = serializeGameState(initialGameState);
                        const gameView = renderGameView(initialGameState);

                        return new Response(
                            JSON.stringify({
                                type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                                data: {
                                    content: gameView,
                                    components: [
                                        {
                                            type: 1, // Action Row
                                            components: [
                                                { type: 2, style: 2, label: "Toggle Fwd", custom_id: `doom_toggle_forward_${gameStateString}` }, // Grey
                                                { type: 2, style: 1, label: "Shoot", custom_id: `doom_shoot_${gameStateString}` }, // Blue
                                            ],
                                        },
                                        {
                                            type: 1, // Action Row
                                            components: [
                                                { type: 2, style: 2, label: "Toggle Turn L", custom_id: `doom_toggle_turn_left_${gameStateString}` },
                                                { type: 2, style: 2, label: "Toggle Turn R", custom_id: `doom_toggle_turn_right_${gameStateString}` },
                                            ],
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


                    if (prefix !== "doom" || !action || !gameStateString) {
                         console.error("Invalid custom_id format:", customIdFull);
                         return new Response(JSON.stringify({ type: 4, data: { content: "Error: Invalid button data.", ephemeral: true } }), 
                                            { headers: { "Content-Type": "application/json" } });
                    }

                    const currentGameState = deserializeGameState(gameStateString);
                    if (!currentGameState) {
                        console.error("Failed to deserialize game state from custom_id:", gameStateString);
                         return new Response(JSON.stringify({ type: 4, data: { content: "Error: Corrupted game state. Please start a new game with /doom.", ephemeral: true } }), 
                                            { headers: { "Content-Type": "application/json" } });
                    }
                    
                    if (Date.now() - currentGameState.lastInteractionTime > 600000 && !currentGameState.gameOver) { // 10 min, example
                        return new Response(
                            JSON.stringify({
                                type: 7, // UPDATE_MESSAGE
                                data: {
                                    content: "This game session has expired due to inactivity. Please start a new game with `/doom`.",
                                    components: [] // Remove buttons
                                }
                            }), { headers: { "Content-Type": "application/json" } }
                        );
                    }


                    const updatedGameState = updateGameState(currentGameState, action);
                    const newGameStateString = serializeGameState(updatedGameState);

                    if (newGameStateString.length > 90) { // Check if custom_id will be too long (90 + "doom_action_" ~ 100)
                        console.warn("Serialized game state is very long:", newGameStateString.length, newGameStateString);
                        // Potentially respond with an error or simplified state if it gets too big
                    }


                    const gameView = renderGameView(updatedGameState);
                    
                    return new Response(
                        JSON.stringify({
                            type: 7, // UPDATE_MESSAGE
                            data: {
                                content: gameView,
                                components: updatedGameState.gameOver ? [] : [ // No buttons if game over
                                    {
                                        type: 1, components: [
                                            { type: 2, style: updatedGameState.isMovingForward ? 3:2, label: "Toggle Fwd", custom_id: `doom_toggle_forward_${newGameStateString}` }, // Green if ON
                                            { type: 2, style: 1, label: "Shoot", custom_id: `doom_shoot_${newGameStateString}` },
                                        ]
                                    },
                                    {
                                        type: 1, components: [
                                            { type: 2, style: updatedGameState.isTurningLeft ? 3:2, label: "Toggle Turn L", custom_id: `doom_toggle_turn_left_${newGameStateString}` },
                                            { type: 2, style: updatedGameState.isTurningRight ? 3:2, label: "Toggle Turn R", custom_id: `doom_toggle_turn_right_${newGameStateString}` },
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
