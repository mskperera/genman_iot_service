function convertToLocalTime(utcDate, offsetMinutes) {
   
    const updatedDateLocal = moment.utc(utcDate).add(330, 'minutes').format("YYYY-MM-DD HH:mm:ss");

    return updatedDateLocal;

}

module.exports={convertToLocalTime};