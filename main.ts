// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
import { Canvas, Image } from "https://deno.land/x/skia_canvas@0.5.5/mod.ts"; // Using skia_canvas for image generation

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
    const imageQuality = 0.85; // For JPEG, not used for PNG but good to keep in mind for alternatives

    // 1. Fetch PFP
    let pfpImage: Image | null = null;
    try {
        const pfpResponse = await fetch(avatarUrl);
        if (pfpResponse.ok) {
            const pfpData = await pfpResponse.arrayBuffer();
            pfpImage = new Image();
            // skia_canvas Image.src can take Uint8Array or path.
            // We need to ensure it correctly loads from buffer.
            // A common pattern is to write to temp or use a method that accepts ArrayBuffer directly if available.
            // For skia_canvas, assigning ArrayBuffer to src works.
            pfpImage.src = new Uint8Array(pfpData);
        }
    } catch (e) {
        console.error("Failed to fetch or load PFP:", e);
        // Could use a placeholder PFP here
    }

    // 2. Prepare canvas and context (pre-calculate text height for dynamic canvas height)
    const tempCanvasForTextMetrics = new Canvas(1, 1); // Temporary canvas for text measurement
    const tempCtx = tempCanvasForTextMetrics.getContext("2d");

    // Author Name
    tempCtx.font = `bold ${authorNameFontSize}px sans-serif`;
    const authorNameMetrics = tempCtx.measureText(authorName);
    let currentHeight = padding + authorNameMetrics.actualBoundingBoxAscent + authorNameMetrics.actualBoundingBoxDescent;

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
    const lineHeight = contentFontSize * 1.4; // Approximate line height
    currentHeight += padding / 2 + lines.length * lineHeight;

    // Timestamp
    tempCtx.font = `${timestampFontSize}px sans-serif`;
    const timestampMetrics = tempCtx.measureText(new Date(messageTimestamp).toLocaleString());
    currentHeight += padding / 2 + timestampMetrics.actualBoundingBoxAscent + timestampMetrics.actualBoundingBoxDescent;
    currentHeight += padding; // Bottom padding

    const canvasHeight = Math.max(pfpSize + 2 * padding, currentHeight); // Ensure canvas is at least as tall as PFP
    const canvasWidth = padding + pfpSize + padding + textBlockWidth + padding;

    const canvas = new Canvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");

    // 3. Background (optional, if you want a specific bg color for the whole image)
    ctx.fillStyle = "#2C2F33"; // Dark Discord-like background
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 4. Draw PFP
    if (pfpImage && pfpImage.complete) { // Check if image loaded
        // Create a circular clipping path
        ctx.save();
        ctx.beginPath();
        ctx.arc(padding + pfpSize / 2, padding + pfpSize / 2, pfpSize / 2, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(pfpImage, padding, padding, pfpSize, pfpSize);
        ctx.restore();
    } else {
        // Fallback for missing PFP
        ctx.fillStyle = "#7289DA"; // Discord blurple
        ctx.beginPath();
        ctx.arc(padding + pfpSize / 2, padding + pfpSize / 2, pfpSize / 2, 0, Math.PI * 2, true);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = "bold 48px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", padding + pfpSize / 2, padding + pfpSize / 2 + 5); // Offset for better centering
    }


    // 5. Draw text background
    const textBgX = padding + pfpSize + padding;
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)"; // Pure black, half transparent
    ctx.fillRect(textBgX, padding, textBlockWidth, canvasHeight - 2 * padding);

    // 6. Draw text
    ctx.fillStyle = "white";
    ctx.textAlign = "left";
    ctx.textBaseline = "top"; // Important for positioning lines

    let yPos = padding + textPadding;

    // Author Name
    ctx.font = `bold ${authorNameFontSize}px sans-serif`;
    ctx.fillText(authorName, textBgX + textPadding, yPos);
    yPos += authorNameFontSize * 1.2; // Spacing after name

    // Message Content
    ctx.font = `${contentFontSize}px sans-serif`;
    for (const l of lines) {
        ctx.fillText(l, textBgX + textPadding, yPos);
        yPos += lineHeight;
    }
    yPos += padding / 2; // Extra spacing before timestamp

    // Timestamp
    ctx.font = `${timestampFontSize}px sans-serif`;
    ctx.fillStyle = "#99AAB5"; // Lighter gray for timestamp
    ctx.fillText(new Date(messageTimestamp).toLocaleString(), textBgX + textPadding, yPos);

    // 7. Encode to PNG
    return canvas.encode("png"); // Returns Promise<Uint8Array>
}


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
            const commandName = interaction.data.name;

            if (commandName === "ping") {
                return new Response(
                    JSON.stringify({ type: 4, data: { content: "Pong!" } }),
                    { headers: { "Content-Type": "application/json" } }
                );
            } else if (commandName === "Quote Message") {
                // This is a MESSAGE context menu command
                // The target message is in interaction.data.resolved.messages[interaction.data.target_id]
                const targetMessageId = interaction.data.target_id;
                const message = interaction.data.resolved.messages[targetMessageId];

                if (!message) {
                    return new Response(
                        JSON.stringify({ type: 4, data: { content: "Could not find the message to quote." } }),
                        { headers: { "Content-Type": "application/json" } }
                    );
                }

                const author = message.author;
                const avatarHash = author.avatar;
                const avatarUrl = avatarHash
                    ? `https://cdn.discordapp.com/avatars/${author.id}/${avatarHash}.png?size=128`
                    : `https://cdn.discordapp.com/embed/avatars/${parseInt(author.discriminator) % 5}.png`; // Default avatar

                try {
                    const imageBytes = await generateQuoteImage(
                        author.global_name || author.username, // Use global_name if available
                        avatarUrl,
                        message.content || "[No text content - e.g., an embed or attachment]",
                        message.timestamp
                    );

                    // To send an image, we need a multipart/form-data response
                    const formData = new FormData();
                    formData.append(
                        "payload_json",
                        JSON.stringify({
                            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                            data: {
                                // You can add content here too, like "Here's the quote:"
                                // content: "Quoted message:",
                                attachments: [{
                                    id: 0, // A temporary ID for the attachment
                                    filename: "quote.png",
                                    description: `Quote of message ${message.id}`
                                }]
                            }
                        })
                    );
                    formData.append("files[0]", new Blob([imageBytes], { type: "image/png" }), "quote.png");
                    
                    // Deno.serve and fetch API handle the Content-Type for FormData automatically
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
