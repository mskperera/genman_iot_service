const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    await mongoose.connect("mongodb://localhost:27017/mqttData",
     { useNewUrlParser: true, useUnifiedTopology: true,
      socketTimeoutMS: 60000,
      serverSelectionTimeoutMS: 30000,
      });
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  }
};

module.exports = connectDB;
