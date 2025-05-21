// register_commands.ts - Deployed to Deno Deploy for one-time command registration.
// Visit this deployment's URL in your browser ONCE to trigger command registration.

// Deno.serve() makes this a web endpoint that can be triggered by visiting its URL.
Deno.serve(async (req) => {
    // Only allow GET requests to trigger registration for simplicity.
    if (req.method !== "GET") {
        return new Response("Method Not Allowed. Use GET to trigger command registration.", { status: 405 });
    }

    // Get environment variables for Discord API access.
    // These MUST be set in this Deno Deploy project's settings.
    const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
    const DISCORD_CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID");

    if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
        const errorMsg = "Missing DISCORD_TOKEN or DISCORD_CLIENT_ID environment variables. Please set them in Deno Deploy project settings for this deployment.";
        console.error(errorMsg);
        return new Response(errorMsg, { status: 500 });
    }

    // Define the slash commands your bot will have.
    const commands = [
        {
            name: "ping",
            description: "Replies with Pong!",
            type: 1, // CHAT_INPUT (a standard slash command)
        },
    ];

    // Discord API endpoint for application commands.
    const DISCORD_API_BASE = "https://discord.com/api/v10";
    const url = `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`;

    try {
        const response = await fetch(url, {
            method: "PUT", // Use PUT to overwrite/update all existing commands
            headers: {
                "Authorization": `Bot ${DISCORD_TOKEN}`, // Authenticate with your bot token
                "Content-Type": "application/json",
            },
            body: JSON.stringify(commands), // Send your command definitions
        });

        if (response.ok) {
            const result = await response.json();
            console.log("Successfully registered commands:", result);
            return new Response(`Successfully registered commands: ${JSON.stringify(result, null, 2)}`, {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            const errorText = await response.text();
            console.error("Failed to register commands:", response.status, response.statusText, errorText);
            return new Response(`Failed to register commands: ${response.status} - ${response.statusText} - ${errorText}`, { status: response.status });
        }
    } catch (error: any) {
        console.error("Error during command registration:", error);
        return new Response(`Error during command registration: ${error.message}`, { status: 500 });
    }
});

console.log("Command registration service initialized. Visit its URL to trigger registration.");
