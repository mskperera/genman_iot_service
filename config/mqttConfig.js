const { default: mqtt } = require("mqtt");

const client = mqtt.connect('mqtt://34.124.201.85:1883', {
    reconnectPeriod: 5000, // Retry connection every 5 seconds
});
module.exports = client;