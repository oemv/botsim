// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
// Using deno-canvas with explicit initialization
import { createCanvas, init as initCanvasKit } from "https://deno.land/x/canvas@v1.4.1/mod.ts";

// --- CanvasKit Initialization ---
// URL for the CanvasKit WASM file that deno-canvas v1.4.1 uses (based on its deps.ts)
const CANVAS_KIT_WASM_URL = "https://unpkg.com/canvaskit-wasm@0.39.1/bin/canvaskit.wasm";
let canvasInitialized = false;
let canvasInitializationError: string | null = null;

// Top-level await for initialization. Deno Deploy supports this.
// This block will run once when your Deno Deploy instance starts.
try {
    console.log(`Attempting to initialize CanvasKit from ${CANVAS_KIT_WASM_URL}...`);
    await initCanvasKit(CANVAS_KIT_WASM_URL);
    canvasInitialized = true;
    console.log("CanvasKit initialized successfully!");
} catch (e) {
    console.error("CRITICAL: Failed to initialize CanvasKit on startup:", e);
    canvasInitializationError = e.message || String(e);
    // The bot will still run, but image generation will fail.
    // The "Quote Message" handler will inform the user.
}
// --- End CanvasKit Initialization ---

function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

async function generateSimpleQuoteImage(
    authorDisplayName: string,
    messageContent: string
): Promise<Uint8Array> {
    if (!canvasInitialized) {
        // This is a safeguard. The main handler should check canvasInitialized first.
        throw new Error(`Image generation called but CanvasKit not initialized. Error: ${canvasInitializationError || "Unknown initialization error."}`);
    }

    const bgColor = "#36393F"; // Discord dark theme background
    const textColor = "#DCDDDE"; // Discord light text for content
    const authorColor = "#B9BBBE"; // Discord slightly dimmer text for author

    const padding = 25; // Generous padding around the text
    const contentFontSize = 20;
    const authorFontSize = 16;
    const maxTextWidth = 550; // Max width for the text content itself
    const lineSpacing = 1.4; // Multiplier for line height

    // 1. Prepare canvas for text measurement
    const tempCanvas = createCanvas(1, 1);
    const tempCtx = tempCanvas.getContext("2d");

    // 2. Format quote and author text
    const fullQuoteText = `"${messageContent}"`;
    const authorLineText = `- ${authorDisplayName}`;

    // 3. Calculate wrapped lines for the quote content
    tempCtx.font = `${contentFontSize}px sans-serif`;
    const quoteWords = fullQuoteText.split(' ');
    const quoteLines: string[] = [];
    let currentLine = '';
    for (const word of quoteWords) {
        const testLine = currentLine + word + ' ';
        const metrics = tempCtx.measureText(testLine);
        if (metrics.width > maxTextWidth && currentLine !== '') {
            quoteLines.push(currentLine.trim());
            currentLine = word + ' ';
        } else {
            currentLine = testLine;
        }
    }
    quoteLines.push(currentLine.trim()); // Add the last line

    const quoteTextHeight = quoteLines.length * (contentFontSize * lineSpacing);

    // 4. Calculate author text dimensions
    tempCtx.font = `italic ${authorFontSize}px sans-serif`;
    const authorTextMetrics = tempCtx.measureText(authorLineText);
    const authorTextHeight = authorFontSize * lineSpacing;

    // 5. Calculate total canvas dimensions
    const totalTextHeight = quoteTextHeight + (authorLineText ? (authorTextHeight + padding / 2) : 0);
    const canvasHeight = Math.ceil(totalTextHeight + 2 * padding);
    // Determine max width needed from wrapped lines or author line
    let requiredWidth = 0;
    tempCtx.font = `${contentFontSize}px sans-serif`; // Reset for quote lines measurement
    quoteLines.forEach(line => {
        const metrics = tempCtx.measureText(line);
        if (metrics.width > requiredWidth) requiredWidth = metrics.width;
    });
    if (authorTextMetrics.width > requiredWidth) requiredWidth = authorTextMetrics.width;
    const canvasWidth = Math.ceil(Math.min(maxTextWidth, requiredWidth) + 2 * padding);


    // 6. Create final canvas and draw
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let yPos = padding;

    // Draw Quote Content
    ctx.font = `${contentFontSize}px sans-serif`;
    ctx.fillStyle = textColor;
    for (const line of quoteLines) {
        ctx.fillText(line, padding, yPos);
        yPos += contentFontSize * lineSpacing;
    }

    // Draw Author
    if (authorLineText) {
        yPos += padding / 2; // Space before author line
        ctx.font = `italic ${authorFontSize}px sans-serif`;
        ctx.fillStyle = authorColor;
        ctx.fillText(authorLineText, padding, yPos);
    }

    // 7. Encode to PNG
    return Promise.resolve(canvas.toBuffer("image/png"));
}


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
        hexToUint8Array(DISCORD_PUBLIC_KEY!)
    );

    if (!isVerified) {
        return new Response("Unauthorized: Invalid Discord Signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    switch (interaction.type) {
        case 1: // PING
            return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });
        
        case 2: // APPLICATION_COMMAND
            const commandData = interaction.data;
            const commandName = commandData.name;

            if (commandName === "ping") {
                return new Response(
                    JSON.stringify({ type: 4, data: { content: "Pong!" } }),
                    { headers: { "Content-Type": "application/json" } }
                );
            } else if (commandName === "Quote Message") {
                // Check if canvas initialization failed on startup
                if (!canvasInitialized) {
                    console.warn("Quote Message command called, but canvas not initialized. Startup Error:", canvasInitializationError);
                    return new Response(
                        JSON.stringify({
                            type: 4,
                            data: { content: `Sorry, the image generation module is not ready. ${canvasInitializationError ? `Startup Error: ${canvasInitializationError}` : 'Please check logs.'}` }
                        }),
                        { headers: { "Content-Type": "application/json" } }
                    );
                }

                const targetMessageId = commandData.target_id;
                const message = commandData.resolved.messages[targetMessageId];

                if (!message) {
                    return new Response(
                        JSON.stringify({ type: 4, data: { content: "Could not find the message to quote." } }),
                        { headers: { "Content-Type": "application/json" } }
                    );
                }

                const author = message.author;
                // Prefer member nickname if available (from resolved.members), fallback to global_name, then username.
                // Note: interaction.data.resolved.members might contain the member object with 'nick'.
                const member = commandData.resolved.members?.[author.id];
                const displayName = member?.nick || author.global_name || author.username;
                
                const messageContent = message.content || "[This message has no text content]";

                try {
                    console.log(`Generating quote for: "${messageContent}" by ${displayName}`);
                    const imageBytes = await generateSimpleQuoteImage(
                        displayName,
                        messageContent
                    );

                    const formData = new FormData();
                    formData.append(
                        "payload_json",
                        JSON.stringify({
                            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                            data: {
                                attachments: [{
                                    id: 0, // Temporary ID for the attachment
                                    filename: "quote.png",
                                    description: `Quote of message by ${displayName}`
                                }]
                            }
                        })
                    );
                    formData.append("files[0]", new Blob([imageBytes], { type: "image/png" }), "quote.png");
                    
                    console.log("Sending image response for quote.");
                    return new Response(formData); // Deno Deploy handles FormData Content-Type

                } catch (error) {
                    console.error("Error during quote image generation or sending:", error);
                    return new Response(
                        JSON.stringify({ type: 4, data: { content: `Sorry, I couldn't generate the quote image. Error: ${error.message}` } }),
                        { headers: { "Content-Type": "application/json" } }
                    );
                }

            } else {
                return new Response(
                    JSON.stringify({ type: 4, data: { content: "Unknown command." } }),
                    { headers: { "Content-Type": "application/json" } }
                );
            }
        
        default:
            return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
    }
});
