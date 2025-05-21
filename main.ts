// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
import { initWasm as initResvgWasm, Resvg } from "https://esm.sh/@resvg/resvg-js@2.6.2"; // Using a slightly newer version

// Initialize Resvg WASM at the top level. This is crucial.
// Deno Deploy supports top-level await.
const resvgWasmUrl = "https://esm.sh/@resvg/resvg-js@2.6.2/resvg.wasm";
let resvgInitialized = false;
try {
    const wasmResponse = await fetch(resvgWasmUrl);
    if (!wasmResponse.ok) throw new Error(`Failed to fetch resvg.wasm: ${wasmResponse.status}`);
    const wasmBuffer = await wasmResponse.arrayBuffer();
    await initResvgWasm(wasmBuffer);
    resvgInitialized = true;
    console.log("Resvg WASM initialized successfully.");
} catch (e) {
    console.error("Failed to initialize Resvg WASM:", e);
    // If this fails, image generation will not work.
    // The bot will still respond to pings but quote will fail.
}


function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

// Helper to escape XML/SVG special characters
function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '<';
            case '>': return '>';
            case '&': return '&';
            case '\'': return ''';
            case '"': return '"';
            default: return c;
        }
    });
}

// Basic text wrapper for SVG
function wrapText(text: string, maxWidth: number, fontSize: number, lineHeightMultiplier: number, font: string): { lines: string[], height: number } {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";
    const spaceWidth = fontSize * 0.3; // Approximate width of a space

    // This is a very naive way to measure text width.
    // A proper way would use a canvas or font metrics library, but we're avoiding canvas.
    // For monospaced or well-behaved fonts, character count can be a rough proxy.
    // For variable-width fonts, this is very approximate.
    // Let's assume an average character width relative to font size.
    const avgCharWidth = fontSize * 0.55; // Highly dependent on font

    for (const word of words) {
        const potentialLine = currentLine ? currentLine + " " + word : word;
        // Naive width calculation
        if ((potentialLine.length * avgCharWidth) > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = potentialLine;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }
    if (lines.length === 0 && text) lines.push(text); // Handle single very long word or short text
    if (lines.length === 0 && !text) lines.push("[No Content]");


    return {
        lines: lines.map(escapeXml),
        height: lines.length * fontSize * lineHeightMultiplier,
    };
}


async function generateQuoteImageSVG(avatarUrl: string, username: string, messageContent: string): Promise<Uint8Array> {
    if (!resvgInitialized) {
        throw new Error("Resvg WASM not initialized. Cannot generate image.");
    }

    // --- Image constants ---
    const avatarSize = 96;
    const padding = 15;
    const textPadding = 12;
    const authorTextSize = 20;
    const messageTextSize = 18;
    const lineHeightMultiplier = 1.3;
    const maxTextWidth = 450;
    const backgroundColor = "#313338";
    const quoteBoxColor = "rgba(0, 0, 0, 0.5)";
    const authorTextColor = "#FFFFFF";
    const messageTextColor = "#DBDEE1";
    const fontFamily = `"gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`; // Common Discord/system fonts

    // --- Fetch and Base64 encode avatar ---
    let avatarDataUrl = `https://cdn.discordapp.com/embed/avatars/0.png`; // Default
    try {
        const avatarResponse = await fetch(avatarUrl);
        if (avatarResponse.ok) {
            const avatarBuffer = await avatarResponse.arrayBuffer();
            const base64Avatar = btoa(String.fromCharCode(...new Uint8Array(avatarBuffer)));
            const contentType = avatarResponse.headers.get("content-type") || "image/png";
            avatarDataUrl = `data:${contentType};base64,${base64Avatar}`;
        } else {
            console.warn(`Failed to fetch avatar (${avatarResponse.status}), using default.`);
        }
    } catch (e) {
        console.warn("Error fetching avatar, using default:", e);
    }

    // --- Prepare text ---
    const escapedUsername = escapeXml(username);
    const messageWrapped = wrapText(messageContent || "[No Content]", maxTextWidth - (textPadding * 2), messageTextSize, lineHeightMultiplier, fontFamily);

    const authorLineHeight = authorTextSize * lineHeightMultiplier;
    const totalTextHeightInsideQuoteBox = authorLineHeight + messageWrapped.height;
    const quoteBoxContentHeight = textPadding + totalTextHeightInsideQuoteBox + textPadding;

    const quoteBoxHeight = Math.max(avatarSize, quoteBoxContentHeight);
    const imageWidth = padding + avatarSize + padding + maxTextWidth + padding;
    const imageHeight = padding + quoteBoxHeight + padding;

    const quoteBoxX = padding + avatarSize + padding;
    const quoteBoxY = padding;

    // --- Construct SVG ---
    let svg = `<svg width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`;
    svg += `<style>
        .author { font: bold ${authorTextSize}px ${fontFamily}; fill: ${authorTextColor}; }
        .message { font: ${messageTextSize}px ${fontFamily}; fill: ${messageTextColor}; }
    </style>`;
    // Background for the entire image
    svg += `<rect width="100%" height="100%" fill="${backgroundColor}"/>`;

    // Avatar (square, could add clip-path for circle if desired)
    // To make it circular:
    // svg += `<defs><clipPath id="avatarClip"><circle cx="${padding + avatarSize / 2}" cy="${padding + avatarSize / 2 + (quoteBoxHeight - avatarSize) / 2}" r="${avatarSize / 2}" /></clipPath></defs>`;
    // svg += `<image x="${padding}" y="${padding + (quoteBoxHeight - avatarSize) / 2}" width="${avatarSize}" height="${avatarSize}" xlink:href="${avatarDataUrl}" clip-path="url(#avatarClip)" />`;
    svg += `<image x="${padding}" y="${padding + (quoteBoxHeight - avatarSize) / 2}" width="${avatarSize}" height="${avatarSize}" xlink:href="${avatarDataUrl}" />`;


    // Semi-transparent quote box
    svg += `<rect x="${quoteBoxX}" y="${quoteBoxY}" width="${maxTextWidth}" height="${quoteBoxHeight}" fill="${quoteBoxColor}" rx="5" ry="5" />`; // Added rounded corners

    // Author text
    let currentTextY = quoteBoxY + textPadding + authorTextSize; // Baseline for author text
    svg += `<text x="${quoteBoxX + textPadding}" y="${currentTextY}" class="author">${escapedUsername}</text>`;

    // Message text lines
    currentTextY += (authorLineHeight - authorTextSize); // Move to bottom of author line
    currentTextY += (messageTextSize * lineHeightMultiplier * 0.3); // Small gap

    for (const line of messageWrapped.lines) {
        currentTextY += (messageTextSize * lineHeightMultiplier);
        svg += `<text x="${quoteBoxX + textPadding}" y="${currentTextY}" class="message">${line}</text>`;
    }

    svg += `</svg>`;

    // --- Render SVG to PNG ---
    const resvg = new Resvg(svg, {
        // background: backgroundColor, // Already in SVG
        fitTo: {
            mode: 'original',
        },
        font: {
            // resvg-js has some default font fallbacks.
            // For best results, you might load custom fonts if specific ones are needed
            // and not available in its default set (e.g. Noto Sans is often included).
            // For "gg sans", it will likely fallback to a generic sans-serif.
            fontFiles: [], // You can load .ttf/.otf files here if needed
            loadSystemFonts: false, // Deno Deploy doesn't have system fonts in a typical way
            defaultFontFamily: 'sans-serif',
        },
        // logLevel: 'debug', // For troubleshooting SVG rendering
    });

    const pngData = resvg.render();
    return pngData.asPng();
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
                if (!resvgInitialized) {
                     console.error("Quote command received but Resvg is not initialized.");
                     return new Response(JSON.stringify({ type: 4, data: { content: "Sorry, the image generation service is not ready. Please try again in a moment.", flags: 64 /* Ephemeral */ } }), { headers: { "Content-Type": "application/json" } });
                }
                const targetMessageId = appCmdData.target_id;
                const targetMessage = appCmdData.resolved.messages[targetMessageId];

                if (!targetMessage) {
                    console.error("Target message not found in resolved data:", targetMessageId);
                    return new Response(JSON.stringify({ type: 4, data: { content: "Could not find the target message to quote.", flags: 64 /* Ephemeral */ } }), { headers: { "Content-Type": "application/json" } });
                }

                const author = targetMessage.author;
                let avatarUrl: string;
                if (author.avatar) {
                    avatarUrl = `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=128`;
                } else {
                    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${parseInt(author.discriminator) % 5}.png`;
                }

                try {
                    // Respond immediately with a "thinking" state (deferred response)
                    // This is good practice if image generation might take >3s, but for "instant" we try direct.
                    // If it becomes slow, uncomment this and send a followup.
                    // For now, we aim for direct response.

                    const imageBuffer = await generateQuoteImageSVG(avatarUrl, author.username, targetMessage.content);

                    const formData = new FormData();
                    const payload = {
                        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                        data: {
                            attachments: [{
                                id: "0",
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
                return new Response(JSON.stringify({ type: 4, data: { content: "Unknown application command.", flags: 64 /* Ephemeral */ } }), { headers: { "Content-Type": "application/json" } });
            }
        default:
            return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
    }
});
