// main.ts
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";
import { renderAsync } from "https://deno.land/x/resvg_wasm@v2.6.0/mod.ts"; // SVG to PNG
import React from "https://esm.sh/react@18.2.0"; // Satori dependency
import satori from "https://esm.sh/satori@0.10.13"; // SVG generation from HTML/JSX
import { Buffer } from "https://deno.land/std@0.208.0/io/buffer.ts"; // To handle image buffer

function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

// Cache for fetched fonts to improve performance on subsequent calls
const fontCache = new Map<string, ArrayBuffer>();

async function getFont(url: string): Promise<ArrayBuffer> {
    if (fontCache.has(url)) {
        return fontCache.get(url)!;
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch font: ${url} - ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fontCache.set(url, arrayBuffer);
    return arrayBuffer;
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
        case 1: // Ping
            return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });

        case 2: // Application Command
            const commandData = interaction.data;
            const commandName = commandData.name;

            // Type 1: Chat Input Command (e.g., /ping)
            if (commandData.type === 1 && commandName === "ping") {
                return new Response(JSON.stringify({ type: 4, data: { content: "Pong!" } }), { headers: { "Content-Type": "application/json" } });
            }
            // Type 3: Message Context Menu Command
            else if (commandData.type === 3 && commandName === "Quote Message") {
                const targetMessageId = commandData.target_id;
                const resolvedMessages = commandData.resolved?.messages;
                const messageToQuote = resolvedMessages?.[targetMessageId];

                if (!messageToQuote) {
                    console.error("Resolved messages or target message not found:", commandData.resolved);
                    return new Response(JSON.stringify({ type: 4, data: { content: "Could not find the message to quote." } }), { headers: { "Content-Type": "application/json" } });
                }

                const author = messageToQuote.author;
                let messageContent = messageToQuote.content || "";
                if (messageToQuote.attachments && messageToQuote.attachments.length > 0) {
                    if (messageContent) messageContent += "\n";
                    messageContent += `[${messageToQuote.attachments.length} attachment(s)]`;
                }
                if (!messageContent && (!messageToQuote.attachments || messageToQuote.attachments.length === 0)) {
                    messageContent = "[No textual content]";
                }


                const authorName = author.global_name || author.username;
                let avatarUrl = `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=128`;
                if (!author.avatar) {
                    const defaultAvatarIndex = (BigInt(author.id) >> 22n) % 6n;
                    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
                }

                try {
                    const avatarResponse = await fetch(avatarUrl);
                    if (!avatarResponse.ok) throw new Error(`Failed to fetch avatar (status: ${avatarResponse.status})`);
                    const avatarArrayBuffer = await avatarResponse.arrayBuffer();
                    const avatarBase64 = `data:${avatarResponse.headers.get("content-type") || "image/png"};base64,${btoa(String.fromCharCode(...new Uint8Array(avatarArrayBuffer)))}`;

                    const whitneyMediumFont = await getFont("https://cdn.jsdelivr.net/gh/discord/discord-font@master/Whitney-Medium.woff");
                    const whitneySemiboldFont = await getFont("https://cdn.jsdelivr.net/gh/discord/discord-font@master/Whitney-Semibold.woff");

                    const svg = await satori(
                        React.createElement(
                            "div",
                            {
                                style: {
                                    display: "flex",
                                    flexDirection: "column", // Stack elements vertically
                                    width: 550,
                                    padding: 20,
                                    backgroundColor: "#313338", // Discord dark theme background
                                    borderRadius: 8,
                                    fontFamily: "'Whitney'", // Ensure Satori uses this
                                    color: "#DBDEE1", // Default text color
                                },
                            },
                            // Author and Timestamp row
                            React.createElement(
                                "div",
                                {
                                    style: {
                                        display: "flex",
                                        alignItems: "center",
                                        marginBottom: 10,
                                    }
                                },
                                React.createElement("img", {
                                    src: avatarBase64,
                                    width: 40,
                                    height: 40,
                                    style: { borderRadius: "50%", marginRight: 10 },
                                }),
                                React.createElement(
                                    "div",
                                    {
                                        style: {
                                            display: "flex",
                                            flexDirection: "column",
                                        }
                                    },
                                    React.createElement(
                                        "span",
                                        {
                                            style: {
                                                fontSize: 16,
                                                fontWeight: "600", // Semibold
                                                color: "#F2F3F5", // Brighter name color
                                                fontFamily: "'Whitney'",
                                            },
                                        },
                                        authorName
                                    ),
                                     React.createElement(
                                        "span",
                                        {
                                            style: {
                                                fontSize: 12,
                                                color: "#949BA4", // Timestamp color
                                                fontFamily: "'Whitney'",
                                            },
                                        },
                                        new Date(messageToQuote.timestamp).toLocaleString()
                                    )
                                )
                            ),
                            // Message content area
                            React.createElement(
                                "div",
                                {
                                    style: {
                                        backgroundColor: "rgba(0, 0, 0, 0.15)", // Slightly darker, less transparent
                                        padding: "10px 12px",
                                        borderRadius: 6,
                                        fontSize: 15,
                                        lineHeight: "1.4",
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                        fontFamily: "'Whitney'",
                                        maxHeight: 300, // Max height for content
                                        overflowY: "auto", // Scroll if content overflows
                                    },
                                },
                                messageContent
                            )
                        ),
                        {
                            width: 550,
                            // height is auto-calculated by Satori
                            fonts: [
                                { name: "Whitney", data: whitneyMediumFont, weight: 400, style: "normal" },
                                { name: "Whitney", data: whitneySemiboldFont, weight: 600, style: "normal" },
                            ],
                        }
                    );

                    const pngData = await renderAsync(svg, {
                        // Resvg wasm might need font data if Satori's SVG doesn't fully embed them for all renderers
                        // For now, assuming Satori's output is sufficient. If text is missing, revisit this.
                    });
                    const pngBuffer = new Buffer(pngData.bytes());

                    const formData = new FormData();
                    formData.append("payload_json", JSON.stringify({
                        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                        // data: { content: `Quoted message from ${authorName}:` } // Optional: add some text content
                    }));
                    formData.append("files[0]", new Blob([pngBuffer.bytes()], { type: "image/png" }), "quote.png");

                    return new Response(formData); // Deno Deploy handles FormData response

                } catch (error) {
                    console.error("Error generating quote image:", error);
                    return new Response(JSON.stringify({ type: 4, data: { content: `Sorry, I couldn't generate the quote image. ${error.message}` } }), { headers: { "Content-Type": "application/json" } });
                }

            } else {
                return new Response(JSON.stringify({ type: 4, data: { content: "Unknown command." } }), { headers: { "Content-Type": "application/json" } });
            }
            break;

        default:
            return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
    }
});

console.log("Discord bot server running with quote feature!");
