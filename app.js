const express = require('express');
const http = require('http');
const { startReceiverService } = require('./receiver');
const dataRoutes = require('./routes/dataRoutes');

const app = express();
const server = http.createServer(app); // Single server for Express and Socket.IO

// Middleware
app.use(express.json());

// Express routes
app.use('/api', dataRoutes);

// Initialize MQTT and Socket.IO service with the shared server
startReceiverService(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = server;