// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
import { createCanvas, loadImage, CanvasRenderingContext2D } from "https://deno.land/x/canvas@v1.4.1/mod.ts";

// Helper to convert hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

// Helper to get avatar URL (handles default avatars)
function getAvatarUrl(author: any, size: string = "128"): string {
    if (author.avatar) {
        const format = author.avatar.startsWith("a_") ? "gif" : "png"; // Support animated avatars
        return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.${format}?size=${size}`;
    } else {
        // Default avatar logic based on user ID (new system)
        const avatarIndex = (BigInt(author.id) >> 22n) % 6n;
        return `https://cdn.discordapp.com/embed/avatars/${Number(avatarIndex)}.png?size=${size}`;
    }
}

// Helper to wrap text on canvas
function wrapText(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines?: number
): number {
    const words = text.split(' ');
    let line = '';
    let currentY = y;
    let linesDrawn = 0;

    for (let n = 0; n < words.length; n++) {
        if (maxLines && linesDrawn >= maxLines) {
            // Add ellipsis if text is truncated due to maxLines
            const lastLineTest = line.trimRight() + '...';
            if (context.measureText(lastLineTest).width <= maxWidth) {
                line = lastLineTest;
            } else {
                // If even ellipsis doesn't fit, just use the line as is (might be slightly over)
                // or truncate harder. For simplicity, we'll draw the current line.
                line = line.substring(0, line.length - words[n-1].length -1) + "...";
            }
            context.fillText(line.trimRight(), x, currentY);
            return currentY + lineHeight;
        }

        const testLine = line + words[n] + ' ';
        const metrics = context.measureText(testLine);
        const testWidth = metrics.width;

        if (testWidth > maxWidth && n > 0) {
            context.fillText(line.trimRight(), x, currentY);
            line = words[n] + ' ';
            currentY += lineHeight;
            linesDrawn++;
        } else {
            line = testLine;
        }
    }
    if (line.trim() !== '') {
        if (maxLines && linesDrawn >= maxLines) { // Check again for the very last line
             line = line.substring(0, line.length -1) + "..."; // Add ellipsis if it's the max line
        }
        context.fillText(line.trimRight(), x, currentY);
        linesDrawn++;
    }
    return currentY + (linesDrawn > 0 ? lineHeight : 0);
}


// Function to generate the quote image
async function generateQuoteImage(author: any, content: string, timestampStr: string): Promise<Uint8Array> {
    const canvasWidth = 600;
    const canvasHeight = 220; // Increased height for timestamp and better spacing
    const padding = 15;
    const avatarSize = 100; // Slightly smaller avatar for better balance

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");

    // Background (optional, could be transparent if desired)
    // Forcing a background color ensures no transparency issues in Discord dark/light mode
    ctx.fillStyle = "#2C2F33"; // Dark theme color, or choose another
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Load avatar
    const avatarUrl = getAvatarUrl(author, avatarSize.toString());
    let avatarImage;
    try {
        avatarImage = await loadImage(avatarUrl);
    } catch (e) {
        console.error("Failed to load avatar, using placeholder:", e);
        // Fallback: draw a gray square or use a pre-loaded default placeholder
        ctx.fillStyle = "#7289DA"; // Discord blurple
        ctx.fillRect(padding, padding, avatarSize, avatarSize);
    }

    if (avatarImage) {
        // Draw avatar (circular mask)
        ctx.save();
        ctx.beginPath();
        ctx.arc(padding + avatarSize / 2, padding + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImage, padding, padding, avatarSize, avatarSize);
        ctx.restore();
    }


    // Text area styling
    const textAreaX = padding + avatarSize + padding;
    const textAreaY = padding;
    const textAreaWidth = canvasWidth - textAreaX - padding;
    const textAreaHeight = canvasHeight - (padding * 2); // Full height for text area background

    // Draw semi-transparent background for text
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.roundRect(textAreaX - 5, textAreaY -5 , textAreaWidth + 10, textAreaHeight + 10, 8); // Rounded corners
    ctx.fill();


    // Author name
    ctx.fillStyle = "#FFFFFF"; // White text
    ctx.font = "bold 20px sans-serif";
    const displayName = author.global_name || author.username;
    ctx.fillText(`@${displayName}`, textAreaX, textAreaY + 25);

    // Message content
    ctx.font = "16px sans-serif";
    const messageLineHeight = 22;
    const maxMessageLines = 5; // Limit lines to keep image size reasonable
    const messageYStart = textAreaY + 25 + 25; // Below author name
    const actualContent = content.length > 0 ? content : "[No text content]";
    const truncatedContent = actualContent.length > 400 ? actualContent.substring(0, 397) + "..." : actualContent;
    const lastTextY = wrapText(ctx, truncatedContent, textAreaX, messageYStart, textAreaWidth - 10, messageLineHeight, maxMessageLines);


    // Timestamp
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#B9BBBE"; // Lighter gray for timestamp
    const date = new Date(timestampStr);
    const formattedTimestamp = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + " " +
                               date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    const timestampY = canvasHeight - padding - 5; // Position at the bottom of the text area
    ctx.fillText(formattedTimestamp, textAreaX, timestampY);


    return canvas.toBuffer("image/png");
}

