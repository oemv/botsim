// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
import { createCanvas, loadImage, type CanvasRenderingContext2D } from "https://deno.land/x/canvas@v1.4.1/mod.ts";

function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

// Helper function for text wrapping
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    if (!text) return [];
    const words = text.split(' ');
    const lines: string[] = [];
    if (words.length === 0) return [];
    
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine + " " + word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width < maxWidth) {
            currentLine = testLine;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

// Helper function to create the quote image
async function createImageForQuote(message: any): Promise<{ imageBuffer: Uint8Array, fileName: string }> {
    const author = message.author;
    const content = message.content || " "; // Ensure content is not empty
    const avatarHash = author.avatar;
    const userId = author.id;
    const username = author.username;

    const avatarSize = 96;
    const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=${avatarSize}`;

    let avatarImage;
    try {
        const avatarRes = await fetch(avatarUrl);
        if (!avatarRes.ok) throw new Error(`Failed to fetch avatar: ${avatarRes.status}`);
        const avatarBuffer = await avatarRes.arrayBuffer();
        avatarImage = await loadImage(new Uint8Array(avatarBuffer));
    } catch (e) {
        console.warn("Failed to load avatar, using placeholder:", e.message);
        const placeholderCanvas = createCanvas(avatarSize, avatarSize);
        const pctx = placeholderCanvas.getContext("2d");
        pctx.fillStyle = "#7289DA"; // Discord blurple
        pctx.fillRect(0, 0, avatarSize, avatarSize);
        pctx.fillStyle = "white";
        pctx.font = `bold ${avatarSize / 4}px sans-serif`;
        pctx.textAlign = "center";
        pctx.textBaseline = "middle";
        pctx.fillText(username.substring(0, 2).toUpperCase(), avatarSize / 2, avatarSize / 2);
        avatarImage = await loadImage(placeholderCanvas.toBuffer("image/png"));
    }

    const sidePadding = 15;
    const topBottomPadding = 15;
    const avatarTextGap = 10;
    const textInnerPadding = 10;

    const fontSize = 16;
    const usernameFontSize = 14;
    const lineHeight = fontSize * 1.25; // Adjusted for better spacing
    const usernameLineHeight = usernameFontSize * 1.25; // Adjusted
    const mainFont = `${fontSize}px sans-serif`;
    const usernameFont = `bold ${usernameFontSize}px sans-serif`;

    const tempCanvas = createCanvas(1, 1);
    const tempCtx = tempCanvas.getContext("2d");

    const maxTextContentWidth = 300;

    tempCtx.font = usernameFont;
    const wrappedUsernameLines = wrapText(tempCtx, username, maxTextContentWidth);

    tempCtx.font = mainFont;
    const wrappedContentLines = wrapText(tempCtx, content, maxTextContentWidth);

    const usernameBlockHeight = wrappedUsernameLines.length * usernameLineHeight;
    const contentBlockHeight = wrappedContentLines.length * lineHeight;
    const gapBetweenUserAndContent = (wrappedUsernameLines.length > 0 && wrappedContentLines.length > 0) ? 5 : 0;

    const textBlockHeight = usernameBlockHeight + gapBetweenUserAndContent + contentBlockHeight;

    let maxMeasuredTextWidth = 0;
    tempCtx.font = usernameFont;
    for (const line of wrappedUsernameLines) {
        maxMeasuredTextWidth = Math.max(maxMeasuredTextWidth, tempCtx.measureText(line).width);
    }
    tempCtx.font = mainFont;
    for (const line of wrappedContentLines) {
        maxMeasuredTextWidth = Math.max(maxMeasuredTextWidth, tempCtx.measureText(line).width);
    }
    
    const textContainerContentWidth = Math.min(maxTextContentWidth, maxMeasuredTextWidth);
    const textContainerWidth = textContainerContentWidth + 2 * textInnerPadding;
    const textContainerHeight = Math.max(avatarSize, textBlockHeight + 2 * textInnerPadding);

    const imageWidth = sidePadding + avatarSize + avatarTextGap + textContainerWidth + sidePadding;
    const imageHeight = topBottomPadding + textContainerHeight + topBottomPadding;

    const canvas = createCanvas(imageWidth, imageHeight);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#2C2F33"; // Base dark color for the image background
    ctx.fillRect(0, 0, imageWidth, imageHeight);

    const avatarY = topBottomPadding + (textContainerHeight - avatarSize) / 2;
    if (avatarImage) {
        ctx.beginPath();
        ctx.arc(sidePadding + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImage, sidePadding, avatarY, avatarSize, avatarSize);
        ctx.restore(); // Restore context if clip changes state globally (good practice)
    }


    const textContainerX = sidePadding + avatarSize + avatarTextGap;
    const textContainerY = topBottomPadding;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)"; // Pure black half transparent container
    ctx.fillRect(textContainerX, textContainerY, textContainerWidth, textContainerHeight);

    ctx.textBaseline = "top";
    let currentTextY = textContainerY + textInnerPadding;

    if (wrappedUsernameLines.length > 0) {
        ctx.fillStyle = "#FFFFFF";
        ctx.font = usernameFont;
        for (const line of wrappedUsernameLines) {
            ctx.fillText(line, textContainerX + textInnerPadding, currentTextY);
            currentTextY += usernameLineHeight;
        }
    }

    currentTextY += gapBetweenUserAndContent;

    if (wrappedContentLines.length > 0) {
        ctx.fillStyle = "#DDDDDD";
        ctx.font = mainFont;
        for (const line of wrappedContentLines) {
            ctx.fillText(line, textContainerX + textInnerPadding, currentTextY);
            currentTextY += lineHeight;
        }
    }

    const imageBuffer = canvas.toBuffer("image/png");
    return { imageBuffer: new Uint8Array(imageBuffer), fileName: "quote.png" };
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
            {
                const commandData = interaction.data;
                const commandName = commandData.name;

                if (commandData.type === 1 && commandName === "ping") { // CHAT_INPUT (slash command)
                    return new Response(JSON.stringify({ type: 4, data: { content: "Pong!" } }), { headers: { "Content-Type": "application/json" } });
                } else if (commandData.type === 3 && commandName === "Quote Message") { // MESSAGE context menu command
                    const targetMessageId = commandData.target_id;
                    const messages = commandData.resolved?.messages;
                    const targetMessage = messages?.[targetMessageId];

                    if (!targetMessage) {
                        console.error("Target message not found in resolved data:", JSON.stringify(commandData.resolved));
                        return new Response(JSON.stringify({ type: 4, data: { content: "Could not find the target message data." } }), { headers: { "Content-Type": "application/json" } });
                    }

                    try {
                        // Acknowledge the interaction immediately (optional, but good for long tasks)
                        // For this "instant" bot, we can try to send the full response directly.
                        // If image generation were slower, an initial "defer" (type 5) response would be better.

                        const { imageBuffer, fileName } = await createImageForQuote(targetMessage);

                        const formData = new FormData();
                        const payloadJson = {
                            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                            data: {
                                attachments: [{
                                    id: "0", 
                                    filename: fileName,
                                    description: `Quote of a message originally sent by ${targetMessage.author.username}`
                                }]
                            }
                        };
                        formData.append("payload_json", JSON.stringify(payloadJson));
                        formData.append("files[0]", new Blob([imageBuffer], { type: "image/png" }), fileName);
                        
                        return new Response(formData); // Deno's server handles FormData to multipart

                    } catch (error: any) {
                        console.error("Error processing 'Quote Message' command:", error.stack || error.message);
                        return new Response(JSON.stringify({ type: 4, data: { content: `Sorry, an error occurred while generating the quote image.` } }), { headers: { "Content-Type": "application/json" } });
                    }

                } else {
                    console.warn("Unknown command or command type received:", commandData);
                    return new Response(JSON.stringify({ type: 4, data: { content: "Unknown command." } }), { headers: { "Content-Type": "application/json" } });
                }
            }
        default:
            return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
    }
});
