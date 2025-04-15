const Data = require('../models/dataModel');
const moment = require('moment');
const fs=require('fs');

// time gap in seconds (default 60 seconds for 1 minute)
const TIME_GAP_SECONDS = 60;

const timezoneOffset = 330;

const calculateKwhPerMinute = (lastKwh, currentKwh, timeGapInSeconds) => {
    if (timeGapInSeconds === 0) return 0;
    const kwhDifference = currentKwh - lastKwh;
    if (kwhDifference < 0) return 0;

    const perMinuteValue = (kwhDifference / timeGapInSeconds) * 60;
    return perMinuteValue;
};

// save to a .txt file
const logToFile = (logMessage) => {
    const logFilePath = './kwhPerMinuteLogs.txt';
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    const logEntry = `[${timestamp}] ${logMessage}\n`;

    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            console.error('Error writing log to file:', err);
        }
    });
};

const saveToMongoDB = async (payload) => {
    try {
        let timstampdatetimeUTC;
        if (payload.DeviceTimeStamp) {
            timstampdatetimeUTC = new Date(payload.DeviceTimeStamp * 1000).toISOString();
            payload.DeviceTimeStampDate_UTC = timstampdatetimeUTC;

            const updatedDateLocal = moment
                .utc(timstampdatetimeUTC)
                .add(timezoneOffset, "minutes")
                .format("YYYY-MM-DD HH:mm:ss");

            payload.DeviceTimeStampDate_Local = updatedDateLocal;

            const latestRecord = await Data.findOne({ ChipId: payload.ChipId })
                .sort({ DeviceTimeStamp: -1 })
                .lean();

            if (latestRecord) {
                const lastTimestamp = latestRecord.DeviceTimeStamp * 1000;
                const currentTimestamp = payload.DeviceTimeStamp * 1000;
                const timeDifference = (currentTimestamp - lastTimestamp) / 1000;

                if (timeDifference < TIME_GAP_SECONDS) {
                    console.log(
                        `Skipping save: Time difference (${timeDifference.toFixed(
                            2
                        )} seconds) is less than ${TIME_GAP_SECONDS} seconds.`
                    );
                    return;
                }

                payload.KwhPerN = calculateKwhPerMinute(
                    latestRecord.Kwh,
                    payload.Kwh,
                    timeDifference
                );

                payload.KwhPerN2 = 0;
                if (payload.Kwh2 != null && payload.Kwh2 != 0) {
                    payload.KwhPerN2 = calculateKwhPerMinute(
                        latestRecord.Kwh2,
                        payload.Kwh2,
                        timeDifference
                    );
                }

                payload.KwhPerN3 = 0;
                if (payload.Kwh3 != null && payload.Kwh3 != 0) {
                    payload.KwhPerN3 = calculateKwhPerMinute(
                        latestRecord.Kwh3,
                        payload.Kwh3,
                        timeDifference
                    );
                }

                const logMessage = `ChipId=${payload.ChipId}, KwhPerN=${payload.KwhPerN.toFixed(
                    5
                )}`;
                console.log(`\x1b[32mSaving Data: ${logMessage}\x1b[0m`);

                logToFile(logMessage);
            }
        } else {
            console.warn("DeviceTimeStamp not found in payload");
            return;
        }

        if (!payload.DeviceId) {
            console.warn(
                "DeviceId not provided in payload. Defaulting to 0."
            );
            payload.DeviceId = 0;
        }

        const data = new Data(payload);
        await data.save();
        console.log("\x1b[32mPayload saved to MongoDB successfully.\x1b[0m");

        logToFile(`Payload saved to MongoDB: ChipId=${payload.ChipId} KwhPerN=${payload.KwhPerN.toFixed(
                    5
                )}, KwhPerN2=${payload.KwhPerN2.toFixed(
                    5
                )} ,KwhPerN3=${payload.KwhPerN3.toFixed(
                    5
                )} `);
    } catch (err) {
        console.error("Error saving payload to MongoDB:", err);
        logToFile(`Error saving payload to MongoDB: ${err.message}`);
    }
};

module.exports = { saveToMongoDB };
