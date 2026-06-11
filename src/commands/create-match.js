const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { load, save } = require('../db');
const { buildMatchEmbed, buildButtons } = require('../matchEmbed');
const { fromZonedTime } = require('date-fns-tz');
const TZ = 'Europe/Paris';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('create-match')
    .setDescription('Criar uma aposta para um jogo')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('titre').setDescription('Nome do jogo').setRequired(true))
    .addStringOption(o => o.setName('fermeture').setDescription('Fecho YYYY-MM-DD HH:MM (hora Paris)').setRequired(true))
    .addStringOption(o => o.setName('choix1_label').setDescription('Opção 1').setRequired(true))
    .addStringOption(o => o.setName('choix1_cote').setDescription('Cota Opção 1').setRequired(true))
    .addStringOption(o => o.setName('choix2_label').setDescription('Opção 2').setRequired(true))
    .addStringOption(o => o.setName('choix2_cote').setDescription('Cota Opção 2').setRequired(true))
    .addStringOption(o => o.setName('choix3_label').setDescription('Opção 3').setRequired(true))
    .addStringOption(o => o.setName('choix3_cote').setDescription('Cota Opção 3').setRequired(true))
    .addStringOption(o => o.setName('image').setDescription('URL imagem (opcional)').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Canal alvo').addChannelTypes(ChannelType.GuildText).setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const titre         = interaction.options.getString('titre');
    const fermeture     = interaction.options.getString('fermeture');
    const choice1Label  = interaction.options.getString('choix1_label');
    const choice1Odds   = interaction.options.getString('choix1_cote');
    const choice2Label  = interaction.options.getString('choix2_label');
    const choice2Odds   = interaction.options.getString('choix2_cote');
    const choice3Label  = interaction.options.getString('choix3_label');
    const choice3Odds   = interaction.options.getString('choix3_cote');
    const imageUrl      = interaction.options.getString('image') || null;
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    const match = fermeture.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (!match) return interaction.editReply('Format invalide. Utilise YYYY-MM-DD HH:MM');
    const [, y, mo, d, h, mi] = match;
    const closingUTC = fromZonedTime(new Date(y+'-'+mo+'-'+d+'T'+h+':'+mi+':00'), TZ);
    if (isNaN(closingUTC.getTime())) return interaction.editReply('Date invalide.');

    const matchId = 'match_' + Date.now();
    const matchData = {
      id: matchId, title: titre, status: 'open',
      closingTimeUTC: closingUTC.toISOString(),
      closingTimeLabel: d+'/'+mo+'/'+y+' '+h+':'+mi,
      choice1Label, choice1Odds, choice2Label, choice2Odds, choice3Label, choice3Odds,
      imageUrl, channelId: targetChannel.id, messageId: null,
    };

    const embed = buildMatchEmbed(matchData);
    const row   = buildButtons(matchId, true);
    const msg   = await targetChannel.send({ embeds: [embed], components: [row] });
    matchData.messageId = msg.id;

    const db = load();
    db.matches[matchId] = matchData;
    db.bets[matchId] = {};
    save(db);

    if (process.env.DISCORD_ADMIN_CHANNEL_ID) {
      try {
        const adminCh = await interaction.guild.channels.fetch(process.env.DISCORD_ADMIN_CHANNEL_ID);
        await adminCh.send('📋 **Novo jogo criado**\nID : `' + matchId + '`\nJogo : ' + titre + '\nFecha : ' + fermeture);
      } catch(e) { console.error('[AdminLog]', e.message); }
    }

    await interaction.editReply('Jogo criado! ID: `' + matchId + '`\nFecho : ' + fermeture + ' (Paris)');
  },
};
