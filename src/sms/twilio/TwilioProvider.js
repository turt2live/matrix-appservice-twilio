var twilio = require("twilio");
var LogService = require("../../LogService");
var Promise = require('bluebird');

class TwilioProvider {

    init(config) {
        this._client = new twilio(config.twilio.accountSid, config.twilio.accountToken);
        this._from = config.smsBridge.phoneNumber;
        return Promise.resolve();
    }

    sendSms(phoneNumber, text) {
        if (!phoneNumber.startsWith("+")) phoneNumber = "+" + phoneNumber;
        return this._client.messages.create({
            body: text,
            to: phoneNumber,
            from: this._from
        }).then(message => {
            LogService.info("TwilioProvider", "Sent message to " + phoneNumber);
        });
    }
}

module.exports = new TwilioProvider();