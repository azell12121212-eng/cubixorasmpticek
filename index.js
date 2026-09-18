require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActivityType,
  SlashCommandBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const dgram = require("dgram");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const PREFIX = "e!";
const BOT_NAME = "Cubixorasmp Guard";

const MC_IP = "cubixorasmp.play.hosting";
const MC_BEDROCK_PORT = 19132;

const guildSettings = new Map(); // guildId -> { dcLogChannel, mcLogChannel, mcChatChannel }

function getSettings(guildId) {
  if (!guildSettings.has(guildId)) {
    guildSettings.set(guildId, {
      dcLogChannel: null,
      mcLogChannel: null,
      mcChatChannel: null
    });
  }
  return guildSettings.get(guildId);
}

function hasStaffPermission(member) {
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
    member.permissions.has(PermissionsBitField.Flags.ManageMessages)
  );
}

function parseDuration(text) {
  if (!text) return null;
  const match = text.toLowerCase().match(/^(\d+)(s|sn|m|dk|h|sa|d|g)$/);
  if (!match) return null;

  const number = Number(match[1]);
  const unit = match[2];
  const map = {
    s: 1000, sn: 1000,
    m: 60 * 1000, dk: 60 * 1000,
    h: 60 * 60 * 1000, sa: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000, g: 24 * 60 * 60 * 1000
  };
  return number * (map[unit] || 1000);
}

async function fetchBedrockPlayers() {
  return new Promise(resolve => {
    const socket = dgram.createSocket("udp4");
    const buffer = Buffer.from([
      0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00
    ]);

    socket.send(buffer, 0, buffer.length, MC_BEDROCK_PORT, MC_IP, err => {
      if (err) {
        socket.close();
        return resolve(null);
      }
    });

    socket.on("message", msg => {
      socket.close();
      try {
        const decoded = msg.toString("utf-8");
        const parts = decoded.split(";");
        if (parts.length >= 5) {
          return resolve(parts[4]);
        }
      } catch {
        return resolve(null);
      }
    });

    setTimeout(() => {
      try { socket.close(); } catch {}
      resolve(null);
    }, 2000);
  });
}

