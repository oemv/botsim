// register_commands.ts
Deno.serve(async (req: Request) => {
    if (req.method !== "GET") {
        return new Response("Method Not Allowed. Use GET to trigger command registration.", { status: 405 });
    }

    const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
    const DISCORD_CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID");

    if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
        return new Response("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID env vars for command registration.", { status: 500 });
    }

    const commands = [
        {
            name: "ping",
            description: "Replies with Pong!",
            type: 1, // CHAT_INPUT
        },
        {
            name: "doom",
            description: "Starts a mini Doom-style emoji shooter game!",
            type: 1, // CHAT_INPUT
        },
    ];

    const DISCORD_API_BASE = "https://discord.com/api/v10";
    const url = `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`;

    try {
        const response = await fetch(url, {
            method: "PUT",
            headers: {
                "Authorization": `Bot ${DISCORD_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(commands),
        });

        if (response.ok) {
            return new Response(`Successfully registered commands: ${JSON.stringify(await response.json(), null, 2)}`, {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(`Failed to register commands: ${response.status} - ${await response.text()}`, {
                status: response.status,
            });
        }
    } catch (error: any) {
        return new Response(`Error during command registration: ${error.message}`, { status: 500 });
    }
});
