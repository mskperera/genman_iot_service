const mqtt = require('mqtt');
const { saveToMongoDB } = require('./utils/saveToDB');
const client = require('./config/mqttConfig');
const http = require('http');
const socketIo = require("socket.io");

const heartbeatInterval = 5000; // Send heartbeat every 5 seconds
let heartbeatTimer;
const subscriptionPool = [];
const offlineTimeout = 5000; // 10 seconds to consider device offline
let apps = [];
const deviceStatusMap = {}; // To store last received timestamp for each chipId


const server = http.createServer();
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

server.listen(3002, () => {
    console.log("socketIo Server is running on http://localhost:3002");
  });
  



const handleSocketError = (socket, error) => {
    console.error(`Error on socket ${socket.id}:`, error.message || error);
    socket.emit("error", { message: "An unexpected error occurred" });
  };
  
  io.on("connection", (socket) => {
    console.log("A user connectedooo", socket.id);
  
    io.to(socket.id).emit("testConnection", {
        sender: socket.id,
        status: 'connected to servererrr',
      });
   

    socket.on("connectDeviceToTheService", ({ chipId }) => {
      try {

        // io.to(socket.id).emit("testConnection", {
        //     sender: socket.id,
        //     status: 'connected',
        //   });
     
        const index = apps.findIndex((f) => f.chipId === chipId && f.socketId===socket.id);
        if (index !== -1) {
          apps.splice(index, 1);
        }
  
        //const chipId=deviceRegistry.find(d=>d)
        apps.push({ chipId, socketId: socket.id });
        console.log(" apps",apps);
      //  }
      } catch (error) {
        handleSocketError(socket, error);
      }
    });

});


const loadActiveDevices = async () => {
    try {
        const response = await fetch("https://regression_smartenergymeter_api.fidaglobal.com/api/device/getChipIds");
        const data = await response.json();
        
        const chipIds = data.map(device => device.chipId);

      //  console.log("chipIds:", chipIds);

        chipIds.forEach((chipId) => {
            subscriptionPool.push({ chipId });
        });
      
       
    } catch (error) {
        console.error("Error fetching chip IDs:", error);
    }
};


// // Load devices into subscription pool
// const loadActiveDevices = () => {
//     const chipIds = ["1","0857A75C7BCC","3"];
//     chipIds.forEach((chipId) => {
//         subscriptionPool.push({ chipId });
//     });

// };

const notifyReceiverStatus = (status) => {
    if (client.connected) {
        client.publish('receiver/status', status, (err) => {
            if (err) {
                console.error('Error publishing receiver status:', err);
            } else {
                console.log(`Receiver status sent: ${status}`);
            }
        });
    }
};

const startHeartbeat = () => {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
        notifyReceiverStatus('active');
    }, heartbeatInterval);
};

client.on('connect',async () => {
   await loadActiveDevices();
    console.log('Connected to MQTT broker.');
    console.log("Subscription Pool Updated:", subscriptionPool);
    notifyReceiverStatus('active');
    startHeartbeat();

    subscriptionPool.forEach((o) => {
        const chipId = o.chipId;
        const dynamicTopic = `device/${chipId}/data`;

        
        client.subscribe(dynamicTopic, (err) => {
            if (err) {
                console.error(`Failed to subscribe to topic ${dynamicTopic}:`, err);
            } else {
                console.log(`Subscribed to topic: ${dynamicTopic}`);
            }
        });
    });
});

client.on('message', (topic, message) => {
    console.log('topic:', topic);
 
    const deviceTopicMatch = topic.match(/device\/([a-zA-Z0-9]+)\/data/);
    if (deviceTopicMatch) {
        const chipId = deviceTopicMatch[1];

        const payload = JSON.parse(message.toString());
        console.log(`Received data for chipId ${chipId}:`, payload);

        saveToMongoDB(payload);

         // Update device status to online
         deviceStatusMap[chipId] = Date.now();

         // Notify relevant clients
         const appArr = apps.filter(app => app.chipId === chipId);
         const status = 'online';

        console.log('app-------s',appArr)
      //  if (app) {
        appArr.map(app=>{
            io.to(app.socketId).emit("realtimeData", {
                sender: `mqtt topic ${topic}`,
                chipId: chipId,
                realtimeData: payload,
                status: status
            });
        });
            
      //  }
      
        const ackTopic = `device/${chipId}/ack`;
        client.publish(ackTopic, 'dataReceived=true', (err) => {
            if (err) {
                console.error(`Failed to send acknowledgment to device ${chipId}:`, err);
            } else {
                console.log(`Acknowledgment sent to device ${chipId}`);
            }
        });
    }
});

// client.on('message', (topic, message) => {

//     console.log('message   /////:',message);
//     const deviceTopicMatch = topic.match(/device\/(\d+)\/data/);
//     if (deviceTopicMatch) {
//         const chipId = deviceTopicMatch[1];

//         const payload = JSON.parse(message.toString());
//        /// console.log(`Received data for chipId `,payload);

//         // Save the payload to MongoDB    console.log(`Received data for chipId ${chipId}:`, payload);
//         console.log('chipId:',chipId);
//         saveToMongoDB(payload);

// const app=apps.find(a=>a.chipId===chipId);
// console.log('app',app);
// if(app){
//         io.to(app.socketId).emit("realtimeData", {
//             sender: `mqtt topic ${deviceTopicMatch}`,
//             chipId:chipId,
//             realtimeData: payload,
//           });

//         }



//         // Acknowledge receipt of data
//         const ackTopic = `device/${chipId}/ack`;
//         client.publish(ackTopic, 'dataReceived=true', (err) => {
//             if (err) {
//                 console.error(`Failed to send acknowledgment to device ${chipId}:`, err);
//             } else {
//                 console.log(`Acknowledgment sent to device ${chipId}`);
//             }
//         });
//     }
// });

// Handle connection loss
client.on('offline', () => {
    console.warn('MQTT client is offline. Retrying connection...');
    clearInterval(heartbeatTimer); // Stop heartbeat while offline
    notifyReceiverStatus('stopped');
});

client.on('reconnect', () => {
    console.log('Attempting to reconnect to MQTT broker...');
});


// Send device status (online/offline) updates
const updateDeviceStatuses = () => {
    const now = Date.now();

    Object.keys(deviceStatusMap).forEach((chipId) => {
        const lastTimestamp = deviceStatusMap[chipId];
        const status = (now - lastTimestamp <= offlineTimeout) ? 'online' : 'offline';
        deviceStatusMap[chipId] = { lastTimestamp, status }; // Update status in the map
    });

    // Emit the updated statuses to all relevant clients
    apps.forEach((app) => {
        const { chipId, socketId } = app;
        const status = deviceStatusMap[chipId]?.status || 'offline';
        io.to(socketId).emit("deviceStatusUpdate", { chipId, status });
    });
};

// Start periodic device status checking
setInterval(updateDeviceStatuses, 3000); // Check statuses every 3 seconds


process.on('SIGINT', () => {
    console.log('Stopping MQTT receiver...');
    clearInterval(heartbeatTimer);
    notifyReceiverStatus('stopped');
    client.end(() => {
        console.log('Disconnected from MQTT broker.');
        process.exit(0);
    });
});


client.on('error', (err) => {
    console.error('Connection error:', err);
});

const startReceiverService = () => {
    console.log('Starting MQTT receiver service...');
};

module.exports = { startReceiverService };
