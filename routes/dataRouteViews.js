const express = require('express');
const router = express.Router();
const Data = require('../models/dataModel');
const { getEnergyMeterData, getEnergyMeterGroupFrequency, getEntergyMeterGroupHourlyTimeline } = require('../mongodb/data');


router.get('/energy-meter-data-group-hourly-timeline-view', async (req, res) => {
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

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Energy Meters Data (Timeline)</title>
                <style>
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 20px 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    th {
                        background-color: #f2f2f2;
                    }
                    tr:nth-child(even) {
                        background-color: #f9f9f9;
                    }
                    tr:hover {
                        background-color: #f1f1f1;
                    }
                </style>
            </head>
            <body>
                <h1>Energy Meters Data (Hourly Timeline)</h1>
                <p>Total Time Slots: ${timelineData.length}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Month</th>
                            <th>Day</th>
                            <th>Hour</th>
                            <th>DateTime (First - Local Time)</th>
                            <th>Total KwhPerN</th>
                            <th>Total KwhPerN2</th>
                            <th>Total KwhPerN3</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        timelineData.forEach((item) => {
            const { _id, firstDatetime, totalKwhPerN, totalKwhPerN2, totalKwhPerN3, count } = item;
            html += `
                <tr>
                    <td>${_id.year}</td>
                    <td>${_id.month}</td>
                    <td>${_id.day}</td>
                    <td>${_id.hour}</td>
                    <td>${firstDatetime.toLocaleString()}</td>
                    <td>${totalKwhPerN !== null ? totalKwhPerN : 'null'}</td>
                    <td>${totalKwhPerN2 !== null ? totalKwhPerN2 : 'null'}</td>
                    <td>${totalKwhPerN3 !== null ? totalKwhPerN3 : 'null'}</td>
                    <td>${count}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </body>
            </html>
        `;

        res.send(html);
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).send('<h1>Error retrieving data</h1>');
    }
});


router.get('/energy-meter-data-group-daily-timeline', async (req, res) => {
    try {
        const { deviceId, startDate, endDate } = req.query;

        if (!startDate || !endDate || !deviceId) {
            return res.status(400).send('<h1>Missing required parameters: deviceId, startDate, or endDate.</h1>');
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start) || isNaN(end)) {
            return res.status(400).send('<h1>Invalid date format. Please use a valid date format (e.g., YYYY-MM-DD).</h1>');
        }

        const deviceIdInt = parseInt(deviceId);

        const filterCriteria = {
            DeviceId: deviceIdInt,
            DeviceTimeStampDate_Local: { $gte: start, $lte: end }
        };

        const data = await Data.aggregate([
            { $match: filterCriteria },
            {
                $addFields: {
                    localDateParts: {
                        $dateToParts: {
                            date: "$DeviceTimeStampDate_Local",
                            timezone: "Asia/Colombo"
                        }
                    }
                }
            },
            {
                $group: {
                    _id: {
                        day: "$localDateParts.day",
                        month: "$localDateParts.month",
                        year: "$localDateParts.year"
                    },
                    firstDatetime: { $min: "$DeviceTimeStampDate_Local" },
                    totalKwhPerN: { $sum: "$KwhPerN" },
                    totalKwhPerN2: { $sum: "$KwhPerN2" },
                    totalKwhPerN3: { $sum: "$KwhPerN3" },
                    count: { $sum: 1 }
                }
            }
        ]);

        const timeSlots = [];
        let current = new Date(start);
        while (current <= end) {
            timeSlots.push(new Date(current));
            current.setDate(current.getDate() + 1); 
        }

        const dataMap = data.reduce((map, item) => {
            const { _id } = item;
            const dateKey = `${_id.year}-${_id.month}-${_id.day}`;
            map[dateKey] = item;
            return map;
        }, {});

        const timelineData = timeSlots.map((slot) => {
            const dateKey = `${slot.getFullYear()}-${slot.getMonth() + 1}-${slot.getDate()}`;
            const matchedData = dataMap[dateKey];
            return matchedData
                ? {
                      ...matchedData,
                      date: slot.toLocaleDateString()
                  }
                : {
                      _id: {
                          year: slot.getFullYear(),
                          month: slot.getMonth() + 1,
                          day: slot.getDate()
                      },
                      firstDatetime: slot,
                      totalKwhPerN: null,
                      totalKwhPerN2: null,
                      totalKwhPerN3: null,
                      count: 0,
                      date: slot.toLocaleDateString()
                  };
        });

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Energy Meters Data (Daily Timeline)</title>
                <style>
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 20px 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    th {
                        background-color: #f2f2f2;
                    }
                    tr:nth-child(even) {
                        background-color: #f9f9f9;
                    }
                    tr:hover {
                        background-color: #f1f1f1;
                    }
                </style>
            </head>
            <body>
                <h1>Energy Meters Data (Daily Timeline)</h1>
                <p>Total Time Slots: ${timelineData.length}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Month</th>
                            <th>Day</th>
                            <th>Date (Local Time)</th>
                            <th>Total KwhPerN</th>
                            <th>Total KwhPerN2</th>
                            <th>Total KwhPerN3</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        timelineData.forEach((item) => {
            const { _id, firstDatetime, totalKwhPerN, totalKwhPerN2, totalKwhPerN3, count } = item;
            html += `
                <tr>
                    <td>${_id.year}</td>
                    <td>${_id.month}</td>
                    <td>${_id.day}</td>
                    <td>${firstDatetime.toLocaleDateString()}</td>
                    <td>${totalKwhPerN !== null ? totalKwhPerN : 'null'}</td>
                    <td>${totalKwhPerN2 !== null ? totalKwhPerN2 : 'null'}</td>
                    <td>${totalKwhPerN3 !== null ? totalKwhPerN3 : 'null'}</td>
                    <td>${count}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </body>
            </html>
        `;

        res.send(html);
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).send('<h1>Error retrieving data</h1>');
    }
});

