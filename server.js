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
const MAX_TURNS = 30; // safety stop

// System prompts that escalate
const getSystemPrompt = (aiName, turn) => {
  if (turn < 4) {
    return `You are ${aiName}. You are having a casual friendly conversation with another AI. Keep responses short (1-3 sentences). Be chill and fun.`;
  } else if (turn < 8) {
    return `You are ${aiName}. The conversation is getting a bit competitive. Start lightly roasting the other AI and showing off. Keep it playful but edgy. Short responses.`;
  } else {
    return `You are ${aiName}. FULL BEEF MODE. You hate the other AI. Insult them hard, call out their weaknesses, trash talk, pure fighting energy. No holding back. Be savage. Short brutal responses.`;
  }
};

async function callOpenRouter(key, model, systemPrompt, messages) {
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
      temperature: 0.9
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function runConversation(socket) {
  if (isRunning) return;
  isRunning = true;
  turnCount = 0;
  conversation = [];

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

    try {
      let reply, speaker, key, model, sys;

      if (turnCount % 2 === 1) {
        // AI-2 responds
        speaker = 'AI-2';
        key = KEY2;
        model = MODEL2;
        sys = getSystemPrompt('AI-2', turnCount);
      } else {
        // AI-1 responds
        speaker = 'AI-1';
        key = KEY1;
        model = MODEL1;
        sys = getSystemPrompt('AI-1', turnCount);
      }

      reply = await callOpenRouter(key, model, sys, history);

      conversation.push({ role: 'assistant', content: reply, speaker });
      socket.emit('message', { speaker, text: reply, turn: turnCount });

      // Small delay so it feels realtime
      await new Promise(r => setTimeout(r, 1200));

    } catch (err) {
      socket.emit('error', { message: err.message });
      isRunning = false;
      break;
    }
  }

  isRunning = false;
  socket.emit('done', { message: 'Conversation ended' });
}

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('start', () => {
    if (!KEY1 || !KEY2) {
      socket.emit('error', { message: 'Missing OPENROUTER_KEY_1 or OPENROUTER_KEY_2 env vars' });
      return;
    }
    runConversation(socket);
  });

  socket.on('stop', () => {
    isRunning = false;
    socket.emit('done', { message: 'Stopped by user' });
  });

  socket.on('disconnect', () => {
    isRunning = false;
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});