var fs = require("fs");
var config = require("js-yaml").safeLoad(fs.readFileSync("config/config.yaml", "utf8"));

var accountSid = config.twilio.accountSid;
var authToken = config.twilio.authToken;
var client = require('twilio')(accountSid, authToken);

client.messages.create({
    body: 'This is a test',
    to: '+14108675309',
    from: '+15005550006',
}, (err, sms) => {
    if (err) console.error(err);
    else console.log(sms.sid);
});