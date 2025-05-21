// main.ts - The truly fastest Discord bot handler on Deno Deploy (Web-only setup)

// nacl for Discord signature verification (CRITICAL for security).
import nacl from "https://cdn.skypack.dev/tweetnacl@1.0.3";

// Helper to convert hex strings to Uint8Arrays for nacl verification.
function hexToUint8Array(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

// Get your Discord Public Key from Deno Deploy's environment variables.
// DO NOT hardcode your public key here!
const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY");

if (!DISCORD_PUBLIC_KEY) {
    console.error("ERROR: DISCORD_PUBLIC_KEY environment variable is not set.");
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
}

// Start the Deno HTTP server using the native Deno.serve() function.
// This is the fastest way to handle incoming requests in Deno.
Deno.serve(async (req: Request) => {
    // Only accept POST requests from Discord for interactions.
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    // Verify Discord Signature (CRITICAL SECURITY STEP)
    const signature = req.headers.get("x-signature-ed25519");
    const timestamp = req.headers.get("x-signature-timestamp");
    const body = await req.text(); // Read body as text for verification.

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

    // Parse the Discord Interaction Payload
    const interaction = JSON.parse(body);

    // Handle Interaction Types
    switch (interaction.type) {
        case 1: // PING interaction (Discord sends this to verify your endpoint)
            console.log("Received PING interaction.");
            return new Response(JSON.stringify({ type: 1 }), {
                headers: { "Content-Type": "application/json" },
            });

        case 2: // APPLICATION_COMMAND interaction (e.g., slash commands)
            const commandName = interaction.data.name;
            console.log(`Received command: /${commandName}`);

            if (commandName === "ping") {
                return new Response(
                    JSON.stringify({
                        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE (send a message)
                        data: {
                            content: "Pong!", // The message content
                        },
                    }),
                    {
                        headers: { "Content-Type": "application/json" },
                    }
                );
            } else {
                return new Response(
                    JSON.stringify({
                        type: 4,
                        data: { content: "Unknown command." },
                    }),
                    {
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }

        default: // Unknown interaction type
            console.warn(`Received unknown interaction type: ${interaction.type}`);
            return new Response("Bad Request: Unknown Interaction Type", { status: 400 });
    }
});

console.log("Discord bot main server handler initialized.");
