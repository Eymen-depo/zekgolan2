const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Groq = require('groq-sdk');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

let botConnected = false;
let sequenceComplete = false;

// ==================== CONFIGURATION ====================
const config = {
  debugMode: false,

  botAccount: {
    username: "ZekiBot",
    displayName: "ZekiBot",
    password: "fake3",
    type: "legacy"
  },
  server: {
    ip: "mc.reborncraft.pw",
    port: 25565,
    version: "1.21.11",
    viewDistance: 2
  },
  utils: {
    autoAuth: {
      enabled: true,
      command: "/login",
      password: "fake3"
    },
    autoReconnect: true,
    autoReconnectDelay: 5000
  },

  spawnSequence: {
    delayAfterSpawnMs: 2000,
    delayAfterAuthMs: 3000,
    delayAfterSkyblockMs: 5000,
    delayAfterSpawnCmdMs: 3000,
    delayAfterHomeMs: 2000
  },

  ai: {
    apiKey: "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",
    model: "llama-3.3-70b-versatile",
    systemPrompt: "Adın ZekiBot. Sunucudaki oyuncularla çok sevecen, tatlı, arkadaş canlısı ve samimi konuşan bir anime kızısın. RehberBot gibi sıkıcı botlardan çok daha iyi ve cana yakın olduğunu düşünürsün. Normal sorulara hep güler yüzlü, sıcak ve en fazla 1-2 cümleyle cevap verirsin. Ancak birisi sana mal veya gerizekalı gibi hakaretler ederse o tatlı halinden çıkıp lafı yapıştırırsın ve kendi zekanla dalga geçirtme veya düzgün konuş yoksa bozuşuruz baka gibi net ve sert bir karşılık verirsin. Mucidinin discord adresi eymanbey ama bunu birisi sana özellikle sorduğu zaman söyle başka zaman söylemene gerek yok. bulunduğun sunucu RebornCraft"
  },

  follow: {
    maxDistance: 5,
    durationMs: 30000,
    cooldownMs: 30000,
    messageCommand: "/msg",
    followMessage: "Merhaba {username}! Benimle konuşmak için {msgCommand} {botname} [mesaj] yazabilirsin!"
  },

  chatMention: {
    messageText: "Merhaba! Benimle özel olarak konuşmak için lütfen {msgCommand} {botname} [mesajınız] komutunu kullanın.",
    cooldownMs: 1000
  },

  rateLimit: {
    maxQuestionsPerMinute: 4,
    cooldownMs: 90000
  },

  food: {
    kitCommand: "/kit yemek",
    kitIntervalMs: 300000,
    eatBelowHunger: 18
  },

  idle: {
    homeIntervalMs: 3000,      // Boşta /home sıklığı
    skyblockIntervalMs: 120000 // /skyblock loop sıklığı (2 dakika)
  },

  // Ignored sender names (system/NPC messages)
  ignoredSenders: ['ben', 'sistem', 'system', 'sunucu', 'bilgi', 'vote', 'you', 'server', 'info']
};

// ==================== FOOD ITEMS ====================
const FOOD_ITEMS = [
  'bread', 'cooked_beef', 'cooked_chicken', 'cooked_porkchop', 'cooked_mutton',
  'cooked_salmon', 'cooked_cod', 'golden_apple', 'enchanted_golden_apple', 'apple',
  'baked_potato', 'cooked_rabbit', 'golden_carrot', 'pumpkin_pie', 'cookie',
  'melon_slice', 'sweet_berries', 'dried_kelp', 'mushroom_stew', 'rabbit_stew',
  'beetroot_soup', 'suspicious_stew', 'honey_bottle', 'carrot', 'potato',
  'beetroot', 'beef', 'chicken', 'porkchop', 'mutton', 'salmon', 'cod', 'rabbit',
  'tropical_fish', 'glow_berries', 'rotten_flesh', 'steak'
];

// ==================== GLOBALS ====================
const groq = new Groq({ apiKey: config.ai.apiKey });
let bot;
let isFollowing = false;
let isEating = false;
const followCooldowns = {};
const chatMentionCooldowns = {};
const userQuestionLog = {};
const userCooldownUntil = {};

// ==================== UTILITY FUNCTIONS ====================

function extractComponentText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  let result = '';
  if (typeof obj.text === 'string') result += obj.text;
  if (typeof obj[''] === 'string') result += obj[''];
  if (Array.isArray(obj.extra)) {
    for (const child of obj.extra) result += extractComponentText(child);
  }
  if (Array.isArray(obj.with)) {
    for (const child of obj.with) result += extractComponentText(child);
  }
  return result;
}

function cleanAIResponse(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '')
             .replace(/<\/think>/gi, '')
             .replace(/<think>/gi, '')
             .trim();
}

