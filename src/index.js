const cluster = require("cluster");
const WebSocket = require("ws");
const erlpack = require("erlpack");
const zlib = require("zlib-sync");
const util = require("./util");
const config = require("../config.json");

if (cluster.isMaster) {
  for (const account of config.accounts) {
    cluster.fork({
      ACCOUNT: JSON.stringify(account),
    });
  }
} else {
  const account = JSON.parse(process.env.ACCOUNT);
  account.log = util.createLogger(account.id);

  const connect = () => {
    const ws = new WebSocket(
      "wss://gateway.discord.gg?v=8&encoding=etf&compress=zlib-stream"
    );

    //etf wrapper
    ws._send = ws.send;
    ws.send = (data) => {
      account.log.debug(`tx: op=${data.op}`);
      account.log.data(`tx: ${JSON.stringify(data)}`);

      ws._send(erlpack.pack(data));
    };

    ws.onopen = () => {
      ws.lastHeartbeat = Date.now();
      ws.clientDisconnect = false;
      ws.inflate = new zlib.Inflate();
    };

    ws.onmessage = async ({ data }) => {
      //zlib decompress
      ws.inflate.push(data, zlib.Z_SYNC_FLUSH);
      data = ws.inflate.result;

      //etf unpack
      data = erlpack.unpack(data);
      ws.seq = data.s;

      let line = [];
      if (data.op !== null) line.push(`op=${data.op}`);
      if (data.t !== null) line.push(`t=${data.t}`);
      if (data.s !== null) line.push(`s=${data.s}`);
      account.log.debug(`rx: ${line.join(" ")}`);
      account.log.data(`rx: ${JSON.stringify(data)}`);

      //reconnect
      if (data.op === 7) {
        account.log.warn("reconnecting: requested by server");
        ws.clientDisconnect = true;
        ws.close();
      }

      //bad session
      if (data.op === 9) {
        account.log.warn("reconnecting: bad session");
        account.session = null;
        ws.clientDisconnect = true;
        ws.close();
      }

      //hello
      if (data.op === 10) {
        //heartbeat
        ws.heartbeatLoop = setInterval(() => {
          if (Date.now() > ws.lastHeartbeat + data.d.heartbeat_interval * 2) {
            account.log.warn("reconnecting: didn't receive heartbeat ack");
            ws.clientDisconnect = true;
            ws.close();
          }

          ws.send({
            op: 1,
            d: ws.seq,
          });
        }, data.d.heartbeat_interval);

        let res;

        if (account.session) {
          //resume
          res = {
            op: 6,
            d: {
              token: account.token,
              session_id: account.session,
              seq: account.seq,
            },
          };
        } else {
          //identify
          res = {
            op: 2,
            d: {
              token: account.token,
              intents: 32767,
              properties: {},
            },
          };
        }

        ws.send(res);
      }

      //heartbeat ack
      if (data.op === 11) {
        ws.lastHeartbeat = Date.now();
      }

      //event
      if (data.op === 0) {
        if (data.t === "READY") {
          account.user = data.d.user;
          account.session = data.d.session_id;
          account.channels = data.d.private_channels;
          data.d.guilds.map((g) => {
            account.channels = [...account.channels, ...g.channels];
          });

          account.log.info(
            `logged in as ${account.user.username}#${account.user.discriminator}`
          );
        }

        if (data.t === "READY" || data.t === "RESUMED") {
          account.connectTries = 0;
        }

        //channel type caching
        if (data.t === "CHANNEL_CREATE") {
          account.channels.push(data.d); //store for lookup of channel types.
        }

        //logging
        if (data.t === "PRESENCE_UPDATE" && account.logging.presences) {
          util.logWrite(
            `data/${account.id}/presences/${data.d.user.id}.log`,
            data
          );
        }

        if (
          data.t === "MESSAGE_CREATE" ||
          data.t === "MESSAGE_UPDATE" ||
          data.t === "MESSAGE_DELETE" ||
          (data.t === "MESSAGE_ACK" && account.logging.messages) ||
          (data.t === "TYPING_START" && account.logging.typing) ||
          (data.t === "VOICE_STATE_UPDATE" && account.logging.voice)
        ) {
          if (!data.d.channel_id) return;

          const dir = util.getChannelDir(
            account,
            data.d.channel_id,
            data.d.guild_id
          );

          util.logWrite(`${dir}/events.log`, data);
        }

        //attachments
        if (data.d?.attachments?.length) {
          for (const attachment of data.d.attachments) {
            util.saveAttachment(account, data.d.channel_id, attachment);
          }
        }

        //commands
        if (
          data.t === "MESSAGE_CREATE" &&
          data.d.author.id === account.user.id &&
          account.commands.enabled &&
          data.d.content.startsWith(account.commands.prefix)
        ) {
          await util.deleteMessage(account, data.d.channel_id, data.d.id);

          const args = data.d.content.split(" ");
          const cmd = args.shift().slice(1);

          if (cmd === "p" || cmd === "ping") {
            await util.sendMessage(account, data.d.channel_id, "pong");
          }

          if (cmd === "d" || cmd === "delete") {
            const limit = Number(args[0]);
            if (!limit) return;

            await util.purgeMessages(account, data.d.channel_id, limit);
          }

          if (cmd === "c" || cmd === "clear") {
            await util.purgeMessages(account, data.d.channel_id, -1);
          }

          if (cmd === "e" || cmd === "export") {
            await util.exportChannel(
              account,
              data.d.channel_id,
              data.d.guild_id
            );
          }
        }

        //slobtot
        if (
          data.t === "MESSAGE_CREATE" &&
          data.d.author.id === "346353957029019648" &&
          data.d.content.startsWith("Someone just dropped their wallet")
        ) {
          await util.sendMessage(account, data.d.channel_id, "~grab");
        }
      }
    };

    ws.onclose = () => {
      clearInterval(ws.heartbeatLoop);

      if (++account.connectTries >= 5) {
        account.log.error(`failed to reconnect ${account.connectTries} times`);
        process.exit(1);
      } else {
        if (!ws.clientDisconnect) {
          account.log.warn("reconnecting: websocket closed");
        }

        setTimeout(connect, 10e3);
      }
    };

    account.ws = ws;
  };

  connect();
}
