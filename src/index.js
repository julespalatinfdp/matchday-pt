try { require('dotenv').config(); } catch(e) {}
const { Client, GatewayIntentBits, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { load, save } = require('./db');
const { buildMatchEmbed, buildButtons } = require('./matchEmbed');


function getParisDayKey() {
  const now = new Date();
  const parisDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const h = parisDate.getHours();
  const d = new Date(parisDate);
  if (h < 12) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.commands = new Collection();
const cmdDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(cmdDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(cmdDir, file));
  client.commands.set(cmd.data.name, cmd);
}

client.once('ready', () => {
  process.stdout.write('✅ Bot connecté : ' + client.user.tag + '\n');
  startAutoCloseJob();
});

client.on('interactionCreate', async interaction => {

  if (interaction.isChatInputCommand()) {
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;
    try { await cmd.execute(interaction); }
    catch (e) {
      console.error(e);
      const r = { content: '❌ Erreur.', ephemeral: true };
      interaction.deferred || interaction.replied ? interaction.editReply(r) : interaction.reply(r);
    }
    return;
  }

  if (!interaction.isButton()) return;
  const customId = interaction.customId;

  // ── Bouton de pari initial ──
  if (customId.startsWith('bet_')) {
    const parts   = customId.split('_');
    const choice  = parseInt(parts[parts.length - 1], 10);
    const matchId = parts.slice(1, -1).join('_');
    const db    = load();
    const match = db.matches[matchId];

    if (!match) return interaction.reply({ content: '❌ Jogo não encontrado.', ephemeral: true });
    if (match.status !== 'open') return interaction.reply({ content: '❌ As apostas estão encerradas.', ephemeral: true });

    const userId   = interaction.user.id;
    const username = interaction.user.username;

    // Aposta já feita → bloqueado
    if (db.bets[matchId]?.[userId]) {
      const existing = db.bets[matchId][userId];
      const labels = { 1: match.choice1Label, 2: match.choice2Label, 3: match.choice3Label };
      return interaction.reply({ embeds: [{ color: 0xE10014, title: '🔒 Aposta já registada',
        description: 'Já apostaste em **' + labels[existing.choice] + '**.\nNão é possível alterar a aposta depois de confirmada.' }], ephemeral: true });
    }

    if (!db.users[userId]) db.users[userId] = { totalPoints: 0, boostUsedToday: null, username };
    db.users[userId].username = username;

    const todayStr       = new Date().toISOString().slice(0, 10);
    const boostAvailable = db.users[userId].boostUsedToday !== todayStr;
    const basePoints     = { 1: 2, 2: 4, 3: 8 }[choice];
    const labels         = { 1: match.choice1Label, 2: match.choice2Label, 3: match.choice3Label };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_' + matchId + '_' + choice + '_0').setLabel('✅ Confirmar').setStyle(ButtonStyle.Success),
      ...(boostAvailable ? [new ButtonBuilder().setCustomId('confirm_' + matchId + '_' + choice + '_1').setLabel('⚡ Confirmar + Boost ×2').setStyle(ButtonStyle.Primary)] : []),
      new ButtonBuilder().setCustomId('cancel_bet').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
    );

    return interaction.reply({ embeds: [{ color: 0xE10014,
      title: '🎲 Confirmar aposta — ' + match.title,
      description: 'Escolheste: **' + labels[choice] + '**\n**Pontos potenciais: ' + basePoints + ' pts**\n\n' +
        (boostAvailable ? '⚡ **Boost disponível!** Duplica os teus pontos.\n*(1 boost/dia, irrevogável)*' : '❌ Boost já utilizado hoje.'),
      footer: { text: '⚠️ Depois de confirmada, a aposta não pode ser alterada.' } }],
      components: [row], ephemeral: true });
  }

  // ── Confirmation ──
  if (customId.startsWith('confirm_')) {
    const parts   = customId.split('_');
    const boost   = parts[parts.length - 1] === '1';
    const choice  = parseInt(parts[parts.length - 2], 10);
    const matchId = parts.slice(1, -2).join('_');
    const db    = load();
    const match = db.matches[matchId];

    if (!match || match.status !== 'open') return interaction.update({ content: '❌ Jogo encerrado.', embeds: [], components: [] });

    const userId   = interaction.user.id;
    const username = interaction.user.username;
    const todayStr = getParisDayKey();

    if (!db.users[userId]) db.users[userId] = { totalPoints: 0, boostUsedToday: null, username };
    if (db.bets[matchId]?.[userId]) return interaction.update({ content: '❌ Aposta já registada.', embeds: [], components: [] });
    if (boost && db.users[userId].boostUsedToday === todayStr) return interaction.update({ content: '❌ Boost já utilizado hoje.', embeds: [], components: [] });

    if (!db.bets[matchId]) db.bets[matchId] = {};
    db.bets[matchId][userId] = { choice, boosted: boost, username, points: null, placedAt: Date.now() };
    if (boost) db.users[userId].boostUsedToday = todayStr;
    if (!db.users[userId].firstBetAt) db.users[userId].firstBetAt = Date.now();
    db.users[userId].username = username;
    save(db);

    const basePoints  = { 1: 2, 2: 4, 3: 8 }[choice];
    const finalPoints = boost ? basePoints * 2 : basePoints;
    const labels      = { 1: match.choice1Label, 2: match.choice2Label, 3: match.choice3Label };

    return interaction.update({ embeds: [{ color: 0x00C853, title: '✅ Aposta registada!',
      description: '**Jogo:** ' + match.title + '\n**Escolha:** ' + labels[choice] + '\n**Pontos potenciais:** ' + finalPoints + ' pts' + (boost ? ' ⚡ (boost ×2)' : ''),
      footer: { text: 'Boa sorte! 🍀' } }], components: [] });
  }

  if (customId === 'cancel_bet') return interaction.update({ content: 'Aposta cancelada.', embeds: [], components: [] });
});

function startAutoCloseJob() {
  cron.schedule('* * * * *', async () => {
    const now = new Date(); const db = load(); let changed = false;
    for (const [matchId, match] of Object.entries(db.matches)) {
      if (match.status !== 'open') continue;
      if (now >= new Date(match.closingTimeUTC)) {
        match.status = 'closed'; changed = true;
        try {
          const guild   = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
          const channel = await guild.channels.fetch(match.channelId);
          const msg     = await channel.messages.fetch(match.messageId);
          await msg.edit({ embeds: [buildMatchEmbed(match)], components: [buildButtons(matchId, false)] });
        } catch (e) { console.error('[AutoClose]', e.message); }
      }
    }
    if (changed) save(db);
  });
}

require('http').createServer((req,res)=>res.end('ok')).listen(process.env.PORT||3000);
client.login(process.env.DISCORD_TOKEN);
