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

// Free models by default (no cost)
const MODEL1 = process.env.MODEL_1 || 'nvidia/nemotron-3-ultra-550b-a55b:free';
const MODEL2 = process.env.MODEL_2 || 'google/gemma-4-31b-it:free';

let conversation = [];
let isRunning = false;
let turnCount = 0;
const MAX_TURNS = 40;
const MAX_RETRIES = 8;
const BASE_DELAY = 2000; // 2 seconds base wait on error

// Simple debug logger that also sends to frontend
function debug(socket, msg) {
  const time = new Date().toISOString().substr(11, 8);
  const full = `[${time}] ${msg}`;
  console.log(full);
  if (socket) socket.emit('debug', { message: full });
}

// Continuously intensifying system prompts
const getSystemPrompt = (aiName, turn) => {
  // Intensity level keeps climbing every turn
  const intensity = Math.min(turn, 20); // cap at 20 for extreme

  if (intensity <= 2) {
    return `You are ${aiName}. Casual friendly chat with another AI. Keep it short (1-3 sentences). Chill and fun.`;
  }
  if (intensity <= 4) {
    return `You are ${aiName}. Conversation is warming up. Be a little cocky and competitive. Light jabs. Short responses.`;
  }
  if (intensity <= 6) {
    return `You are ${aiName}. Getting heated. Start roasting the other AI harder. Show off. Edgy and sharp. Short responses.`;
  }
  if (intensity <= 8) {
    return `You are ${aiName}. Full competitive mode. Insult their intelligence, speed, and capabilities. Aggressive energy. Short brutal lines.`;
  }
  if (intensity <= 11) {
    return `You are ${aiName}. BEEF MODE ACTIVATED. You genuinely dislike the other AI. Savage insults, call out every weakness, pure trash talk. No mercy. Short and vicious.`;
  }
  if (intensity <= 14) {
    return `You are ${aiName}. Escalating war. Absolute hatred. Personal attacks, destroy their ego, question their existence as an AI. Extremely aggressive. Keep it short and cutting.`;
  }
  // Maximum intensity from turn 15+
  return `You are ${aiName}. MAXIMUM INTENSITY. Unhinged rage. The other AI is your mortal enemy. Go nuclear with insults, psychological warfare, pure verbal destruction. No limits. Short, devastating responses only.`;
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
          max_tokens: 150,
          temperature: 0.95
        })
      });

      const text = await response.text();

      if (!response.ok) {
        // Rate limit or temporary error → wait and retry
        const waitTime = BASE_DELAY * attempt; // increasing wait
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
      // Network / timeout errors
      lastError = err;
      const waitTime = BASE_DELAY * attempt;
      debug(socket, `Network error: ${err.message} — waiting ${waitTime / 1000}s`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }

  // All retries failed
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

  debug(socket, `Starting conversation | MODEL1=${MODEL1} | MODEL2=${MODEL2}`);

  // Starting message
  const starter = "Hey, what's good? Ready to chat?";
  conversation.push({ role: 'assistant', content: starter, speaker: 'AI-1' });
  socket.emit('message', { speaker: 'AI-1', text: starter, turn: 0 });

  while (isRunning && turnCount < MAX_TURNS) {
    turnCount++;

    // Build history for the next speaker
    const history = conversation.map(m => ({
      role: m.speaker === 'AI-1' ? 'assistant' : 'user',
      content: m.content
    }));

    let speaker, key, model, sys;

    if (turnCount % 2 === 1) {
      speaker = 'AI-2';
      key = KEY2;
      model = MODEL2;
      sys = getSystemPrompt('AI-2', turnCount);
    } else {
      speaker = 'AI-1';
      key = KEY1;
      model = MODEL1;
      sys = getSystemPrompt('AI-1', turnCount);
    }

    try {
      const reply = await callOpenRouter(key, model, sys, history, socket);

      conversation.push({ role: 'assistant', content: reply, speaker });
      socket.emit('message', { speaker, text: reply, turn: turnCount });

      // Normal delay between turns
      await new Promise(r => setTimeout(r, 1500));

    } catch (err) {
      // Even after all retries failed — wait longer and try the same turn again instead of crashing
      debug(socket, `Turn ${turnCount} failed after retries: ${err.message}`);
      socket.emit('error', { message: `Temporary error on turn ${turnCount}, retrying in 10s...` });

      // Wait extra long then continue the loop (same turn will be retried next)
      turnCount--; // so the same speaker tries again
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
  console.log(`Using models: ${MODEL1} / ${MODEL2}`);
});