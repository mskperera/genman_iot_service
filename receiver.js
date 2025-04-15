const mqtt = require('mqtt');
const http = require('http');
const socketIo = require('socket.io');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// MQTT client configuration
const mqttOptions = {
  clientId: `backend_${Math.random().toString(16).slice(3)}`,
  username: process.env.MQTT_USERNAME || '',
  password: process.env.MQTT_PASSWORD || '',
};
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, mqttOptions);

// MongoDB connection
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';
const mongoClient = new MongoClient(mongoUri);
let db;

// HTTP server and Socket.IO setup
const server = http.createServer();
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Constants
const HEARTBEAT_INTERVAL = 5000;
const GRACE_PERIOD = 12000;

// State
const subscriptionPool = new Set(); // Track active generator IDs
const deviceStatusMap = {}; // Last update timestamp per generator
let heartbeatTimer;

// Determine anomalies based on temperature and battery
const detectAnomalies = (temperatureStr, batteryLevelStr) => {
  // Extract numeric values from strings (e.g., "75°C" -> 75, "20%" -> 20)
  const temperature = parseFloat(temperatureStr);
  const batteryLevel = parseFloat(batteryLevelStr);

  let anomalyStatus = 'normal';
  let anomalyMessage = 'All systems operational';
  if (temperature > 75) {
    anomalyStatus = 'alarm';
    anomalyMessage = 'High temperature detected';
  } else if (temperature > 65) {
    anomalyStatus = 'warning';
    anomalyMessage = 'Moderate temperature rise';
  } else if (batteryLevel < 20) {
    anomalyStatus = 'warning';
    anomalyMessage = 'Low battery level';
  }

  return {
    status: anomalyStatus,
    message: anomalyMessage,
  };
};

// Save data to MongoDB
const saveToMongoDB = async (data) => {
  try {
    const collection = db.collection('generator_data');
    await collection.insertOne({
      ...data,
      timestamp: new Date(),
    });
    console.log(`Saved data for generator ${data.id} to MongoDB`);
  } catch (error) {
    console.error('Error saving to MongoDB:', error);
  }
};

// Load active generators (mocked or from an API)
const loadActiveGenerators = async () => {
  const mockGenerators = ['G-0032', 'G-0034', 'G-0035'];
  mockGenerators.forEach((id) => {
    subscriptionPool.add(id);
    // Initialize deviceStatusMap with a very old timestamp to mark as offline
    deviceStatusMap[id] = 0;
  });
  console.log('Loaded active generators:', Array.from(subscriptionPool));
};

// Notify receiver status via MQTT
const notifyReceiverStatus = (status) => {
  if (mqttClient.connected) {
    mqttClient.publish('receiver/status', status, { qos: 1 }, (err) => {
      if (err) {
        console.error('Error publishing receiver status:', err);
      } else {
        console.log(`Receiver status sent: ${status}`);
      }
    });
  }
};

