// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
import initRsvg, { Resvg } from "https://deno.land/x/resvg_wasm@v0.2.0/mod.js";

// Initialize resvg-wasm. This is crucial.
// It needs to fetch the resvg_wasm_bg.wasm file.
const rsvgWasmUrl = new URL("https://deno.land/x/resvg_wasm@v0.2.0/resvg_wasm_bg.wasm");
let rsvgInitialized = false;
async function initializeRsvg() {
    if (rsvgInitialized) return;
    try {
        const wasmResponse = await fetch(rsvgWasmUrl);
        const wasmBinary = await wasmResponse.arrayBuffer();
        await initRsvg(wasmBinary);
        rsvgInitialized = true;
        console.log("resvg-wasm initialized successfully.");
    } catch (e) {
        console.error("Error initializing resvg-wasm:", e);
        throw e;
    }
}

function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

// Helper to escape XML special characters for SVG text
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

// Helper function for text wrapping (simplified for SVG)
function wrapSvgText(text: string, maxWidth: number, charWidthEstimate: number): string[] {
    if (!text) return [];
    const lines: string[] = [];
    const charsPerLine = Math.floor(maxWidth / charWidthEstimate);
    if (charsPerLine <=0) return [text]; // Avoid infinite loop if maxWidth is too small

    let currentLine = "";
    const words = text.split(' ');

    for (const word of words) {
        if ((currentLine + " " + word).length > charsPerLine && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            if (currentLine.length > 0) {
                currentLine += " " + word;
            } else {
                currentLine = word;
            }
        }
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    return lines;
}


async function createImageForQuote(message: any): Promise<{ imageBuffer: Uint8Array, fileName: string }> {
    await initializeRsvg(); // Ensure resvg is initialized

    const author = message.author;
    const content = message.content || " ";
    const avatarHash = author.avatar;
    const userId = author.id;
    const username = author.username;

    const avatarSize = 96;
    const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=${avatarSize}`;
    let avatarBase64 = "";

    try {
        const avatarRes = await fetch(avatarUrl);
        if (!avatarRes.ok) throw new Error(`Failed to fetch avatar: ${avatarRes.status}`);
        const avatarBuffer = await avatarRes.arrayBuffer();
        const u8Array = new Uint8Array(avatarBuffer);
        let binaryString = '';
        for (let i = 0; i < u8Array.length; i++) {
            binaryString += String.fromCharCode(u8Array[i]);
        }
        avatarBase64 = btoa(binaryString);
    } catch (e) {
        console.warn("Failed to load avatar, will omit from image:", e.message);
        // You could create a placeholder SVG/Base64 string here if desired
    }

    const sidePadding = 15;
    const topBottomPadding = 15;
    const avatarTextGap = 10;
    const textInnerPadding = 10;

    const fontSize = 16;
    const usernameFontSize = 14;
    const lineHeight = fontSize * 1.3;
    const usernameLineHeight = usernameFontSize * 1.3;
    const maxTextContentWidth = 300; // Max width for the text itself

    // Estimate character width (very rough, depends on font)
    const charWidthEstimate = fontSize * 0.6;
    const usernameCharWidthEstimate = usernameFontSize * 0.6;

    const wrappedUsernameLines = wrapSvgText(username, maxTextContentWidth, usernameCharWidthEstimate);
    const wrappedContentLines = wrapSvgText(content, maxTextContentWidth, charWidthEstimate);

    const usernameBlockHeight = wrappedUsernameLines.length * usernameLineHeight;
    const contentBlockHeight = wrappedContentLines.length * lineHeight;
    const gapBetweenUserAndContent = (wrappedUsernameLines.length > 0 && wrappedContentLines.length > 0) ? 5 : 0;
    const textBlockHeight = usernameBlockHeight + gapBetweenUserAndContent + contentBlockHeight;

    const textContainerContentHeight = Math.max(avatarBase64 ? avatarSize : 0, textBlockHeight);
    const textContainerHeight = textContainerContentHeight + 2 * textInnerPadding;
    
    // Calculate actual text width based on lines (still an estimate without proper text metrics)
    let maxLineLength = 0;
    wrappedUsernameLines.forEach(line => maxLineLength = Math.max(maxLineLength, line.length));
    wrappedContentLines.forEach(line => maxLineLength = Math.max(maxLineLength, line.length));
    
    const estimatedTextWidth = Math.min(maxTextContentWidth, maxLineLength * charWidthEstimate);
    const textContainerWidth = estimatedTextWidth + 2 * textInnerPadding;


    const imageWidth = sidePadding + (avatarBase64 ? avatarSize + avatarTextGap : 0) + textContainerWidth + sidePadding;
    const imageHeight = topBottomPadding + textContainerHeight + topBottomPadding;

    let svgString = `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`;
    svgString += `<style>
        .username { font: bold ${usernameFontSize}px sans-serif; fill: #FFFFFF; }
        .content { font: ${fontSize}px sans-serif; fill: #DDDDDD; }
    </style>`;
    svgString += `<rect width="100%" height="100%" fill="#2C2F33"/>`; // Base dark background

    const avatarX = sidePadding;
    const avatarY = topBottomPadding + (textContainerHeight - avatarSize) / 2;

    if (avatarBase64) {
        svgString += `<defs><clipPath id="avatarClip"><circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2}"/></clipPath></defs>`;
        svgString += `<image xlink:href="data:image/png;base64,${avatarBase64}" x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" clip-path="url(#avatarClip)"/>`;
    }

    const textContainerX = sidePadding + (avatarBase64 ? avatarSize + avatarTextGap : 0);
    const textContainerY = topBottomPadding;

    svgString += `<rect x="${textContainerX}" y="${textContainerY}" width="${textContainerWidth}" height="${textContainerHeight}" fill="rgba(0,0,0,0.5)"/>`;

    let currentTextY = textContainerY + textInnerPadding;

    if (wrappedUsernameLines.length > 0) {
        currentTextY += usernameFontSize; // Adjust for baseline
        for (const line of wrappedUsernameLines) {
            svgString += `<text x="${textContainerX + textInnerPadding}" y="${currentTextY}" class="username">${escapeXml(line)}</text>`;
            currentTextY += usernameLineHeight;
        }
    }

    currentTextY += gapBetweenUserAndContent;
    if (wrappedUsernameLines.length > 0 && wrappedContentLines.length > 0) {
         // currentTextY += usernameLineHeight; // Already added
    }


    if (wrappedContentLines.length > 0) {
        currentTextY += fontSize; // Adjust for baseline
        for (const line of wrappedContentLines) {
            svgString += `<text x="${textContainerX + textInnerPadding}" y="${currentTextY}" class="content">${escapeXml(line)}</text>`;
            currentTextY += lineHeight;
        }
    }

    svgString += `</svg>`;

    try {
        const resvg = new Resvg(svgString, {
            fitTo: { mode: 'original' }, // Use original size from SVG
            font: {
                // Deno Deploy might not have many fonts. Stick to sans-serif or load custom ones if resvg supports it.
                // For simplicity, we rely on system sans-serif.
                // loadSystemFonts: false, // Set to true if you want to try and load system fonts, but might be inconsistent.
                // defaultFontFamily: "sans-serif", // Already default in browsers/SVG
            }
        });
        const pngData = resvg.render();
        const imageBuffer = pngData.asPng();
        return { imageBuffer, fileName: "quote.png" };
    } catch (e) {
        console.error("Error rendering SVG with resvg:", e);
        console.error("SVG Content:", svgString); // Log the SVG for debugging
        throw new Error("Failed to render quote image using resvg.");
    }
}


Deno.serve(async (req: Request) => {
    // Ensure rsvg is initialized before handling requests that might need it.
    // Doing it once at the start or lazily before first use.
    // For Deno Deploy, top-level await for initializeRsvg() might be an option if your entry point allows.
    // Or ensure it's called before any image generation.
    // Here, we call it inside createImageForQuote, which is lazy.

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
                    
                    // Acknowledge interaction first (defer) if image generation might be slow
                    // For potentially >3s operations, a deferral (type 5) is needed.
                    // Here we'll try to send it directly. If it times out, add deferral.
                    // return new Response(JSON.stringify({ type: 5 }), { headers: { "Content-Type": "application/json" } });
                    // And then use fetch to PATCH followup to interaction.application_id/token/messages/@original

                    try {
                        const { imageBuffer, fileName } = await createImageForQuote(targetMessage);

                        const formData = new FormData();
                        const payloadJson = {
                            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                            data: {
                                // content: "Here's your quote:", // Optional content
                                attachments: [{
                                    id: "0", // Client-side ID for the attachment
                                    filename: fileName,
                                    description: `Quote of a message by ${targetMessage.author.username}`
                                }]
                            }
                        };
                        formData.append("payload_json", JSON.stringify(payloadJson));
                        formData.append("files[0]", new Blob([imageBuffer], { type: "image/png" }), fileName);
                        
                        // This is a direct response. If it takes >3s, Discord will show "interaction failed".
                        return new Response(formData); // Deno's server handles FormData to multipart

                    } catch (error: any) {
                        console.error("Error processing 'Quote Message' command:", error.stack || error.message);
                        // If you deferred, you'd PATCH the followup with an error message.
                        // For direct response, send an error message like this:
                        return new Response(JSON.stringify({ type: 4, data: { content: `Sorry, an error occurred while generating the quote image: ${error.message}` } }), { headers: { "Content-Type": "application/json" } });
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

// Top-level await to initialize rsvg when the module loads.
// This is generally better for Deno Deploy.
(async () => {
    await initializeRsvg();
})();
