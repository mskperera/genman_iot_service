const getEnergyMeterData = async (chipId, deviceId, startDate, endDate, timezoneOffset, sortOrder = "asc", top = 0) => {
    if (!startDate || !endDate || (!chipId && !deviceId) || !timezoneOffset) {
        return res.status(400).json('<h1>Missing required parameters: chipId, startDate, endDate, or timezoneOffset.</h1>');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start) || isNaN(end)) {
        return res.status(400).json('<h1>Invalid date format. Please use a valid date and time format (e.g., YYYY-MM-DDTHH:mm:ss).</h1>');
    }

    const startAdjusted = convertToLocalTime(start, 330);
    const endAdjusted = convertToLocalTime(end, 330);

    console.log('getEnergyMeterData startISO endISO', startAdjusted, endAdjusted);

    // Determine the sorting order based on the sortOrder parameter
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    // Set default query
    let query;

    if (chipId) {
        query = Data.find({
            ChipId: chipId,
            DeviceTimeStampDate_Local: { $gte: startAdjusted, $lte: endAdjusted }
        }).sort({ DeviceTimeStampDate_UTC: sortDirection });
    }
    if (deviceId) {
        query = Data.find({
            DeviceId: deviceId,
            DeviceTimeStampDate_Local: { $gte: startAdjusted, $lte: endAdjusted }
        }).sort({ DeviceTimeStampDate_UTC: sortDirection });
    }

    // Apply limit if `top` is greater than 0
    if (top > 0) {
        query = query.limit(top);
    }

    const data = await query;
    //console.log(' updatedData data', data);
    const updatedData =[];
    
    data.forEach(e=>{

     updatedData.push({
    _id: e._id,
    kwh: e.Kwh, 
    kwh2: e.Kwh2, 
    kwh3: e.Kwh3, 
    kwhPerN: e.KwhPerN,
    kwhPerN2: e.KwhPerN2,
    kwhPerN3: e.KwhPerN3,
    chipId: e.ChipId,
    deviceId: e.DeviceId,
    deviceTimeStamp: e.DeviceTimeStamp,
    deviceTimeStampDate_UTC: e.DeviceTimeStampDate_UTC,
    timeStamp_local:convertToLocalTime(e.DeviceTimeStampDate_UTC, 330),
    createdDate: e.CreatedDate,
    createdDate_UTC: e.CreatedDate_UTC,
    dataSourceId: e.dataSourceId,
    isMaximumDemandProcessed: e.isMaximumDemandProcessed,
        })
    })

  
 
    return updatedData;//;
};




const getTotalConsumedKwh = async (chipId, deviceId, startDate, endDate, timezoneOffset) => {
    if (!startDate || !endDate || (!chipId && !deviceId) || !timezoneOffset) {
        throw new Error("Missing required parameters: chipId, startDate, endDate, or timezoneOffset.");
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start) || isNaN(end)) {
        throw new Error("Invalid date format. Please use a valid date and time format (e.g., YYYY-MM-DDTHH:mm:ss).");
    }

    const startAdjusted = convertToLocalTime(start, timezoneOffset);
    const endAdjusted = convertToLocalTime(end, timezoneOffset);

    console.log("Adjusted start and end dates:", startAdjusted, endAdjusted);

    // Build the match condition based on chipId or deviceId
    const matchCondition = {
        DeviceTimeStampDate_Local: { $gte: startAdjusted, $lte: endAdjusted }
    };

    if (chipId) {
        matchCondition.ChipId = chipId;
    }

    if (deviceId) {
        matchCondition.DeviceId = deviceId;
    }

    // Fetch the first and last record within the date range
    const [firstRecord] = await Data.find(matchCondition)
        .sort({ DeviceTimeStampDate_Local: 1 })
        .limit(1);

    const [lastRecord] = await Data.find(matchCondition)
        .sort({ DeviceTimeStampDate_Local: -1 })
        .limit(1);

    // Calculate the total consumed kWh
    if (!firstRecord || !lastRecord) {
        return { totalConsumedKwh: 0 }; // No data in the range
    }

    const totalConsumedKwh = lastRecord.Kwh - firstRecord.Kwh;

    return {
        totalConsumedKwh,
        firstRecord: firstRecord.Kwh,
        lastRecord: lastRecord.Kwh,
    };
};

