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
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const dgram = require("dgram"); // Minecraft Bedrock (19132) ping atmak için

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

const PREFIX = "!";
const BOT_NAME = "Cubixorasmp Guard";

const MC_IP = "cubixorasmp.play.hosting";
const MC_BEDROCK_PORT = 19132;

// Log kanalları ve ayarlar hafızası
const guildSettings = new Map(); // guildId -> { dcLogChannel, mcLogChannel }

function getSettings(guildId) {
  if (!guildSettings.has(guildId)) {
    guildSettings.set(guildId, {
      dcLogChannel: null,
      mcLogChannel: null
    });
  }
  return guildSettings.get(guildId);
}

// Yetki kontrolü (Rolü olan veya Yönetici olanlar)
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

// Minecraft Bedrock Query ile Oyuncu Sayısını Çekme
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
          const onlinePlayers = parts[4];
          return resolve(onlinePlayers);
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

// Slash Komutları Listesi
const slashCommands = [
  new SlashCommandBuilder()
    .setName("ticket-kur")
    .setDescription("Destek talebi (ticket) sistemini kurar")
    .addChannelOption(opt =>
      opt.setName("kanal").setDescription("Mesajın atılacağı kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("dc-ceza")
    .setDescription("Discord ceza log kanalını ayarlar")
    .addChannelOption(opt =>
      opt.setName("kanal").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("mc-ceza")
    .setDescription("Minecraft ceza log kanalını ayarlar")
    .addChannelOption(opt =>
      opt.setName("kanal").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)
    )
];

client.once("ready", async () => {
  console.log(`${BOT_NAME} aktif ve çalışıyor!`);

  // Slash komutları kaydet
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(slashCommands.map(cmd => cmd.toJSON()));
    } catch (e) {
      console.log("Komut yükleme hatası:", e.message);
    }
  }

  // Her 30 saniyede bir botun durumunu Minecraft oyuncu sayısıyla güncelle
  setInterval(async () => {
    const online = await fetchBedrockPlayers();
    const statusText = online !== null ? `MC: ${online} Oyuncu 🟢` : `CubixoraSMP 🌍`;
    
    client.user.setPresence({
      activities: [{ name: statusText, type: ActivityType.Watching }],
      status: "online"
    });
  }, 30000);
});

// Otomatik Korumalar ve Mesaj İşlemleri
client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const content = message.content.trim();
  const lower = content.toLowerCase();
  const settings = getSettings(message.guild.id);

  // 1. Sunucu Linki Atma Koruması (1 Gün Mute)
  const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)/i;
  if (inviteRegex.test(content) && !hasStaffPermission(message.member)) {
    try {
      await message.delete();
      const muteDuration = 24 * 60 * 60 * 1000; // 1 Gün
      await message.member.timeout(muteDuration, "Reklam / Davet linki paylaşımı");
      
      message.channel.send(`⚠️ ${message.author}, sunucumuzda reklam yapmak yasak! Otomatik olarak **1 gün** susturuldun.`);

      // DC Log Gönderimi
      if (settings.dcLogChannel) {
        const logChan = message.guild.channels.cache.get(settings.dcLogChannel);
        if (logChan) {
          logChan.send(`🛡️ **[REKLAM KORUMASI]** ${message.author.tag} reklam yaptığı için 1 gün susturuldu.`);
        }
      }
    } catch {}
    return;
  }

  // 2. Küfür / Argo Koruması (30 Dakika Mute)
  const badWords = ["küfür1", "küfür2", "argo1"]; // Buraya kendi yasaklı kelimelerini ekleyebilirsin
  const containsBadWord = badWords.some(word => lower.includes(word));
  
  if (containsBadWord && !hasStaffPermission(message.member)) {
    try {
      await message.delete();
      const muteDuration = 30 * 60 * 1000; // 30 Dakika
      await message.member.timeout(muteDuration, "Küfür / Argo kullanımı");

      message.channel.send(`⚠️ ${message.author}, argo/küfür kullanımı yasak! Otomatik olarak **30 dakika** susturuldun.`);

      if (settings.dcLogChannel) {
        const logChan = message.guild.channels.cache.get(settings.dcLogChannel);
        if (logChan) {
          logChan.send(`🛡️ **[KÜFÜR KORUMASI]** ${message.author.tag} küfür ettiği için 30 dakika susturuldu.`);
        }
      }
    } catch {}
    return;
  }

  // Klasik Komut Sistemi (Prefix: !)
  if (!content.startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  // !mute @kullanici 30m sebep
  if (command === "mute") {
    if (!hasStaffPermission(message.member)) return message.reply("Bu komut için yetkin yok.");
    const target = message.mentions.members.first();
    const duration = parseDuration(args[1] || "30m");
    const reason = args.slice(2).join(" ") || "Sebep belirtilmedi";

    if (!target || !duration) return message.reply("Kullanım: `!mute @kullanıcı 30m [sebep]`");

    try {
      await target.timeout(duration, reason);
      message.reply(`🔇 ${target} başarıyla susturuldu. Sebep: ${reason}`);

      if (settings.dcLogChannel) {
        const logChan = message.guild.channels.cache.get(settings.dcLogChannel);
        if (logChan) logChan.send(`🔨 **[MUTE]** ${target.user.tag}, yetkili ${message.author.tag} tarafından susturuldu. Sebep: ${reason}`);
      }
    } catch {
      message.reply("Bu üyeyi susturamadım (Yetkim yetmiyor olabilir).");
    }
  }

  // !ban @kullanici sebep
  if (command === "ban") {
    if (!hasStaffPermission(message.member)) return message.reply("Bu komut için yetkin yok.");
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ") || "Sebep belirtilmedi";

    if (!target) return message.reply("Kullanım: `!ban @kullanıcı [sebep]`");

    try {
      await target.ban({ reason });
      message.reply(`🔨 ${target.user.tag} sunucudan yasaklandı.`);

      if (settings.dcLogChannel) {
        const logChan = message.guild.channels.cache.get(settings.dcLogChannel);
        if (logChan) logChan.send(`🚨 **[BAN]** ${target.user.tag} yasaklandı. Yetkili: ${message.author.tag}`);
      }
    } catch {
      message.reply("Bu kullanıcıyı banlayamadım.");
    }
  }

  // !sil 100 (1 ile 1000 arası mesaj silme)
  if (command === "sil") {
    if (!hasStaffPermission(message.member)) return message.reply("Bu komut için yetkin yok.");
    const count = parseInt(args[0]);

    if (isNaN(count) || count < 1 || count > 1000) {
      return message.reply("Lütfen **1 ile 1000** arasında bir sayı belirtin. Örn: `!sil 100`");
    }

    try {
      await message.delete().catch(() => {});
      let deletedTotal = 0;

      // Discord API tek seferde en fazla 100 mesaj sildiği için döngüyle parça parça siliyoruz
      while (deletedTotal < count) {
        const fetchSize = Math.min(count - deletedTotal, 100);
        const fetched = await message.channel.messages.fetch({ limit: fetchSize });
        if (fetched.size === 0) break;
        
        const deleted = await message.channel.bulkDelete(fetched, true);
        deletedTotal += deleted.size;
        if (deleted.size < fetchSize) break;
      }

      const infoMsg = await message.channel.send(`🧹 Başarıyla **${deletedTotal}** mesaj silindi.`);
      setTimeout(() => infoMsg.delete().catch(() => {}), 4000);
    } catch (e) {
      message.reply("Mesajlar silinirken bir hata oluştu (14 günden eski mesajlar toplu silinemez).");
    }
  }
});

