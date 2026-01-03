import express from "express";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4000;
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI;

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

/* ---------- SESSION MUST LOAD BEFORE ROUTES ---------- */
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax", // allow localhost:3003 → 4000
      secure: false, // MUST be false for http://
    },
  })
);

console.log("REDIRECT URI:", REDIRECT_URI);

console.log("API key loaded:", !!process.env.OPENAI_API_KEY);

/* ------------------------------------------------------
   LINKEDIN OAUTH — LOGIN → CONSENT SCREEN
------------------------------------------------------- */

app.get("/auth/linkedin", (req, res) => {
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&scope=openid%20profile%20w_member_social`;

  res.redirect(authUrl);
});

/* ------------------------------------------------------
   LINKEDIN OAUTH — CALLBACK → GET ACCESS TOKEN
------------------------------------------------------- */

app.get("/auth/linkedin/callback", async (req, res) => {
  const { code, error, error_description } = req.query;

  console.log("OAuth callback query:", req.query);

  if (error) {
    console.error("LinkedIn returned error:", error, error_description);
    return res.status(400).send(error_description);
  }

  try {
    console.log("Exchanging code for token...");

    const tokenRes = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      }
    );

    const data = await tokenRes.json();

    console.log("Token exchange result:", data);

    if (data.error) throw new Error(data.error_description);

    req.session.linkedinAccessToken = data.access_token;
    await req.session.save();

    res.send(`
  <!DOCTYPE html>
  <html>
    <head>
      <title>LinkedIn Connected</title>
      <meta charset="utf-8" />
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
        }
        .box {
          padding: 24px 32px;
          border-radius: 10px;
          border: 1px solid #ddd;
          box-shadow: 0 2px 12px rgba(0,0,0,0.08);
        }
      </style>

      <script>
        setTimeout(() => {
          window.location.href = "http://localhost:3000";
        }, 3000);
      </script>
    </head>

    <body>
      <div class="box">
        <h2>LinkedIn connected successfully</h2>
        <p>You’ll be redirected shortly…</p>
      </div>
    </body>
  </html>
`);
  } catch (err) {
    console.error("OAuth exchange failed:", err);
    res.status(500).send("OAuth failed");
  }
});

/* ------------------------------------------------------
   POST TO LINKEDIN USING SESSION TOKEN
------------------------------------------------------- */

app.post("/api/linkedin-post", async (req, res) => {
  const { text } = req.body;
  const token = req.session.linkedinAccessToken;
  console.log("SESSION TOKEN >>>", req.session.linkedinAccessToken);

  if (!token) {
    return res
      .status(401)
      .json({ error: "Not authorized — connect LinkedIn first." });
  }

  try {
    // Get LinkedIn profile id
    const me = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const profile = await me.json();
    console.log("USERINFO RESPONSE >>>", profile);

    const payload = {
      author: `urn:li:person:${profile.sub}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(await response.text());

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------
   OPENAI ENDPOINT
------------------------------------------------------- */

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/api/ask", async (req, res) => {
  try {
    const { message } = req.body;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert Product Manager assistant...

RULES:
- Begin answers directly with the content.
- Do NOT say "Certainly", "Here are", etc.
- No closing filler text.
- No follow-up questions.`,
        },
        { role: "user", content: message },
      ],
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/* ------------------------------------------------------
   START SERVER
------------------------------------------------------- */

app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));

console.log("PID:", process.pid);
