var twilio = require("twilio");
var LogService = require("../LogService");
var Promise = require('bluebird');

class SmsProxy {

    init(config) {
        this._client = new twilio(config.twilio.accountSid, config.twilio.authToken);
        this._from = config.bridge.phoneNumber;
        return Promise.resolve();
    }

    send(phoneNumber, text) {
        if (!phoneNumber.startsWith("+")) phoneNumber = "+" + phoneNumber;
        LogService.info("SmsProxy", "Sending text message to " + phoneNumber);
        return this._client.messages.create({
            body: text,
            to: phoneNumber,
            from: this._from
        }).then(message => {
            LogService.info("SmsProxy", "Sent message to " + phoneNumber);
        });
    }
}

module.exports = new SmsProxy();