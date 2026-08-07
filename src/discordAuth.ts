const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export function buildAuthorizeUrl(state: string): string {
  const clientId = requiredEnv("DISCORD_CLIENT_ID");
  const redirectUri = requiredEnv("DISCORD_REDIRECT_URI");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const clientId = requiredEnv("DISCORD_CLIENT_ID");
  const clientSecret = requiredEnv("DISCORD_CLIENT_SECRET");
  const redirectUri = requiredEnv("DISCORD_REDIRECT_URI");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`Discord token exchange failed: ${res.status} ${res.statusText} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Discord user fetch failed: ${res.status} ${res.statusText} ${await res.text()}`);
  }

  const json = (await res.json()) as { id: string; username: string; avatar: string | null };
  return { id: json.id, username: json.username, avatar: json.avatar };
}

export async function completeDiscordLogin(code: string): Promise<DiscordUser> {
  const accessToken = await exchangeCodeForToken(code);
  return fetchDiscordUser(accessToken);
}

export function discordAvatarUrl(discordId: string, avatarHash: string | null): string | null {
  if (!avatarHash) return null;
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`;
}
