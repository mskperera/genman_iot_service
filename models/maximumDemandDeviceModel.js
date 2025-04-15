const mongoose = require('mongoose');

// Define the schema for MaximumDemandDevices
const maximumDemandDevicesSchema = new mongoose.Schema({
    DeviceId: {
        type: Number,  // Device identifier, can be an integer
        required: true,
    },
    MaxDemand: {
        type: Number,  // Maximum demand value calculated from KwhPerN, KwhPerN2, KwhPerN3
        required: true,
    },
    Timestamp: {
        type: String,  // Timestamp of when the maximum demand was recorded (UTC)
        required: true,
    },
    DeviceTimeStamp: {
        type: Number,  // The original device timestamp, in seconds or milliseconds
        required: true,
    },
});

// Create the model for MaximumDemandDevices
const MaximumDemandDevices = mongoose.model('MaximumDemandDevices', maximumDemandDevicesSchema);

module.exports = MaximumDemandDevices;