// Main interaction handler for "Quote Message"
async function handleQuoteMessageInteraction(interaction: any): Promise<Response> {
    const targetMessage = interaction.data.resolved.messages[interaction.data.target_id];
    if (!targetMessage) {
        return new Response(JSON.stringify({ type: 4, data: { content: "Error: Could not find the target message.", ephemeral: true } }), {
            headers: { "Content-Type": "application/json" },
        });
    }

    const author = targetMessage.author;
    const content = targetMessage.content; // Will be empty string if no text content
    const timestamp = targetMessage.timestamp;

    // Acknowledge the interaction quickly if image generation might take time.
    // For "fastest", we try direct response. If it times out (Discord expects ack in 3s),
    // then a deferred response (type 5) would be needed.
    // Let's assume generation is fast enough for now.

    try {
        const imageBuffer = await generateQuoteImage(author, content, timestamp);
        const formData = new FormData();

        const quotedByUserId = interaction.member?.user?.id || interaction.user?.id;

        const payload = {
            content: `Message from **${author.global_name || author.username}** quoted by <@${quotedByUserId}>:`,
            embeds: [{
                image: { url: "attachment://quote.png" },
                // You could add a color to the embed to match your bot's theme
                // color: 0x7289DA, // Discord Blurple
            }],
            allowed_mentions: { parse: ["users"] } // Allow the "quoted by" mention
        };

        formData.append("payload_json", JSON.stringify({ type: 4, data: payload }));
        formData.append("files[0]", new Blob([imageBuffer], { type: "image/png" }), "quote.png");

        return new Response(formData); // Deno.serve handles multipart Content-Type
    } catch (error) {
        console.error("Error handling quote message interaction:", error);
        return new Response(JSON.stringify({
            type: 4,
            data: { content: "Sorry, I encountered an error trying to quote that message.", ephemeral: true },
        }), { headers: { "Content-Type": "application/json" } });
    }
}


// --- Deno Deploy HTTP Server ---
const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set in environment variables.");
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
        hexToUint8Array(DISCORD_PUBLIC_KEY)
    );

    if (!isVerified) {
        return new Response("Unauthorized: Invalid Discord Signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    switch (interaction.type) {
        case 1: // PING (Discord verifying endpoint)
            return new Response(JSON.stringify({ type: 1 }), {
                headers: { "Content-Type": "application/json" },
            });

        case 2: // APPLICATION_COMMAND
            switch (interaction.data.type) {
                case 1: // CHAT_INPUT (Slash Command)
                    const commandName = interaction.data.name;
                    if (commandName === "ping") {
                        return new Response(JSON.stringify({
                            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                            data: { content: "Pong!" },
                        }), { headers: { "Content-Type": "application/json" } });
                    } else {
                        return new Response(JSON.stringify({
                            type: 4,
                            data: { content: "Unknown slash command.", ephemeral: true },
                        }), { headers: { "Content-Type": "application/json" } });
                    }
                // break; // Not needed due to return

                case 3: // MESSAGE (Message Context Menu Command)
                    const messageCommandName = interaction.data.name;
                    if (messageCommandName === "Quote Message") {
                        return await handleQuoteMessageInteraction(interaction);
                    } else {
                        return new Response(JSON.stringify({
                            type: 4,
                            data: { content: "Unknown message command.", ephemeral: true },
                        }), { headers: { "Content-Type": "application/json" } });
                    }
                // break; // Not needed due to return

                default:
                    return new Response(JSON.stringify({
                        type: 4,
                        data: { content: "Unsupported application command type.", ephemeral: true },
                    }), { headers: { "Content-Type": "application/json" } });
            }
        // break; // Not needed as inner switch cases return

        default:
            return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
    }
});

console.log("Discord bot server running!");
