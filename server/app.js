const argv = require('minimist')(process.argv.slice(2));
const { EventEmitter } = require('events');
const { Server } = require('ws');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const emitter = new EventEmitter();
let server = express();

const { logger } = require('./logger');

server.use(cors());

server = server.listen(process.env.PORT || 80, () =>
  logger('INFO', 'Server', `Server started on port ${process.env.PORT || 80}`),
);

const ip = argv.ip || '';
const port = argv.port || '';

if (!ip || !port) {
  logger('ERROR', 'Server', 'Missing ip or port');
  process.exit(1);
}

const feedURL = `http://${ip}:${port}/shot.jpg`;

let mode = 'pilot';

let takeScreenshot = setInterval(() => {
  if (mode === 'auto-pilot') {
    axios.get(feedURL).then((response) => {
      const direction = getDirection(response.data);
      emitter.emit('sendDirections', direction);
    });
  } else {
    clearInterval(takeScreenshot);
  }
}, 1000);

const wss = new Server({ server });

let chip = null;
const devices = [];

emitter.on('chipCall', (data) => {
  devices.forEach((device) => {
    try {
      device.send(data, { binary: false });
      logger('INFO', 'Master Sent', data);
    } catch (error) {
      logger('ERROR', 'Master Send', error);
    }
  });
});

emitter.on('sendDirections', (direction) => {
  if (chip) {
    chip.send(direction);
    logger('INFO', 'Master Recieved', direction);
  }
});

wss.on('connection', function connection(ws, req) {
  switch (req.url) {
    case '/master':
      chip = ws;
      logger('INFO', 'Master', 'Master Connected');
      ws.on('message', function incoming(message) {
        logger('DATA', 'Master', message);
        try {
          readings = JSON.parse(message);
        } catch (error) {
          logger('ERROR', 'Master Data', 'Parsing JSON Data');
        }
        axios
          .get(feedURL)
          .then(function (response) {
            emitter.emit('chipCall', response.data);
          })
          .catch(function (error) {
            logger('ERROR', 'Master Data', 'Getting Image');
          });
      });
      break;
    case '/slave':
      logger('INFO', 'Slave', 'Slave Connected');
      devices.push(ws);
      ws.on('message', (message) => {
        message = message.toString();
        if (message === 'auto-pilot') {
          mode = 'auto-pilot';
          logger('INFO', 'Slave', 'Auto Pilot Mode');
          takeScreenshot();
        } else if (message === 'pilot') {
          mode = 'pilot';
          logger('INFO', 'Slave', 'Pilot Mode');
          clearInterval(takeScreenshot);
        } else {
          logger('INFO', 'Slave', 'Send Pilot Direction');
          emitter.emit('sendDirections', message);
        }
      });
      break;
  }
});

wss.on('error', (error) => {
  logger('ERROR', 'Server', error);
});