// Slash Komutları ve Ticket Buton İşlemleri
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
        new ButtonBuilder()
          .setCustomId("create_ticket")
          .setLabel("Destek Talebi Aç")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🎫")
      );

      await channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: `✅ Ticket sistemi ${channel} kanalına kuruldu!`, ephemeral: true });
    }

    if (interaction.commandName === "dc-ceza") {
      const channel = interaction.options.getChannel("kanal");
      settings.dcLogChannel = channel.id;
      return interaction.reply({ content: `✅ Discord ceza log kanalı ${channel} olarak ayarlandı.`, ephemeral: true });
    }

    if (interaction.commandName === "mc-ceza") {
      const channel = interaction.options.getChannel("kanal");
      settings.mcLogChannel = channel.id;
      return interaction.reply({ content: `✅ Minecraft ceza log kanalı ${channel} olarak ayarlandı.`, ephemeral: true });
    }
  }

  // Buton Yönetimi (Ticket Açma, Üstlenme, Kapatma)
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
          .setDescription(`Merhaba ${member}, yetkililer en kısa sürede burada olacaktır.\n\nİşlem butonlarını aşağıdan kullanabilirsin.`);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("claim_ticket").setLabel("Talebi Üstlen").setStyle(ButtonStyle.Success).setEmoji("🙋‍♂️"),
          new ButtonBuilder().setCustomId("close_ticket").setLabel("Talebi Kapat").setStyle(ButtonStyle.Danger).setEmoji("🔒")
        );

        await ticketChannel.send({ content: `${member}`, embeds: [embed], components: [row] });
        return interaction.editReply({ content: `✅ Destek kanalın açıldı: ${ticketChannel}` });
      } catch {
        return interaction.editReply({ content: "Ticket kanalı açılırken yetki hatası oluştu." });
      }
    }

    if (interaction.customId === "claim_ticket") {
      if (!hasStaffPermission(member)) return interaction.reply({ content: "Bu butonu sadece yetkililer kullanabilir.", ephemeral: true });

      await interaction.message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(`🙋‍♂️ Bu talep **${member.user.tag}** tarafından üstlenildi.`)] });
      return interaction.reply({ content: "Talebi başarıyla üstlendin.", ephemeral: true });
    }

    if (interaction.customId === "close_ticket") {
      if (!hasStaffPermission(member)) return interaction.reply({ content: "Bu kanalı kapatmak için yetkin yok.", ephemeral: true });

      await interaction.reply({ content: "🔒 Destek talebi 5 saniye içinde kapatılıyor..." });
      setTimeout(async () => {
        try { await interaction.channel.delete(); } catch {}
      }, 5000);
    }
  }
});

client.login(process.env.TOKEN);
