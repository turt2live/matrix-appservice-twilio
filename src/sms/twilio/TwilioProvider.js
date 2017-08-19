class TwilioProvider {
    sendSms(phoneNumber, text) {
        // TODO: Send text
        console.log(phoneNumber + " : " + text);
    }
}

module.exports = new TwilioProvider();