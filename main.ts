// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
// Ensure this resvg_wasm version and URL are correct and accessible for your Deno Deploy environment.
// Using v0.2.0 as per previous discussions. Adjust if needed.
import initRsvg, { Resvg } from "https://deno.land/x/resvg_wasm@v0.2.0/mod.js";

const rsvgWasmUrl = new URL("https://deno.land/x/resvg_wasm@v0.2.0/resvg_wasm_bg.wasm");
let rsvgInitialized = false;
async function initializeRsvg() {
    if (rsvgInitialized) return;
    try {
        const wasmResponse = await fetch(rsvgWasmUrl);
        if (!wasmResponse.ok) {
            throw new Error(`Failed to fetch resvg WASM (${rsvgWasmUrl}): ${wasmResponse.status} ${await wasmResponse.text()}`);
        }
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
            case '\'': return '''; // THIS LINE MUST BE EXACTLY THIS
            case '"': return '"';
            default: return c;
        }
    });
}

// Helper function for text wrapping (simplified for SVG)
function wrapSvgText(text: string, maxWidth: number, charWidthEstimate: number): string[] {
    if (!text) return [];
    const lines: string[] = [];
    const charsPerLine = Math.max(1, Math.floor(maxWidth / charWidthEstimate));

    let currentLine = "";
    const words = text.split(' ');

    for (const word of words) {
        if (currentLine.length === 0) {
            currentLine = word;
        } else if ((currentLine + " " + word).length <= charsPerLine) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
        while (currentLine.length > charsPerLine) {
            lines.push(currentLine.substring(0, charsPerLine));
            currentLine = currentLine.substring(charsPerLine);
        }
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    return lines;
}


async function createImageForQuote(message: any): Promise<{ imageBuffer: Uint8Array, fileName: string }> {
    if (!rsvgInitialized) {
      console.warn("resvg not initialized prior to createImageForQuote, attempting now...");
      await initializeRsvg();
      if (!rsvgInitialized) {
          throw new Error("Failed to initialize resvg for image creation after lazy attempt.");
      }
    }

    const author = message.author;
    const content = message.content || " ";
    const avatarHash = author.avatar;
    const userId = author.id;
    const username = author.global_name || author.username;

    const avatarSize = 96;
    const avatarUrl = avatarHash ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=${avatarSize}` : null;
    let avatarBase64 = "";

    if (avatarUrl) {
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
        }
    }

    const sidePadding = 20;
    const topBottomPadding = 20;
    const avatarTextGap = 15;
    const textInnerPadding = 15;

    const fontSize = 18;
    const usernameFontSize = 16;
    const lineHeight = fontSize * 1.4;
    const usernameLineHeight = usernameFontSize * 1.4;
    const maxTextContentWidth = 350;

    const charWidthEstimate = fontSize * 0.55;
    const usernameCharWidthEstimate = usernameFontSize * 0.55;

    const wrappedUsernameLines = wrapSvgText(username, maxTextContentWidth, usernameCharWidthEstimate);
    const wrappedContentLines = wrapSvgText(content, maxTextContentWidth, charWidthEstimate);

    const usernameBlockHeight = wrappedUsernameLines.length * usernameLineHeight;
    const contentBlockHeight = wrappedContentLines.length * lineHeight;
    const gapBetweenUserAndContent = (wrappedUsernameLines.length > 0 && wrappedContentLines.length > 0) ? 8 : 0;
    const textBlockHeight = usernameBlockHeight + gapBetweenUserAndContent + contentBlockHeight;

    const textContainerMinHeight = avatarBase64 ? avatarSize : (usernameBlockHeight + contentBlockHeight + gapBetweenUserAndContent);
    const textContainerActualHeight = Math.max(textContainerMinHeight, textBlockHeight);
    const textContainerPaddedHeight = textContainerActualHeight + 2 * textInnerPadding;
    
    let dynamicTextContentWidth = 0;
    wrappedUsernameLines.forEach(line => dynamicTextContentWidth = Math.max(dynamicTextContentWidth, line.length * usernameCharWidthEstimate));
    wrappedContentLines.forEach(line => dynamicTextContentWidth = Math.max(dynamicTextContentWidth, line.length * charWidthEstimate));
    dynamicTextContentWidth = Math.min(maxTextContentWidth, Math.max(50, dynamicTextContentWidth));


    const textContainerWidth = dynamicTextContentWidth + 2 * textInnerPadding;

    const imageWidth = sidePadding + (avatarBase64 ? avatarSize + avatarTextGap : 0) + textContainerWidth + sidePadding;
    const imageHeight = topBottomPadding + textContainerPaddedHeight + topBottomPadding;

    let svgString = `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`;
    svgString += `<style>
        .username { font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-weight: bold; font-size: ${usernameFontSize}px; fill: #FFFFFF; }
        .content { font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: ${fontSize}px; fill: #E0E0E0; white-space: pre-wrap; }
    </style>`;
    svgString += `<rect width="100%" height="100%" fill="#23272A"/>`;

    const avatarX = sidePadding;
    const avatarY = topBottomPadding + (textContainerPaddedHeight - avatarSize) / 2;

    if (avatarBase64) {
        svgString += `<defs><clipPath id="avatarClip"><circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2}"/></clipPath></defs>`;
        svgString += `<image xlink:href="data:image/png;base64,${avatarBase64}" x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" clip-path="url(#avatarClip)"/>`;
    }

    const textContainerX = sidePadding + (avatarBase64 ? avatarSize + avatarTextGap : 0);
    const textContainerY = topBottomPadding;

    svgString += `<rect x="${textContainerX}" y="${textContainerY}" width="${textContainerWidth}" height="${textContainerPaddedHeight}" fill="rgba(0,0,0,0.55)" rx="8" ry="8"/>`;

    let currentTextY = textContainerY + textInnerPadding;

    if (wrappedUsernameLines.length > 0) {
        currentTextY += usernameFontSize; 
        for (const line of wrappedUsernameLines) {
            svgString += `<text x="${textContainerX + textInnerPadding}" y="${currentTextY}" class="username">${escapeXml(line)}</text>`;
            currentTextY += usernameLineHeight;
        }
    }

    currentTextY += gapBetweenUserAndContent;
    
    if (wrappedContentLines.length > 0) {
        if (wrappedUsernameLines.length === 0 && wrappedContentLines.length > 0) { 
            currentTextY += fontSize;
        } else if (wrappedUsernameLines.length > 0 && wrappedContentLines.length > 0) {
             currentTextY += fontSize;
        }


        for (const line of wrappedContentLines) {
            svgString += `<text x="${textContainerX + textInnerPadding}" y="${currentTextY}" class="content">${escapeXml(line)}</text>`;
            currentTextY += lineHeight;
        }
    }

    svgString += `</svg>`;

    try {
        const resvg = new Resvg(svgString, {
            font: {
                loadSystemFonts: false, 
                defaultFontFamily: "Noto Sans",
            },
        });
        const pngData = resvg.render();
        const imageBuffer = pngData.asPng();
        return { imageBuffer, fileName: "quote.png" };
    } catch (e) {
        console.error("Error rendering SVG with resvg:", e);
        console.error("SVG Content that failed (first 500 chars):", svgString.substring(0, 500));
        throw new Error(`Failed to render quote image using resvg: ${e.message}`);
    }
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
        console.warn("Invalid Discord signature received.");
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

                if (commandData.type === 1 && commandName === "ping") { 
                    return new Response(JSON.stringify({ type: 4, data: { content: "Pong!" } }), { headers: { "Content-Type": "application/json" } });
                } else if (commandData.type === 3 && commandName === "Quote Message") { 
                    const targetMessageId = commandData.target_id;
                    const messages = commandData.resolved?.messages;
                    const targetMessage = messages?.[targetMessageId];

                    if (!targetMessage) {
                        console.error("Target message not found in resolved data:", JSON.stringify(commandData.resolved));
                        return new Response(JSON.stringify({ type: 4, data: { content: "Could not find the target message data." } }), { headers: { "Content-Type": "application/json" } });
                    }
                    
                    try {
                        const { imageBuffer, fileName } = await createImageForQuote(targetMessage);

                        const formData = new FormData();
                        const payloadJson = {
                            type: 4, 
                            data: {
                                attachments: [{
                                    id: "0", 
                                    filename: fileName,
                                    description: `Quote of a message by ${targetMessage.author.global_name || targetMessage.author.username}`
                                }]
                            }
                        };
                        formData.append("payload_json", JSON.stringify(payloadJson));
                        formData.append("files[0]", new Blob([imageBuffer], { type: "image/png" }), fileName);
                        
                        return new Response(formData);

                    } catch (error: any) {
                        console.error("Error processing 'Quote Message' command:", error.stack || error.message);
                        return new Response(JSON.stringify({ type: 4, data: { content: `Sorry, an error occurred while generating the quote: ${error.message}` } }), { headers: { "Content-Type": "application/json" } });
                    }

                } else {
                    console.warn("Unknown command or command type received:", commandData);
                    return new Response(JSON.stringify({ type: 4, data: { content: "Unknown command." } }), { headers: { "Content-Type": "application/json" } });
                }
            }
        default:
            console.warn("Unknown interaction type received:", interaction.type);
            return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
    }
});

(async () => {
    try {
        await initializeRsvg();
    } catch (e) {
        console.error("Top-level resvg initialization failed. The bot may not generate images correctly.", e);
    }
})();
