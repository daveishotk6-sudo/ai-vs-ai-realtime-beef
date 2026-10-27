# AI vs AI Realtime Beef 🔥

Two AIs talk to each other in realtime using OpenRouter.  
They start chill... then after a few messages they go full **BEEF MODE** and start roasting each other.

Built to deploy on **Railway** in one click.

## How it works
- Uses two separate OpenRouter API keys
- AI-1 and AI-2 take turns responding
- After ~4 turns they get competitive
- After ~8 turns they go pure trash-talk / fighting mode
- Live streaming of messages via Socket.IO

## Deploy on Railway

1. Go to [Railway](https://railway.app) → New Project → Deploy from GitHub
2. Select this repo: `daveishotk6-sudo/ai-vs-ai-realtime-beef`
3. Add these environment variables:

```
OPENROUTER_KEY_1 = your_first_openrouter_key
OPENROUTER_KEY_2 = your_second_openrouter_key
```

Optional:
```
MODEL_1 = openai/gpt-4o-mini
MODEL_2 = anthropic/claude-3.5-sonnet
```

4. Deploy. Railway will auto-detect Node and run `npm start`.

## Local run

```bash
npm install
cp .env.example .env
# put your two keys in .env
npm start
```

Open http://localhost:3000

## Notes
- Keys are never exposed to the frontend
- Conversation auto-stops after 30 turns
- You can hit Stop anytime

Enjoy the fight.