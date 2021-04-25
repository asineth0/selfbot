const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const _fetch = require("node-fetch");
const winston = require("winston");
const types = require("./types");
const config = require("../config");

const fetch = async (account, url, config) => {
  const res = await _fetch(url, {
    ...config,
    headers: {
      ...config?.headers,
      authorization: account.token,
    },
  });

  account.log.debug(`http ${res.status} for ${url}`);

  if (res.status === 429) {
    const body = await res.json();
    account.log.debug(`ratelimit ${body.retry_after}s for ${url}`);
    await new Promise((r) => setTimeout(r, body.retry_after * 1000)); //sleep
    return await fetch(account, url, config);
  } else {
    return res;
  }
};

const createLogger = (name) => {
  const dir = `data/${name}`;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {
      recursive: true,
    });
  }

  return winston.createLogger({
    levels: {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      data: 4,
    },
    transports: [
      new winston.transports.Console({
        level: config.debug ? "debug" : "info",
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.printf(
            (info) =>
              `${info.timestamp} (${name}) ${info.level}: ${info.message}`
          )
        ),
      }),
      new winston.transports.File({
        level: config.debug ? "data" : "info",
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(
            (info) => `${info.timestamp} ${info.level}: ${info.message}`
          )
        ),
        filename: `${dir}/latest.log`,
      }),
    ],
  });
};

const logWrite = (file, text) => {
  try {
    fs.mkdirSync(path.dirname(file), {
      recursive: true,
    });
    // eslint-disable-next-line no-empty
  } catch {}

  if (typeof text !== "string") {
    text = JSON.stringify(text);
  }

  fs.appendFileSync(file, `${text}\n`);
};

const getMessages = async (account, channel, limit) => {
  let messages = [];
  let lastMessage;
  let i = 0;

  while (limit != 0) {
    ++i;
    const size = Math.min(100, limit > 0 ? limit : 100);

    let url = `https://discord.com/api/v8/channels/${channel}/messages?limit=${size}`;

    if (lastMessage) {
      url += `&before=${lastMessage}`;
    }

    try {
      const body = await (await fetch(account, url)).json();

      if (body.length < 1) {
        break;
      }

      messages = [...messages, ...body];

      if (body.length < size) {
        break;
      }

      lastMessage = body[body.length - 1].id;
      limit -= size;
    } catch {
      account.log.error(
        `failed getting messages for ${channel} (i: #${i} limit: ${size})`
      );
    }
  }

  return messages;
};

const deleteMessage = async (account, channel, message) => {
  await fetch(
    account,
    `https://discord.com/api/v8/channels/${channel}/messages/${message}`,
    {
      method: "DELETE",
    }
  );

  account.log.info(`deleted ${message} in ${channel}`);
};

const purgeMessages = async (account, channel, limit) => {
  const messages = await getMessages(account, channel, limit);
  let deleted = 0;

  for (const m of messages) {
    if (m.type === types.M_DEFAULT && m.author.id === account.user.id) {
      await deleteMessage(account, channel, m.id);
      deleted++;
    }
  }

  account.log.info(`deleted ${deleted} messages in ${channel}`);
};

const sendMessage = async (account, channel, content) => {
  const res = await fetch(
    account,
    `https://discord.com/api/v8/channels/${channel}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content,
      }),
    }
  );

  return res;
};

const getChannelDir = (account, channel, guild) => {
  let dir = `data/${account.id}/`;
  const { type } = account.channels.find((c) => c.id === channel);

  if (type === types.C_DM) {
    dir += "dms";
  }

  if (type === types.C_GROUP_DM) {
    dir += "groups";
  }

  if (guild) {
    dir += `guilds/${guild}/`;

    if (type === types.C_GUILD_CATEGORY) {
      dir += "category";
    }

    if (type === types.C_GUILD_NEWS) {
      dir += "news";
    }

    if (type === types.C_GUILD_STORE) {
      dir += "store";
    }

    if (type === types.C_GUILD_TEXT) {
      dir += "text";
    }

    if (type === types.C_GUILD_VOICE) {
      dir += "voice";
    }
  }

  return `${dir}/${channel}`;
};

const saveAttachment = async (account, channel, attachment) => {
  const { type } = account.channels.find((c) => c.id === channel);

  if (
    (type === types.C_DM && account.logging.attachments.dm) ||
    (type === types.C_GROUP_DM && account.logging.attachments.group) ||
    (type === types.C_GUILD_TEXT && account.logging.attachments.guild)
  ) {
    const dir = `data/${account.id}/attachments`;
    const ids = `${dir}/.ids`;

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    if (!fs.existsSync(ids)) {
      fs.writeFileSync(ids, "");
    }

    if (fs.readFileSync(ids).toString().includes(`${attachment.id}\n`)) {
      account.log.debug(`attachment ${attachment.id} found by id`);

      return;
    }

    fs.appendFileSync(ids, `${attachment.id}\n`);

    const data = await (await _fetch(attachment.url)).buffer();
    const digest = crypto.createHash("sha256").update(data).digest("hex");

    if (fs.readdirSync(dir).find((f) => f.startsWith(digest))) {
      account.log.debug(
        `attachment ${attachment.id} found by digest ${digest}`
      );

      return;
    }

    let ext = "";

    const filenameParts = attachment.filename.split(".");
    if (filenameParts.length > 1) {
      ext = `.${filenameParts[filenameParts.length - 1]}`;
    }

    fs.writeFileSync(`${dir}/${digest}${ext}`, data);

    account.log.info(`saved attachment ${attachment.id} from ${channel}`);
  }
};

const exportChannel = async (account, channel, guild) => {
  let count = 0;
  const dir = getChannelDir(account, channel, guild);
  const time = Date.now();
  const messages = await getMessages(account, channel, -1);

  for (const message of messages) {
    logWrite(`${dir}/exports/${time}.log`, message);

    if (message?.attachments?.length) {
      for (const attachment of message.attachments) {
        await saveAttachment(account, channel, attachment);
      }
    }

    ++count;
  }

  account.log.info(`saved ${count} messages from ${channel}`);
};

module.exports = {
  createLogger,
  logWrite,
  getMessages,
  deleteMessage,
  purgeMessages,
  sendMessage,
  getChannelDir,
  saveAttachment,
  exportChannel,
};
