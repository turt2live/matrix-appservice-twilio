var fs = require("fs");
var config = require("js-yaml").safeLoad(fs.readFileSync("config/config.yaml", "utf8"));

var accountSid = config.twilio.accountSid;
var authToken = config.twilio.authToken;
var client = require('twilio')(accountSid, authToken);

const countryCode = 'GB';
const searchQuery = {
    SmsEnabled: true,
    VoiceEnabled: true,
    ExcludeAllAddressRequired: true, // we're not going to even begin to deal with this
};

//searchQuery["areaCode"] = 587;

client.availablePhoneNumbers(countryCode).local.list(searchQuery).then(phoneNumbers => {
    console.log(phoneNumbers.map(p => p.friendlyName + " (" + p.phoneNumber + ")"));
});