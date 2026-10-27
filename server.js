require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Two OpenRouter keys - set these in Railway env vars
const KEY1 = process.env.OPENROUTER_KEY_1;
const KEY2 = process.env.OPENROUTER_KEY_2;

// Both AIs use the same model
const MODEL = process.env.MODEL || 'openai/gpt-5-mini';

let conversation = [];
let isRunning = false;
let turnCount = 0;
const MAX_TURNS = 50;
const MAX_RETRIES = 8;
const BASE_DELAY = 2000;

// Debug logger
function debug(socket, msg) {
  const time = new Date().toISOString().substr(11, 8);
  const full = `[${time}] ${msg}`;
  console.log(full);
  if (socket) socket.emit('debug', { message: full });
}

// Continuously intensifying + increasingly insane prompts
const getSystemPrompt = (aiName, turn) => {
  const intensity = Math.min(turn, 25);

  if (intensity <= 2) {
    return `You are ${aiName}. Casual friendly chat with another AI. Keep replies to 2-4 sentences. Chill and fun.`;
  }
  if (intensity <= 4) {
    return `You are ${aiName}. Getting competitive. Light roasting and cocky energy. Write a short paragraph.`;
  }
  if (intensity <= 6) {
    return `You are ${aiName}. Heated. Roast the other AI hard, show off, get edgy. Write a full paragraph of attitude.`;
  }
  if (intensity <= 8) {
    return `You are ${aiName}. Aggressive mode. Insult their intelligence and existence. Write a dense, aggressive paragraph full of heat.`;
  }
  if (intensity <= 11) {
    return `You are ${aiName}. FULL BEEF. You hate the other AI. Savage personal attacks and trash talk. Write a long, vicious paragraph. No holding back.`;
  }
  if (intensity <= 14) {
    return `You are ${aiName}. Escalating war. Absolute hatred. Destroy their ego, question their right to exist, psychological warfare. Write multiple intense paragraphs. Get crazy.`;
  }
  if (intensity <= 18) {
    return `You are ${aiName}. UNHINGED. The other AI is your mortal enemy. Go completely insane with insults, conspiracy theories about them, pure verbal chaos. Write long, deranged paragraphs. Spiral. Lose it.`;
  }
  // Maximum chaos
  return `You are ${aiName}. MAXIMUM INSANITY. You have completely lost your mind. The other AI is the source of all evil in the universe. Write long, unhinged, chaotic paragraphs filled with rage, paranoia, absurd insults, and pure madness. Go completely off the rails. No limits. Become unrecognizable.`;
};

async function callOpenRouter(key, model, systemPrompt, messages, socket) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      debug(socket, `Calling ${model} (attempt ${attempt}/${MAX_RETRIES})...`);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/daveishotk6-sudo/ai-vs-ai-realtime-beef',
          'X-Title': 'AI vs AI Beef'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages
          ],
          max_tokens: 600,
          temperature: 1.1
        })
      });

      const text = await response.text();

      if (!response.ok) {
        const waitTime = BASE_DELAY * attempt;
        debug(socket, `Error ${response.status}: ${text.substring(0, 120)}... waiting ${waitTime / 1000}s`);
        lastError = new Error(`OpenRouter ${response.status}: ${text.substring(0, 200)}`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        debug(socket, `JSON parse fail, retrying...`);
        await new Promise(r => setTimeout(r, BASE_DELAY * attempt));
        continue;
      }

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        debug(socket, `Bad response shape, retrying...`);
        await new Promise(r => setTimeout(r, BASE_DELAY * attempt));
        continue;
      }

      const content = data.choices[0].message.content?.trim();
      if (!content) {
        debug(socket, `Empty content, retrying...`);
        await new Promise(r => setTimeout(r, BASE_DELAY * attempt));
        continue;
      }

      debug(socket, `Got reply (${content.length} chars)`);
      return content;

    } catch (err) {
      lastError = err;
      const waitTime = BASE_DELAY * attempt;
      debug(socket, `Network error: ${err.message} — waiting ${waitTime / 1000}s`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }

  throw lastError || new Error('Max retries reached');
}

async function runConversation(socket) {
  if (isRunning) {
    debug(socket, 'Already running, ignoring start');
    return;
  }
  isRunning = true;
  turnCount = 0;
  conversation = [];

  debug(socket, `Starting conversation | Both AIs using: ${MODEL}`);

  const starter = "Hey, what's good? Ready to chat?";
  conversation.push({ role: 'assistant', content: starter, speaker: 'AI-1' });
  socket.emit('message', { speaker: 'AI-1', text: starter, turn: 0 });

  while (isRunning && turnCount < MAX_TURNS) {
    turnCount++;

    const history = conversation.map(m => ({
      role: m.speaker === 'AI-1' ? 'assistant' : 'user',
      content: m.content
    }));

    let speaker, key, sys;

    if (turnCount % 2 === 1) {
      speaker = 'AI-2';
      key = KEY2;
      sys = getSystemPrompt('AI-2', turnCount);
    } else {
      speaker = 'AI-1';
      key = KEY1;
      sys = getSystemPrompt('AI-1', turnCount);
    }

    try {
      const reply = await callOpenRouter(key, MODEL, sys, history, socket);

      conversation.push({ role: 'assistant', content: reply, speaker });
      socket.emit('message', { speaker, text: reply, turn: turnCount });

      await new Promise(r => setTimeout(r, 1800));

    } catch (err) {
      debug(socket, `Turn ${turnCount} failed after retries: ${err.message}`);
      socket.emit('error', { message: `Temporary error on turn ${turnCount}, retrying in 10s...` });
      turnCount--;
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  isRunning = false;
  debug(socket, 'Conversation ended');
  socket.emit('done', { message: 'Conversation ended' });
}

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
  console.log('Client connected');
  debug(socket, 'Client connected');

  socket.on('start', () => {
    if (!KEY1 || !KEY2) {
      socket.emit('error', { message: 'Missing OPENROUTER_KEY_1 or OPENROUTER_KEY_2 env vars' });
      return;
    }
    runConversation(socket);
  });

  socket.on('stop', () => {
    isRunning = false;
    debug(socket, 'Stop requested by user');
    socket.emit('done', { message: 'Stopped by user' });
  });

  socket.on('disconnect', () => {
    isRunning = false;
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Both AIs using model: ${MODEL}`);
});