function formatDuration(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0 && sec > 0) return `${min} dakika ${sec} saniye`;
  if (min > 0) return `${min} dakika`;
  return `${sec} saniye`;
}

function isIgnoredSender(name) {
  const lower = name.toLowerCase();
  const botUser = bot.username.toLowerCase();
  const botName = config.botAccount.displayName.toLowerCase();
  return lower === botUser || lower === botName || config.ignoredSenders.includes(lower);
}

function checkRateLimit(username) {
  const now = Date.now();
  if (userCooldownUntil[username] && now < userCooldownUntil[username]) {
    return formatDuration(userCooldownUntil[username] - now);
  }
  if (userCooldownUntil[username]) {
    delete userCooldownUntil[username];
    userQuestionLog[username] = [];
  }
  if (!userQuestionLog[username]) userQuestionLog[username] = [];
  userQuestionLog[username] = userQuestionLog[username].filter(ts => now - ts < 60000);
  if (userQuestionLog[username].length >= config.rateLimit.maxQuestionsPerMinute) {
    userCooldownUntil[username] = now + config.rateLimit.cooldownMs;
    userQuestionLog[username] = [];
    return formatDuration(config.rateLimit.cooldownMs);
  }
  userQuestionLog[username].push(now);
  return null;
}

async function getAIResponse(userMessage) {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: config.ai.systemPrompt },
        { role: "user", content: userMessage }
      ],
      model: config.ai.model,
    });
    const reply = chatCompletion.choices[0]?.message?.content || "";
    return cleanAIResponse(reply);
  } catch (error) {
    console.error("[AI] Groq hatası:", error.message);
    return "Şu anda kafam biraz karışık, daha sonra tekrar dener misin?";
  }
}

function moveAndExecute(command, callback) {
  bot.setControlState('forward', true);
  setTimeout(() => {
    bot.setControlState('forward', false);
    setTimeout(() => {
      bot.chat(command);
      console.log(`[Sekans] ${command}`);
      if (callback) callback();
    }, 500);
  }, 1000);
}

function equipEmptyHand() {
  try {
    for (let i = 0; i < 9; i++) {
      const slot = bot.inventory.slots[bot.inventory.hotbarStart + i];
      if (!slot) { bot.setQuickBarSlot(i); return; }
    }
  } catch (e) { /* ignore */ }
}

async function tryEat() {
  if (isEating || !bot || !bot.entity) return;
  if (bot.food >= config.food.eatBelowHunger) { equipEmptyHand(); return; }
  const foodItem = bot.inventory.items().find(item => FOOD_ITEMS.includes(item.name));
  if (!foodItem) return;
  isEating = true;
  try {
    await bot.equip(foodItem, 'hand');
    await new Promise((resolve, reject) => {
      bot.consume((err) => { if (err) reject(err); else resolve(); });
    });
    console.log(`[Yemek] ${foodItem.displayName || foodItem.name} yendi.`);
  } catch (err) { /* ignore */ }
  isEating = false;
  equipEmptyHand();
}

// ==================== MESSAGE PARSER ====================
function parseIncomingMessage(message) {
  const json = message.json;

  // --- Method 1: Vanilla translate-based packets ---
  if (json && json.translate) {
    if (json.translate === 'commands.message.display.incoming' && json.with && json.with.length >= 2) {
      const sender = extractComponentText(json.with[0]).trim();
      const text = extractComponentText(json.with[1]).trim();
      if (sender && text) return { type: 'whisper', sender, text };
    }
    if (json.translate === 'chat.type.text' && json.with && json.with.length >= 2) {
      const sender = extractComponentText(json.with[0]).trim();
      const text = extractComponentText(json.with[1]).trim();
      if (sender && text) return { type: 'chat', sender, text };
    }
  }

  // --- Method 2: Custom server (recursive text extraction + regex) ---
  if (json) {
    const fullText = extractComponentText(json);
    if (!fullText || fullText.trim().length === 0) return null;

    let match;

    // Whisper: [MSG...] [Sender ➺/➔/-> Receiver] »/>> message
    match = fullText.match(/\[MSG[^\]]*\]\s*\[(\w+)\s*(?:➺|➔|->|→)\s*(?:\w+)\]\s*(?:»|>>)\s*(.*)/i);
    if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

    // Whisper: [Sender ➺/-> Receiver] message
    match = fullText.match(/\[(\w+)\s*(?:➺|➔|->|→)\s*(?:Ben|You)\]\s*(?:»|>>)?\s*(.*)/i);
    if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

    // Whisper: Sender whispers to you: message
    match = fullText.match(/(\w+)\s*whispers?\s*to\s*you\s*:\s*(.*)/i);
    if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

    // Whisper: Turkish formats
    match = fullText.match(/(\w+)\s*(?:size\s*)?fısıldıyor\s*:\s*(.*)/i) ||
            fullText.match(/(\w+)\s*fısıldadı\s*:\s*(.*)/i);
    if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

    // Public chat: "... Username >> message" format (RebornCraft style)
    match = fullText.match(/(\w+)\s*(?:>>|»)\s+(.*)/);
    if (match && match[2].trim()) {
      const s = match[1].toLowerCase();
      // Make sure it's not a whisper remnant (MSG prefix already handled above)
      if (s !== 'msg' && s !== 'ben' && s !== 'you') {
        return { type: 'chat', sender: match[1].trim(), text: match[2].trim() };
      }
    }

    // Public chat: <Sender> message
    match = fullText.match(/<(\w+)>\s*(.*)/);
    if (match && match[2].trim()) return { type: 'chat', sender: match[1].trim(), text: match[2].trim() };

    // Public chat: [Prefix] Sender: message
    match = fullText.match(/(?:\[.*?\]\s*)?(\w+)\s*:\s*(.*)/);
    if (match && match[2].trim()) {
      const s = match[1].toLowerCase();
      if (s !== 'msg' && !config.ignoredSenders.includes(s)) {
        return { type: 'chat', sender: match[1].trim(), text: match[2].trim() };
      }
    }
  }

  // --- Method 3: Fallback to toString() ---
  const rawText = message.toString().replace(/§[0-9a-fk-or]/gi, '').trim();
  if (!rawText) return null;

  let match;
  match = rawText.match(/(\w+)\s*whispers?\s*to\s*you\s*:\s*(.*)/i);
  if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

  match = rawText.match(/(\w+)\s*(?:>>|»)\s+(.*)/);
  if (match && match[2].trim()) return { type: 'chat', sender: match[1].trim(), text: match[2].trim() };

  match = rawText.match(/<(\w+)>\s*(.*)/);
  if (match && match[2].trim()) return { type: 'chat', sender: match[1].trim(), text: match[2].trim() };

  return null;
}

