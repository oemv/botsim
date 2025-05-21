// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
import { createCanvas, loadImage } from "https://deno.land/x/canvas@v1.4.1/mod.ts";

function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

async function generateQuoteImage(avatarUrl: string, username: string, messageContent: string): Promise<Uint8Array> {
    // --- Image constants ---
    const avatarSize = 96;
    const padding = 15;
    const textPadding = 12; // Padding inside the quote box
    const authorTextSize = 20;
    const messageTextSize = 18;
    const lineHeightMultiplier = 1.3;
    const maxTextWidth = 450; // Max width for the text content area
    const backgroundColor = "#313338"; // Discord-like dark background for the whole image
    const quoteBoxColor = "rgba(0, 0, 0, 0.5)"; // Semi-transparent black for the text box
    const authorTextColor = "#FFFFFF";
    const messageTextColor = "#DBDEE1"; // Discord's message text color

    // --- Load avatar ---
    let avatarImage;
    try {
        avatarImage = await loadImage(avatarUrl);
    } catch (e) {
        console.warn("Failed to load primary avatar:", avatarUrl, e);
        // Fallback to a default Discord avatar if the primary one fails
        try {
            avatarImage = await loadImage(`https://cdn.discordapp.com/embed/avatars/0.png`); // Default grey avatar
        } catch (defaultError) {
            console.error("Failed to load default avatar:", defaultError);
            // If even default fails, we might need a placeholder canvas or throw
            throw new Error("Could not load avatar image or default fallback.");
        }
    }

    // --- Prepare text and calculate dimensions ---
    const tempCanvas = createCanvas(1, 1); // For text measurement
    const tempCtx = tempCanvas.getContext("2d");

    // Author text (single line)
    tempCtx.font = `bold ${authorTextSize}px "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const authorText = username;
    const authorLineHeight = authorTextSize * lineHeightMultiplier;

    // Message text (potentially multiple lines)
    tempCtx.font = `${messageTextSize}px "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const words = (messageContent || "[No Content]").split(' ');
    const lines: string[] = [];
    let currentLine = "";
    for (const word of words) {
        const testLine = currentLine + (currentLine ? " " : "") + word;
        const metrics = tempCtx.measureText(testLine);
        if (metrics.width > maxTextWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);
    if (lines.length === 0 && !messageContent) lines.push("[No Content]");


    const messageBlockHeight = lines.length * (messageTextSize * lineHeightMultiplier);
    const totalTextHeightInsideQuoteBox = authorLineHeight + messageBlockHeight;
    const quoteBoxContentHeight = textPadding + totalTextHeightInsideQuoteBox + textPadding;

    // --- Calculate overall canvas dimensions ---
    const quoteBoxHeight = Math.max(avatarSize, quoteBoxContentHeight); // Quote box matches avatar height or text height
    const imageWidth = padding + avatarSize + padding + maxTextWidth + padding;
    const imageHeight = padding + quoteBoxHeight + padding;

    const canvas = createCanvas(imageWidth, imageHeight);
    const ctx = canvas.getContext("2d");

    // Draw background for the entire image
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, imageWidth, imageHeight);

    // Draw avatar (circular crop would be nice, but keeping it simple as square)
    // To make it circular:
    // ctx.save();
    // ctx.beginPath();
    // ctx.arc(padding + avatarSize / 2, padding + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
    // ctx.closePath();
    // ctx.clip();
    // ctx.drawImage(avatarImage, padding, padding, avatarSize, avatarSize);
    // ctx.restore();
    // For simplicity, using square avatar:
    ctx.drawImage(avatarImage, padding, padding + (quoteBoxHeight - avatarSize) / 2, avatarSize, avatarSize);


    // Draw semi-transparent quote box
    const quoteBoxX = padding + avatarSize + padding;
    const quoteBoxY = padding;
    ctx.fillStyle = quoteBoxColor;
    ctx.fillRect(quoteBoxX, quoteBoxY, maxTextWidth, quoteBoxHeight);

    // Draw author text
    ctx.fillStyle = authorTextColor;
    ctx.font = `bold ${authorTextSize}px "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    // Align text to the top of the quote box content area
    let currentTextY = quoteBoxY + textPadding + authorTextSize; // Baseline for author text
    ctx.fillText(authorText, quoteBoxX + textPadding, currentTextY);

    // Draw message text
    currentTextY += (authorLineHeight - authorTextSize); // Move to bottom of author line
    currentTextY += (messageTextSize * lineHeightMultiplier * 0.3); // Small gap
    ctx.fillStyle = messageTextColor;
    ctx.font = `${messageTextSize}px "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    for (const line of lines) {
        currentTextY += (messageTextSize * lineHeightMultiplier);
        ctx.fillText(line, quoteBoxX + textPadding, currentTextY);
    }

    return canvas.toBuffer("image/png");
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
        hexToUint8Array(DISCORD_PUBLIC_KEY)
    );

    if (!isVerified) {
        return new Response("Unauthorized: Invalid Discord Signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    switch (interaction.type) {
        case 1: // PING
            return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });
        case 2: // APPLICATION_COMMAND
            const appCmdData = interaction.data;
            const commandName = appCmdData.name;

            if (appCmdData.type === 1 && commandName === "ping") { // CHAT_INPUT (Slash Command)
                return new Response(JSON.stringify({ type: 4, data: { content: "Pong!" } }), { headers: { "Content-Type": "application/json" } });
            } else if (appCmdData.type === 3 && commandName === "Quote Message") { // MESSAGE_CONTEXT_MENU
                const targetMessageId = appCmdData.target_id;
                const targetMessage = appCmdData.resolved.messages[targetMessageId];

                if (!targetMessage) {
                    console.error("Target message not found in resolved data:", targetMessageId);
                    return new Response(JSON.stringify({ type: 4, data: { content: "Could not find the target message to quote.", flags: 64 /* Ephemeral */ } }), { headers: { "Content-Type": "application/json" } });
                }

                const author = targetMessage.author;
                let avatarUrl: string;
                if (author.avatar) {
                    // Request PNG, Discord CDN will convert animated to static PNG if .png is requested
                    avatarUrl = `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=128`;
                } else {
                    // Default avatar based on discriminator
                    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${parseInt(author.discriminator) % 5}.png`;
                }

                try {
                    const imageBuffer = await generateQuoteImage(avatarUrl, author.username, targetMessage.content);

                    const formData = new FormData();
                    const payload = {
                        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                        data: {
                            // content: `Quoted by <@${interaction.member?.user?.id || interaction.user?.id}>:`, // Optional: add who quoted
                            attachments: [{
                                id: "0", // String or number, used to reference the file
                                filename: "quote.png",
                                description: `Quote of ${author.username}'s message`
                            }]
                        }
                    };
                    formData.append("payload_json", JSON.stringify(payload));
                    formData.append("files[0]", new Blob([imageBuffer], { type: "image/png" }), "quote.png");

                    return new Response(formData); // Deno Deploy handles FormData for multipart responses
                } catch (error) {
                    console.error("Error generating or sending quote image:", error);
                    return new Response(JSON.stringify({ type: 4, data: { content: "Sorry, I couldn't generate the quote image. " + error.message, flags: 64 /* Ephemeral */ } }), { headers: { "Content-Type": "application/json" } });
                }
            } else {
                // Fallback for unknown command names or types (e.g. User commands if not handled)
                return new Response(JSON.stringify({ type: 4, data: { content: "Unknown application command.", flags: 64 /* Ephemeral */ } }), { headers: { "Content-Type": "application/json" } });
            }
        default:
            return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
    }
});
