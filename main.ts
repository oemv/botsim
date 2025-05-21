// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
import { Image, Font } from "https://deno.land/x/imagescript@1.2.17/mod.ts"; // decode removed as Font.render is used

// --- Font Initialization ---
const FONT_URL = "https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf";
const ITALIC_FONT_URL = "https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Italic.ttf";

let mainFont: Font | null = null;
let italicFont: Font | null = null;
let fontInitializationError: string | null = null;

// Top-level await for font initialization.
(async () => {
    try {
        console.log(`Attempting to fetch main font data from ${FONT_URL}...`);
        const mainFontResponse = await fetch(FONT_URL);
        if (!mainFontResponse.ok) {
            throw new Error(`Failed to fetch main font: ${mainFontResponse.status} ${mainFontResponse.statusText}`);
        }
        const mainFontData = await mainFontResponse.arrayBuffer();
        mainFont = Font.render(new Uint8Array(mainFontData)); // Correct way to load font
        console.log("Main font rendered successfully!");

        console.log(`Attempting to fetch italic font data from ${ITALIC_FONT_URL}...`);
        const italicFontResponse = await fetch(ITALIC_FONT_URL);
        if (!italicFontResponse.ok) {
            throw new Error(`Failed to fetch italic font: ${italicFontResponse.status} ${italicFontResponse.statusText}`);
        }
        const italicFontData = await italicFontResponse.arrayBuffer();
        italicFont = Font.render(new Uint8Array(italicFontData)); // Correct way to load font
        console.log("Italic font rendered successfully!");

    } catch (e) {
        console.error("CRITICAL: Failed to initialize font(s) on startup:", e);
        fontInitializationError = e.message || String(e);
    }
})();
// --- End Font Initialization ---


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
    if (!mainFont || !italicFont) {
        // This error will be caught by the command handler and reported to the user.
        throw new Error(`Image generation called but font(s) not initialized. Error: ${fontInitializationError || "Unknown font initialization error."}`);
    }

    const bgColor = 0x36393FFF; // Discord dark theme background (RGBA)
    const textColor = 0xDCDDDEFF; // Discord light text for content
    const authorColor = 0xB9BBBEFF; // Discord slightly dimmer text for author

    const padding = 30;
    const contentFontSize = 28;
    const authorFontSize = 22;
    const maxTextWidth = 600;
    const lineSpacingFactor = 1.4;

    const fullQuoteText = `“${messageContent}”`;
    const authorLineText = `— ${authorDisplayName}`;

    const quoteLines: string[] = [];
    let currentLine = '';
    const words = fullQuoteText.split(' ');

    for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const lineWidth = mainFont.measureWidth(testLine, contentFontSize);
        if (lineWidth > maxTextWidth && currentLine) {
            quoteLines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) quoteLines.push(currentLine);

    const contentLineHeight = contentFontSize * lineSpacingFactor;
    const quoteTextHeight = quoteLines.length * contentLineHeight;

    const authorTextWidth = italicFont.measureWidth(authorLineText, authorFontSize);
    const authorLineHeight = authorFontSize * lineSpacingFactor;

    const totalTextHeight = quoteTextHeight + (authorLineText ? (authorLineHeight + padding / 2) : 0);
    const canvasHeight = Math.ceil(totalTextHeight + 2 * padding);

    let requiredWidth = 0;
    quoteLines.forEach(line => {
        const lineWidth = mainFont.measureWidth(line, contentFontSize);
        if (lineWidth > requiredWidth) requiredWidth = lineWidth;
    });
    if (authorTextWidth > requiredWidth) requiredWidth = authorTextWidth;
    // Ensure canvas has some width even for very short text, and respects maxTextWidth for overall content block
    const canvasWidth = Math.ceil(Math.max(padding * 2 + 50, Math.min(maxTextWidth + 2 * padding, requiredWidth + 2 * padding)));


    const image = new Image(canvasWidth, canvasHeight);
    image.fill(bgColor);

    let yPos = padding;

    for (const line of quoteLines) {
        // Center each line of the quote
        const textX = (canvasWidth - mainFont.measureWidth(line, contentFontSize)) / 2;
        image.print(mainFont, Math.max(padding, textX), yPos, line, contentFontSize, textColor); // Ensure textX doesn't go into padding
        yPos += contentLineHeight;
    }

    if (authorLineText) {
        yPos += padding / 3; // Adjust spacing
        // Right-align the author line, respecting padding
        const authorX = Math.max(padding, canvasWidth - authorTextWidth - padding);
        image.print(italicFont, authorX, yPos, authorLineText, authorFontSize, authorColor);
    }

    const pngData: Uint8Array = await image.encode(0); // 0 for PNG
    return pngData;
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
                if (!mainFont || !italicFont) {
                    console.warn("Quote Message command called, but font(s) not initialized. Startup Error:", fontInitializationError);
                    return new Response(
                        JSON.stringify({
                            type: 4,
                            data: { content: `Sorry, the image generation module is not ready. ${fontInitializationError ? `Font Error: ${fontInitializationError}` : 'Please check logs.'}` }
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
                const member = commandData.resolved?.members?.[author.id];
                const displayName = member?.nick || author.global_name || author.username;
                const messageContent = message.content || "[This message has no text content]";

                try {
                    console.log(`Generating quote using imagescript for: "${messageContent}" by ${displayName}`);
                    const imageBytes = await generateSimpleQuoteImage(
                        displayName,
                        messageContent
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
                                    description: `Quote of message by ${displayName}`
                                }]
                            }
                        })
                    );
                    formData.append("files[0]", new Blob([imageBytes], { type: "image/png" }), "quote.png");
                    
                    console.log("Sending image response (imagescript) for quote.");
                    return new Response(formData);

                } catch (error) {
                    console.error("Error during quote image generation (imagescript) or sending:", error);
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
