var twilio = require("twilio");
var LogService = require("../LogService");

/**
 * Handles outbound Twilio SMS messages
 */
class TwilioSmsSender {

    /**
     * Configures the Twilio SMS sender
     * @param config the configuration to use
     */
    init(config) {
        this._client = new twilio(config.twilio.accountSid, config.twilio.authToken);
    }

    /**
     * Sends a new SMS message to a phone number
     * @param {string} fromPhoneNumber the phone number to send as
     * @param {string} toPhoneNumber the phone number to send to
     * @param {string} text the text to send
     * @returns {Promise<*>} resolves when completed
     */
    send(fromPhoneNumber, toPhoneNumber, text, mediaUrl) {
        if (!toPhoneNumber.startsWith("+")) toPhoneNumber = "+" + toPhoneNumber;
        if (!fromPhoneNumber.startsWith("+")) fromPhoneNumber = "+" + fromPhoneNumber;

        LogService.info("TwilioSmsSender", "Sending text message to " + toPhoneNumber + " from " + fromPhoneNumber);

	var obj = {
            body: text,
            to: toPhoneNumber,
            from: fromPhoneNumber
        };

        if (mediaUrl != null) {
            obj.mediaUrl = mediaUrl;
        }

        return this._client.messages.create(obj)
        .then(message => {
            LogService.info("TwilioSmsSender", "Sent message to " + toPhoneNumber + " from " + fromPhoneNumber);
        });
    }
}

module.exports = new TwilioSmsSender();
