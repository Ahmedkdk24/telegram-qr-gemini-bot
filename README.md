# 🤖 Telegram QR Gemini Bot

A Telegram bot powered by **Google Gemini Pro Vision**, hosted serverlessly on **Cloudflare Workers**.  
This bot can understand both **text and image messages**, intelligently describe photo content, and even **extract URLs from QR codes**.

---

## 🌐 Features

- 💬 AI-powered text chat (via Gemini Pro)
- 🖼️ Image understanding & text extraction (Gemini Vision)
- 🔍 QR code scanning from images
- ☁️ Fully serverless with Cloudflare Workers
- 🔐 Secrets stored securely via Cloudflare environment variables

---

## 🚀 Live Demo

Fork it, deploy it, and try chatting with your bot on Telegram.  
You’ll get answers from Gemini and QR scans from image uploads — no backend server needed.

---

## 🛠️ Prerequisites

Before you begin, make sure you have:

- ✅ A [Telegram account](https://telegram.org/)
- ✅ A [Cloudflare account](https://dash.cloudflare.com/)
- ✅ A [Google Cloud account](https://console.cloud.google.com/) with access to **Gemini API**

---

## 📲 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the steps to:
   - Name your bot
   - Choose a unique username
   - Get your **bot token**
3. Save the token — it’ll be used in your Cloudflare config

---

## 🧠 2. Enable Gemini API (Google AI Studio)

1. Go to [Google AI Studio](https://makersuite.google.com/)
2. Enable the **Gemini API**
3. Then visit the [Google Cloud Console](https://console.cloud.google.com/)
   - Enable the **Generative Language API**
   - Generate a new **API Key**
4. Copy this key — you’ll need it in the next step

> ⚠️ Note: A billing account may be required.

---

## ☁️ 3. Set Up Cloudflare Worker

### 🔧 Install Wrangler CLI

```bash
npm install -g wrangler
```

### 📦 Clone This Repo

```bash
git clone https://github.com/Ahmedkdk24/telegram-qr-gemini-bot.git
cd telegram-gemini-bot
```

### 🔐 Authenticate with Cloudflare

```bash
wrangler login
```

---

## 🛠️ 4. Configure Environment Variables

In your `wrangler.jsonc` file, set your keys and IDs:

```jsonc
{
  "name": "telegram-gemini-bot",
  "main": "src/index.js",
  "compatibility_date": "2024-05-01",

  "vars": {
    "TELEGRAM_TOKEN": "your-telegram-bot-token",
    "TELEGRAM_SECRET": "your-telegram-webhook-secret",
    "GOOGLE_API_KEY": "your-gemini-api-key",
    "ACCOUNT_ID": "your-cloudflare-account-id",
    "GATEWAY_NAME": "your-cloudflare-ai-gateway-name"
  }
}
```

> ⚠️ Do **not** commit real API keys to public repos. Use `wrangler secret put` if needed.

---

## 🚀 5. Deploy to Cloudflare

```bash
wrangler deploy
```

After deploying, note the `.workers.dev` URL printed in the terminal.

---

## 🔗 6. Register Your Webhook with Telegram

Now set your bot's webhook to point to your deployed Worker:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your-worker-url.workers.dev/endpoint&secret_token=your-secret"
```

> Replace:
> - `<YOUR_TOKEN>` with your Telegram bot token
> - `your-worker-url` with your actual Worker URL
> - `your-secret` with the same secret used in your code

---

## ✅ You're Done!

Now send a message or image to your bot on Telegram. It will:

- Reply using Gemini for text and image input
- Decode QR codes from images and include the URL (if found)

---

## 📁 Folder Structure

```bash
telegram-gemini-bot/
├── src/
│   └── index.js         # Main Cloudflare Worker script
├── wrangler.jsonc       # Worker configuration and vars
├── .gitignore
└── README.md
```

---

## 🛡️ Security Best Practices

- Store production API keys using:
  ```bash
  wrangler secret put API_KEY
  wrangler secret put TOKEN
  ```
- Do not publish secrets in `wrangler.jsonc` for public repos
- Never commit your `.env` (if used for local dev)

---

## 🧩 Contributing

PRs and suggestions welcome!  
Feel free to fork, remix, and improve this bot.

---

## 📄 License

MIT License © 2025 [Ahmedkdk24](https://github.com/Ahmedkdk24)