// Start heartbeat
const startHeartbeat = () => {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    notifyReceiverStatus('active');
  }, HEARTBEAT_INTERVAL);
};

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.emit('testConnection', {
    sender: socket.id,
    status: 'connected to server',
  });

  socket.on('subscribeToGenerator', ({ generatorId }) => {
    try {
      socket.join(generatorId);
      console.log(`Client ${socket.id} subscribed to generator ${generatorId}`);
      // Send initial status for the generator
      const now = Date.now();
      const lastTimestamp = deviceStatusMap[generatorId] || 0;
      const status = now - lastTimestamp <= GRACE_PERIOD ? 'online' : 'offline';
      socket.emit('generatorStatus', { generatorId, status });
    } catch (error) {
      socket.emit('error', { message: 'Failed to subscribe to generator' });
      console.error('Socket error:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// MQTT event handlers
mqttClient.on('connect', async () => {
  console.log('Connected to MQTT broker');
  await loadActiveGenerators();
  notifyReceiverStatus('active');
  startHeartbeat();

  subscriptionPool.forEach((generatorId) => {
    const dataTopic = `generator/${generatorId}/data`;

    mqttClient.subscribe(dataTopic, { qos: 1 }, (err) => {
      if (err) {
        console.error(`Failed to subscribe to ${dataTopic}:`, err);
      } else {
        console.log(`Subscribed to ${dataTopic}`);
      }
    });
  });
});

mqttClient.on('message', async (topic, message) => {
  try {
    const dataMatch = topic.match(/generator\/([A-Z0-9-]+)\/data/);

    if (dataMatch) {
      const generatorId = dataMatch[1];
      const payload = JSON.parse(message.toString());
      console.log(`Received data for ${generatorId}:`, payload);

      if (subscriptionPool.has(generatorId)) {
        // Add anomaly detection
        const anomalies = detectAnomalies(payload.temperature, payload.batteryLevel);
        const enrichedPayload = {
          ...payload,
          anomalies,
        };

        // Save to MongoDB
        // await saveToMongoDB(enrichedPayload);

        // Update status timestamp
        deviceStatusMap[generatorId] = Date.now();

        // Broadcast to Socket.IO clients
        console.log(`realtimeData emit`, generatorId);
        io.to(generatorId).emit('realtimeData', {
          generatorId,
          data: enrichedPayload,
          status: 'online',
        });

        // Send acknowledgment
        mqttClient.publish(
          `generator/${generatorId}/ack`,
          'dataReceived=true',
          { qos: 1 },
          (err) => {
            if (err) {
              console.error(`Failed to send ack for ${generatorId}:`, err);
            }
          }
        );
      } else {
        console.warn(`Generator ${generatorId} not in subscription pool`);
      }
    }
  } catch (error) {
    console.error('Error processing MQTT message:', error);
  }
});

// Periodically update generator statuses
const updateGeneratorStatuses = () => {
  const now = Date.now();
  subscriptionPool.forEach((generatorId) => {
    const lastTimestamp = deviceStatusMap[generatorId] || 0;
    const status = now - lastTimestamp <= GRACE_PERIOD ? 'online' : 'offline';
    io.to(generatorId).emit('generatorStatus', { generatorId, status });
    console.log(`Generator ${generatorId} status: ${status}`);
  });
};

setInterval(updateGeneratorStatuses, 2000);

// MQTT error handling
mqttClient.on('offline', () => {
  console.warn('MQTT client offline. Retrying...');
  clearInterval(heartbeatTimer);
  notifyReceiverStatus('stopped');
});

mqttClient.on('reconnect', () => {
  console.log('Reconnecting to MQTT broker...');
});

mqttClient.on('error', (err) => {
  console.error('MQTT error:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  clearInterval(heartbeatTimer);
  notifyReceiverStatus('stopped');
  mqttClient.end();
  // await mongoClient.close();
  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
});

const startReceiverService = (server) => {
  console.log('Starting MQTT receiver service...');
  io.listen(server); // use same server for socket.io
};

module.exports = { startReceiverService };

// const mqtt = require('mqtt');
// const http = require('http');
// const socketIo = require('socket.io');
// const { MongoClient } = require('mongodb');
// require('dotenv').config();

// // MQTT client configuration
// const mqttOptions = {
//   clientId: `backend_${Math.random().toString(16).slice(3)}`,
//   username: process.env.MQTT_USERNAME || '',
//   password: process.env.MQTT_PASSWORD || '',
// };
// const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, mqttOptions);

// // MongoDB connection
// const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';
// const mongoClient = new MongoClient(mongoUri);
// let db;

// // HTTP server and Socket.IO setup
// const server = http.createServer();
// const io = socketIo(server, {
//   cors: {
//     origin: '*',
//     methods: ['GET', 'POST'],
//   },
// });

// // Constants
// const HEARTBEAT_INTERVAL = 5000;
// const GRACE_PERIOD = 12000;

// // State
// const subscriptionPool = new Set(); // Track active generator IDs
// const deviceStatusMap = {}; // Last update timestamp per generator
// let heartbeatTimer;

// // Determine anomalies based on temperature and battery
// const detectAnomalies = (temperatureStr, batteryLevelStr) => {
//   // Extract numeric values from strings (e.g., "75°C" -> 75, "20%" -> 20)
//   const temperature = parseFloat(temperatureStr);
//   const batteryLevel = parseFloat(batteryLevelStr);

//   let anomalyStatus = 'normal';
//   let anomalyMessage = 'All systems operational';
//   if (temperature > 75) {
//     anomalyStatus = 'alarm';
//     anomalyMessage = 'High temperature detected';
//   } else if (temperature > 65) {
//     anomalyStatus = 'warning';
//     anomalyMessage = 'Moderate temperature rise';
//   } else if (batteryLevel < 20) {
//     anomalyStatus = 'warning';
//     anomalyMessage = 'Low battery level';
//   }

//   return {
//     status: anomalyStatus,
//     message: anomalyMessage,
//   };
// };

// // Save data to MongoDB
// const saveToMongoDB = async (data) => {
//   try {
//     const collection = db.collection('generator_data');
//     await collection.insertOne({
//       ...data,
//       timestamp: new Date(),
//     });
//     console.log(`Saved data for generator ${data.id} to MongoDB`);
//   } catch (error) {
//     console.error('Error saving to MongoDB:', error);
//   }
// };

// // Load active generators (mocked or from an API)
// const loadActiveGenerators = async () => {
//   const mockGenerators = ['G-0032', 'G-0034', 'G-0035'];
//   mockGenerators.forEach((id) => subscriptionPool.add(id));
//   console.log('Loaded active generators:', Array.from(subscriptionPool));
// };

// // Notify receiver status via MQTT
// const notifyReceiverStatus = (status) => {
//   if (mqttClient.connected) {
//     mqttClient.publish('receiver/status', status, { qos: 1 }, (err) => {
//       if (err) {
//         console.error('Error publishing receiver status:', err);
//       } else {
//         console.log(`Receiver status sent: ${status}`);
//       }
//     });
//   }
// };

// // Start heartbeat
// const startHeartbeat = () => {
//   clearInterval(heartbeatTimer);
//   heartbeatTimer = setInterval(() => {
//     notifyReceiverStatus('active');
//   }, HEARTBEAT_INTERVAL);
// };

// // Handle Socket.IO connections
// io.on('connection', (socket) => {
//   console.log('Client connected:', socket.id);

//   socket.emit('testConnection', {
//     sender: socket.id,
//     status: 'connected to server',
//   });

//   socket.on('subscribeToGenerator', ({ generatorId }) => {
//     try {
//       socket.join(generatorId);
//       console.log(`Client ${socket.id} subscribed to generator ${generatorId}`);
//     } catch (error) {
//       socket.emit('error', { message: 'Failed to subscribe to generator' });
//       console.error('Socket error:', error);
//     }
//   });

//   socket.on('disconnect', () => {
//     console.log('Client disconnected:', socket.id);
//   });
// });

// // MQTT event handlers
// mqttClient.on('connect', async () => {
//   console.log('Connected to MQTT broker');
//   await loadActiveGenerators();
//   notifyReceiverStatus('active');
//   startHeartbeat();

//   subscriptionPool.forEach((generatorId) => {
//     const dataTopic = `generator/${generatorId}/data`;

//     mqttClient.subscribe(dataTopic, { qos: 1 }, (err) => {
//       if (err) {
//         console.error(`Failed to subscribe to ${dataTopic}:`, err);
//       } else {
//         console.log(`Subscribed to ${dataTopic}`);
//       }
//     });
//   });
// });

// mqttClient.on('message', async (topic, message) => {
//   try {
//     const dataMatch = topic.match(/generator\/([A-Z0-9-]+)\/data/);

//     if (dataMatch) {
//       const generatorId = dataMatch[1];
//       const payload = JSON.parse(message.toString());
//       console.log(`Received data for ${generatorId}:`, payload);

//       if (subscriptionPool.has(generatorId)) {
//         // Add anomaly detection
//         const anomalies = detectAnomalies(payload.temperature, payload.batteryLevel);
//         const enrichedPayload = {
//           ...payload,
//           anomalies,
//         };

//         // Save to MongoDB
//         // await saveToMongoDB(enrichedPayload);

//         // Update status timestamp
//         deviceStatusMap[generatorId] = Date.now();

//         // Broadcast to Socket.IO clients
//         console.log(`realtimeData emit`, generatorId);
//         io.to(generatorId).emit('realtimeData', {
//           generatorId,
//           data: enrichedPayload,
//           status: 'online',
//         });

//         // Send acknowledgment
//         mqttClient.publish(
//           `generator/${generatorId}/ack`,
//           'dataReceived=true',
//           { qos: 1 },
//           (err) => {
//             if (err) {
//               console.error(`Failed to send ack for ${generatorId}:`, err);
//             }
//           }
//         );
//       } else {
//         console.warn(`Generator ${generatorId} not in subscription pool`);
//       }
//     }
//   } catch (error) {
//     console.error('Error processing MQTT message:', error);
//   }
// });

// // Periodically update generator statuses
// const updateGeneratorStatuses = () => {
//   const now = Date.now();
//   Object.keys(deviceStatusMap).forEach((generatorId) => {
//     const lastTimestamp = deviceStatusMap[generatorId];
//     const status = now - lastTimestamp <= GRACE_PERIOD ? 'online' : 'offline';
//     io.to(generatorId).emit('generatorStatus', { generatorId, status });
//     console.log(`Generator ${generatorId} status: ${status}`);
//   });
// };

// setInterval(updateGeneratorStatuses, 2000);

// // MQTT error handling
// mqttClient.on('offline', () => {
//   console.warn('MQTT client offline. Retrying...');
//   clearInterval(heartbeatTimer);
//   notifyReceiverStatus('stopped');
// });

// mqttClient.on('reconnect', () => {
//   console.log('Reconnecting to MQTT broker...');
// });

// mqttClient.on('error', (err) => {
//   console.error('MQTT error:', err);
// });

// // Graceful shutdown
// process.on('SIGINT', async () => {
//   console.log('Shutting down...');
//   clearInterval(heartbeatTimer);
//   notifyReceiverStatus('stopped');
//   mqttClient.end();
//   // await mongoClient.close();
//   server.close(() => {
//     console.log('Server stopped');
//     process.exit(0);
//   });
// });

// const startReceiverService = (server) => {
//   console.log('Starting MQTT receiver service...');
//   io.listen(server); // use same server for socket.io
// };

// module.exports = { startReceiverService };


// const mqtt = require('mqtt');
// const http = require('http');
// const socketIo = require('socket.io');
// const { MongoClient } = require('mongodb');
// require('dotenv').config();

// // MQTT client configuration
// const mqttOptions = {
//   clientId: `backend_${Math.random().toString(16).slice(3)}`,
//   username: process.env.MQTT_USERNAME || '',
//   password: process.env.MQTT_PASSWORD || '',
// };
// const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, mqttOptions);

// // MongoDB connection
// const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';
// const mongoClient = new MongoClient(mongoUri);
// let db;

// // HTTP server and Socket.IO setup
// const server = http.createServer();
// const io = socketIo(server, {
//   cors: {
//     origin: '*',
//     methods: ['GET', 'POST'],
//   },
// });

// // Constants
// const HEARTBEAT_INTERVAL = 5000;
// const OFFLINE_TIMEOUT = 4000;
// const GRACE_PERIOD = 12000;

// // State
// const subscriptionPool = new Set(); // Track active generator IDs
// const deviceStatusMap = {}; // Last update timestamp per generator
// const deviceTimeouts = {}; // Timeout trackers for offline detection
// let heartbeatTimer;

// // Determine anomalies based on temperature and battery
// const detectAnomalies = (temperatureStr, batteryLevelStr) => {
//   // Extract numeric values from strings (e.g., "75°C" -> 75, "20%" -> 20)
//   const temperature = parseFloat(temperatureStr);
//   const batteryLevel = parseFloat(batteryLevelStr);

//   let anomalyStatus = 'normal';
//   let anomalyMessage = 'All systems operational';
//   if (temperature > 75) {
//     anomalyStatus = 'alarm';
//     anomalyMessage = 'High temperature detected';
//   } else if (temperature > 65) {
//     anomalyStatus = 'warning';
//     anomalyMessage = 'Moderate temperature rise';
//   } else if (batteryLevel < 20) {
//     anomalyStatus = 'warning';
//     anomalyMessage = 'Low battery level';
//   }

//   return {
//     status: anomalyStatus,
//     message: anomalyMessage,
//   };
// };

// // Save data to MongoDB
// const saveToMongoDB = async (data) => {
//   try {
//     const collection = db.collection('generator_data');
//     await collection.insertOne({
//       ...data,
//       timestamp: new Date(),
//     });
//     console.log(`Saved data for generator ${data.id} to MongoDB`);
//   } catch (error) {
//     console.error('Error saving to MongoDB:', error);
//   }
// };

// // Load active generators (mocked or from an API)
// const loadActiveGenerators = async () => {
//   const mockGenerators = ['G-0032', 'G-0034', 'G-0035'];
//   mockGenerators.forEach((id) => subscriptionPool.add(id));
//   console.log('Loaded active generators:', Array.from(subscriptionPool));
// };

// // Notify receiver status via MQTT
// const notifyReceiverStatus = (status) => {
//   if (mqttClient.connected) {
//     mqttClient.publish('receiver/status', status, { qos: 1 }, (err) => {
//       if (err) {
//         console.error('Error publishing receiver status:', err);
//       } else {
//         console.log(`Receiver status sent: ${status}`);
//       }
//     });
//   }
// };

// // Start heartbeat
// const startHeartbeat = () => {
//   clearInterval(heartbeatTimer);
//   heartbeatTimer = setInterval(() => {
//     notifyReceiverStatus('active');
//   }, HEARTBEAT_INTERVAL);
// };

// // Handle Socket.IO connections
// io.on('connection', (socket) => {
//   console.log('Client connected:', socket.id);

//   socket.emit('testConnection', {
//     sender: socket.id,
//     status: 'connected to server',
//   });

//   socket.on('subscribeToGenerator', ({ generatorId }) => {
//     try {
//       socket.join(generatorId);
//       console.log(`Client ${socket.id} subscribed to generator ${generatorId}`);
//     } catch (error) {
//       socket.emit('error', { message: 'Failed to subscribe to generator' });
//       console.error('Socket error:', error);
//     }
//   });

//   socket.on('disconnect', () => {
//     console.log('Client disconnected:', socket.id);
//   });
// });

// // MQTT event handlers
// mqttClient.on('connect', async () => {
//   console.log('Connected to MQTT broker');
//   await loadActiveGenerators();
//   notifyReceiverStatus('active');
//   startHeartbeat();

//   subscriptionPool.forEach((generatorId) => {
//     const dataTopic = `generator/${generatorId}/data`;
//     const statusTopic = `generator/${generatorId}/status`;

//     mqttClient.subscribe([dataTopic, statusTopic], { qos: 1 }, (err) => {
//       if (err) {
//         console.error(`Failed to subscribe to ${dataTopic} or ${statusTopic}:`, err);
//       } else {
//         console.log(`Subscribed to ${dataTopic} and ${statusTopic}`);
//       }
//     });
//   });
// });

// mqttClient.on('message', async (topic, message) => {
//   try {
//     const dataMatch = topic.match(/generator\/([A-Z0-9-]+)\/data/);
//     const statusMatch = topic.match(/generator\/([A-Z0-9-]+)\/status/);

//     if (dataMatch) {
//       const generatorId = dataMatch[1];
//       const payload = JSON.parse(message.toString());
//       console.log(`Received data for ${generatorId}:`, payload);

//       if (subscriptionPool.has(generatorId)) {
//         // Add anomaly detection
//         const anomalies = detectAnomalies(payload.temperature, payload.batteryLevel);
//         const enrichedPayload = {
//           ...payload,
//           anomalies,
//         };

//         // Save to MongoDB
//         // await saveToMongoDB(enrichedPayload);

//         // Update status timestamp
//         deviceStatusMap[generatorId] = Date.now();

//         // Broadcast to Socket.IO clients
//         console.log(`realtimeData emit`, generatorId);
//         io.to(generatorId).emit('realtimeData', {
//           generatorId,
//           data: enrichedPayload,
//           status: 'online',
//         });

//         // Send acknowledgment
//         mqttClient.publish(
//           `generator/${generatorId}/ack`,
//           'dataReceived=true',
//           { qos: 1 },
//           (err) => {
//             if (err) {
//               console.error(`Failed to send ack for ${generatorId}:`, err);
//             }
//           }
//         );
//       } else {
//         console.warn(`Generator ${generatorId} not in subscription pool`);
//       }
//     }

//     if (statusMatch) {
//       const generatorId = statusMatch[1];
//       const status = message.toString().toLowerCase();
//       console.log(`Status for ${generatorId}: ${status}`);

//       // Clear existing timeout
//       if (deviceTimeouts[generatorId]) {
//         clearTimeout(deviceTimeouts[generatorId]);
//       }

//       // Broadcast status
//       io.to(generatorId).emit('generatorStatus', { generatorId, status });

//       // Set offline timeout
//       deviceTimeouts[generatorId] = setTimeout(() => {
//         io.to(generatorId).emit('generatorStatus', { generatorId, status: 'offline' });
//         console.log(`Generator ${generatorId} marked as offline`);
//       }, OFFLINE_TIMEOUT);
//     }
//   } catch (error) {
//     console.error('Error processing MQTT message:', error);
//   }
// });

// // Periodically update generator statuses
// const updateGeneratorStatuses = () => {
//   const now = Date.now();
//   Object.keys(deviceStatusMap).forEach((generatorId) => {
//     const lastTimestamp = deviceStatusMap[generatorId];
//     const status = now - lastTimestamp <= GRACE_PERIOD ? 'online' : 'offline';
//     mqttClient.publish(`generator/${generatorId}/status`, status, { qos: 1 }, (err) => {
//       if (err) {
//         console.error(`Failed to publish status for ${generatorId}:`, err);
//       }
//     });
//   });
// };

// setInterval(updateGeneratorStatuses, 2000);

// // MQTT error handling
// mqttClient.on('offline', () => {
//   console.warn('MQTT client offline. Retrying...');
//   clearInterval(heartbeatTimer);
//   notifyReceiverStatus('stopped');
// });

// mqttClient.on('reconnect', () => {
//   console.log('Reconnecting to MQTT broker...');
// });

// mqttClient.on('error', (err) => {
//   console.error('MQTT error:', err);
// });

// // Graceful shutdown
// process.on('SIGINT', async () => {
//   console.log('Shutting down...');
//   clearInterval(heartbeatTimer);
//   notifyReceiverStatus('stopped');
//   mqttClient.end();
//   // await mongoClient.close();
//   server.close(() => {
//     console.log('Server stopped');
//     process.exit(0);
//   });
// });

// const startReceiverService = (server) => {
//   console.log('Starting MQTT receiver service...');
//   io.listen(server); // use same server for socket.io
// };

// module.exports = { startReceiverService };

// const mqtt = require('mqtt');
// const http = require('http');
// const socketIo = require('socket.io');
// const { MongoClient } = require('mongodb');
// require('dotenv').config();

// // MQTT client configuration
// const mqttOptions = {
//   clientId: `backend_${Math.random().toString(16).slice(3)}`,
//   username: process.env.MQTT_USERNAME || '',
//   password: process.env.MQTT_PASSWORD || '',
// };
// // const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com', mqttOptions);
//  const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, mqttOptions);

// // MongoDB connection
// const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';
// const mongoClient = new MongoClient(mongoUri);
// let db;

// // HTTP server and Socket.IO setup
// const server = http.createServer();
// const io = socketIo(server, {
//   cors: {
//     origin: '*',
//     methods: ['GET', 'POST'],
//   },
// });

// // Constants
// const HEARTBEAT_INTERVAL = 5000;
// const OFFLINE_TIMEOUT = 4000;
// const GRACE_PERIOD = 12000;

// // State
// const subscriptionPool = new Set(); // Track active generator IDs
// const deviceStatusMap = {}; // Last update timestamp per generator
// const deviceTimeouts = {}; // Timeout trackers for offline detection
// let heartbeatTimer;

// // Save data to MongoDB
// const saveToMongoDB = async (data) => {
//   try {
//     const collection = db.collection('generator_data');
//     await collection.insertOne({
//       ...data,
//       timestamp: new Date(),
//     });
//     console.log(`Saved data for generator ${data.id} to MongoDB`);
//   } catch (error) {
//     console.error('Error saving to MongoDB:', error);
//   }
// };

// // Load active generators (mocked or from an API)
// const loadActiveGenerators = async () => {
//   // Replace with your API or database query if needed
//   const mockGenerators = [
//     'G-0032',
//     'G-0034',
//     'G-0035',
//     // Add more IDs as needed
//   ];
//   mockGenerators.forEach((id) => subscriptionPool.add(id));
//   console.log('Loaded active generators:', Array.from(subscriptionPool));
// };

// // Notify receiver status via MQTT
// const notifyReceiverStatus = (status) => {
//   if (mqttClient.connected) {
//     mqttClient.publish('receiver/status', status, { qos: 1 }, (err) => {
//       if (err) {
//         console.error('Error publishing receiver status:', err);
//       } else {
//         console.log(`Receiver status sent: ${status}`);
//       }
//     });
//   }
// };

// // Start heartbeat
// const startHeartbeat = () => {
//   clearInterval(heartbeatTimer);
//   heartbeatTimer = setInterval(() => {
//     notifyReceiverStatus('active');
//   }, HEARTBEAT_INTERVAL);
// };

// // Handle Socket.IO connections
// io.on('connection', (socket) => {
//   console.log('Client connected:', socket.id);

//   socket.emit('testConnection', {
//     sender: socket.id,
//     status: 'connected to server',
//   });

//   // Subscribe client to generator updates
//   socket.on('subscribeToGenerator', ({ generatorId }) => {
//     try {
//       socket.join(generatorId);
//       console.log(`Client ${socket.id} subscribed to generator ${generatorId}`);
//     } catch (error) {
//       socket.emit('error', { message: 'Failed to subscribe to generator' });
//       console.error('Socket error:', error);
//     }
//   });

//   socket.on('disconnect', () => {
//     console.log('Client disconnected:', socket.id);
//   });
// });

// // MQTT event handlers
// mqttClient.on('connect', async () => {
//   console.log('Connected to MQTT broker');
//   await loadActiveGenerators();
//   notifyReceiverStatus('active');
//   startHeartbeat();

//   subscriptionPool.forEach((generatorId) => {
//     const dataTopic = `generator/${generatorId}/data`;
//     const statusTopic = `generator/${generatorId}/status`;

//     mqttClient.subscribe([dataTopic, statusTopic], { qos: 1 }, (err) => {
//       if (err) {
//         console.error(`Failed to subscribe to ${dataTopic} or ${statusTopic}:`, err);
//       } else {
//         console.log(`Subscribed to ${dataTopic} and ${statusTopic}`);
//       }
//     });
//   });
// });

// mqttClient.on('message', async (topic, message) => {
//   try {
//     const dataMatch = topic.match(/generator\/([A-Z0-9-]+)\/data/);
//     const statusMatch = topic.match(/generator\/([A-Z0-9-]+)\/status/);

//     if (dataMatch) {
//       const generatorId = dataMatch[1];
//       const payload = JSON.parse(message.toString());
//       console.log(`Received data for ${generatorId}:`, payload);

//       if (subscriptionPool.has(generatorId)) {
//         // Save to MongoDB
//       //  await saveToMongoDB(payload);

//         // Update status timestamp
//         deviceStatusMap[generatorId] = Date.now();

//         // Broadcast to Socket.IO clients
//         console.log(`realtimeData emit `,generatorId);
//         io.to(generatorId).emit('realtimeData', {
//           generatorId,
//           data: payload,
//           status: 'online',
//         });

//         // Send acknowledgment
//         mqttClient.publish(
//           `generator/${generatorId}/ack`,
//           'dataReceived=true',
//           { qos: 1 },
//           (err) => {
//             if (err) {
//               console.error(`Failed to send ack for ${generatorId}:`, err);
//             }
//           }
//         );
//       } else {
//         console.warn(`Generator ${generatorId} not in subscription pool`);
//       }
//     }

//     if (statusMatch) {
//       const generatorId = statusMatch[1];
//       const status = message.toString().toLowerCase();
//       console.log(`Status for ${generatorId}: ${status}`);

//       // Clear existing timeout
//       if (deviceTimeouts[generatorId]) {
//         clearTimeout(deviceTimeouts[generatorId]);
//       }

//       // Broadcast status
//       io.to(generatorId).emit('generatorStatus', { generatorId, status });

//       // Set offline timeout
//       deviceTimeouts[generatorId] = setTimeout(() => {
//         io.to(generatorId).emit('generatorStatus', { generatorId, status: 'offline' });
//         console.log(`Generator ${generatorId} marked as offline`);
//       }, OFFLINE_TIMEOUT);
//     }
//   } catch (error) {
//     console.error('Error processing MQTT message:', error);
//   }
// });

// // Periodically update generator statuses
// const updateGeneratorStatuses = () => {
//   const now = Date.now();
//   Object.keys(deviceStatusMap).forEach((generatorId) => {
//     const lastTimestamp = deviceStatusMap[generatorId];
//     const status = now - lastTimestamp <= GRACE_PERIOD ? 'online' : 'offline';
//     mqttClient.publish(`generator/${generatorId}/status`, status, { qos: 1 }, (err) => {
//       if (err) {
//         console.error(`Failed to publish status for ${generatorId}:`, err);
//       }
//     });
//   });
// };

// setInterval(updateGeneratorStatuses, 2000);

// // MQTT error handling
// mqttClient.on('offline', () => {
//   console.warn('MQTT client offline. Retrying...');
//   clearInterval(heartbeatTimer);
//   notifyReceiverStatus('stopped');
// });

// mqttClient.on('reconnect', () => {
//   console.log('Reconnecting to MQTT broker...');
// });

// mqttClient.on('error', (err) => {
//   console.error('MQTT error:', err);
// });

// // Graceful shutdown
// process.on('SIGINT', async () => {
//   console.log('Shutting down...');
//   clearInterval(heartbeatTimer);
//   notifyReceiverStatus('stopped');
//   mqttClient.end();
//   //await mongoClient.close();
//   server.close(() => {
//     console.log('Server stopped');
//     process.exit(0);
//   });
// });


// const startReceiverService = (server) => {
//     console.log('Starting MQTT receiver service...');
//     io.listen(server); // use same server for socet.io
// };

// module.exports = { startReceiverService };