// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
// Import 'canvas' which uses WASM-based Skia (CanvasKit)
import { createCanvas, loadImage } from "https://deno.land/x/canvas@v1.4.1/mod.ts";
// Note: 'Image' class is not directly exported like in skia_canvas, loadImage is used.

function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

async function generateQuoteImage(
    authorName: string,
    avatarUrl: string,
    messageContent: string,
    messageTimestamp: string
): Promise<Uint8Array> {
    const pfpSize = 128;
    const padding = 20;
    const textPadding = 15;
    const authorNameFontSize = 24;
    const contentFontSize = 18;
    const timestampFontSize = 14;
    const textBlockWidth = 400;

    // 1. Fetch and load PFP
    let pfpImage: any | null = null; // Type from deno-canvas loadImage
    try {
        const pfpResponse = await fetch(avatarUrl);
        if (pfpResponse.ok) {
            const pfpData = await pfpResponse.arrayBuffer();
            pfpImage = await loadImage(new Uint8Array(pfpData)); // Use loadImage
        }
    } catch (e) {
        console.error("Failed to fetch or load PFP:", e);
    }

    // 2. Prepare canvas and context (pre-calculate text height for dynamic canvas height)
    // For deno-canvas, text metrics are slightly different; we'll make it a bit more generous
    const tempCanvasForTextMetrics = createCanvas(1, 1);
    const tempCtx = tempCanvasForTextMetrics.getContext("2d");

    // Author Name
    tempCtx.font = `bold ${authorNameFontSize}px sans-serif`;
    // measureText in deno-canvas returns an object with 'width'
    const authorNameMetrics = tempCtx.measureText(authorName);
    let currentHeight = padding + authorNameFontSize * 1.2; // Approximate height

    // Message Content (with wrapping)
    tempCtx.font = `${contentFontSize}px sans-serif`;
    const words = messageContent.split(' ');
    let line = '';
    const lines = [];
    for (const word of words) {
        const testLine = line + word + ' ';
        const metrics = tempCtx.measureText(testLine);
        if (metrics.width > textBlockWidth - 2 * textPadding && line !== '') {
            lines.push(line.trim());
            line = word + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    const lineHeight = contentFontSize * 1.4;
    currentHeight += padding / 2 + lines.length * lineHeight;

    // Timestamp
    tempCtx.font = `${timestampFontSize}px sans-serif`;
    currentHeight += padding / 2 + timestampFontSize * 1.2;
    currentHeight += padding;

    const canvasHeight = Math.max(pfpSize + 2 * padding, currentHeight);
    const canvasWidth = padding + pfpSize + padding + textBlockWidth + padding;

    const canvas = createCanvas(canvasWidth, canvasHeight); // Use createCanvas
    const ctx = canvas.getContext("2d");

    // 3. Background
    ctx.fillStyle = "#2C2F33";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 4. Draw PFP
    if (pfpImage) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(padding + pfpSize / 2, padding + pfpSize / 2, pfpSize / 2, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(pfpImage, padding, padding, pfpSize, pfpSize);
        ctx.restore();
    } else {
        ctx.fillStyle = "#7289DA";
        ctx.beginPath();
        ctx.arc(padding + pfpSize / 2, padding + pfpSize / 2, pfpSize / 2, 0, Math.PI * 2, true);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = "bold 48px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", padding + pfpSize / 2, padding + pfpSize / 2 + 5);
    }

    // 5. Draw text background
    const textBgX = padding + pfpSize + padding;
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(textBgX, padding, textBlockWidth, canvasHeight - 2 * padding);

    // 6. Draw text
    ctx.fillStyle = "white";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    let yPos = padding + textPadding;

    // Author Name
    ctx.font = `bold ${authorNameFontSize}px sans-serif`;
    ctx.fillText(authorName, textBgX + textPadding, yPos);
    yPos += authorNameFontSize * 1.2;

    // Message Content
    ctx.font = `${contentFontSize}px sans-serif`;
    for (const l of lines) {
        ctx.fillText(l, textBgX + textPadding, yPos);
        yPos += lineHeight;
    }
    yPos += padding / 2;

    // Timestamp
    ctx.font = `${timestampFontSize}px sans-serif`;
    ctx.fillStyle = "#99AAB5";
    ctx.fillText(new Date(messageTimestamp).toLocaleString(), textBgX + textPadding, yPos);

    // 7. Encode to PNG
    // deno-canvas's toBuffer is synchronous but generateQuoteImage is async
    return Promise.resolve(canvas.toBuffer("image/png")); // Use toBuffer and ensure it's a promise
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
                const targetMessageId = commandData.target_id;
                const message = commandData.resolved.messages[targetMessageId];

                if (!message) {
                    return new Response(
                        JSON.stringify({ type: 4, data: { content: "Could not find the message to quote." } }),
                        { headers: { "Content-Type": "application/json" } }
                    );
                }

                const author = message.author;
                const avatarHash = author.avatar;
                // Use author.display_name if available (for server nicknames), fallback to global_name, then username
                const displayName = message.member?.nick || author.global_name || author.username;
                
                const avatarUrl = avatarHash
                    ? `https://cdn.discordapp.com/avatars/${author.id}/${avatarHash}.png?size=128`
                    : `https://cdn.discordapp.com/embed/avatars/${parseInt(author.discriminator === "0" ? author.id.slice(-1) : author.discriminator) % 5}.png`; // Updated default avatar logic for new usernames

                try {
                    const imageBytes = await generateQuoteImage(
                        displayName,
                        avatarUrl,
                        message.content || "[No text content - e.g., an embed or attachment]",
                        message.timestamp
                    );

                    const formData = new FormData();
                    formData.append(
                        "payload_json",
                        JSON.stringify({
                            type: 4,
                            data: {
                                attachments: [{
                                    id: 0,
                                    filename: "quote.png",
                                    description: `Quote of message ${message.id}`
                                }]
                            }
                        })
                    );
                    formData.append("files[0]", new Blob([imageBytes], { type: "image/png" }), "quote.png");
                    
                    return new Response(formData);

                } catch (error) {
                    console.error("Error generating quote image:", error);
                    return new Response(
                        JSON.stringify({ type: 4, data: { content: "Sorry, I couldn't generate the quote image." } }),
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