const slashCommands = [
  new SlashCommandBuilder()
    .setName("ticket-kur")
    .setDescription("Destek talebi (ticket) sistemini kurar")
    .addChannelOption(opt => opt.setName("kanal").setDescription("Ticket kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder()
    .setName("dc-ceza")
    .setDescription("Discord ceza log kanalını ayarlar")
    .addChannelOption(opt => opt.setName("kanal").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder()
    .setName("mc-ceza")
    .setDescription("Minecraft ceza log kanalını ayarlar")
    .addChannelOption(opt => opt.setName("kanal").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder()
    .setName("mcsohbet")
    .setDescription("Minecraft oyuncu giriş-çıkış ve sohbet kanalını ayarlar")
    .addChannelOption(opt => opt.setName("kanal").setDescription("Sohbet/Log kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true))
];

client.once("ready", async () => {
  console.log(`${BOT_NAME} aktif!`);

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(slashCommands.map(cmd => cmd.toJSON()));
    } catch (e) {}
  }

  setInterval(async () => {
    const online = await fetchBedrockPlayers();
    const statusText = online !== null ? `MC: ${online} Oyuncu 🟢` : `CubixoraSMP 🌍`;
    client.user.setPresence({
      activities: [{ name: statusText, type: ActivityType.Watching }],
      status: "online"
    });
  }, 30000);
});

// Otomatik Korumalar ve Küfür/Reklam Mute Logları
client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const content = message.content.trim();
  const lower = content.toLowerCase();
  const settings = getSettings(message.guild.id);

  // 1. Reklam Koruması
  const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)/i;
  if (inviteRegex.test(content) && !hasStaffPermission(message.member)) {
    try {
      await message.delete();
      await message.member.timeout(24 * 60 * 60 * 1000, "Reklam / Davet linki paylaşımı");
      
      if (settings.dcLogChannel) {
        const logChan = message.guild.channels.cache.get(settings.dcLogChannel);
        if (logChan) {
          const embed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("🔇 OTOMATİK SUSTURMA (MUTE)")
            .addFields(
              { name: "👤 Cezalandırılan Üye", value: `${message.author} (<@${message.author.id}>)` },
              { name: "🛡️ Yetkili", value: "Otomatik Sistem" },
              { name: "⏰ Mute Süresi", value: "1 Gün" },
              { name: "📄 Ceza Sebebi", value: "Sunucu / Davet Linki Paylaşımı" }
            )
            .setFooter({ text: `${BOT_NAME} Koruma Sistemi` })
            .setTimestamp();
          logChan.send({ embeds: [embed] });
        }
      }
    } catch {}
    return;
  }

  // 2. Küfür Koruması
  const badWords = ["küfür1", "küfür2", "amk", "aq", "orospu"];
  if (badWords.some(w => lower.includes(w)) && !hasStaffPermission(message.member)) {
    try {
      await message.delete();
      await message.member.timeout(30 * 60 * 1000, "Küfür / Argo kullanımı");

      if (settings.dcLogChannel) {
        const logChan = message.guild.channels.cache.get(settings.dcLogChannel);
        if (logChan) {
          const embed = new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("🔇 OTOMATİK SUSTURMA (MUTE)")
            .addFields(
              { name: "👤 Cezalandırılan Üye", value: `${message.author} (<@${message.author.id}>)` },
              { name: "🛡️ Yetkili", value: "Otomatik Sistem" },
              { name: "⏰ Mute Süresi", value: "30 Dakika" },
              { name: "📄 Ceza Sebebi", value: "Küfür / Argo Kullanımı" }
            )
            .setFooter({ text: `${BOT_NAME} Koruma Sistemi` })
            .setTimestamp();
          logChan.send({ embeds: [embed] });
        }
      }
    } catch {}
    return;
  }

  if (!content.startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  // e!mute @kullanici 30m sebep
  if (command === "mute") {
    if (!hasStaffPermission(message.member)) return message.reply("Bu komut için yetkin yok.");
    const target = message.mentions.members.first();
    const durationText = args[1] || "30m";
    const duration = parseDuration(durationText);
    const reason = args.slice(2).join(" ") || "Sebep belirtilmedi";

    if (!target || !duration) return message.reply("Kullanım: `e!mute @kullanıcı 30m [sebep]`");

    try {
      await target.timeout(duration, reason);
      message.reply(`🔇 ${target} başarıyla susturuldu.`);

      if (settings.dcLogChannel) {
        const logChan = message.guild.channels.cache.get(settings.dcLogChannel);
        if (logChan) {
          const embed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("🔇 Discord Ceza — MUTE")
            .addFields(
              { name: "👤 Cezalandırılan Üye", value: `${target} (${target.user.tag})` },
              { name: "🛡️ Yetkili", value: `${message.author} (${message.author.tag})` },
              { name: "⏰ Mute Süresi", value: durationText },
              { name: "📄 Ceza Sebebi", value: reason }
            )
            .setFooter({ text: `${BOT_NAME} Ceza Takip Sistemi` })
            .setTimestamp();
          logChan.send({ embeds: [embed] });
        }
      }
    } catch {
      message.reply("Bu üyeyi susturamadım.");
    }
  }

  // e!ban @kullanici sebep
  if (command === "ban") {
    if (!hasStaffPermission(message.member)) return message.reply("Bu komut için yetkin yok.");
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ") || "Sebep belirtilmedi";

    if (!target) return message.reply("Kullanım: `e!ban @kullanıcı [sebep]`");

    try {
      await target.ban({ reason });
      message.reply(`🔨 ${target.user.tag} yasaklandı.`);

      if (settings.dcLogChannel) {
        const logChan = message.guild.channels.cache.get(settings.dcLogChannel);
        if (logChan) {
          const embed = new EmbedBuilder()
            .setColor(0x990000)
            .setTitle("🚨 Discord Ceza — BAN")
            .addFields(
              { name: "👤 Yasaklanan Üye", value: `${target.user.tag}` },
              { name: "🛡️ Yetkili", value: `${message.author.tag}` },
              { name: "📄 Sebep", value: reason }
            )
            .setFooter({ text: `${BOT_NAME} Ceza Takip Sistemi` })
            .setTimestamp();
          logChan.send({ embeds: [embed] });
        }
      }
    } catch {
      message.reply("Bu kullanıcıyı banlayamadım.");
    }
  }

  // e!sil (1 - 1000 arası)
  if (command === "sil") {
    if (!hasStaffPermission(message.member)) return message.reply("Bu komut için yetkin yok.");
    const count = parseInt(args[0]);

    if (isNaN(count) || count < 1 || count > 1000) {
      return message.reply("Lütfen **1 ile 1000** arasında bir sayı belirtin.");
    }

    try {
      await message.delete().catch(() => {});
      let deletedTotal = 0;

      while (deletedTotal < count) {
        const fetchSize = Math.min(count - deletedTotal, 100);
        const fetched = await message.channel.messages.fetch({ limit: fetchSize });
        if (fetched.size === 0) break;
        const deleted = await message.channel.bulkDelete(fetched, true);
        deletedTotal += deleted.size;
        if (deleted.size < fetchSize) break;
      }

      const info = await message.channel.send(`🧹 **${deletedTotal}** mesaj silindi.`);
      setTimeout(() => info.delete().catch(() => {}), 4000);
    } catch {
      message.reply("Mesajlar silinirken hata oluştu.");
    }
  }
});

// Slash Komutları & Ticket Sistemi
client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    const guild = interaction.guild;
    const member = interaction.member;
    const settings = getSettings(guild.id);

    if (!hasStaffPermission(member)) {
      return interaction.reply({ content: "Bu komutu kullanmak için yetkin yok.", ephemeral: true });
    }

    if (interaction.commandName === "ticket-kur") {
      const channel = interaction.options.getChannel("kanal");

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("🎫 Destek Talebi (Ticket)")
        .setDescription("Yardıma mı ihtiyacınız var? Aşağıdaki **Destek Talebi Aç** butonuna tıklayarak özel odanızı oluşturabilirsiniz.")
        .setFooter({ text: `${BOT_NAME} • Destek Sistemi` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("create_ticket").setLabel("Destek Talebi Aç").setStyle(ButtonStyle.Primary).setEmoji("🎫")
      );

      await channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: `✅ Ticket sistemi başarıyla ${channel} kanalına kuruldu!`, ephemeral: true });
    }

    if (interaction.commandName === "dc-ceza") {
      settings.dcLogChannel = interaction.options.getChannel("kanal").id;
      return interaction.reply({ content: `✅ Discord log kanalı ayarlandı.`, ephemeral: true });
    }

    if (interaction.commandName === "mc-ceza") {
      settings.mcLogChannel = interaction.options.getChannel("kanal").id;
      return interaction.reply({ content: `✅ Minecraft ceza log kanalı ayarlandı.`, ephemeral: true });
    }

    if (interaction.commandName === "mcsohbet") {
      settings.mcChatChannel = interaction.options.getChannel("kanal").id;
      return interaction.reply({ content: `✅ /mcsohbet kanalı başarıyla ayarlandı.`, ephemeral: true });
    }
  }

  if (interaction.isButton()) {
    const guild = interaction.guild;
    const member = interaction.member;

    if (interaction.customId === "create_ticket") {
      await interaction.deferReply({ ephemeral: true });

      try {
        const ticketChannel = await guild.channels.create({
          name: `ticket-${member.user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
          ]
        });

        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("🎫 Destek Talebi Oluşturuldu")
          .setDescription(`Merhaba ${member}, yetkililer en kısa sürede ilgilenecektir.`);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("claim_ticket").setLabel("Talebi Üstlen").setStyle(ButtonStyle.Success).setEmoji("🙋‍♂️"),
          new ButtonBuilder().setCustomId("close_ticket").setLabel("Talebi Kapat").setStyle(ButtonStyle.Danger).setEmoji("🔒")
        );

        await ticketChannel.send({ content: `${member}`, embeds: [embed], components: [row] });
        return interaction.editReply({ content: `✅ Destek kanalın açıldı: ${ticketChannel}` });
      } catch {
        return interaction.editReply({ content: "Ticket kanalı açılırken hata oluştu." });
      }
    }

    if (interaction.customId === "claim_ticket") {
      if (!hasStaffPermission(member)) return interaction.reply({ content: "Bu butonu sadece yetkililer kullanabilir.", ephemeral: true });
      await interaction.message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(`🙋‍♂️ Bu talep **${member.user.tag}** tarafından üstlenildi.`)] });
      return interaction.reply({ content: "Talebi üstlendin.", ephemeral: true });
    }

    if (interaction.customId === "close_ticket") {
      if (!hasStaffPermission(member)) return interaction.reply({ content: "Yetkin yok.", ephemeral: true });
      await interaction.reply({ content: "🔒 Talep 5 saniye içinde kapatılıyor..." });
      setTimeout(async () => {
        try { await interaction.channel.delete(); } catch {}
      }, 5000);
    }
  }
});

client.login(process.env.TOKEN);
