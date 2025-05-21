// main.ts (TEMPORARY - NO IMAGE GENERATION)
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";

function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");
if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
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
                const targetMessageId = commandData.target_id;
                const message = commandData.resolved.messages[targetMessageId];

                if (!message) {
                    return new Response(
                        JSON.stringify({ type: 4, data: { content: "Could not find the message to quote." } }),
                        { headers: { "Content-Type": "application/json" } }
                    );
                }
                // Placeholder response instead of image
                return new Response(
                    JSON.stringify({ type: 4, data: { content: `Quoting message ID: ${message.id} by ${message.author.username}. Image generation disabled for testing.` } }),
                    { headers: { "Content-Type": "application/json" } }
                );

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