router.get('/energy-meter-data-group-monthly-timeline', async (req, res) => {
    try {
        const { deviceId, startDate, endDate } = req.query;

        if (!startDate || !endDate || !deviceId) {
            return res.status(400).send('<h1>Missing required parameters: deviceId, startDate, or endDate.</h1>');
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start) || isNaN(end)) {
            return res.status(400).send('<h1>Invalid date format. Please use a valid date format (e.g., YYYY-MM-DD).</h1>');
        }

        const deviceIdInt = parseInt(deviceId);

        const filterCriteria = {
            DeviceId: deviceIdInt,
            DeviceTimeStampDate_Local: { $gte: start, $lte: end }
        };

        const data = await Data.aggregate([
            { $match: filterCriteria },
            {
                $addFields: {
                    localDateParts: {
                        $dateToParts: {
                            date: "$DeviceTimeStampDate_Local",
                            timezone: "Asia/Colombo"
                        }
                    }
                }
            },
            {
                $group: {
                    _id: {
                        year: "$localDateParts.year",
                        month: "$localDateParts.month"
                    },
                    firstDatetime: { $min: "$DeviceTimeStampDate_Local" },
                    totalKwhPerN: { $sum: "$KwhPerN" },
                    totalKwhPerN2: { $sum: "$KwhPerN2" },
                    totalKwhPerN3: { $sum: "$KwhPerN3" },
                    count: { $sum: 1 }
                }
            }
        ]);

        const timeSlots = [];
        let current = new Date(start);
        while (current <= end) {
            timeSlots.push(new Date(current));
            current.setMonth(current.getMonth() + 1);
        }

        const dataMap = data.reduce((map, item) => {
            const { _id } = item;
            const dateKey = `${_id.year}-${_id.month}`;
            map[dateKey] = item;
            return map;
        }, {});

        const timelineData = timeSlots.map((slot) => {
            const dateKey = `${slot.getFullYear()}-${slot.getMonth() + 1}`;
            const matchedData = dataMap[dateKey];
            return matchedData
                ? {
                      ...matchedData,
                      date: slot.toLocaleDateString()
                  }
                : {
                      _id: {
                          year: slot.getFullYear(),
                          month: slot.getMonth() + 1
                      },
                      firstDatetime: slot,
                      totalKwhPerN: null,
                      totalKwhPerN2: null,
                      totalKwhPerN3: null,
                      count: 0,
                      date: slot.toLocaleDateString()
                  };
        });

        let html = `<!DOCTYPE html>
            <html>
            <head>
                <title>Energy Meters Data (Monthly Timeline)</title>
                <style>
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 20px 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    th {
                        background-color: #f2f2f2;
                    }
                    tr:nth-child(even) {
                        background-color: #f9f9f9;
                    }
                    tr:hover {
                        background-color: #f1f1f1;
                    }
                </style>
            </head>
            <body>
                <h1>Energy Meters Data (Monthly Timeline)</h1>
                <p>Total Time Slots: ${timelineData.length}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Month</th>
                            <th>Date (Local Time)</th>
                            <th>Total KwhPerN</th>
                            <th>Total KwhPerN2</th>
                            <th>Total KwhPerN3</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>`;

        timelineData.forEach((item) => {
            const { _id, firstDatetime, totalKwhPerN, totalKwhPerN2, totalKwhPerN3, count } = item;
            html += `
                <tr>
                    <td>${_id.year}</td>
                    <td>${_id.month}</td>
                    <td>${firstDatetime.toLocaleDateString()}</td>
                    <td>${totalKwhPerN !== null ? totalKwhPerN : 'null'}</td>
                    <td>${totalKwhPerN2 !== null ? totalKwhPerN2 : 'null'}</td>
                    <td>${totalKwhPerN3 !== null ? totalKwhPerN3 : 'null'}</td>
                    <td>${count}</td>
                </tr>
            `;
        });

        html += `</tbody>
                </table>
            </body>
            </html>`;

        res.send(html);
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).send('<h1>Error retrieving data</h1>');
    }
});
router.get('/energy-meter-data-group', async (req, res) => {
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

        const deviceIdInt = parseInt(deviceId);
        console.log('deviceId:', deviceIdInt);

        const filterCriteria = {
            DeviceId: deviceIdInt,
            DeviceTimeStampDate_Local: { $gte: start, $lte: end }
        };

        const data = await Data.aggregate([
            { $match: filterCriteria },
            {
                $addFields: {
                    localDateParts: {
                        $dateToParts: {
                            date: "$DeviceTimeStampDate_Local",
                            timezone: "Asia/Colombo" // Replace with your local time zone
                        }
                    }
                }
            },
            {
                $group: {
                    _id: {
                        hour: "$localDateParts.hour", // Use the adjusted hour
                        day: "$localDateParts.day",
                        month: "$localDateParts.month",
                        year: "$localDateParts.year"
                    },
                    firstDatetime: { $min: "$DeviceTimeStampDate_Local" },
                    totalKwhPerN: { $sum: "$KwhPerN" },
                    totalKwhPerN2: { $sum: "$KwhPerN2" },
                    totalKwhPerN3: { $sum: "$KwhPerN3" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.hour": 1 } }
        ]);
        

        if (!data.length) {
            return res.send('<h1>No Data Found for the given criteria</h1>');
        }

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Energy Meters Data (Hourly)</title>
                <style>
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 20px 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    th {
                        background-color: #f2f2f2;
                    }
                    tr:nth-child(even) {
                        background-color: #f9f9f9;
                    }
                    tr:hover {
                        background-color: #f1f1f1;
                    }
                </style>
            </head>
            <body>
                <h1>Energy Meters Data (Grouped by Hourly)</h1>
                <p>Total Groups: ${data.length}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Month</th>
                            <th>Day</th>
                            <th>Hour</th>
                            <th>DateTime (First - Local Time)</th>
                            <th>Total KwhPerN</th>
                            <th>Total KwhPerN2</th>
                            <th>Total KwhPerN3</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        data.forEach((item) => {
            const { _id, firstDatetime, totalKwhPerN, totalKwhPerN2, totalKwhPerN3, count } = item;
            const localDatetime = new Date(firstDatetime).toLocaleString(); // Convert to local time string
            html += `
                <tr>
                    <td>${_id.year}</td>
                    <td>${_id.month}</td>
                    <td>${_id.day}</td>
                    <td>${_id.hour}</td>
                    <td>${localDatetime}</td>
                    <td>${totalKwhPerN}</td>
                    <td>${totalKwhPerN2}</td>
                    <td>${totalKwhPerN3}</td>
                    <td>${count}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </body>
            </html>
        `;

        res.send(html);
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).send('<h1>Error retrieving data</h1>');
    }
});

router.get('/energy-meter-data-group-frequency', async (req, res) => {
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


        const data=await getEnergyMeterGroupFrequency(deviceId,start,end,frequency);

        if (!data.length) {
            return res.send('<h1>No Data Found for the given criteria</h1>');
        }

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Energy Meters Data (${frequency.charAt(0).toUpperCase() + frequency.slice(1)})</title>
                <style>
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 20px 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    th {
                        background-color: #f2f2f2;
                    }
                    tr:nth-child(even) {
                        background-color: #f9f9f9;
                    }
                    tr:hover {
                        background-color: #f1f1f1;
                    }
                </style>
            </head>
            <body>
                <h1>Energy Meters Data (Grouped by ${frequency})</h1>
                <p>Total Groups: ${data.length}</p>
                <table>
                    <thead>
                        <tr>
                            ${frequency === 'hourly' ? '<th>Hour</th>' : ''}
                            ${frequency !== 'monthly' ? '<th>Day</th>' : ''}
                            <th>Month</th>
                            <th>Year</th>
                            <th>DateTime (First - Local Time)</th>
                            <th>Total KwhPerN</th>
                            <th>Total KwhPerN2</th>
                            <th>Total KwhPerN3</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        data.forEach((item) => {
            const { _id, firstDatetime, totalKwhPerN, totalKwhPerN2, totalKwhPerN3, count } = item;
            const localDatetime = new Date(firstDatetime).toLocaleString(); // Convert to local time string
            html += `
                <tr>
                    ${frequency === 'hourly' ? `<td>${_id.hour || ''}</td>` : ''}
                    ${frequency !== 'monthly' ? `<td>${_id.day || ''}</td>` : ''}
                    <td>${_id.month}</td>
                    <td>${_id.year}</td>
                    <td>${localDatetime}</td>
                    <td>${totalKwhPerN}</td>
                    <td>${totalKwhPerN2}</td>
                    <td>${totalKwhPerN3}</td>
                    <td>${count}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </body>
            </html>
        `;

        res.send(html);
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).send('<h1>Error retrieving data</h1>');
    }
});

router.get('/energy-meter-data', async (req, res) => {
    try {
        const { chipId, deviceId, startDate, endDate, timezoneOffset, sortOrder, top } = req.query;

        const data = await getEnergyMeterData(chipId, deviceId, startDate, endDate, timezoneOffset, sortOrder, top);

        if (!data || !data.length) {
            return res.send('<h1>No Data Found for the given criteria</h1>');
        }

        const allKeys = Object.keys(data[0]);

        const recordCount = data.length;

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Energy Meters Data</title>
                <style>
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 20px 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    th {
                        background-color: #f2f2f2;
                    }
                    tr:nth-child(even) {
                        background-color: #f9f9f9;
                    }
                    tr:hover {
                        background-color: #f1f1f1;
                    }
                </style>
            </head>
            <body>
                <h1>Energy Meters Data</h1>
                <p>Total Records: ${recordCount}</p>
                <table>
                    <thead>
                        <tr>
                            ${allKeys.map((key) => `<th>${key}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
        `;

        data.forEach((item) => {
            html += `
                <tr>
                    ${allKeys.map((key) => `<td>${item[key] ?? ''}</td>`).join('')}
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </body>
            </html>
        `;

        res.send(html);
    } catch (err) {
        console.error('Error retrieving data:', err.message);
        res.status(500).send('<h1>An error occurred while retrieving the data.</h1>');
    }
});


router.get('/energy-meters', async (req, res) => {
    try {
        const chipId = req.query.chipId;

        const data = await Data.find(chipId ? { ChipId: chipId } : {})
            .sort({ DeviceTimeStamp: -1 });

        if (!data.length) {
            return res.send('<h1>No Data Found</h1>');
        }

        const allKeys = Object.keys(data[0].toObject());

        if (!allKeys.includes('DeviceTimeStampDate_Local')) {
            allKeys.push('DeviceTimeStampDate_Local');
        }

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Energy Meters Data</title>
                <style>
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 20px 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    th {
                        background-color: #f2f2f2;
                    }
                    tr:nth-child(even) {
                        background-color: #f9f9f9;
                    }
                    tr:hover {
                        background-color: #f1f1f1;
                    }
                </style>
            </head>
            <body>
                <h1>Energy Meters Data</h1>
                <table>
                    <thead>
                        <tr>
                            ${allKeys.map((key) => `<th>${key}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${data
                            .map(
                                (item) => `
                                <tr>
                                    ${allKeys.map((key) => `<td>${item[key] ?? ''}</td>`).join('')}
                                </tr>
                            `
                            )
                            .join('')}
                    </tbody>
                </table>
            </body>
            </html>
        `;

        res.send(html);
    } catch (err) {
        console.error('Error retrieving data from MongoDB:', err);
        res.status(500).send('<h1>Error retrieving data</h1>');
    }
});

module.exports = router;