// engergy meter backend apis
const getEnergyMeterGroupFrequency=async (deviceId,start,end,frequency)=>{
    const deviceIdInt = parseInt(deviceId);
    console.log('deviceId:', deviceIdInt);
    console.log('frequency:', frequency);

    // Filter criteria
    const filterCriteria = {
        DeviceId: deviceIdInt,
        DeviceTimeStampDate_Local: { $gte: start, $lte: end }
    };

    // Determine grouping fields based on frequency
    let groupFields = {};
    switch (frequency.toLowerCase()) {
        case 'hourly':
            groupFields = {
                hour: "$localDateParts.hour",
                day: "$localDateParts.day",
                month: "$localDateParts.month",
                year: "$localDateParts.year"
            };
            break;
        case 'daily':
            groupFields = {
                day: "$localDateParts.day",
                month: "$localDateParts.month",
                year: "$localDateParts.year"
            };
            break;
        case 'monthly':
            groupFields = {
                month: "$localDateParts.month",
                year: "$localDateParts.year"
            };
            break;
            case 'weekly':
                groupFields = {
                    week: "$localDateParts.week",
                    year: "$localDateParts.year"
                };
                break;
        default:
            return res.status(400).send('<h1>Invalid frequency. Allowed values are: hourly, daily, monthly.</h1>');
    }

    // Aggregation pipeline
    const data = await Data.aggregate([
        { $match: filterCriteria },
        {
            $addFields: {
                localDateParts: {
                    $dateToParts: {
                        date: "$DeviceTimeStampDate_Local",
                        timezone: "Asia/Colombo" // Replace with your local time zone
                    }
                },
                week: { $isoWeek: "$DeviceTimeStampDate_Local" } // Add ISO week number separately
            }
        },
        {
            $group: {
                _id: groupFields,
                firstDatetime: { $min: "$DeviceTimeStampDate_Local" },
                totalKwhPerN: { $sum: "$KwhPerN" },
                totalKwhPerN2: { $sum: "$KwhPerN2" },
                totalKwhPerN3: { $sum: "$KwhPerN3" },
                count: { $sum: 1 }
            }
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.week": 1, "_id.day": 1, "_id.hour": 1 } }
    ]);

    return data;
}

const getEntergyMeterGroupHourlyTimeline=async(deviceId,start,end)=>{

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
                        timezone: "Asia/Colombo" // Replace with your local time zone
                    }
                }
            }
        },
        {
            $group: {
                _id: {
                    hour: "$localDateParts.hour",
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
        current.setHours(current.getHours() + 1);
    }
    
    const dataMap = data.reduce((map, item) => {
        const { _id } = item;
        const dateKey = `${_id.year}-${_id.month}-${_id.day} ${_id.hour}:00`;
        map[dateKey] = item;
        return map;
    }, {});
    
    const timelineData = timeSlots.map((slot) => {
        const dateKey = `${slot.getFullYear()}-${slot.getMonth() + 1}-${slot.getDate()} ${slot.getHours()}:00`;
        const matchedData = dataMap[dateKey];
        return matchedData
            ? {
                  ...matchedData,
                  date: slot.toLocaleString()
              }
            : {
                  _id: {
                      year: slot.getFullYear(),
                      month: slot.getMonth() + 1,
                      day: slot.getDate(),
                      hour: slot.getHours()
                  },
                  firstDatetime: slot,
                  totalKwhPerN: null,
                  totalKwhPerN2: null,
                  totalKwhPerN3: null,
                  count: 0,
                  date: slot.toLocaleString()
              };
    });
    
    return timelineData;
    }


module.exports={getEnergyMeterData,getEnergyMeterGroupFrequency,getEntergyMeterGroupHourlyTimeline};