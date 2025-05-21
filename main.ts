// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
import { Image, decode, Font } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

// --- Font Initialization ---
// We'll use Noto Sans, a common and good-looking open-source font.
// We fetch it once when the Deno Deploy instance starts.
const FONT_URL = "https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf";
const ITALIC_FONT_URL = "https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Italic.ttf"; // For the author

let mainFont: Font | null = null;
let italicFont: Font | null = null;
let fontInitializationError: string | null = null;

// Top-level await for font initialization.
(async () => {
    try {
        console.log(`Attempting to fetch and decode font from ${FONT_URL}...`);
        const fontData = await fetch(FONT_URL).then(res => res.arrayBuffer());
        mainFont = decode(fontData) as Font; // Cast to Font
        console.log("Main font decoded successfully!");

        console.log(`Attempting to fetch and decode italic font from ${ITALIC_FONT_URL}...`);
        const italicFontData = await fetch(ITALIC_FONT_URL).then(res => res.arrayBuffer());
        italicFont = decode(italicFontData) as Font;
        console.log("Italic font decoded successfully!");

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
        throw new Error(`Image generation called but font(s) not initialized. Error: ${fontInitializationError || "Unknown font initialization error."}`);
    }

    const bgColor = 0x36393FFF; // Discord dark theme background (RGBA)
    const textColor = 0xDCDDDEFF; // Discord light text for content
    const authorColor = 0xB9BBBEFF; // Discord slightly dimmer text for author

    const padding = 30; // Increased padding
    const contentFontSize = 28; // Increased for better readability
    const authorFontSize = 22;  // Increased for better readability
    const maxTextWidth = 600; // Max width for the text content itself
    const lineSpacingFactor = 1.4; // Multiplier for line height

    // 1. Format quote and author text
    const fullQuoteText = `“${messageContent}”`; // Using better quote marks
    const authorLineText = `— ${authorDisplayName}`;

    // 2. Calculate wrapped lines for the quote content
    // imagescript's measureText needs the font size.
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
    if (currentLine) quoteLines.push(currentLine); // Add the last line

    const contentLineHeight = contentFontSize * lineSpacingFactor;
    const quoteTextHeight = quoteLines.length * contentLineHeight;

    // 3. Calculate author text dimensions
    const authorTextWidth = italicFont.measureWidth(authorLineText, authorFontSize);
    const authorLineHeight = authorFontSize * lineSpacingFactor;

    // 4. Calculate total canvas dimensions
    const totalTextHeight = quoteTextHeight + (authorLineText ? (authorLineHeight + padding / 2) : 0);
    const canvasHeight = Math.ceil(totalTextHeight + 2 * padding);

    let requiredWidth = 0;
    quoteLines.forEach(line => {
        const lineWidth = mainFont.measureWidth(line, contentFontSize);
        if (lineWidth > requiredWidth) requiredWidth = lineWidth;
    });
    if (authorTextWidth > requiredWidth) requiredWidth = authorTextWidth;
    const canvasWidth = Math.ceil(Math.min(maxTextWidth + padding, requiredWidth) + 2 * padding); // Ensure some padding even if text is narrow

    // 5. Create image and draw
    const image = new Image(canvasWidth, canvasHeight);
    image.fill(bgColor);

    let yPos = padding;

    // Draw Quote Content
    for (const line of quoteLines) {
        const textX = (canvasWidth - mainFont.measureWidth(line, contentFontSize)) / 2; // Center each line
        image.print(mainFont, textX, yPos, line, contentFontSize, textColor);
        yPos += contentLineHeight;
    }

    // Draw Author
    if (authorLineText) {
        yPos += padding / 4; // Smaller space before author line
        const authorX = canvasWidth - authorTextWidth - padding; // Align author to the right
        image.print(italicFont, authorX, yPos, authorLineText, authorFontSize, authorColor);
    }

    // 6. Encode to PNG
    const pngData: Uint8Array = await image.encode(0); // 0 for PNG, compression level default
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
