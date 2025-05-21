// register_commands.ts
async function register() {
    const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
    const DISCORD_CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID");

    if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
        return new Response("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID env vars for command registration.", { status: 500 });
    }

    const commands = [
        {
            name: "ping",
            description: "Replies with Pong!",
            type: 1 // CHAT_INPUT
        },
        {
            name: "Quote Message", // Name for the context menu item
            type: 3 // MESSAGE context menu command
        },
        {
            name: "tetris",
            description: "Play a game of Tetris!",
            type: 1, // CHAT_INPUT
            options: [
                {
                    name: "allow_others_to_control",
                    description: "Allow other users to control your game (default: false)",
                    type: 5, // BOOLEAN type
                    required: false
                }
            ]
        }
    ];

    const DISCORD_API_BASE = "https://discord.com/api/v10";
    const url = `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`;

    try {
        const response = await fetch(url, {
            method: "PUT",
            headers: {
                "Authorization": `Bot ${DISCORD_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(commands)
        });

        if (response.ok) {
            const data = await response.json();
            return new Response(`Successfully registered commands: ${JSON.stringify(data, null, 2)}`, {
                headers: { "Content-Type": "application/json" }
            });
        } else {
            return new Response(`Failed to register commands: ${response.status} - ${await response.text()}`, {
                status: response.status
            });
        }
    } catch (error: any) {
        return new Response(`Error during command registration: ${error.message}`, { status: 500 });
    }
}

Deno.serve(async (req) => {
    if (req.method !== "GET") {
        return new Response("Method Not Allowed. Use GET to trigger command registration.", { status: 405 });
    }
    // Automatically run registration when GET request is made
    return await register();
});

console.log("Command registration server running. Access via GET to register commands.");
// To register commands immediately if run directly (e.g. `deno run --allow-env --allow-net register_commands.ts`):
// if (import.meta.main) {
//   console.log("Running command registration directly...");
//   const res = await register();
//   console.log(await res.text());
// }
