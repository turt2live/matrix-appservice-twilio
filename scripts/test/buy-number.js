var fs = require("fs");
var config = require("js-yaml").safeLoad(fs.readFileSync("config/config.yaml", "utf8"));

var accountSid = config.twilio.accountSid;
var authToken = config.twilio.authToken;
var client = require('twilio')(accountSid, authToken);

client.incomingPhoneNumbers.create({
    smsUrl: "https://demo.twilio.com/docs/sms.xml", // always replies "Holy biscuits! Thanks for trying Twilio's documentation!"
    phoneNumber: "+15005550006" // safe number to register
}, (err, number) => {
    if (err) console.error(err);
    else console.log(number.sid);
});