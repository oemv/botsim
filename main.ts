// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
// Corrected resvg_wasm import to a generally available version.
// If you found v0.2.0 works, ensure the URL is precise.
// Let's assume v0.2.0 for this fix.
import initRsvg, { Resvg } from "https://deno.land/x/resvg_wasm@v0.2.0/mod.js";

// Initialize resvg-wasm.
// Ensure this URL matches the version of mod.js you are using.
const rsvgWasmUrl = new URL("https://deno.land/x/resvg_wasm@v0.2.0/resvg_wasm_bg.wasm");
let rsvgInitialized = false;
async function initializeRsvg() {
    if (rsvgInitialized) return;
    try {
        const wasmResponse = await fetch(rsvgWasmUrl);
        if (!wasmResponse.ok) {
            throw new Error(`Failed to fetch resvg WASM: ${wasmResponse.status} ${await wasmResponse.text()}`);
        }
        const wasmBinary = await wasmResponse.arrayBuffer();
        await initRsvg(wasmBinary);
        rsvgInitialized = true;
        console.log("resvg-wasm initialized successfully.");
    } catch (e) {
        console.error("Error initializing resvg-wasm:", e);
        throw e; // Re-throw to prevent the bot from starting in a broken state
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
            case '\'': return '''; // Corrected line
            case '"': return '"';
            default: return c;
        }
    });
}

// Helper function for text wrapping (simplified for SVG)
function wrapSvgText(text: string, maxWidth: number, charWidthEstimate: number): string[] {
    if (!text) return [];
    const lines: string[] = [];
    const charsPerLine = Math.max(1, Math.floor(maxWidth / charWidthEstimate)); // Ensure charsPerLine is at least 1

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
        // Handle words longer than charsPerLine
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
      console.warn("resvg not initialized, attempting now...");
      await initializeRsvg(); // Ensure resvg is initialized
      if (!rsvgInitialized) {
          throw new Error("Failed to initialize resvg for image creation.");
      }
    }

    const author = message.author;
    const content = message.content || " "; // Ensure content is not empty or undefined
    const avatarHash = author.avatar;
    const userId = author.id;
    const username = author.global_name || author.username; // Prefer global_name

    const avatarSize = 96;
    // Use .png for potentially animated avatars, though SVG rendering will make it static
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

    const sidePadding = 20; // Increased padding
    const topBottomPadding = 20; // Increased padding
    const avatarTextGap = 15;
    const textInnerPadding = 15;

    const fontSize = 18; // Slightly larger font
    const usernameFontSize = 16;
    const lineHeight = fontSize * 1.4; // Increased line height
    const usernameLineHeight = usernameFontSize * 1.4;
    const maxTextContentWidth = 350;

    const charWidthEstimate = fontSize * 0.55; // Adjusted estimate
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


    let maxLineTextWidth = 0;
    const tempSvgForTextMeasure = `<svg xmlns="http://www.w3.org/2000/svg"><text style="font: bold ${usernameFontSize}px sans-serif;">${escapeXml(wrappedUsernameLines.join(""))}</text><text style="font: ${fontSize}px sans-serif;">${escapeXml(wrappedContentLines.join(""))}</text></svg>`;
    // Note: True text measurement in SVG without rendering is complex. This is a rough approximation.
    // For more accuracy, one might need to render to a tiny canvas or use more sophisticated SVG text metrics.
    // We'll base width on wrapped lines and char estimates primarily.
    
    let dynamicTextContentWidth = 0;
    wrappedUsernameLines.forEach(line => dynamicTextContentWidth = Math.max(dynamicTextContentWidth, line.length * usernameCharWidthEstimate));
    wrappedContentLines.forEach(line => dynamicTextContentWidth = Math.max(dynamicTextContentWidth, line.length * charWidthEstimate));
    dynamicTextContentWidth = Math.min(maxTextContentWidth, dynamicTextContentWidth);


    const textContainerWidth = dynamicTextContentWidth + 2 * textInnerPadding;

    const imageWidth = sidePadding + (avatarBase64 ? avatarSize + avatarTextGap : 0) + textContainerWidth + sidePadding;
    const imageHeight = topBottomPadding + textContainerPaddedHeight + topBottomPadding;

    let svgString = `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`;
    svgString += `<style>
        .username { font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-weight: bold; font-size: ${usernameFontSize}px; fill: #FFFFFF; }
        .content { font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: ${fontSize}px; fill: #E0E0E0; white-space: pre-wrap; }
    </style>`;
    svgString += `<rect width="100%" height="100%" fill="#23272A"/>`; // Discord dark theme background

    const avatarX = sidePadding;
    const avatarY = topBottomPadding + (textContainerPaddedHeight - avatarSize) / 2;

    if (avatarBase64) {
        svgString += `<defs><clipPath id="avatarClip"><circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2}"/></clipPath></defs>`;
        svgString += `<image xlink:href="data:image/png;base64,${avatarBase64}" x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" clip-path="url(#avatarClip)"/>`;
    }

    const textContainerX = sidePadding + (avatarBase64 ? avatarSize + avatarTextGap : 0);
    const textContainerY = topBottomPadding;

    // Semi-transparent background for the text area
    svgString += `<rect x="${textContainerX}" y="${textContainerY}" width="${textContainerWidth}" height="${textContainerPaddedHeight}" fill="rgba(0,0,0,0.55)" rx="8" ry="8"/>`; // Rounded corners

    let currentTextY = textContainerY + textInnerPadding;

    if (wrappedUsernameLines.length > 0) {
        currentTextY += usernameFontSize; // SVG text y is baseline
        for (const line of wrappedUsernameLines) {
            svgString += `<text x="${textContainerX + textInnerPadding}" y="${currentTextY}" class="username">${escapeXml(line)}</text>`;
            currentTextY += usernameLineHeight;
        }
    }

    currentTextY += gapBetweenUserAndContent;
    if (wrappedUsernameLines.length > 0 && wrappedContentLines.length > 0 && gapBetweenUserAndContent > 0) {
        // currentTextY -= usernameLineHeight; // Adjust if gap is purely visual, not for text start
    }


    if (wrappedContentLines.length > 0) {
        if (wrappedUsernameLines.length === 0) currentTextY += fontSize; // Adjust for baseline if no username
        else currentTextY += (fontSize - usernameFontSize); // Adjust based on previous line type

        for (const line of wrappedContentLines) {
            svgString += `<text x="${textContainerX + textInnerPadding}" y="${currentTextY}" class="content">${escapeXml(line)}</text>`;
            currentTextY += lineHeight;
        }
    }

    svgString += `</svg>`;

    try {
        const resvg = new Resvg(svgString, {
            // Removed fitTo to use the explicit width/height from SVG root
            font: {
                loadSystemFonts: false, // Important for Deno Deploy consistency
                defaultFontFamily: "Noto Sans", // A common sans-serif font
                // You can bundle .ttf files with your deployment and provide them here if needed:
                // fontFiles: ["./path/to/your/font.ttf"]
            },
            // logLevel: "debug" // For more verbose output from resvg if needed
        });
        const pngData = resvg.render();
        const imageBuffer = pngData.asPng();
        return { imageBuffer, fileName: "quote.png" };
    } catch (e) {
        console.error("Error rendering SVG with resvg:", e);
        console.error("SVG Content that failed:", svgString);
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
                    
                    // For potentially >3s operations, a deferral (type 5) is needed.
                    // Then you'd use fetch to PATCH followup to:
                    // `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`
                    // For now, we attempt a direct response. If it times out, implement deferral.

                    try {
                        const { imageBuffer, fileName } = await createImageForQuote(targetMessage);

                        const formData = new FormData();
                        const payloadJson = {
                            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                            data: {
                                // content: "Here's your quote:", // Optional content
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

// Initialize resvg when the module loads.
(async () => {
    try {
        await initializeRsvg();
    } catch (e) {
        console.error("Top-level resvg initialization failed. The bot might not be able to generate images.", e);
        // Depending on how critical image generation is, you might want to exit or handle this.
        // For Deno Deploy, the process will likely restart if it crashes here.
    }
})();