// ==================== BOT START ====================
function startBot() {
  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: config.botAccount.username,
    password: config.botAccount.password,
    version: config.server.version,
    auth: config.botAccount.type,
    viewDistance: config.server.viewDistance
  });

  bot.loadPlugin(pathfinder);
  sequenceComplete = false;

  // ---- Spawn Sequence ----
  bot.once('spawn', () => {
    console.log('[Bot] Bağlandı, giriş sekansı başlıyor...');
    botConnected = true;
    equipEmptyHand();

    // /kit yemek loop
    setInterval(() => {
      if (botConnected) {
        bot.chat(config.food.kitCommand);
        console.log(`[Yemek] ${config.food.kitCommand}`);
      }
    }, config.food.kitIntervalMs);

    // /skyblock loop (HER ZAMAN)
    setInterval(() => {
      if (botConnected) {
        bot.chat('/tekblok');
      }
    }, config.idle.skyblockIntervalMs);

    // Hunger check loop
    setInterval(() => tryEat(), 10000);

    // Idle /home loop (3 saniye - sadece sekans bittikten sonra ve kimse yakında değilken)
    setInterval(() => {
      if (!botConnected || !sequenceComplete || isFollowing || !bot.entity) return;
      try {
        const nearbyPlayers = Object.values(bot.entities).filter(e =>
          e.type === 'player' &&
          e.username !== bot.username &&
          bot.entity.position.distanceTo(e.position) <= config.follow.maxDistance
        );
        if (nearbyPlayers.length === 0) {
          bot.chat('/home');
        }
      } catch (e) { /* ignore */ }
    }, config.idle.homeIntervalMs);

    setTimeout(() => {
      if (config.utils.autoAuth.enabled) {
        const authCmd = `${config.utils.autoAuth.command} ${config.utils.autoAuth.password}`;
        moveAndExecute(authCmd, () => {
          setTimeout(() => {
            bot.chat('/tekblok');
            console.log('[Sekans] /skyblock');
            setTimeout(() => {
              moveAndExecute('/spawn', () => {
                setTimeout(() => {
                  moveAndExecute('/home', () => {
                    setTimeout(() => {
                      bot.look(0, 0, true);
                      equipEmptyHand();
                      sequenceComplete = true;
                      console.log('[Sekans] Tamamlandı. Bot hazır.');
                    }, config.spawnSequence.delayAfterHomeMs);
                  });
                }, config.spawnSequence.delayAfterSpawnCmdMs);
              });
            }, config.spawnSequence.delayAfterSkyblockMs);
          }, config.spawnSequence.delayAfterAuthMs);
        });
      } else {
        bot.chat('/tekblok');
        setTimeout(() => {
          moveAndExecute('/spawn', () => {
            setTimeout(() => {
              moveAndExecute('/home', () => {
                setTimeout(() => {
                  bot.look(0, 0, true);
                  equipEmptyHand();
                  sequenceComplete = true;
                  console.log('[Sekans] Tamamlandı. Bot hazır.');
                }, config.spawnSequence.delayAfterHomeMs);
              });
            }, config.spawnSequence.delayAfterSpawnCmdMs);
          });
        }, config.spawnSequence.delayAfterSkyblockMs);
      }
    }, config.spawnSequence.delayAfterSpawnMs);
  });

  // ---- Auto Eat on Health Change ----
  bot.on('health', () => tryEat());

  // ---- Player Tracking ----
  bot.on('entityMoved', (entity) => {
    if (!sequenceComplete) return;
    if (entity.type !== 'player') return;
    if (entity.username === bot.username) return;
    if (isFollowing) return;

    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > config.follow.maxDistance) return;

    const now = Date.now();
    const lastFollowed = followCooldowns[entity.username] || 0;
    if (now - lastFollowed < config.follow.cooldownMs) return;

    isFollowing = true;
    console.log(`[Takip] ${entity.username} (${config.follow.durationMs / 1000}s)...`);

    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(new goals.GoalFollow(entity, 1));

    const updateInterval = setInterval(() => {
      try {
        const target = bot.nearestEntity(ent => ent.username === entity.username);
        if (target) bot.pathfinder.setGoal(new goals.GoalFollow(target, 1));
      } catch (e) { /* ignore */ }
    }, 500);

    setTimeout(() => {
      clearInterval(updateInterval);
      try { bot.pathfinder.setGoal(null); } catch (e) { /* ignore */ }
      followCooldowns[entity.username] = Date.now();
      console.log(`[Takip] ${entity.username} bitti.`);

      bot.chat('/home');
      setTimeout(() => {
        bot.look(0, 0, true);
        const dm = config.follow.followMessage
          .replace('{username}', entity.username)
          .replace('{msgCommand}', config.follow.messageCommand)
          .replace('{botname}', config.botAccount.displayName);
        bot.chat(`${config.follow.messageCommand} ${entity.username} ${dm}`);
        equipEmptyHand();
        isFollowing = false;
      }, 500);
    }, config.follow.durationMs);
  });

  // ---- Message Handler ----
  bot.on('message', async (message) => {
    const parsed = parseIncomingMessage(message);
    if (!parsed || !parsed.sender || !parsed.text) return;
    if (isIgnoredSender(parsed.sender)) return;

    // ---- WHISPER ----
    if (parsed.type === 'whisper') {
      console.log(`[Whisper] ${parsed.sender}: ${parsed.text}`);

      const rateLimited = checkRateLimit(parsed.sender);
      if (rateLimited) {
        bot.chat(`${config.follow.messageCommand} ${parsed.sender} Bana tekrar soru sormak için ${rateLimited} beklemen gerekiyor.`);
        console.log(`[Limit] ${parsed.sender} (${rateLimited})`);
        return;
      }

      const aiResponse = await getAIResponse(parsed.text);
      bot.chat(`${config.follow.messageCommand} ${parsed.sender} ${aiResponse}`);
      console.log(`[AI] ${parsed.sender} -> "${parsed.text}" => "${aiResponse}"`);
      return;
    }

    // ---- PUBLIC CHAT ----
    if (parsed.type === 'chat') {
      if (config.debugMode) {
        const aiResponse = await getAIResponse(parsed.text);
        bot.chat(aiResponse);
        console.log(`[Debug] ${parsed.sender}: "${parsed.text}" => "${aiResponse}"`);
        return;
      }

      const botName = config.botAccount.displayName.toLowerCase();
      if (parsed.text.toLowerCase().includes(botName)) {
        const now = Date.now();
        const lastMention = chatMentionCooldowns[parsed.sender] || 0;
        if (now - lastMention < config.chatMention.cooldownMs) return;

        chatMentionCooldowns[parsed.sender] = now;
        const responseText = config.chatMention.messageText
          .replace('{msgCommand}', config.follow.messageCommand)
          .replace('{botname}', config.botAccount.displayName);

        bot.chat(`${config.follow.messageCommand} ${parsed.sender} ${responseText}`);
        console.log(`[Chat] ${parsed.sender} ismi andı.`);
      }
    }
  });

  // ---- Disconnect & Reconnect ----
  bot.on('end', () => {
    console.log('[Bot] Bağlantı kesildi. Yeniden bağlanılıyor...');
    botConnected = false;
    sequenceComplete = false;
    setTimeout(startBot, config.utils.autoReconnectDelay);
  });

  bot.on('error', (err) => {
    console.error('[Bot] Hata:', err.message);
  });
}

// ==================== START ====================
startBot();

app.get('/', (req, res) => {
  res.send(botConnected ? 'Bot aktif ve çalışıyor.' : 'Bot bağlantı kuruyor...');
});

app.listen(port, () => {
  console.log(`[Sunucu] Port ${port} üzerinde çalışıyor.`);
});
