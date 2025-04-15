const mongoose = require('mongoose');

// Define the schema for your data
const dataSchema = new mongoose.Schema({
    Voltage: Number,
    Current: Number,
    Power: Number,
    Kwh: Number,
    UsageBill: Number,
    ground: Number,
    PF: Number,
    Hertz: String,
    UsageBillPerMins: Number,
    KwhPerMins: Number,
    Voltage2: Number,
    Current2: Number,
    Power2: Number,
    Kwh2: Number,
    UsageBill2: Number,
    ground2: Number,
    PF2: Number,
    Hertz2: String,
    UsageBillPerMins2: Number,
    KwhPerMins2: Number,
    Voltage3: Number,
    Current3: Number,
    Power3: Number,
    Kwh3: Number,
    UsageBill3: Number,
    ground3: Number,
    PF3: Number,
    Hertz3: String,
    UsageBillPerMins3: Number,
    KwhPerMins3: Number,
    KwhPerN: Number,
    KwhPerN2: Number,
    KwhPerN3: Number,
    ChipId: String,
    DeviceId: Number, // Added DeviceId field
    DeviceTimeStamp: Number,
    DeviceTimeStampDate_UTC: Date,
    DeviceTimeStampDate_Local: Date, 
    CreatedDate: Date,
    CreatedDate_UTC: Date,
    dataSourceId: Number,
    isMaximumDemandProcessed: { type: Boolean, default: false },
});

// Create the model
const Data = mongoose.model('Data', dataSchema);

module.exports = Data;
