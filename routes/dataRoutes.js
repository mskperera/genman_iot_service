const express = require('express');
const router = express.Router();
const MaximumDemandDevices = require('../models/maximumDemandDeviceModel');
const { loadActiveDevices } = require('../receiver');
const { getEnergyMeterData, getEnergyMeterGroupFrequency, getEntergyMeterGroupHourlyTimeline } = require('../mongodb/data');


router.get('/energy-meter-data-group-frequency-json', async (req, res) => {
    try {
        const { deviceId, startDate, endDate, frequency } = req.query;

        if (!startDate || !endDate || !deviceId || !frequency) {
            return res.status(400).send('<h1>Missing required parameters: deviceId, startDate, endDate, or frequency.</h1>');
        }


        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start) || isNaN(end)) {
            return res.status(400).send('<h1>Invalid date format. Please use a valid date and time format (e.g., YYYY-MM-DDTHH:mm:ss).</h1>');
        }

       const timelineData=await getEnergyMeterGroupFrequency(deviceId,start,end,frequency);

     

        res.json(timelineData);
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).send('<h1>Error retrieving data</h1>');
    }
});

router.get('/reload-devices', async (req, res) => {
    try {

       await loadActiveDevices();

        res.json({message:"Reloaded succesfully."});
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).send('<h1>Error retrieving data</h1>');
    }
});

router.get('/energy-meter-consumed-kwh-api', async (req, res) => {
    try {
        const { chipId,deviceId, startDate, endDate, timezoneOffset,sortOrder,top } = req.query;

    const data=await getEnergyMeterData(chipId,deviceId, startDate, endDate, timezoneOffset,sortOrder,top);

        res.json(data);  
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);

    }
});

router.get('/energy-meter-data-json', async (req, res) => {
    try {
        const { chipId,deviceId, startDate, endDate, timezoneOffset,sortOrder,top } = req.query;

    const data=await getEnergyMeterData(chipId,deviceId, startDate, endDate, timezoneOffset,sortOrder,top);


    if (!data.length) {
      return res.status(400).json('No Data Found for the given criteria');
    }

        res.json(data);  
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).json('Error retrieving data');
    }
});

router.get('/energy-meter-data-group-hourly-timeline-api', async (req, res) => {
    try {
        const { deviceId, startDate, endDate } = req.query;

        if (!startDate || !endDate || !deviceId) {
            return res.status(400).send('<h1>Missing required parameters: deviceId, startDate, or endDate.</h1>');
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start) || isNaN(end)) {
            return res.status(400).send('<h1>Invalid date format. Please use a valid date and time format (e.g., YYYY-MM-DDTHH:mm:ss).</h1>');
        }

       const timelineData=await getEntergyMeterGroupHourlyTimeline(deviceId,start,end);

     

        res.json(timelineData);
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).send('<h1>Error retrieving data</h1>');
    }
});

router.get('/view-maximum-demand', async (req, res) => {
    try {
        const { deviceId } = req.query;

        if (!deviceId) {
            return res.status(400).json({ error: 'DeviceId is required' });
        }

        const maxDemandRecord = await MaximumDemandDevices.find({ DeviceId: parseInt(deviceId, 10) })
            .sort({ DeviceTimeStamp: -1 })
            .lean();

        if (!maxDemandRecord) {
            return res.status(404).json({ error: 'No maximum demand data found for this device' });
        }

        res.json({
            status: 'Success',
            message: 'Maximum demand data retrieved successfully',
            data: maxDemandRecord
        });

    } catch (err) {
        console.error('Error retrieving maximum demand:', err);
        res.status(500).json({ error: 'Failed to retrieve maximum demand data' });
    }
});

router.get('/view-max-demand-value', async (req, res) => {
    try {
        const { deviceId } = req.query;

        if (!deviceId) {
            return res.status(400).json({ error: 'DeviceId is required' });
        }

        const maxDemandRecord = await MaximumDemandDevices.findOne({ DeviceId: parseInt(deviceId, 10) })
            .sort({ MaxDemand: -1 })
            .lean();

        if (!maxDemandRecord) {
            return res.status(404).json({ error: 'No maximum demand data found for this device' });
        }

        res.json({
            status: 'Success',
            message: 'Maximum demand data retrieved successfully',
            data: {
                DeviceId: maxDemandRecord.DeviceId,
                MaxDemand: maxDemandRecord.MaxDemand,
                Timestamp: maxDemandRecord.Timestamp,
                DeviceTimeStamp: maxDemandRecord.DeviceTimeStamp,
            }
        });

    } catch (err) {
        console.error('Error retrieving maximum demand:', err);
        res.status(500).json({ error: 'Failed to retrieve maximum demand data' });
    }
});

module.exports = router;
