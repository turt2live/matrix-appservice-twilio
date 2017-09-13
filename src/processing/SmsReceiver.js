var LogService = require("../LogService");
var PubSub = require("pubsub-js");
var PhoneNumberManager = require("./PhoneNumberManager");
var _ = require("lodash");

/**
 * Handles incoming SMS from Twilio and sends it to Matrix
 */
class SmsReceiver {
    constructor() {
        PubSub.subscribe("sms_recv", this._onSms.bind(this));
    }

    /**
     * Sets the bridge to use in this receiver
     * @param {TwilioBridge} bridge the bridge to use
     */
    setBridge(bridge) {
        this._bridge = bridge;
    }

    _onSms(topic, event) {
        LogService.info("SmsReceiver", "Processing SMS from " + event.from + " to " + event.to);

        var virtualRooms = PhoneNumberManager.getVirtualRoomIds(event.to);
        var realRooms = PhoneNumberManager.getRealRoomIds(event.from);
        var targetRooms = _.filter(realRooms, rr => virtualRooms.indexOf(rr) !== -1);

        var intent = this._bridge.getTwilioIntent(event.from);
        for (var roomId of targetRooms) {
            LogService.info("SmsReceiver", "Sending text from " + event.from + " to " + event.to + " to room " + roomId);
            intent.sendText(roomId, event.body);
        }

        // TODO: Create room if there is no room already
    }
}

module.exports = new SmsReceiver();