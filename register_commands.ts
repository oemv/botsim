// register_commands.ts
Deno.serve(async (req) => {
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
            type: 1 // CHAT_INPUT (slash command)
        },
        {
            name: "Quote Message", // This name appears in the context menu
            type: 3 // MESSAGE context menu command
            // No description or options needed for message context menu commands
        }
    ];

    const DISCORD_API_BASE = "https://discord.com/api/v10";
    const url = `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`;

    console.log("Attempting to register commands:", JSON.stringify(commands));

    try {
        const response = await fetch(url, {
            method: "PUT",
            headers: {
                "Authorization": `Bot ${DISCORD_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(commands)
        });

        const responseBody = await response.text(); // Read body once

        if (response.ok) {
            console.log("Successfully registered commands:", responseBody);
            return new Response(`Successfully registered commands: ${responseBody}`, { headers: { "Content-Type": "application/json" } });
        } else {
            console.error(`Failed to register commands: ${response.status} - ${responseBody}`);
            return new Response(`Failed to register commands: ${response.status} - ${responseBody}`, { status: response.status });
        }
    } catch (error: any) {
        console.error(`Error during command registration: ${error.message}`);
        return new Response(`Error during command registration: ${error.message}`, { status: 500 });
    }
});
